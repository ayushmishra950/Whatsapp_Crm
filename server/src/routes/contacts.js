import { Router } from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import { z } from 'zod';
import { AdSource, Contact, Conversation, Message, Template, Tenant } from '../models/index.js';
import { authorize } from '../middleware/auth.js';
import { validate, notFound, conflict, badRequest, paginate, escapeRegex, normalizePhone } from '../utils/http.js';
import { DEFAULT_TZ, safeTimeZone, startOfDayIn } from '../utils/time.js';
import { audit } from '../services/audit.js';
import { assertContactLimit, remainingContactSlots } from '../services/subscription.js';
import { assertLeadStatus, getLeadStatuses, matchLeadStatus } from '../services/leadStatuses.js';
import { registerContactFields, normalizeCustomFields, getContactFields } from '../services/contactFields.js';
import { segmentQuery } from '../services/segments.js';
import { triggerDrips } from '../services/drips.js';
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
  if (query.joined) extra.joined = { preset: query.joined };
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
    followUp: z.enum(['due', 'overdue', 'upcoming', 'any', '']).optional(),
    optedOut: z.string().optional(),
    tz: z.string().optional(),
    joined: z.enum(['', '7d', '14d', '30d', '90d', '180d', '365d']).optional(),
    lastInbound: z.enum(['', '7d', '14d', '30d', '90d', '180d', '365d']).optional(),
    smart: z.union([z.string(), z.record(z.string(), z.any())]).optional(),
  })
  .partial();

// Bulk actions work on picked contacts ({ ids }) or on everything matching the current filters ({ filter })
const bulkTarget = z
  .object({ ids: z.array(objectId).min(1).optional(), filter: filterSchema.optional() })
  .refine((v) => v.ids || v.filter, 'Select contacts first');

function bulkMongoFilter(req, { ids, filter }) {
  return ids ? { tenantId: req.tenantId, _id: { $in: ids } } : contactFilter(req.tenantId, filter);
}

const statusTracking = (req) => ({ statusUpdatedAt: new Date(), statusUpdatedBy: req.user._id });

