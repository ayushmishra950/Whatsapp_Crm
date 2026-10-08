import { Router } from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import { z } from 'zod';
import { AdSource, Contact, Conversation, Course, DripEnrollment, Message, Task, Template, Tenant, User } from '../models/index.js';
import { addInternalNote, getOrCreateConversation, renderTemplate } from '../services/messaging.js';
import { resolveVariables } from '../services/variables.js';
import { authorize } from '../middleware/auth.js';
import { validate, notFound, conflict, badRequest, paginate, escapeRegex, normalizePhone } from '../utils/http.js';
import { DEFAULT_TZ, safeTimeZone, startOfDayIn, zonedTime } from '../utils/time.js';
import { parseDateInput } from '../utils/dates.js';
import { audit } from '../services/audit.js';
import { assertContactLimit, remainingContactSlots } from '../services/subscription.js';
import { assertLeadStatus, getLeadStatuses, matchLeadStatus, statusLabel } from '../services/leadStatuses.js';
import { registerContactFields, normalizeCustomFields, getContactFields, MANUAL_SOURCES } from '../services/contactFields.js';
import { segmentQuery } from '../services/segments.js';
import { sendAutomatedTemplate, triggerDrips } from '../services/drips.js';
import { approvedTemplate } from '../services/fees.js';
import { createTask, notify, refreshNextAction } from '../services/alerts.js';
import { isCoaching } from '../services/coaching.js';
import { readSheet, guessMapping, sheetPhone, writeSheet } from '../services/sheets.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const phoneField = z
  .string()
  .transform(normalizePhone)
  .refine((p) => /^\d{8,15}$/.test(p), 'Phone must include country code, e.g. 919876543210');

const objectId = z.string().refine(mongoose.isValidObjectId, 'Invalid id');
const objectIdOrNull = objectId.nullable();

// No defaults here: used for PATCH, where missing fields must stay untouched
const contactFields = z.object({
  name: z.string().trim(),
  phone: phoneField,
  email: z.string().email().or(z.literal('')),
  tags: z.array(z.string().trim().min(1)),
  customFields: z.record(z.string(), z.string()),
  leadStatus: z.string().trim().min(1),
  notes: z.string(),
  assignedTo: objectIdOrNull,
  optedOut: z.boolean(),
  followUpAt: z.coerce.date().nullable(),
  followUpNote: z.string().trim().max(500),
  // "message" = at followUpAt, also send this WhatsApp template to the customer
  followUpAction: z.enum(['remind', 'message']),
  followUpTemplateId: objectIdOrNull,
  course: z.string().trim().toUpperCase().max(20),
  source: z.enum(MANUAL_SOURCES),
  language: z.enum(['', 'en', 'hi']),
});
const createContactSchema = contactFields.partial().required({ phone: true });
const updateContactSchema = contactFields.partial();

/**
 * Mongo filter for the contacts list, export, bulk actions and campaign audiences.
 * query: search, tag, leadStatus (one or comma separated), source ("ad" = from a Facebook/Instagram ad),
 * adId, followUp (due = by end of today, overdue, upcoming, any), optedOut,
 * joined / lastInbound (7d, 14d, 30d, 90d, 180d, 365d), smart (JSON smart filter, see services/segments.js).
 */
export function contactFilter(tenantId, query = {}) {
  const filter = { tenantId };
  const extra = {};
  if (query.joined === 'custom' || query.createdFrom || query.createdTo) extra.joined = { preset: 'custom', from: query.createdFrom || undefined, to: query.createdTo || undefined };
  else if (query.joined) extra.joined = { preset: query.joined };
  if (query.lastInbound) extra.lastInbound = { preset: query.lastInbound };
  let smart = {};
  if (query.smart) {
    try {
      smart = typeof query.smart === 'string' ? JSON.parse(query.smart) : query.smart;
    } catch {
      throw badRequest('Invalid smart filter');
    }
  }
  if (Object.keys(extra).length || Object.keys(smart).length) {
    filter.$and = [segmentQuery(tenantId, { ...smart, ...extra }, query.tz || DEFAULT_TZ)];
  }
  if (query.search) {
    const rx = { $regex: escapeRegex(query.search), $options: 'i' };
    filter.$or = [{ name: rx }, { phone: rx }, { email: rx }];
  }
  if (query.tag) filter.tags = query.tag;
  if (query.leadStatus) {
    const statuses = String(query.leadStatus).split(',').filter(Boolean);
    filter.leadStatus = statuses.length > 1 ? { $in: statuses } : statuses[0];
  }
  if (query.source === 'ad') filter['adSource.sourceId'] = { $exists: true, $ne: null };
  else if (query.source) filter.source = query.source;
  if (query.adId) filter['adSource.sourceId'] = String(query.adId);
  if (query.course) filter.course = query.course === 'none' ? '' : String(query.course).toUpperCase();
  if (query.language) filter.language = query.language === 'none' ? '' : query.language;
  // Counsellor (the lead's owner = its chat's counsellor). "me" is turned into the user id by the routes.
  if (query.assignedTo === 'none') filter.assignedTo = null;
  else if (query.assignedTo && mongoose.isValidObjectId(query.assignedTo)) filter.assignedTo = new mongoose.Types.ObjectId(String(query.assignedTo));
  // Customer has not written for N days (or never)
  const quietDays = { '1d': 1, '3d': 3, '7d': 7, '14d': 14, '30d': 30 }[query.noReply];
  if (quietDays) {
    const before = new Date(Date.now() - quietDays * 864e5);
    (filter.$and ||= []).push({ $or: [{ lastInboundAt: { $lt: before } }, { lastInboundAt: null }] });
  }
  if (query.calls === 'none') filter.callAttempts = { $in: [0, null] };
  else if (query.calls === '1') filter.callAttempts = { $gte: 1 };
  else if (query.calls === '3') filter.callAttempts = { $gte: 3 };
  if (query.nextAction === 'none') filter.nextActionAt = null;
  else if (query.nextAction === 'overdue') filter.nextActionAt = { $lt: new Date() };
  else if (query.nextAction === 'set') filter.nextActionAt = { $ne: null };
  if (query.optedOut === 'true') filter.optedOut = true;
  if (query.followUp) {
    const now = new Date();
    const endOfToday = new Date(startOfDayIn(safeTimeZone(query.tz || DEFAULT_TZ)).getTime() + 864e5);
    if (query.followUp === 'due') filter.followUpAt = { $lt: endOfToday };
    else if (query.followUp === 'overdue') filter.followUpAt = { $lt: now };
    else if (query.followUp === 'upcoming') filter.followUpAt = { $gte: now };
    else if (query.followUp === 'any') filter.followUpAt = { $ne: null };
  }
  return filter;
}

