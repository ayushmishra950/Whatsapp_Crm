import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import {
  Plan, Tenant, User, Contact, Conversation, Message, Template, Campaign, CampaignRecipient, AuditLog,
} from '../models/index.js';
import { authenticate, authorize, signToken } from '../middleware/auth.js';
import { validate, notFound, conflict, paginate, escapeRegex, badRequest } from '../utils/http.js';
import { audit } from '../services/audit.js';
import { emitToSuperAdmins, emitToTenant } from '../services/socket.js';
import { addMonths, currentMonth } from '../services/subscription.js';
import { sessionPayload } from './auth.js';

const router = Router();
router.use(authenticate, authorize('super_admin'));

const objectId = z.string().refine((v) => mongoose.isValidObjectId(v), 'Invalid id');

// ---------- Dashboard ----------

router.get('/stats', async (_req, res) => {
  const now = new Date();
  const [tenants, activeTenants, suspended, plans, usage, mrrAgg] = await Promise.all([
    Tenant.countDocuments(),
    Tenant.countDocuments({ status: 'active', 'subscription.status': { $in: ['active', 'trial'] }, 'subscription.currentPeriodEnd': { $gt: now } }),
    Tenant.countDocuments({ status: 'suspended' }),
    Plan.countDocuments({ isActive: true }),
    Tenant.aggregate([{ $match: { 'usage.month': currentMonth() } }, { $group: { _id: null, total: { $sum: '$usage.messagesSent' } } }]),
    Tenant.aggregate([
      { $match: { status: 'active', 'subscription.status': 'active', 'subscription.currentPeriodEnd': { $gt: now } } },
      { $lookup: { from: 'plans', localField: 'plan', foreignField: '_id', as: 'plan' } },
      { $unwind: '$plan' },
      { $group: { _id: null, mrr: { $sum: '$plan.priceMonthly' } } },
    ]),
  ]);
  const expiringSoon = await Tenant.find({
    'subscription.currentPeriodEnd': { $gt: now, $lt: new Date(now.getTime() + 7 * 864e5) },
  })
    .select('name subscription')
    .limit(10);
  res.json({
    tenants,
    activeTenants,
    suspended,
    plans,
    messagesThisMonth: usage[0]?.total || 0,
    mrr: mrrAgg[0]?.mrr || 0,
    expiringSoon,
  });
});

// ---------- Plans ----------

const planFields = z.object({
  name: z.string().min(2),
  description: z.string(),
  priceMonthly: z.coerce.number().min(0),
  currency: z.string(),
  limits: z.object({
    agents: z.coerce.number().int().min(0),
    contacts: z.coerce.number().int().min(0),
    monthlyMessages: z.coerce.number().int().min(0),
  }),
  features: z.array(z.string()),
  modules: z.object({ chatbot: z.boolean() }),
  isActive: z.boolean(),
});
const createPlanSchema = planFields.partial().required({ name: true, priceMonthly: true, limits: true });
const updatePlanSchema = planFields.partial();

router.get('/plans', async (_req, res) => {
  const plans = await Plan.find().sort({ priceMonthly: 1 }).lean();
  const counts = await Tenant.aggregate([{ $group: { _id: '$plan', count: { $sum: 1 } } }]);
  const byPlan = Object.fromEntries(counts.map((c) => [String(c._id), c.count]));
  res.json(plans.map((p) => ({ ...p, tenantCount: byPlan[String(p._id)] || 0 })));
});

router.post('/plans', async (req, res) => {
  const data = validate(createPlanSchema, req.body);
  if (await Plan.exists({ name: data.name })) throw conflict('A plan with this name already exists');
  const plan = await Plan.create(data);
  await audit(req, 'plan.create', { targetType: 'Plan', targetId: plan._id });
  res.status(201).json(plan);
});

router.patch('/plans/:id', async (req, res) => {
  const data = validate(updatePlanSchema, req.body);
  const plan = await Plan.findByIdAndUpdate(req.params.id, data, { returnDocument: 'after', runValidators: true });
  if (!plan) throw notFound('Plan not found');
  if (data.modules?.chatbot === false) {
    const tenantIds = (await Tenant.find({ plan: plan._id }).select('_id')).map((t) => t._id);
    await Conversation.updateMany(
      { tenantId: { $in: tenantIds }, 'bot.active': true },
      { $set: { 'bot.active': false, 'bot.endedAt': new Date(), 'bot.endReason': 'disabled' } }
    );
  }
  await audit(req, 'plan.update', { targetType: 'Plan', targetId: plan._id, meta: data });
  res.json(plan);
});

router.delete('/plans/:id', async (req, res) => {
  if (await Tenant.exists({ plan: req.params.id })) {
    throw conflict('Plan is in use by businesses. Deactivate it instead.');
  }
  const plan = await Plan.findByIdAndDelete(req.params.id);
  if (!plan) throw notFound('Plan not found');
  await audit(req, 'plan.delete', { targetType: 'Plan', targetId: plan._id });
  res.json({ ok: true });
});

// ---------- Tenants (businesses) ----------