router.get('/', async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const filter = contactFilter(req.tenantId, req.query);
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
  const rows = await Contact.aggregate([{ $match: contactFilter(req.tenantId, rest) }, { $group: { _id: '$leadStatus', n: { $sum: 1 } } }]);
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
  const contacts = await Contact.find({ ...contactFilter(req.tenantId, filter), optedOut: false }).select('_id').limit(50000).lean();
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
  const filter = contactFilter(req.tenantId, req.query);
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

router.post('/', async (req, res) => {
  const data = validate(createContactSchema, req.body);
  if (data.leadStatus) assertLeadStatus(req.tenant, data.leadStatus);
  if (data.customFields) data.customFields = normalizeCustomFields(req.tenant, data.customFields, { strict: true });
  await checkFollowUpMessage(req, data);
  await assertContactLimit(req.tenant);
  if (await Contact.exists({ tenantId: req.tenantId, phone: data.phone })) throw conflict('A contact with this phone already exists');
  const contact = await Contact.create({
    ...data,
    tenantId: req.tenantId,
    source: 'manual',
    ...(data.followUpAt && { followUpBy: req.user._id }),
  });
  await audit(req, 'contact.create', { targetType: 'Contact', targetId: contact._id });
  triggerDrips(req.tenantId, { type: 'new_lead', contactIds: [contact._id], source: 'manual' });
  if (contact.tags.length) triggerDrips(req.tenantId, { type: 'tag_added', contactIds: [contact._id], tags: contact.tags });
  res.status(201).json(contact);
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

router.patch('/:id', async (req, res) => {
  const data = validate(updateContactSchema, req.body);
  if (data.phone && (await Contact.exists({ tenantId: req.tenantId, phone: data.phone, _id: { $ne: req.params.id } }))) {
    throw conflict('Another contact already uses this phone');
  }
  if (!mongoose.isValidObjectId(req.params.id)) throw notFound('Contact not found');
  const before = await Contact.findOne({ _id: req.params.id, tenantId: req.tenantId }).select('tags leadStatus followUpAt followUpAction followUpTemplateId').lean();
  if (!before) throw notFound('Contact not found');
  if (data.leadStatus) {
    data.leadStatus = assertLeadStatus(req.tenant, data.leadStatus);
    if (data.leadStatus !== before.leadStatus) Object.assign(data, statusTracking(req));
  }
  if (data.customFields) data.customFields = normalizeCustomFields(req.tenant, data.customFields, { strict: true });
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
  const addedTags = (contact.tags || []).filter((t) => !(before.tags || []).includes(t));
  if (addedTags.length) triggerDrips(req.tenantId, { type: 'tag_added', contactIds: [contact._id], tags: addedTags });
  if (contact.leadStatus !== before.leadStatus) triggerDrips(req.tenantId, { type: 'status_changed', contactIds: [contact._id], status: contact.leadStatus });
  res.json(contact);
});

router.delete('/:id', authorize('admin'), async (req, res) => {
  const contact = await Contact.findOneAndDelete({ _id: req.params.id, tenantId: req.tenantId });
  if (!contact) throw notFound('Contact not found');
  const conversation = await Conversation.findOneAndDelete({ tenantId: req.tenantId, contactId: contact._id });
  if (conversation) await Message.deleteMany({ conversationId: conversation._id });
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
  const headers = ['Name', 'Mobile', 'Email', 'Tags', 'Status', 'Course', 'City', 'DOB', 'Anniversary'];
  const rows = [
    { Name: 'Rahul Sharma', Mobile: '9876543210', Email: 'rahul@example.com', Tags: 'php, jaipur', Status: 'Interested', Course: 'PHP', City: 'Jaipur', DOB: '15/08/2002', Anniversary: '' },
    { Name: 'Neha Gupta', Mobile: '9876500002', Email: '', Tags: 'mern', Status: '', Course: 'MERN', City: 'Kota', DOB: '03/01/2001', Anniversary: '' },
    { Name: 'Amit Verma', Mobile: '919876500003', Email: '', Tags: 'video-editing, old-student', Status: 'Converted', Course: 'Video Editing', City: 'Ajmer', DOB: '21/11/1998', Anniversary: '10/02/2022' },
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
  }),
  // Other columns to keep as custom fields ("city", "course"...)
  customColumns: z.array(z.string()).default([]),
  defaultCountryCode: z.string().regex(/^\d{0,4}$/).default('91'),
  addTags: z.array(z.string().trim().min(1)).default([]),
  setLeadStatus: z.string().optional(), // for every row without its own status
  batchTag: z.boolean().default(true), // tag all rows of this upload, e.g. "sheet-061025-1530"
});

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

  const stamp = new Date().toLocaleString('en-GB', { timeZone: DEFAULT_TZ, day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).replace(/\D/g, '');
  const batchTag = options.batchTag ? `sheet-${stamp.slice(0, 6)}-${stamp.slice(6, 10)}` : null;
  const commonTags = [...new Set([...options.addTags.map((t) => t.toLowerCase()), ...(batchTag ? [batchTag] : [])])];

  // Parse every row first (and merge duplicates of the same number inside the sheet)
  const result = { totalRows: rows.length, created: 0, updated: 0, invalid: 0, duplicatesInSheet: 0, skippedLimit: 0, errors: [], batchTag };
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
    const set = {};
    if (d.name) set.name = d.name;
    if (d.email) set.email = d.email;
    for (const [k, v] of Object.entries(d.custom)) set[`customFields.${k}`] = v;
    const status = d.leadStatus || setLeadStatus;
    if (status) Object.assign(set, { leadStatus: status, statusUpdatedAt: now, statusUpdatedBy: req.user._id });

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
            createdAt: now, updatedAt: now,
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
  (async () => {
    if (newIds.length) await triggerDrips(req.tenantId, { type: 'new_lead', contactIds: newIds, source: 'import' });
    for (const [tag, ids] of tagGains) await triggerDrips(req.tenantId, { type: 'tag_added', contactIds: ids, tags: [tag] });
    for (const [status, ids] of statusChanges) await triggerDrips(req.tenantId, { type: 'status_changed', contactIds: ids, status });
  })();

  result.imported = result.created + result.updated;
  await audit(req, 'contact.import', { meta: { ...result, errors: undefined, file: req.file.originalname } });
  res.json(result);
});

export default router;