const filterSchema = z
  .object({
    search: z.string().optional(),
    tag: z.string().optional(),
    leadStatus: z.string().optional(),
    source: z.string().optional(),
    adId: z.string().optional(),
    course: z.string().optional(),
    language: z.string().optional(),
    nextAction: z.enum(['', 'none', 'overdue', 'set']).optional(),
    assignedTo: z.string().optional(),
    createdFrom: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/).optional(),
    createdTo: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/).optional(),
    noReply: z.enum(['', '1d', '3d', '7d', '14d', '30d']).optional(),
    calls: z.enum(['', 'none', '1', '3']).optional(),
    followUp: z.enum(['due', 'overdue', 'upcoming', 'any', '']).optional(),
    optedOut: z.string().optional(),
    tz: z.string().optional(),
    joined: z.enum(['', '7d', '14d', '30d', '90d', '180d', '365d', 'custom']).optional(),
    lastInbound: z.enum(['', '7d', '14d', '30d', '90d', '180d', '365d']).optional(),
    smart: z.union([z.string(), z.record(z.string(), z.any())]).optional(),
  })
  .partial();

// Bulk actions work on picked contacts ({ ids }) or on everything matching the current filters ({ filter })
const bulkTarget = z
  .object({ ids: z.array(objectId).min(1).optional(), filter: filterSchema.optional() })
  .refine((v) => v.ids || v.filter, 'Select contacts first');

// "Assigned to: me" -> the logged-in user's id
const withMe = (req, q = {}) => (q.assignedTo === 'me' ? { ...q, assignedTo: String(req.user._id) } : q);

function bulkMongoFilter(req, { ids, filter }) {
  return ids ? { tenantId: req.tenantId, _id: { $in: ids } } : contactFilter(req.tenantId, withMe(req, filter));
}

const statusTracking = (req) => ({ statusUpdatedAt: new Date(), statusUpdatedBy: req.user._id });

router.get('/', async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const filter = contactFilter(req.tenantId, withMe(req, req.query));
  const sort = req.query.followUp ? { followUpAt: 1 } : { createdAt: -1 };
  const [items, total] = await Promise.all([
    Contact.find(filter).populate('assignedTo', 'name').populate('followUpBy', 'name').sort(sort).skip(skip).limit(limit),
    Contact.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit });
});

// How many contacts per lead status, with the other filters applied (status tabs on the Contacts page)
router.get('/status-counts', async (req, res) => {
  const { leadStatus, ...rest } = req.query;
  const rows = await Contact.aggregate([{ $match: contactFilter(req.tenantId, withMe(req, rest)) }, { $group: { _id: '$leadStatus', n: { $sum: 1 } } }]);
  const counts = Object.fromEntries(rows.map((r) => [r._id, r.n]));
  res.json({ total: rows.reduce((a, r) => a + r.n, 0), counts });
});

router.get('/tags', async (req, res) => {
  const tags = await Contact.distinct('tags', { tenantId: req.tenantId });
  res.json(tags.sort());
});

// Facebook / Instagram ads that brought leads (for filters, campaigns and the dashboard)
router.get('/ad-sources', async (req, res) => {
  const ads = await Contact.aggregate([
    { $match: { tenantId: req.tenantId, 'adSource.sourceId': { $exists: true, $ne: null } } },
    {
      $group: {
        _id: '$adSource.sourceId',
        headline: { $last: '$adSource.headline' },
        sourceType: { $last: '$adSource.sourceType' },
        sourceUrl: { $last: '$adSource.sourceUrl' },
        leads: { $sum: 1 },
        converted: { $sum: { $cond: [{ $eq: ['$leadStatus', 'converted'] }, 1, 0] } },
        lastLeadAt: { $max: '$adSource.at' },
      },
    },
    { $sort: { lastLeadAt: -1 } },
    { $limit: 200 },
  ]);
  const named = await AdSource.find({ tenantId: req.tenantId, sourceId: { $in: ads.map((a) => a._id) } }).select('sourceId name tag').lean();
  const byId = Object.fromEntries(named.map((n) => [n.sourceId, n]));
  res.json(ads.map(({ _id, ...a }) => ({ adId: _id, ...a, name: byId[_id]?.name || '', tag: byId[_id]?.tag || '' })));
});

// Ids of all contacts matching the filters (e.g. "send a campaign to all 340 filtered leads")
router.post('/ids', async (req, res) => {
  const { filter } = validate(z.object({ filter: filterSchema.default({}) }), req.body);
  const contacts = await Contact.find({ ...contactFilter(req.tenantId, withMe(req, filter)), optedOut: false }).select('_id').limit(50000).lean();
  res.json({ ids: contacts.map((c) => c._id), total: contacts.length });
});

// Count contacts matching an audience (used by the campaign builder)
router.post('/count', async (req, res) => {
  const { tags, leadStatuses, adIds } = validate(
    z.object({
      tags: z.array(z.string()).default([]),
      leadStatuses: z.array(z.string()).default([]),
      adIds: z.array(z.string()).default([]),
    }),
    req.body
  );
  const filter = { tenantId: req.tenantId, optedOut: false };
  if (tags.length) filter.tags = { $in: tags };
  if (leadStatuses.length) filter.leadStatus = { $in: leadStatuses };
  if (adIds.length) filter['adSource.sourceId'] = { $in: adIds };
  res.json({ count: await Contact.countDocuments(filter) });
});

