import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Contact, Drip, DripEnrollment, Template, Tenant } from '../models/index.js';
import { authorize } from '../middleware/auth.js';
import { validate, notFound, badRequest } from '../utils/http.js';
import { audit } from '../services/audit.js';
import { segmentFilterSchema, segmentQuery } from '../services/segments.js';
import { automationSettings, enrollContacts } from '../services/drips.js';
import { getContactFields } from '../services/contactFields.js';
import { getLeadStatuses } from '../services/leadStatuses.js';

// Drips are built and managed by the business admin only
const router = Router();
router.use(authorize('admin'));

const objectId = z.string().refine(mongoose.isValidObjectId, 'Invalid id');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:MM').or(z.literal(''));

const dripSchema = z.object({
  name: z.string().trim().min(2).max(80),
  trigger: z.object({
    type: z.enum(['new_lead', 'ad_lead', 'tag_added', 'status_changed', 'date', 'manual']),
    sources: z.array(z.enum(['whatsapp', 'ad', 'import', 'manual'])).default([]),
    adIds: z.array(z.string()).default([]),
    tags: z.array(z.string().trim().toLowerCase().min(1)).default([]),
    statuses: z.array(z.string()).default([]),
    field: z.string().default(''),
    offsetDays: z.coerce.number().int().min(-30).max(30).default(0),
  }),
  condition: segmentFilterSchema.default({}),
  steps: z
    .array(
      z.object({
        templateId: objectId,
        variables: z.array(z.object({ source: z.enum(['field', 'static']), value: z.string() })).default([]),
        delayDays: z.coerce.number().int().min(0).max(365).default(0),
        sendTime: hhmm.default(''),
      })
    )
    .min(1, 'Add at least one message')
    .max(20),
  stopOnReply: z.boolean().default(true),
  stopStatuses: z.array(z.string()).default([]),
});

async function checkDrip(req, data) {
  const t = data.trigger;
  if (t.type === 'tag_added' && !t.tags.length) throw badRequest('Choose the tag that starts this drip');
  if (t.type === 'status_changed' && !t.statuses.length) throw badRequest('Choose the lead status that starts this drip');
  if (t.type === 'date') {
    const key = t.field.replace(/^custom\./, '');
    const field = getContactFields(req.tenant).find((f) => f.key === key);
    if (!field || field.type !== 'date') throw badRequest('Choose a date field (e.g. Birthday). Add one in Settings → Contact fields with type "Date".');
    t.field = `custom.${key}`;
  }
  const statusKeys = new Set(getLeadStatuses(req.tenant).map((s) => s.key));
  for (const s of [...t.statuses, ...data.stopStatuses]) if (!statusKeys.has(s)) throw badRequest(`Unknown lead status "${s}"`);
  const ids = [...new Set(data.steps.map((s) => s.templateId))];
  const templates = await Template.find({ _id: { $in: ids }, tenantId: req.tenantId });
  if (templates.length !== ids.length) throw badRequest('A selected template was not found');
  for (const [i, step] of data.steps.entries()) {
    const tpl = templates.find((x) => String(x._id) === step.templateId);
    if ((step.variables?.length || 0) < tpl.variableCount) throw badRequest(`Message ${i + 1}: fill all ${tpl.variableCount} variable(s) of "${tpl.name}"`);
  }
}

async function findDrip(req) {
  if (!mongoose.isValidObjectId(req.params.id)) throw notFound('Drip not found');
  const drip = await Drip.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!drip) throw notFound('Drip not found');
  return drip;
}

// Enrollment counts per drip: { active, completed, stopped, sent }
async function statsFor(dripIds) {
  const rows = await DripEnrollment.aggregate([
    { $match: { dripId: { $in: dripIds } } },
    {
      $group: {
        _id: '$dripId',
        total: { $sum: 1 },
        active: { $sum: { $cond: [{ $in: ['$status', ['active', 'sending']] }, 1, 0] } },
        completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        stopped: { $sum: { $cond: [{ $eq: ['$status', 'stopped'] }, 1, 0] } },
        replied: { $sum: { $cond: [{ $eq: ['$stoppedReason', 'replied'] }, 1, 0] } },
        sent: { $sum: { $size: { $filter: { input: '$history', cond: { $eq: ['$$this.status', 'sent'] } } } } },
        failed: { $sum: { $size: { $filter: { input: '$history', cond: { $in: ['$$this.status', ['failed', 'skipped']] } } } } },
      },
    },
  ]);
  return Object.fromEntries(rows.map(({ _id, ...r }) => [String(_id), r]));
}

router.get('/', async (req, res) => {
  const drips = await Drip.find({ tenantId: req.tenantId }).sort({ createdAt: -1 }).populate('steps.templateId', 'name status');
  const stats = await statsFor(drips.map((d) => d._id));
  res.json(drips.map((d) => ({ ...d.toObject(), stats: stats[String(d._id)] || { total: 0, active: 0, completed: 0, stopped: 0, replied: 0, sent: 0, failed: 0 } })));
});

