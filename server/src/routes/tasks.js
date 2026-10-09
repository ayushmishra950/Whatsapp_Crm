import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Contact, Conversation, Task, User } from '../models/index.js';
import { validate, notFound, forbidden } from '../utils/http.js';
import { createTask, refreshNextAction } from '../services/alerts.js';
import { emitToTenantAdmins, emitToUser } from '../services/socket.js';

// Tasks for leads (call, call back, demo…). Admins see all; agents see theirs.
const router = Router();
const objectId = z.string().refine(mongoose.isValidObjectId, 'Invalid id');
const KINDS = ['call', 'callback', 'demo', 'followup', 'other'];

const isAdmin = (req) => req.user.role === 'admin';

async function canSeeContact(req, contactId) {
  if (isAdmin(req)) return true;
  const c = await Contact.findOne({ _id: contactId, tenantId: req.tenantId }).select('assignedTo').lean();
  if (!c) return false;
  if (!c.assignedTo || String(c.assignedTo) === String(req.user._id)) return true;
  const convs = await Conversation.find({ tenantId: req.tenantId, contactId }).select('assignedTo').lean();
  return !convs.length || convs.some((conv) => !conv.assignedTo || String(conv.assignedTo) === String(req.user._id));
}

router.get('/', async (req, res) => {
  const { status = 'open', contactId, when, assignedTo } = req.query;
  const filter = { tenantId: req.tenantId };
  if (['open', 'done', 'cancelled'].includes(status)) filter.status = status;
  if (contactId && mongoose.isValidObjectId(contactId)) filter.contactId = contactId;
  if (!isAdmin(req) && !contactId) filter.assignedTo = req.user._id;
  else if (assignedTo === 'me') filter.assignedTo = req.user._id;
  else if (assignedTo === 'none') filter.assignedTo = null;
  else if (assignedTo && mongoose.isValidObjectId(assignedTo)) filter.assignedTo = assignedTo;
  if (contactId && !(await canSeeContact(req, contactId))) throw forbidden('Not your lead');
  const now = new Date();
  if (when === 'overdue') filter.dueAt = { $lt: now };
  if (when === 'today') filter.dueAt = { $lt: new Date(now.getTime() + 24 * 36e5) };
  const tasks = await Task.find(filter)
    .sort(filter.status === 'open' ? { dueAt: 1 } : { updatedAt: -1 })
    .limit(300)
    .populate('contactId', 'name phone leadStatus course')
    .populate('assignedTo', 'name')
    .populate('doneBy', 'name')
    .lean();
  res.json(tasks);
});

router.post('/', async (req, res) => {
  const data = validate(
    z.object({
      contactId: objectId,
      title: z.string().trim().min(1, 'What should be done?').max(120),
      kind: z.enum(KINDS).default('call'),
      dueAt: z.coerce.date(),
      assignedTo: objectId.optional().nullable(),
      note: z.string().trim().max(500).default(''),
    }),
    req.body
  );
  const contact = await Contact.findOne({ _id: data.contactId, tenantId: req.tenantId });
  if (!contact) throw notFound('Lead not found');
  if (!(await canSeeContact(req, contact._id))) throw forbidden('Not your lead');
  let owner = data.assignedTo || req.user._id;
  if (!isAdmin(req)) owner = req.user._id; // agents create tasks for themselves
  else if (data.assignedTo && !(await User.exists({ _id: data.assignedTo, tenantId: req.tenantId }))) throw notFound('Team member not found');
  const task = await createTask({
    tenantId: req.tenantId, contact, title: data.title, kind: data.kind, dueAt: data.dueAt, assignedTo: owner, note: data.note,
    createdBy: req.user._id, silent: String(owner) === String(req.user._id),
  });
  res.status(201).json(task);
});

router.patch('/:id', async (req, res) => {
  const data = validate(
    z.object({
      status: z.enum(['open', 'done', 'cancelled']).optional(),
      title: z.string().trim().min(1).max(120).optional(),
      dueAt: z.coerce.date().optional(),
      assignedTo: objectId.optional().nullable(),
      note: z.string().trim().max(500).optional(),
    }),
    req.body
  );
  const task = await Task.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!task) throw notFound('Task not found');
  if (!isAdmin(req) && String(task.assignedTo) !== String(req.user._id) && !(await canSeeContact(req, task.contactId))) throw forbidden('Not your task');
  if (data.assignedTo !== undefined && !isAdmin(req)) delete data.assignedTo;
  if (data.status && data.status !== task.status) {
    task.doneAt = data.status === 'done' ? new Date() : undefined;
    task.doneBy = data.status === 'done' ? req.user._id : undefined;
  }
  if (data.dueAt) task.overdueAlertedAt = undefined; // new time: alert again if it is missed
  Object.assign(task, data);
  await task.save();
  await refreshNextAction(task.contactId);
  emitToTenantAdmins(req.tenantId, 'task:update', { _id: task._id });
  if (task.assignedTo) emitToUser(task.assignedTo, 'task:update', { _id: task._id });
  res.json(task);
});

router.delete('/:id', async (req, res) => {
  const task = await Task.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!task) throw notFound('Task not found');
  if (!isAdmin(req) && String(task.createdBy) !== String(req.user._id)) throw forbidden('Only admins can delete tasks made by others');
  await task.deleteOne();
  await refreshNextAction(task.contactId);
  emitToTenantAdmins(req.tenantId, 'task:update', { _id: task._id });
  res.json({ ok: true });
});

export default router;