/** Download the leads matching the current filters as Excel (.xlsx) or CSV. Admin only. */
router.get('/export', authorize('admin'), async (req, res) => {
  const format = req.query.format === 'csv' ? 'csv' : 'xlsx';
  const filter = contactFilter(req.tenantId, withMe(req, req.query));
  const contacts = await Contact.find(filter).populate('assignedTo', 'name').sort({ createdAt: -1 }).limit(50000).lean();
  const labels = Object.fromEntries(getLeadStatuses(req.tenant).map((s) => [s.key, s.label]));
  const customKeys = [...new Set(contacts.flatMap((c) => Object.keys(c.customFields || {})))].sort();
  const fmt = (d) => (d ? new Date(d).toLocaleString('en-IN', { timeZone: safeTimeZone(req.query.tz || DEFAULT_TZ) }) : '');

  const headers = [
    'Name', 'Phone', 'Email', 'Lead status', 'Tags', 'Source', 'Ad headline', 'Ad ID',
    'Follow-up at', 'Follow-up note', 'Notes', 'Assigned to', 'Opted out', 'Added on', 'Last message',
    ...customKeys,
  ];
  const rows = contacts.map((c) => ({
    Name: c.name || '',
    Phone: c.phone,
    Email: c.email || '',
    'Lead status': labels[c.leadStatus] || c.leadStatus,
    Tags: (c.tags || []).join(', '),
    Source: c.adSource?.sourceId ? 'Facebook/Instagram ad' : c.source,
    'Ad headline': c.adSource?.headline || '',
    'Ad ID': c.adSource?.sourceId || '',
    'Follow-up at': fmt(c.followUpAt),
    'Follow-up note': c.followUpNote || '',
    Notes: c.notes || '',
    'Assigned to': c.assignedTo?.name || '',
    'Opted out': c.optedOut ? 'Yes' : 'No',
    'Added on': fmt(c.createdAt),
    'Last message': fmt(c.lastMessageAt),
    ...Object.fromEntries(customKeys.map((k) => [k, c.customFields?.[k] || ''])),
  }));

  const file = await writeSheet(headers, rows, format);
  const stamp = new Date().toISOString().slice(0, 10);
  res.set('Content-Type', format === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition', `attachment; filename="leads-${stamp}.${format}"`);
  await audit(req, 'contact.export', { meta: { count: rows.length, format, filter: req.query } });
  res.send(file);
});

// Follow-up that sends a WhatsApp message needs a time and an approved template
async function checkFollowUpMessage(req, next) {
  if (next.followUpAction !== 'message') return;
  if (!next.followUpAt) throw badRequest('Pick the follow-up date and time for the WhatsApp message');
  if (!next.followUpTemplateId) throw badRequest('Choose the template to send at follow-up time');
  const tpl = await Template.findOne({ _id: next.followUpTemplateId, tenantId: req.tenantId }).select('status name');
  if (!tpl) throw badRequest('Template not found');
  if (tpl.status !== 'approved') throw badRequest(`Template "${tpl.name}" is not approved by WhatsApp yet`);
}

async function checkCourse(req, data) {
  if (!isCoaching(req.tenant)) {
    // Course / language are part of the coaching format
    delete data.course;
    delete data.language;
    return;
  }
  if (data.course && !(await Course.exists({ tenantId: req.tenantId, code: data.course }))) throw badRequest(`Unknown course "${data.course}". Add it on the Courses page first.`);
}

router.post('/', async (req, res) => {
  const data = validate(createContactSchema, req.body);
  if (data.leadStatus) assertLeadStatus(req.tenant, data.leadStatus);
  if (data.customFields) data.customFields = normalizeCustomFields(req.tenant, data.customFields, { strict: true });
  await checkCourse(req, data);
  if (data.language) data.languageLocked = true;
  await checkFollowUpMessage(req, data);
  await assertContactLimit(req.tenant);
  if (await Contact.exists({ tenantId: req.tenantId, phone: data.phone })) throw conflict('A contact with this phone already exists');
  const contact = await Contact.create({
    ...data,
    tenantId: req.tenantId,
    source: data.source || 'manual',
    ...(data.followUpAt && { followUpBy: req.user._id }),
  });
  await audit(req, 'contact.create', { targetType: 'Contact', targetId: contact._id });
  if (contact.followUpAt) await refreshNextAction(contact._id);
  triggerDrips(req.tenantId, { type: 'new_lead', contactIds: [contact._id], source: contact.source });
  if (contact.tags.length) triggerDrips(req.tenantId, { type: 'tag_added', contactIds: [contact._id], tags: contact.tags });
  res.status(201).json(contact);
});

/**
 * Walk-in / phone enquiry in 10 seconds: name + mobile (course optional) -> contact saved and the
 * welcome template goes out on WhatsApp at once, so every visitor is in the CRM and in the chat.
 * The template: Settings → Lead flow → "Walk-in welcome", else the approved walkin_welcome_en / _hi.
 */
export async function walkInTemplate(tenant, language) {
  const id = tenant.settings?.automation?.walkInTemplateId;
  if (id) {
    const chosen = await Template.findOne({ _id: id, tenantId: tenant._id, status: 'approved' }).lean();
    if (chosen) {
      // Hinglish lead: the "_hi" twin of the chosen "_en" template, when approved
      if (language === 'hi' && /_en$/.test(chosen.name)) {
        const twin = await Template.findOne({ tenantId: tenant._id, name: chosen.name.replace(/_en$/, '_hi'), status: 'approved' }).lean();
        if (twin) return twin;
      }
      return chosen;
    }
  }
  return approvedTemplate(tenant._id, 'walkin_welcome', language);
}

router.get('/quick/welcome', async (req, res) => {
  const [en, hi] = await Promise.all([walkInTemplate(req.tenant, 'en'), walkInTemplate(req.tenant, 'hi')]);
  // Preview with the business's own details; "%NAME%" is swapped for the typed name on screen
  const pick = async (t) => {
    if (!t) return null;
    const params = await resolveVariables(t.variableDefaults || [], { name: '%NAME%', phone: '', customFields: {}, tags: [] }, req.tenant);
    return { _id: t._id, name: t.name, body: t.body, buttons: t.buttons, preview: renderTemplate(t.body, params) };
  };
  res.json({ en: await pick(en), hi: await pick(hi), chosenId: req.tenant.settings?.automation?.walkInTemplateId || null });
});

router.post('/quick', async (req, res) => {
  const data = validate(
    z.object({
      name: z.string().trim().min(1, 'Enter the name').max(100),
      // Indian 10-digit mobile (also with a leading 0) gets +91
      phone: z.string().transform((v) => normalizePhone(v).replace(/^0+(?=\d{10}$)/, '')).transform((p) => (/^[6-9]\d{9}$/.test(p) ? `91${p}` : p)).pipe(phoneField),
      course: z.string().trim().toUpperCase().max(20).optional().default(''),
      language: z.enum(['', 'en', 'hi']).optional().default(''),
      source: z.enum(MANUAL_SOURCES).optional().default('walkin'),
      note: z.string().trim().max(500).optional().default(''),
      sendWelcome: z.boolean().optional().default(true),
    }),
    req.body
  );
  if (data.course && !isCoaching(req.tenant)) data.course = '';
  await checkCourse(req, data);
  let contact = await Contact.findOne({ tenantId: req.tenantId, phone: data.phone });
  const created = !contact;
  const tag = data.source === 'walkin' ? 'walk-in' : data.source;
  if (created) {
    await assertContactLimit(req.tenant);
    contact = await Contact.create({
      tenantId: req.tenantId,
      phone: data.phone,
      name: data.name,
      source: data.source,
      tags: [tag],
      ...(data.course && { course: data.course }),
      ...(data.language && { language: data.language, languageLocked: true }),
      // A counsellor who adds the visitor owns the lead
      ...(req.user.role === 'agent' && { assignedTo: req.user._id }),
    });
  } else {
    const set = {};
    if (!contact.name || contact.name === contact.phone) set.name = data.name;
    if (data.course) set.course = data.course;
    if (data.language) Object.assign(set, { language: data.language, languageLocked: true });
    if (Object.keys(set).length) await Contact.updateOne({ _id: contact._id }, { $set: set });
    await Contact.updateOne({ _id: contact._id }, { $addToSet: { tags: tag } });
    contact = await Contact.findById(contact._id);
  }
  const conversation = await getOrCreateConversation(req.tenantId, contact._id);
  if (req.user.role === 'agent' && !conversation.assignedTo) {
    conversation.assignedTo = req.user._id;
    await conversation.save();
  }

  let welcome = 'skipped';
  let welcomeError = '';
  if (data.sendWelcome) {
    if (contact.optedOut) welcome = 'opted_out';
    else {
      const template = await walkInTemplate(req.tenant, contact.language);
      if (!template) welcome = 'no_template';
      else {
        try {
          const msg = await sendAutomatedTemplate({ tenant: req.tenant, contact, template, variables: template.variableDefaults, automation: { kind: 'followup', name: 'Walk-in welcome' } });
          welcome = msg.status === 'failed' ? 'failed' : 'sent';
          welcomeError = msg.error || '';
        } catch (err) {
          welcome = 'failed';
          welcomeError = err.message;
        }
      }
    }
  }
  const where = { walkin: '🚶 Walk-in visit', call: '📞 Phone enquiry', referral: '🤝 Referral', website: '🌐 Website enquiry' }[data.source] || '➕ Added';
  await addInternalNote({
    tenant: req.tenant,
    conversation,
    user: req.user,
    text: [`${where}${created ? '' : ' (came again)'} — added by ${req.user.name}`, data.course && `Interested in: ${data.course}`, data.note, welcome === 'sent' && '✅ Welcome message sent on WhatsApp'].filter(Boolean).join('\n'),
  });
  await audit(req, 'contact.quick_add', { targetType: 'Contact', targetId: contact._id, meta: { created, source: data.source, welcome } });
  if (created) triggerDrips(req.tenantId, { type: 'new_lead', contactIds: [contact._id], source: contact.source });
  if (created || !contact.tags.includes(tag)) triggerDrips(req.tenantId, { type: 'tag_added', contactIds: [contact._id], tags: [tag] });
  res.status(created ? 201 : 200).json({ contact, created, conversationId: conversation._id, welcome, welcomeError });
});

router.get('/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw notFound('Contact not found');
  const contact = await Contact.findOne({ _id: req.params.id, tenantId: req.tenantId })
    .populate('assignedTo', 'name')
    .populate('followUpBy', 'name');
  if (!contact) throw notFound('Contact not found');
  const conversation = await Conversation.findOne({ tenantId: req.tenantId, contactId: contact._id }).select('_id status assignedTo');
  res.json({ contact, conversation });
});