router.get('/tenants', async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const filter = {};
  if (req.query.search) filter.name = { $regex: escapeRegex(req.query.search), $options: 'i' };
  if (req.query.status) filter.status = req.query.status;
  const [items, total] = await Promise.all([
    Tenant.find(filter).populate('plan', 'name priceMonthly').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Tenant.countDocuments(filter),
  ]);
  const ids = items.map((t) => t._id);
  const [admins, agentCounts, contactCounts] = await Promise.all([
    User.find({ tenantId: { $in: ids }, role: 'admin' }).select('name email tenantId').lean(),
    User.aggregate([{ $match: { tenantId: { $in: ids }, role: 'agent' } }, { $group: { _id: '$tenantId', n: { $sum: 1 } } }]),
    Contact.aggregate([{ $match: { tenantId: { $in: ids } } }, { $group: { _id: '$tenantId', n: { $sum: 1 } } }]),
  ]);
  const agentMap = Object.fromEntries(agentCounts.map((a) => [String(a._id), a.n]));
  const contactMap = Object.fromEntries(contactCounts.map((a) => [String(a._id), a.n]));
  res.json({
    items: items.map((t) => ({
      ...t,
      admin: admins.find((a) => String(a.tenantId) === String(t._id)) || null,
      agentCount: agentMap[String(t._id)] || 0,
      contactCount: contactMap[String(t._id)] || 0,
    })),
    total,
    page,
    limit,
  });
});

const createTenantSchema = z.object({
  name: z.string().min(2),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  planId: objectId,
  subscriptionStatus: z.enum(['trial', 'active']).default('trial'),
  months: z.coerce.number().int().min(1).max(36).default(1),
  admin: z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(8, 'Password must be at least 8 characters'),
  }),
});

router.post('/tenants', async (req, res) => {
  const data = validate(createTenantSchema, req.body);
  const plan = await Plan.findById(data.planId);
  if (!plan) throw badRequest('Plan not found');
  if (await User.exists({ email: data.admin.email.toLowerCase() })) throw conflict('Admin email is already in use');

  const now = new Date();
  const tenant = await Tenant.create({
    name: data.name,
    email: data.email || data.admin.email,
    phone: data.phone,
    plan: plan._id,
    subscription: { status: data.subscriptionStatus, currentPeriodStart: now, currentPeriodEnd: addMonths(now, data.months) },
    usage: { month: currentMonth(), messagesSent: 0 },
  });
  try {
    await User.create({ ...data.admin, tenantId: tenant._id, role: 'admin' });
  } catch (err) {
    await Tenant.deleteOne({ _id: tenant._id });
    throw err;
  }
  await audit(req, 'tenant.create', { tenantId: tenant._id, targetType: 'Tenant', targetId: tenant._id });
  res.status(201).json(tenant);
});

router.get('/tenants/:id', async (req, res) => {
  const tenant = await Tenant.findById(req.params.id).populate('plan');
  if (!tenant) throw notFound('Business not found');
  const tenantId = tenant._id;
  const [users, contacts, conversations, campaigns, templates] = await Promise.all([
    User.find({ tenantId }).select('name email role isActive lastLoginAt createdAt').sort({ role: 1 }),
    Contact.countDocuments({ tenantId }),
    Conversation.countDocuments({ tenantId }),
    Campaign.countDocuments({ tenantId }),
    Template.countDocuments({ tenantId }),
  ]);
  res.json({ tenant, users, counts: { contacts, conversations, campaigns, templates } });
});

const updateTenantSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  status: z.enum(['active', 'suspended']).optional(),
  planId: objectId.optional(),
});

router.patch('/tenants/:id', async (req, res) => {
  const { planId, ...data } = validate(updateTenantSchema, req.body);
  if (planId) {
    if (!(await Plan.exists({ _id: planId }))) throw badRequest('Plan not found');
    data.plan = planId;
  }
  const prev = await Tenant.findById(req.params.id).select('name email phone').lean();
  const tenant = await Tenant.findByIdAndUpdate(req.params.id, data, { returnDocument: 'after' }).populate('plan');
  if (!tenant) throw notFound('Business not found');
  const changes = Object.fromEntries(
    ['name', 'email', 'phone'].filter((k) => data[k] !== undefined && String(data[k] || '') !== String(prev?.[k] || '')).map((k) => [k, { from: prev?.[k] || '', to: data[k] || '' }])
  );
  if (Object.keys(changes).length) {
    const payload = { tenantId: String(tenant._id), name: tenant.name, email: tenant.email, phone: tenant.phone, changes, by: { name: req.user.name, role: 'super_admin' }, at: new Date() };
    emitToSuperAdmins('tenant:updated', payload); // other Super Admin screens
    emitToTenant(tenant._id, 'tenant:profile', payload); // the business's own screens show the new name
  }
  await audit(req, data.status ? `tenant.${data.status === 'suspended' ? 'suspend' : 'activate'}` : 'tenant.update', {
    tenantId: tenant._id, targetType: 'Tenant', targetId: tenant._id, meta: { ...data, planId },
  });
  res.json(tenant);
});

