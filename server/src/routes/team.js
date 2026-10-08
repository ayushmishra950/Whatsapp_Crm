import { Router } from 'express';
import { z } from 'zod';
import { Account, User, Conversation, Contact } from '../models/index.js';
import { authorize } from '../middleware/auth.js';
import { validate, notFound, forbidden } from '../utils/http.js';
import { audit } from '../services/audit.js';
import { assertAgentLimit } from '../services/subscription.js';
import { addMember, removeOrphanAccounts } from '../services/accounts.js';

// Mounted under authenticate + requireTenant
const router = Router();

// Admin + agents (agents need it for chat transfer dropdown)
router.get('/', async (req, res) => {
  const users = await User.find({ tenantId: req.tenantId }).sort({ role: 1, name: 1 }).lean();
  const counts = await Conversation.aggregate([
    { $match: { tenantId: req.tenantId, status: { $ne: 'resolved' }, assignedTo: { $ne: null } } },
    { $group: { _id: '$assignedTo', n: { $sum: 1 } } },
  ]);
  const map = Object.fromEntries(counts.map((c) => [String(c._id), c.n]));
  // Logins also used in another business (their password is theirs: this admin can not change it)
  const shared = await User.aggregate([
    { $match: { accountId: { $in: users.map((u) => u.accountId).filter(Boolean) } } },
    { $group: { _id: '$accountId', n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
  ]);
  const sharedSet = new Set(shared.map((x) => String(x._id)));
  const result = users.map(({ password, ...u }) => ({ ...u, openChats: map[String(u._id)] || 0, sharedLogin: sharedSet.has(String(u.accountId)) }));
  // Agents only get basic info
  res.json(req.user.role === 'admin' ? result : result.map(({ _id, name, role, isActive }) => ({ _id, name, role, isActive })));
});

const agentSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().optional(),
  // Not needed when the email already has a login (the person keeps their own password)
  password: z.string().min(8, 'Password must be at least 8 characters').optional().or(z.literal('')),
});

router.post('/', authorize('admin'), async (req, res) => {
  const data = validate(agentSchema, req.body);
  await assertAgentLimit(req.tenant);
  // An email that already logs in elsewhere is added as it is: same login, this business added to it
  const { user: agent, existing } = await addMember({ tenantId: req.tenantId, role: 'agent', name: data.name, email: data.email, phone: data.phone, password: data.password || '', allowExisting: true });
  await audit(req, 'agent.create', { targetType: 'User', targetId: agent._id, meta: { existingLogin: existing } });
  res.status(201).json({ ...agent.toJSON(), existingLogin: existing });
});

router.patch('/:id', authorize('admin'), async (req, res) => {
  const data = validate(
    z.object({
      name: z.string().min(2).optional(),
      phone: z.string().optional(),
      isActive: z.boolean().optional(),
      password: z.string().min(8).optional(),
    }),
    req.body
  );
  const agent = await User.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!agent) throw notFound('Team member not found');
  if (agent.role === 'admin' && String(agent._id) !== String(req.user._id)) throw forbidden();
  if (agent.role === 'admin' && data.isActive === false) throw forbidden('You can not disable the admin account');

  const { password, ...rest } = data;
  if (password) {
    // The password belongs to the person's login: only when this business is their only one
    if (agent.accountId && (await User.countDocuments({ accountId: agent.accountId })) > 1) {
      throw forbidden('This person uses the same login for another business. They change their password themselves (Settings → Change password).');
    }
    const account = agent.accountId ? await Account.findById(agent.accountId) : null;
    if (account) {
      account.password = password;
      await account.save();
    } else {
      agent.password = password; // legacy user without a login record yet
    }
  }
  Object.assign(agent, rest);
  await agent.save();

  if (data.isActive === false) {
    // Release chats of a disabled agent back to the unassigned queue
    const released = await Conversation.find({ tenantId: req.tenantId, assignedTo: agent._id, status: { $ne: 'resolved' } }).select('contactId').lean();
    await Conversation.updateMany({ _id: { $in: released.map((c) => c._id) } }, { $set: { assignedTo: null } });
    await Contact.updateMany({ _id: { $in: released.map((c) => c.contactId) }, assignedTo: agent._id }, { $set: { assignedTo: null } });
  }
  await audit(req, 'agent.update', { targetType: 'User', targetId: agent._id, meta: { ...data, password: data.password ? '***' : undefined } });
  res.json(agent);
});

router.delete('/:id', authorize('admin'), async (req, res) => {
  const agent = await User.findOne({ _id: req.params.id, tenantId: req.tenantId, role: 'agent' });
  if (!agent) throw notFound('Agent not found');
  await Conversation.updateMany({ tenantId: req.tenantId, assignedTo: agent._id }, { $set: { assignedTo: null } });
  await Contact.updateMany({ tenantId: req.tenantId, assignedTo: agent._id }, { $set: { assignedTo: null } });
  await agent.deleteOne();
  await removeOrphanAccounts([agent.accountId]); // their login goes too, unless they work in another business
  await audit(req, 'agent.delete', { targetType: 'User', targetId: agent._id, meta: { email: agent.email } });
  res.json({ ok: true });
});

export default router;