/**
 * Everything that happened with one lead, newest first: enquiry, calls, notes, status changes, tasks,
 * drips, payments, templates sent and (optionally) the chat messages. The lead page shows it next to the chat.
 */
const NOTE_KIND = [
  [/^📘|^Course set/, 'course'],
  [/^📞 Call/, 'call'],
  [/^💰|^⏰ Fee|^Payment |^Fee /, 'fee'],
  [/^Lead status changed|^Status: /, 'status'],
  [/^🚶|^➕|^🤝|^🌐|^📞 Phone enquiry/, 'visit'],
  [/^🤖|^Chatbot|^Language set|^Tag |automatically/i, 'bot'],
];
router.get('/:id/history', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw notFound('Contact not found');
  const contact = await Contact.findOne({ _id: req.params.id, tenantId: req.tenantId }).populate('assignedTo', 'name').lean();
  if (!contact) throw notFound('Contact not found');
  const chat = req.query.chat === 'true';
  const conversations = await Conversation.find({ tenantId: req.tenantId, contactId: contact._id }).select('_id').lean();
  const convIds = conversations.map((c) => c._id);
  const [messages, tasks, enrollments, firstIn] = await Promise.all([
    Message.find({
      conversationId: { $in: convIds },
      deletedAt: null,
      ...(chat ? {} : { $or: [{ direction: 'internal' }, { type: 'template' }] }),
    })
      .select('direction type text template automation sentBy isBot status createdAt interactive media.fileName referral.headline')
      .populate('sentBy', 'name')
      .sort({ createdAt: -1 })
      .limit(400)
      .lean(),
    Task.find({ contactId: contact._id }).populate('createdBy', 'name').populate('doneBy', 'name').populate('assignedTo', 'name').sort({ createdAt: -1 }).limit(100).lean(),
    DripEnrollment.find({ contactId: contact._id }).populate('dripId', 'name').sort({ createdAt: -1 }).limit(50).lean(),
    Message.findOne({ conversationId: { $in: convIds }, direction: 'inbound' }).sort({ createdAt: 1 }).select('text createdAt referral.headline').lean(),
  ]);
  const events = [];
  const push = (e) => events.push({ ...e, at: e.at || new Date(0) });
  const source = { whatsapp: 'messaged on WhatsApp', ad: 'came from an ad', import: 'imported from a sheet', manual: 'added by the team', walkin: 'visited the institute', referral: 'was referred', website: 'enquired on the website', call: 'called' }[contact.source] || `came via ${contact.source}`;
  push({ kind: 'start', at: contact.createdAt, title: `First enquiry — ${source}`, text: [contact.adSource?.headline && `Ad: ${contact.adSource.headline}`, firstIn?.text && `First message: “${firstIn.text.slice(0, 160)}”`].filter(Boolean).join('\n') });
  for (const m of messages) {
    const by = m.sentBy?.name || (m.isBot ? 'Chatbot' : m.automation?.name || '');
    if (m.direction === 'internal') {
      const kind = NOTE_KIND.find(([rx]) => rx.test(m.text || ''))?.[1] || 'note';
      push({ kind, at: m.createdAt, title: { course: 'Course interest', call: 'Call', status: 'Status changed', fee: 'Fees', visit: 'Visit / enquiry', bot: 'Automatic update', note: 'Note' }[kind], text: m.text, by: m.sentBy?.name || 'Automation' });
    } else if (m.direction === 'inbound') {
      push({ kind: 'customer', at: m.createdAt, title: 'Customer wrote', text: m.text || (m.media?.fileName ? `📎 ${m.media.fileName}` : `[${m.type}]`) });
    } else if (m.type === 'template') {
      push({ kind: 'template', at: m.createdAt, title: `Sent template: ${m.template?.name || ''}`, text: m.text, by: m.automation?.name ? `${m.automation.name} (automatic)` : by, status: m.status });
    } else {
      push({ kind: m.isBot ? 'botmsg' : 'reply', at: m.createdAt, title: m.isBot ? 'Chatbot replied' : `Reply by ${by || 'team'}`, text: m.text || (m.interactive?.options?.length ? m.interactive.options.map((o) => o.title).join(' · ') : `[${m.type}]`), status: m.status });
    }
  }
  for (const t of tasks) {
    push({ kind: 'task', at: t.createdAt, title: `Task: ${t.title}`, text: `Due ${new Date(t.dueAt).toLocaleString('en-IN', { timeZone: req.tenant.settings?.automation?.timezone || 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}${t.assignedTo?.name ? ` · for ${t.assignedTo.name}` : ''}${t.note ? `\n${t.note}` : ''}`, by: t.createdBy?.name || (t.sourceName ? `${t.sourceName} (automatic)` : 'Automation') });
    if (t.status === 'done' && t.doneAt) push({ kind: 'done', at: t.doneAt, title: `Done: ${t.title}`, by: t.doneBy?.name || '' });
  }
  const STOP = { replied: 'customer replied', status: 'status changed', status_changed: 'status changed', other_drip: 'another drip started', opted_out: 'opted out', removed: 'removed', drip_deleted: 'drip deleted' };
  for (const e of enrollments) {
    const name = e.dripId?.name || 'Drip';
    push({ kind: 'drip', at: e.createdAt, title: `Drip started: ${name}` });
    if (e.status === 'completed' || e.status === 'stopped') push({ kind: 'drip', at: e.updatedAt, title: `Drip ${e.status === 'completed' ? 'finished' : 'stopped'}: ${name}`, text: e.status === 'stopped' ? STOP[e.stoppedReason] || e.stoppedReason || '' : '' });
  }
  events.sort((a, b) => new Date(b.at) - new Date(a.at));
  const active = enrollments.filter((e) => e.status === 'active' || e.status === 'sending').map((e) => ({ _id: e._id, name: e.dripId?.name || 'Drip', nextRunAt: e.nextRunAt }));
  const openTasks = tasks.filter((t) => t.status === 'open').sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));
  const counts = await Message.aggregate([{ $match: { conversationId: { $in: convIds }, deletedAt: null } }, { $group: { _id: '$direction', n: { $sum: 1 }, last: { $max: '$createdAt' } } }]);
  const stat = Object.fromEntries(counts.map((c) => [c._id, { n: c.n, last: c.last }]));
  res.json({
    events: events.slice(0, 400),
    activeDrips: active,
    openTasks,
    conversationId: convIds[0] || null,
    stats: { inbound: stat.inbound?.n || 0, outbound: stat.outbound?.n || 0, notes: stat.internal?.n || 0, lastInboundAt: stat.inbound?.last || null, lastOutboundAt: stat.outbound?.last || null, firstEnquiryAt: contact.createdAt, statusLabel: statusLabel(req.tenant, contact.leadStatus) },
  });
});