router.get('/:id', async (req, res) => {
  const drip = await findDrip(req);
  const stats = await statsFor([drip._id]);
  res.json({ ...drip.toObject(), stats: stats[String(drip._id)] || {} });
});

router.post('/', async (req, res) => {
  const data = validate(dripSchema, req.body);
  await checkDrip(req, data);
  const drip = await Drip.create({ ...data, tenantId: req.tenantId, createdBy: req.user._id, status: 'draft' });
  await audit(req, 'drip.create', { targetType: 'Drip', targetId: drip._id });
  res.status(201).json(drip);
});

router.put('/:id', async (req, res) => {
  const data = validate(dripSchema, req.body);
  await checkDrip(req, data);
  const drip = await findDrip(req);
  // People already inside keep their place; if steps were removed, the extra ones simply finish
  Object.assign(drip, data);
  await drip.save();
  await audit(req, 'drip.update', { targetType: 'Drip', targetId: drip._id });
  res.json(drip);
});

/** status: active | paused. includeExisting (on activate): also add contacts that already match the trigger */
router.post('/:id/status', async (req, res) => {
  const { status, includeExisting } = validate(z.object({ status: z.enum(['active', 'paused']), includeExisting: z.boolean().default(false) }), req.body);
  const drip = await findDrip(req);
  drip.status = status;
  if (status === 'active' && !drip.activatedAt) drip.activatedAt = new Date();
  await drip.save();
  let added = 0;
  if (status === 'active' && includeExisting && ['tag_added', 'status_changed', 'ad_lead'].includes(drip.trigger.type)) {
    const { tz } = automationSettings(await Tenant.findById(req.tenantId).select('settings.automation'));
    const t = drip.trigger;
    const extra = t.type === 'tag_added' ? { tags: { $in: t.tags } } : t.type === 'status_changed' ? { leadStatus: { $in: t.statuses } } : t.adIds.length ? { 'adSource.sourceId': { $in: t.adIds } } : { 'adSource.sourceId': { $ne: null } };
    const ids = (await Contact.find({ $and: [segmentQuery(req.tenantId, drip.condition, tz), extra, { optedOut: false }] }).select('_id').limit(50000).lean()).map((c) => c._id);
    added = await enrollContacts(drip, ids, { tz });
  }
  await audit(req, `drip.${status === 'active' ? 'activate' : 'pause'}`, { targetType: 'Drip', targetId: drip._id, meta: { added } });
  res.json({ drip, added });
});

/** Add contacts by hand: { contactIds } or { filter } (smart filter) */
router.post('/:id/enroll', async (req, res) => {
  const { contactIds, filter } = validate(z.object({ contactIds: z.array(objectId).max(50000).optional(), filter: segmentFilterSchema.optional() }), req.body);
  const drip = await findDrip(req);
  if (drip.trigger.type === 'date') throw badRequest('Birthday / anniversary drips add people automatically on their date');
  const { tz } = automationSettings(await Tenant.findById(req.tenantId).select('settings.automation'));
  const query = filter ? segmentQuery(req.tenantId, filter, tz) : { tenantId: req.tenantId, _id: { $in: contactIds || [] } };
  const ids = (await Contact.find({ $and: [query, { optedOut: false }] }).select('_id').limit(50000).lean()).map((c) => c._id);
  const added = await enrollContacts(drip, ids, { tz });
  await audit(req, 'drip.enroll', { targetType: 'Drip', targetId: drip._id, meta: { added } });
  res.json({ added, matched: ids.length, alreadyIn: ids.length - added });
});

router.get('/:id/enrollments', async (req, res) => {
  const drip = await findDrip(req);
  const filter = { dripId: drip._id };
  if (req.query.status) filter.status = req.query.status === 'active' ? { $in: ['active', 'sending'] } : req.query.status;
  const limit = Math.min(100, Number(req.query.limit) || 50);
  const page = Math.max(1, Number(req.query.page) || 1);
  const [items, total] = await Promise.all([
    DripEnrollment.find(filter).sort({ enrolledAt: -1 }).skip((page - 1) * limit).limit(limit).populate('contactId', 'name phone leadStatus'),
    DripEnrollment.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit });
});

// Take one person out of the drip
router.delete('/:id/enrollments/:enrollmentId', async (req, res) => {
  const drip = await findDrip(req);
  const r = await DripEnrollment.updateOne({ _id: req.params.enrollmentId, dripId: drip._id, status: { $in: ['active', 'sending'] } }, { $set: { status: 'stopped', stoppedReason: 'removed', nextRunAt: null } });
  res.json({ ok: r.modifiedCount === 1 });
});

router.delete('/:id', async (req, res) => {
  const drip = await findDrip(req);
  await DripEnrollment.deleteMany({ dripId: drip._id });
  await drip.deleteOne();
  await audit(req, 'drip.delete', { targetType: 'Drip', targetId: drip._id, meta: { name: drip.name } });
  res.json({ ok: true });
});

export default router;
