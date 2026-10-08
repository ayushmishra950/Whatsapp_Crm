import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Contact, Drip, DripEnrollment, Template, Tenant } from '../models/index.js';
import { authorize } from '../middleware/auth.js';
import { validate, notFound, badRequest } from '../utils/http.js';
import { audit } from '../services/audit.js';
import { segmentFilterSchema, segmentQuery } from '../services/segments.js';
import { automationSettings, enrollContacts } from '../services/drips.js';
import { LEAD_SOURCES, getContactFields } from '../services/contactFields.js';
import { getLeadStatuses } from '../services/leadStatuses.js';
import { isCoaching } from '../services/coaching.js';
import { missingBusinessInfo } from '../services/coachingContent.js';

// Drips are built and managed by the business admin only
const router = Router();
router.use(authorize('admin'));

const objectId = z.string().refine(mongoose.isValidObjectId, 'Invalid id');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:MM').or(z.literal(''));

const dripSchema = z.object({
  name: z.string().trim().min(2).max(80),
  trigger: z.object({
    type: z.enum(['new_lead', 'ad_lead', 'tag_added', 'status_changed', 'date', 'manual']),
    sources: z.array(z.enum(LEAD_SOURCES)).default([]),
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
        kind: z.enum(['message', 'task', 'alert', 'status']).default('message'),
        templateId: objectId.optional().nullable(),
        variables: z.array(z.object({ source: z.enum(['field', 'static']), value: z.string() })).default([]),
        templateIdHi: objectId.optional().nullable(),
        variablesHi: z.array(z.object({ source: z.enum(['field', 'static']), value: z.string() })).default([]),
        text: z.string().trim().max(200).default(''),
        dueMinutes: z.coerce.number().int().min(0).max(60 * 24 * 30).default(30),
        setStatus: z.string().default(''),
        delayDays: z.coerce.number().int().min(0).max(365).default(0),
        delayMinutes: z.coerce.number().int().min(0).max(60 * 24 * 30).default(0),
        sendTime: hhmm.default(''),
      })
    )
    .min(1, 'Add at least one step')
    .max(30),
  stopOnReply: z.boolean().default(true),
  stopStatuses: z.array(z.string()).default([]),
  stopOnStatusChange: z.boolean().optional(),
  onComplete: z.object({ setStatus: z.string().default(''), addTag: z.string().trim().toLowerCase().max(40).default('') }).default({ setStatus: '', addTag: '' }),
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
  if (data.onComplete.setStatus && !statusKeys.has(data.onComplete.setStatus)) throw badRequest('Unknown lead status in "When the drip ends"');
  // Birthday / manual drips run beside the status drips; status drips follow "one status = one drip"
  if (data.stopOnStatusChange === undefined) data.stopOnStatusChange = !['date', 'manual'].includes(t.type);
  if (!isCoaching(req.tenant)) for (const s of data.steps) Object.assign(s, { templateIdHi: null, variablesHi: [] }); // Hinglish version = coaching format
  const ids = [...new Set(data.steps.flatMap((s) => (s.kind === 'message' ? [s.templateId, s.templateIdHi] : [])).filter(Boolean))];
  const templates = await Template.find({ _id: { $in: ids }, tenantId: req.tenantId });
  if (templates.length !== ids.length) throw badRequest('A selected template was not found');
  for (const [i, step] of data.steps.entries()) {
    const n = i + 1;
    if (step.kind === 'message') {
      if (!step.templateId) throw badRequest(`Step ${n}: choose the template to send`);
      for (const [id, vars, what] of [[step.templateId, step.variables, ''], [step.templateIdHi, step.variablesHi, ' (Hinglish)']]) {
        if (!id) continue;
        const tpl = templates.find((x) => String(x._id) === String(id));
        if ((vars?.length || 0) < tpl.variableCount) throw badRequest(`Step ${n}${what}: fill all ${tpl.variableCount} variable(s) of "${tpl.name}"`);
      }
      if (!step.templateIdHi) step.variablesHi = [];
    } else {
      step.templateId = null;
      step.templateIdHi = null;
      step.variables = [];
      step.variablesHi = [];
      if ((step.kind === 'task' || step.kind === 'alert') && !step.text) throw badRequest(`Step ${n}: write what the ${step.kind} says`);
      if (step.kind === 'status' && !statusKeys.has(step.setStatus)) throw badRequest(`Step ${n}: choose the status to move the lead to`);
    }
  }
  if (!data.steps.some((s) => s.kind === 'message') && !data.steps.some((s) => s.kind !== 'message')) throw badRequest('Add at least one step');
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
  if (status === 'active') {
    // A message would go out with a blank where e.g. the rating or review link should be: ask for it first
    const ids = drip.steps.flatMap((s) => [s.templateId, s.templateIdHi]).filter(Boolean);
    const missing = missingBusinessInfo(req.tenant, await Template.find({ _id: { $in: ids } }).select('variableDefaults').lean());
    if (missing.length) throw badRequest(`Fill these in Settings → Message info first (the messages use them): ${missing.join(', ')}`);
  }
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