router.patch('/:id', async (req, res) => {
  const data = validate(updateContactSchema, req.body);
  if (data.phone && (await Contact.exists({ tenantId: req.tenantId, phone: data.phone, _id: { $ne: req.params.id } }))) {
    throw conflict('Another contact already uses this phone');
  }
  if (!mongoose.isValidObjectId(req.params.id)) throw notFound('Contact not found');
  const before = await Contact.findOne({ _id: req.params.id, tenantId: req.tenantId }).select('tags leadStatus followUpAt followUpAction followUpTemplateId course').lean();
  if (!before) throw notFound('Contact not found');
  if (data.leadStatus) {
    data.leadStatus = assertLeadStatus(req.tenant, data.leadStatus);
    if (data.leadStatus !== before.leadStatus) Object.assign(data, statusTracking(req));
  }
  if (data.customFields) data.customFields = normalizeCustomFields(req.tenant, data.customFields, { strict: true });
  await checkCourse(req, data);
  if (data.language !== undefined) data.languageLocked = !!data.language; // chosen by a person: stop auto-detecting
  if (data.optedOut === true) data.optedOutAt = new Date();
  if (data.followUpAt !== undefined) data.followUpBy = data.followUpAt ? req.user._id : null;
  if (data.followUpAt === null) Object.assign(data, { followUpNote: '', followUpAction: 'remind', followUpTemplateId: null });
  const next = { ...before, ...data };
  await checkFollowUpMessage(req, next);
  // A new time / template for a "send message" follow-up means it has not been sent yet
  if (['followUpAt', 'followUpAction', 'followUpTemplateId'].some((k) => data[k] !== undefined && String(data[k] ?? '') !== String(before[k] ?? ''))) data.followUpSentAt = null;
  const contact = await Contact.findOneAndUpdate({ _id: req.params.id, tenantId: req.tenantId }, data, {
    returnDocument: 'after',
    runValidators: true,
  })
    .populate('assignedTo', 'name')
    .populate('followUpBy', 'name');
  if (!contact) throw notFound('Contact not found');
  if (data.followUpAt !== undefined || data.followUpAction !== undefined) {
    await refreshNextAction(contact._id);
    contact.nextActionAt = (await Contact.findById(contact._id).select('nextActionAt').lean())?.nextActionAt;
  }
  const addedTags = (contact.tags || []).filter((t) => !(before.tags || []).includes(t));
  if (addedTags.length) triggerDrips(req.tenantId, { type: 'tag_added', contactIds: [contact._id], tags: addedTags });
  if (contact.leadStatus !== before.leadStatus) {
    triggerDrips(req.tenantId, { type: 'status_changed', contactIds: [contact._id], status: contact.leadStatus });
    const conversation = await getOrCreateConversation(req.tenantId, contact._id);
    await addInternalNote({ tenant: req.tenant, conversation, user: req.user, text: `Status: ${statusLabel(req.tenant, before.leadStatus)} → ${statusLabel(req.tenant, contact.leadStatus)}` });
  }
  // Course changed by a person: who and when, in the history
  if (data.course !== undefined && (contact.course || '') !== (before.course || '')) {
    const codes = [before.course, contact.course].filter(Boolean);
    const names = Object.fromEntries((await Course.find({ tenantId: req.tenantId, code: { $in: codes } }).select('code name').lean()).map((c) => [c.code, c.name]));
    const label = (code) => (code ? `${names[code] || code} (${code})` : 'none');
    const conversation = await getOrCreateConversation(req.tenantId, contact._id);
    await addInternalNote({ tenant: req.tenant, conversation, user: req.user, text: `📘 Course changed: ${label(before.course)} → ${label(contact.course)}` });
  }
  res.json(contact);
});

/**
 * Log a call with the lead: outcome, note, optional new status and next call-back / task.
 * "No answer" 3 times -> the time-limit rule of the status (e.g. Contacted – No answer) takes over.
 */