/** Edit the business admin's name / login email (password: reset-admin-password) */
router.patch('/tenants/:id/admin', async (req, res) => {
  const data = validate(z.object({ name: z.string().trim().min(2).max(80).optional(), email: z.string().trim().toLowerCase().email().optional() }), req.body);
  if (!mongoose.isValidObjectId(req.params.id)) throw notFound('Business not found');
  const admin = await User.findOne({ tenantId: req.params.id, role: 'admin' });
  if (!admin) throw notFound('This business has no admin');
  if (data.email && data.email !== admin.email && (await User.exists({ email: data.email, _id: { $ne: admin._id } }))) {
    throw conflict('This email is already used by another account');
  }
  const before = { name: admin.name, email: admin.email };
  Object.assign(admin, data);
  await admin.save();
  await audit(req, 'tenant.admin_update', { tenantId: admin.tenantId, targetType: 'User', targetId: admin._id, meta: { before, after: data } });
  emitToSuperAdmins('tenant:updated', { tenantId: String(admin.tenantId), admin: { name: admin.name, email: admin.email }, by: { name: req.user.name, role: 'super_admin' }, at: new Date() });
  res.json({ _id: admin._id, name: admin.name, email: admin.email });
});

// Monthly billing: mark a payment received and extend the period
router.post('/tenants/:id/subscription', async (req, res) => {
  const { action, months } = validate(
    z.object({ action: z.enum(['renew', 'cancel']), months: z.coerce.number().int().min(1).max(36).default(1) }),
    req.body
  );
  const tenant = await Tenant.findById(req.params.id);
  if (!tenant) throw notFound('Business not found');

  if (action === 'renew') {
    const now = new Date();
    const currentEnd = tenant.subscription?.currentPeriodEnd;
    // Extend from current end if still running, otherwise start fresh today
    const start = currentEnd && currentEnd > now ? currentEnd : now;
    tenant.subscription = {
      status: 'active',
      currentPeriodStart: currentEnd && currentEnd > now ? tenant.subscription.currentPeriodStart : now,
      currentPeriodEnd: addMonths(start, months),
    };
  } else {
    tenant.subscription.status = 'cancelled';
  }
  await tenant.save();
  await audit(req, `subscription.${action}`, { tenantId: tenant._id, targetType: 'Tenant', targetId: tenant._id, meta: { months } });
  res.json(tenant);
});

// Log in as the business admin (support / troubleshooting). Always audited.
router.post('/tenants/:id/impersonate', async (req, res) => {
  const tenant = await Tenant.findById(req.params.id).populate('plan');
  if (!tenant) throw notFound('Business not found');
  const admin = await User.findOne({ tenantId: tenant._id, role: 'admin', isActive: true });
  if (!admin) throw notFound('No active admin user for this business');
  await audit(req, 'tenant.impersonate', { tenantId: tenant._id, targetType: 'User', targetId: admin._id });
  res.json({ token: signToken(admin, { impersonatedBy: req.user._id }), ...sessionPayload(admin, tenant, req.user._id) });
});

router.post('/tenants/:id/reset-admin-password', async (req, res) => {
  const { password } = validate(z.object({ password: z.string().min(8) }), req.body);
  const admin = await User.findOne({ tenantId: req.params.id, role: 'admin' });
  if (!admin) throw notFound('Admin not found');
  admin.password = password;
  await admin.save();
  await audit(req, 'tenant.reset_admin_password', { tenantId: req.params.id, targetType: 'User', targetId: admin._id });
  res.json({ ok: true });
});

// Permanently deletes the business and ALL its data
router.delete('/tenants/:id', async (req, res) => {
  const { confirmName } = validate(z.object({ confirmName: z.string() }), req.body || {});
  const tenant = await Tenant.findById(req.params.id);
  if (!tenant) throw notFound('Business not found');
  if (confirmName !== tenant.name) throw badRequest('Business name does not match');
  const tenantId = tenant._id;
  await Promise.all([
    User.deleteMany({ tenantId }),
    Contact.deleteMany({ tenantId }),
    Conversation.deleteMany({ tenantId }),
    Message.deleteMany({ tenantId }),
    Template.deleteMany({ tenantId }),
    Campaign.deleteMany({ tenantId }),
    CampaignRecipient.deleteMany({ tenantId }),
  ]);
  await tenant.deleteOne();
  await audit(req, 'tenant.delete', { tenantId, targetType: 'Tenant', targetId: tenantId, meta: { name: tenant.name } });
  res.json({ ok: true });
});

// ---------- Audit logs ----------

router.get('/audit-logs', async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const filter = {};
  if (req.query.tenantId && mongoose.isValidObjectId(req.query.tenantId)) filter.tenantId = req.query.tenantId;
  const [items, total] = await Promise.all([
    AuditLog.find(filter)
      .populate('actorId', 'name email role')
      .populate('tenantId', 'name')
      .populate('impersonatedBy', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    AuditLog.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit });
});

export default router;