const CALL_OUTCOMES = { connected: 'Connected', no_answer: 'No answer', busy: 'Busy', switched_off: 'Switched off', wrong_number: 'Wrong number', call_back: 'Asked to call back' };
router.post('/:id/calls', async (req, res) => {
  const data = validate(
    z.object({
      outcome: z.enum(Object.keys(CALL_OUTCOMES)),
      note: z.string().trim().max(1000).default(''),
      leadStatus: z.string().trim().optional(),
      nextAt: z.coerce.date().optional().nullable(), // next call / action
      nextTitle: z.string().trim().max(120).optional(),
    }),
    req.body
  );
  if (!mongoose.isValidObjectId(req.params.id)) throw notFound('Contact not found');
  const contact = await Contact.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!contact) throw notFound('Contact not found');
  if (data.leadStatus) assertLeadStatus(req.tenant, data.leadStatus);
  const now = new Date();
  const statusChanged = data.leadStatus && data.leadStatus !== contact.leadStatus;
  const set = { lastCallAt: now, lastCallOutcome: data.outcome, ...(statusChanged && { leadStatus: data.leadStatus, ...statusTracking(req) }) };
  await Contact.updateOne({ _id: contact._id }, { $set: set, $inc: { callAttempts: 1 } });
  const conversation = await getOrCreateConversation(req.tenantId, contact._id);
  const label = (k) => getLeadStatuses(req.tenant).find((s) => s.key === k)?.label || k;
  const parts = [`📞 Call #${contact.callAttempts + 1}: ${CALL_OUTCOMES[data.outcome]}`];
  if (data.note) parts.push(data.note);
  if (statusChanged) parts.push(`Status: ${label(contact.leadStatus)} → ${label(data.leadStatus)}`);
  if (data.nextAt) parts.push(`Next: ${data.nextTitle || 'Call again'} on ${data.nextAt.toLocaleString('en-IN', { timeZone: req.tenant.settings?.automation?.timezone || 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}`);
  await addInternalNote({ tenant: req.tenant, conversation, user: req.user, text: parts.join('\n') });
  // The open call tasks for this lead are done now
  await Task.updateMany({ contactId: contact._id, status: 'open', kind: { $in: ['call', 'callback'] }, dueAt: { $lte: new Date(now.getTime() + 60 * 6e4) } }, { $set: { status: 'done', doneAt: now, doneBy: req.user._id } });
  if (data.nextAt) {
    await createTask({ tenantId: req.tenantId, contact, title: data.nextTitle || 'Call again', kind: data.outcome === 'call_back' ? 'callback' : 'call', dueAt: data.nextAt, assignedTo: req.user._id, createdBy: req.user._id, silent: true });
  } else {
    await refreshNextAction(contact._id);
  }
  if (statusChanged) triggerDrips(req.tenantId, { type: 'status_changed', contactIds: [contact._id], status: data.leadStatus });
  // 3 calls without reaching the lead -> tell the admins (re-assign / try WhatsApp)
  const UNREACHED = ['no_answer', 'busy', 'switched_off'];
  if (UNREACHED.includes(data.outcome) && contact.callAttempts + 1 >= 3 && (!contact.lastCallOutcome || UNREACHED.includes(contact.lastCallOutcome))) {
    await notify(req.tenantId, { to: 'admins', contact, kind: 'alert', title: `${contact.name || `+${contact.phone}`}: ${contact.callAttempts + 1} calls, not reached`, body: `Last: ${CALL_OUTCOMES[data.outcome]} by ${req.user.name}. Re-assign or try WhatsApp.` });
  }
  await audit(req, 'contact.call', { targetType: 'Contact', targetId: contact._id, meta: { outcome: data.outcome } });
  const fresh = await Contact.findById(contact._id).populate('assignedTo', 'name').populate('followUpBy', 'name');
  res.json(fresh);
});

router.delete('/:id', authorize('admin'), async (req, res) => {
  const contact = await Contact.findOneAndDelete({ _id: req.params.id, tenantId: req.tenantId });
  if (!contact) throw notFound('Contact not found');
  const conversation = await Conversation.findOneAndDelete({ tenantId: req.tenantId, contactId: contact._id });
  if (conversation) await Message.deleteMany({ conversationId: conversation._id });
  await Task.deleteMany({ contactId: contact._id });
  await audit(req, 'contact.delete', { targetType: 'Contact', targetId: contact._id, meta: { phone: contact.phone } });
  res.json({ ok: true });
});

router.post('/bulk-delete', authorize('admin'), async (req, res) => {
  const target = validate(bulkTarget, req.body);
  const contacts = await Contact.find(bulkMongoFilter(req, target)).select('_id');
  const contactIds = contacts.map((c) => c._id);
  const convs = await Conversation.find({ tenantId: req.tenantId, contactId: { $in: contactIds } }).select('_id');
  await Message.deleteMany({ conversationId: { $in: convs.map((c) => c._id) } });
  await Conversation.deleteMany({ _id: { $in: convs.map((c) => c._id) } });
  await Contact.deleteMany({ _id: { $in: contactIds } });
  await Task.deleteMany({ contactId: { $in: contactIds } });
  await audit(req, 'contact.bulk_delete', { meta: { count: contactIds.length } });
  res.json({ deleted: contactIds.length });
});

router.post('/bulk-tag', async (req, res) => {
  const { tags, action, ...target } = validate(
    bulkTarget.and(z.object({ tags: z.array(z.string().trim().min(1)).min(1), action: z.enum(['add', 'remove']) })),
    req.body
  );
  const clean = [...new Set(tags.map((t) => t.toLowerCase()))];
  const update = action === 'add' ? { $addToSet: { tags: { $each: clean } } } : { $pull: { tags: { $in: clean } } };
  // Who is getting a tag they did not have (for drips that start on a tag)
  const gaining = action === 'add' ? (await Contact.find({ $and: [bulkMongoFilter(req, target), { tags: { $not: { $all: clean } } }] }).select('_id').limit(50000).lean()).map((c) => c._id) : [];
  const result = await Contact.updateMany(bulkMongoFilter(req, target), update);
  if (gaining.length) triggerDrips(req.tenantId, { type: 'tag_added', contactIds: gaining, tags: clean });
  res.json({ updated: result.modifiedCount });
});

router.post('/bulk-status', async (req, res) => {
  const { leadStatus, ...target } = validate(bulkTarget.and(z.object({ leadStatus: z.string().trim().min(1) })), req.body);
  assertLeadStatus(req.tenant, leadStatus);
  const changing = (await Contact.find({ $and: [bulkMongoFilter(req, target), { leadStatus: { $ne: leadStatus } }] }).select('_id').limit(50000).lean()).map((c) => c._id);
  const result = await Contact.updateMany({ _id: { $in: changing } }, { $set: { leadStatus, ...statusTracking(req) } });
  if (changing.length) triggerDrips(req.tenantId, { type: 'status_changed', contactIds: changing, status: leadStatus });
  await audit(req, 'contact.bulk_status', { meta: { leadStatus, count: result.modifiedCount } });
  res.json({ updated: result.modifiedCount });
});

// ---------- Sheet import (Excel .xlsx / .csv) ----------

/** Sample Excel sheet for the import (one row per lead; several tags separated by commas) */
router.get('/import/sample', authorize('admin'), async (req, res) => {
  const headers = ['Name', 'Mobile', 'Email', 'Course', 'Status', 'Counsellor', 'Enquiry date', 'Follow-up date', 'Notes', 'Tags', 'City', 'DOB'];
  const rows = [
    { Name: 'Rahul Sharma', Mobile: '9876543210', Email: 'rahul@example.com', Course: 'Digital Marketing', Status: 'Interested', Counsellor: 'Riya', 'Enquiry date': '02/09/2026', 'Follow-up date': '15/10/2026 5 pm', Notes: 'Asked about EMI, will decide after salary', Tags: 'old-query', City: 'Jaipur', DOB: '15/08/2002' },
    { Name: 'Neha Gupta', Mobile: '9876500002', Email: '', Course: 'Python', Status: 'Not interested', Counsellor: '', 'Enquiry date': '20/08/2026', 'Follow-up date': '', Notes: 'Joined another institute', Tags: 'old-query', City: 'Kota', DOB: '' },
    { Name: 'Amit Verma', Mobile: '919876500003', Email: '', Course: 'Video Editing', Status: 'Converted', Counsellor: 'Aman', 'Enquiry date': '05/07/2026', 'Follow-up date': '', Notes: 'Paid 1st instalment', Tags: 'student', City: 'Ajmer', DOB: '21/11/1998' },
  ];
  const file = await writeSheet(headers, rows, 'xlsx');
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition', 'attachment; filename="leads-sample.xlsx"');
  res.send(file);
});

/** Step 1: read the file and show columns + first rows, with a guess of which column is what */
router.post('/import/preview', authorize('admin'), upload.single('file'), async (req, res) => {
  if (!req.file) throw badRequest('Choose a .xlsx or .csv file');
  const { headers, rows } = await readSheet(req.file.buffer, req.file.originalname);
  res.json({ headers, sample: rows.slice(0, 5), totalRows: rows.length, mapping: guessMapping(headers) });
});

const importOptionsSchema = z.object({
  mapping: z.object({
    phone: z.string().min(1, 'Choose the column that has the phone numbers'),
    name: z.string().optional(),
    email: z.string().optional(),
    tags: z.string().optional(),
    leadStatus: z.string().optional(),
    course: z.string().optional(),
    counsellor: z.string().optional(),
    followUp: z.string().optional(),
    notes: z.string().optional(),
    enquiryDate: z.string().optional(),
  }),
  // Old enquiries usually should not get the welcome series: drips start only when asked
  startDrips: z.boolean().default(true),
  // Other columns to keep as custom fields ("city", "course"...)
  customColumns: z.array(z.string()).default([]),
  defaultCountryCode: z.string().regex(/^\d{0,4}$/).default('91'),
  addTags: z.array(z.string().trim().min(1)).default([]),
  setLeadStatus: z.string().optional(), // for every row without its own status
  batchTag: z.boolean().default(true), // tag all rows of this upload, e.g. "sheet-061025-1530"
});

/** "15/10/2026 5 pm", "2026-10-15 17:30", an Excel date… -> Date in the business time zone (default time 11:00) */
function sheetDateTime(raw, tz, defaultTime = '11:00') {
  const text = String(raw || '').trim();
  const day = parseDateInput(text.split(/[ T]/)[0]) || parseDateInput(text);
  if (!day || day.startsWith('0000')) return null;
  const m = /(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\s*$/i.exec(text.slice(text.split(/[ T]/)[0].length));
  let hh = defaultTime;
  if (m) {
    let h = Number(m[1]);
    if (m[3]?.toLowerCase() === 'pm' && h < 12) h += 12;
    if (m[3]?.toLowerCase() === 'am' && h === 12) h = 0;
    if (h <= 23) hh = `${String(h).padStart(2, '0')}:${m[2] || '00'}`;
  }
  return zonedTime(day, hh, tz);
}

const toFieldKey = (h) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'field';

/**
 * Step 2: import with the chosen mapping. Works without "options" too (old CSV import: columns named
 * phone, name, email, tags, lead_status are detected automatically).
 */
router.post('/import', authorize('admin'), upload.single('file'), async (req, res) => {
  if (!req.file) throw badRequest('Choose a .xlsx or .csv file');
  const { headers, rows } = await readSheet(req.file.buffer, req.file.originalname);
  if (!rows.length) throw badRequest('The sheet has no data rows');

  let options;
  if (req.body.options) {
    try {
      options = validate(importOptionsSchema, JSON.parse(req.body.options));
      if (!options.mapping.name) throw badRequest('Choose the column that has the names');
    } catch (err) {
      if (err.status) throw err;
      throw badRequest('Invalid import options');
    }
  } else {
    const mapping = guessMapping(headers);
    if (!mapping.phone) throw badRequest('Could not find a phone column. Name it "phone" or "mobile".');
    const mapped = new Set(Object.values(mapping));
    options = validate(importOptionsSchema, {
      mapping,
      customColumns: headers.filter((h) => !mapped.has(h)),
      addTags: String(req.body.tags || '').split(',').map((t) => t.trim()).filter(Boolean),
      batchTag: false,
    });
  }
  const { mapping, customColumns, defaultCountryCode, setLeadStatus } = options;
  // Extra sheet columns become contact fields (Settings → Contact fields) so they can be used in templates.
  // Columns like "DOB", "Birthday", "Anniversary" become date fields (for birthday / anniversary drips).
  const DATE_HEADER = /(^|\b)(dob|d\.o\.b|birth|bday|b'?day|anniversary|date)/i;
  await registerContactFields(
    req.tenantId,
    Object.fromEntries(customColumns.map((c) => [toFieldKey(c), String(c).trim()])),
    Object.fromEntries(customColumns.filter((c) => DATE_HEADER.test(c)).map((c) => [toFieldKey(c), 'date']))
  );
  const freshTenant = await Tenant.findById(req.tenantId).select('settings.contactFields');
  for (const col of [...Object.values(mapping), ...customColumns]) {
    if (col && !headers.includes(col)) throw badRequest(`Column "${col}" is not in the sheet`);
  }
  if (setLeadStatus) assertLeadStatus(req.tenant, setLeadStatus);
  // Course / counsellor columns are matched by name (or code / email)
  const courseList = mapping.course ? await Course.find({ tenantId: req.tenantId }).select('code name').lean() : [];
  const team = mapping.counsellor ? await User.find({ tenantId: req.tenantId, isActive: { $ne: false } }).select('name email').lean() : [];
  const low = (v) => String(v || '').trim().toLowerCase();
  const matchCourse = (v) => courseList.find((c) => low(c.code) === low(v) || low(c.name) === low(v)) || courseList.find((c) => low(v).length >= 3 && low(c.name).includes(low(v)));
  const matchMember = (v) => team.find((u) => low(u.email) === low(v) || low(u.name) === low(v)) || team.find((u) => low(v).length >= 3 && low(u.name).startsWith(low(v)));
  const tz = safeTimeZone(req.tenant.settings?.automation?.timezone || DEFAULT_TZ);
  const unmatched = { course: new Set(), counsellor: new Set() };

  const stamp = new Date().toLocaleString('en-GB', { timeZone: DEFAULT_TZ, day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).replace(/\D/g, '');
  const batchTag = options.batchTag ? `sheet-${stamp.slice(0, 6)}-${stamp.slice(6, 10)}` : null;
  const commonTags = [...new Set([...options.addTags.map((t) => t.toLowerCase()), ...(batchTag ? [batchTag] : [])])];

  // Parse every row first (and merge duplicates of the same number inside the sheet)
  const result = { totalRows: rows.length, created: 0, updated: 0, invalid: 0, duplicatesInSheet: 0, skippedLimit: 0, noName: 0, errors: [], batchTag };
  const byPhone = new Map();
  rows.forEach((row, i) => {
    const phone = sheetPhone(row[mapping.phone], defaultCountryCode);
    if (!phone) {
      result.invalid += 1;
      if (result.errors.length < 20) result.errors.push(`Row ${i + 2}: invalid phone "${row[mapping.phone] || ''}"`);
      return;
    }
    if (byPhone.has(phone)) result.duplicatesInSheet += 1;
    const prev = byPhone.get(phone) || { tags: new Set(commonTags), custom: {} };
    if (mapping.name && row[mapping.name]) prev.name = row[mapping.name];
    if (mapping.email && /\S+@\S+\.\S+/.test(row[mapping.email])) prev.email = row[mapping.email].toLowerCase();
    if (mapping.tags) row[mapping.tags].split(/[|;,]/).map((t) => t.trim().toLowerCase()).filter(Boolean).forEach((t) => prev.tags.add(t));
    const status = mapping.leadStatus ? matchLeadStatus(req.tenant, row[mapping.leadStatus]) : null;
    if (status) prev.leadStatus = status;
    if (mapping.course && row[mapping.course]) {
      const c = matchCourse(row[mapping.course]);
      if (c) prev.course = c.code;
      else unmatched.course.add(row[mapping.course]);
    }
    if (mapping.counsellor && row[mapping.counsellor]) {
      const u = matchMember(row[mapping.counsellor]);
      if (u) prev.assignedTo = u._id;
      else unmatched.counsellor.add(row[mapping.counsellor]);
    }
    if (mapping.followUp && row[mapping.followUp]) {
      const at = sheetDateTime(row[mapping.followUp], tz);
      if (at) prev.followUpAt = at;
    }
    if (mapping.notes && row[mapping.notes]) prev.notes = [prev.notes, String(row[mapping.notes]).trim()].filter(Boolean).join('\n');
    if (mapping.enquiryDate && row[mapping.enquiryDate]) {
      const at = sheetDateTime(row[mapping.enquiryDate], tz, '10:00');
      if (at && at <= new Date()) prev.enquiryAt = at;
    }
    const custom = {};
    for (const col of customColumns) if (row[col]) custom[toFieldKey(col)] = row[col];
    Object.assign(prev.custom, normalizeCustomFields(freshTenant, custom)); // bad dates are dropped
    byPhone.set(phone, prev);
  });

  const phones = [...byPhone.keys()];
  const existingDocs = await Contact.find({ tenantId: req.tenantId, phone: { $in: phones } }).select('phone tags leadStatus').lean();
  const existing = new Set(existingDocs.map((c) => c.phone));
  const beforeByPhone = new Map(existingDocs.map((c) => [c.phone, c]));
  let slots = await remainingContactSlots(req.tenant);
  const now = new Date();
  const ops = [];
  for (const [phone, d] of byPhone) {
    if (!d.name) result.noName += 1;
    const set = {};
    if (d.name) set.name = d.name;
    if (d.email) set.email = d.email;
    for (const [k, v] of Object.entries(d.custom)) set[`customFields.${k}`] = v;
    const status = d.leadStatus || setLeadStatus;
    if (status) Object.assign(set, { leadStatus: status, statusUpdatedAt: now, statusUpdatedBy: req.user._id });
    if (d.course && isCoaching(req.tenant)) set.course = d.course;
    if (d.assignedTo) set.assignedTo = d.assignedTo;
    if (d.followUpAt) Object.assign(set, { followUpAt: d.followUpAt, followUpBy: req.user._id, followUpAction: 'remind', nextActionAt: d.followUpAt });
    if (d.notes) set.notes = d.notes;

    if (existing.has(phone)) {
      ops.push({ updateOne: { filter: { tenantId: req.tenantId, phone }, update: { ...(Object.keys(set).length && { $set: set }), $addToSet: { tags: { $each: [...d.tags] } } } } });
      result.updated += 1;
    } else if (slots > 0) {
      ops.push({
        insertOne: {
          document: {
            tenantId: req.tenantId, phone, source: 'import', tags: [...d.tags], customFields: d.custom,
            name: d.name || '', ...(d.email && { email: d.email }), leadStatus: status || 'new',
            ...(status && { statusUpdatedAt: now, statusUpdatedBy: req.user._id }),
            ...(set.course && { course: set.course }),
            ...(d.assignedTo && { assignedTo: d.assignedTo }),
            ...(d.followUpAt && { followUpAt: d.followUpAt, followUpBy: req.user._id, followUpAction: 'remind', nextActionAt: d.followUpAt }),
            ...(d.notes && { notes: d.notes }),
            // The enquiry date from the sheet (so "joined in the last 30 days" filters work for old queries)
            createdAt: d.enquiryAt || now, updatedAt: now,
          },
        },
      });
      result.created += 1;
      slots -= 1;
    } else {
      result.skippedLimit += 1;
    }
  }
  for (let i = 0; i < ops.length; i += 1000) await Contact.bulkWrite(ops.slice(i, i + 1000), { ordered: false });

  // Drips: new leads, tags added and status changes from this sheet
  const after = await Contact.find({ tenantId: req.tenantId, phone: { $in: phones } }).select('_id phone tags leadStatus').lean();
  const newIds = [];
  const tagGains = new Map(); // tag -> [contactIds]
  const statusChanges = new Map(); // status -> [contactIds]
  for (const c of after) {
    const before = beforeByPhone.get(c.phone);
    if (!before) newIds.push(c._id);
    for (const t of c.tags) if (!before?.tags?.includes(t)) tagGains.set(t, [...(tagGains.get(t) || []), c._id]);
    if (before && before.leadStatus !== c.leadStatus) statusChanges.set(c.leadStatus, [...(statusChanges.get(c.leadStatus) || []), c._id]);
  }
  if (options.startDrips) (async () => {
    if (newIds.length) await triggerDrips(req.tenantId, { type: 'new_lead', contactIds: newIds, source: 'import' });
    for (const [tag, ids] of tagGains) await triggerDrips(req.tenantId, { type: 'tag_added', contactIds: ids, tags: [tag] });
    for (const [status, ids] of statusChanges) await triggerDrips(req.tenantId, { type: 'status_changed', contactIds: ids, status });
  })();

  result.imported = result.created + result.updated;
  result.unmatched = { course: [...unmatched.course].slice(0, 20), counsellor: [...unmatched.counsellor].slice(0, 20) };
  result.dripsStarted = options.startDrips;
  await audit(req, 'contact.import', { meta: { ...result, errors: undefined, file: req.file.originalname } });
  res.json(result);
});

export default router;
