import { Router } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Contact, Conversation, Message } from '../models/index.js';
import { LEAD_STATUSES } from '../models/Contact.js';
import { authorize } from '../middleware/auth.js';
import { validate, notFound, conflict, badRequest, paginate, escapeRegex, normalizePhone } from '../utils/http.js';
import { audit } from '../services/audit.js';
import { assertContactLimit, remainingContactSlots } from '../services/subscription.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const phoneField = z
  .string()
  .transform(normalizePhone)
  .refine((p) => /^\d{8,15}$/.test(p), 'Phone must include country code, e.g. 919876543210');

const objectIdOrNull = z.string().refine(mongoose.isValidObjectId, 'Invalid id').nullable();

// No defaults here: used for PATCH, where missing fields must stay untouched
const contactFields = z.object({
  name: z.string().trim(),
  phone: phoneField,
  email: z.string().email().or(z.literal('')),
  tags: z.array(z.string().trim().min(1)),
  customFields: z.record(z.string(), z.string()),
  leadStatus: z.enum(LEAD_STATUSES),
  notes: z.string(),
  assignedTo: objectIdOrNull,
  optedOut: z.boolean(),
});
const createContactSchema = contactFields.partial().required({ phone: true });
const updateContactSchema = contactFields.partial();

export function contactFilter(tenantId, query) {
  const filter = { tenantId };
  if (query.search) {
    const rx = { $regex: escapeRegex(query.search), $options: 'i' };
    filter.$or = [{ name: rx }, { phone: rx }, { email: rx }];
  }
  if (query.tag) filter.tags = query.tag;
  if (query.leadStatus) filter.leadStatus = query.leadStatus;
  if (query.optedOut === 'true') filter.optedOut = true;
  return filter;
}

router.get('/', async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const filter = contactFilter(req.tenantId, req.query);
  const [items, total] = await Promise.all([
    Contact.find(filter).populate('assignedTo', 'name').sort({ createdAt: -1 }).skip(skip).limit(limit),
    Contact.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit });
});

router.get('/tags', async (req, res) => {
  const tags = await Contact.distinct('tags', { tenantId: req.tenantId });
  res.json(tags.sort());
});

// Count contacts matching an audience (used by campaign builder)
router.post('/count', async (req, res) => {
  const { tags } = validate(z.object({ tags: z.array(z.string()).default([]) }), req.body);
  const filter = { tenantId: req.tenantId, optedOut: false };
  if (tags.length) filter.tags = { $in: tags };
  res.json({ count: await Contact.countDocuments(filter) });
});

router.post('/', async (req, res) => {
  const data = validate(createContactSchema, req.body);
  await assertContactLimit(req.tenant);
  if (await Contact.exists({ tenantId: req.tenantId, phone: data.phone })) throw conflict('A contact with this phone already exists');
  const contact = await Contact.create({ ...data, tenantId: req.tenantId, source: 'manual' });
  await audit(req, 'contact.create', { targetType: 'Contact', targetId: contact._id });
  res.status(201).json(contact);
});

router.get('/:id', async (req, res) => {
  const contact = await Contact.findOne({ _id: req.params.id, tenantId: req.tenantId }).populate('assignedTo', 'name');
  if (!contact) throw notFound('Contact not found');
  const conversation = await Conversation.findOne({ tenantId: req.tenantId, contactId: contact._id }).select('_id status assignedTo');
  res.json({ contact, conversation });
});

router.patch('/:id', async (req, res) => {
  const data = validate(updateContactSchema, req.body);
  if (data.phone && (await Contact.exists({ tenantId: req.tenantId, phone: data.phone, _id: { $ne: req.params.id } }))) {
    throw conflict('Another contact already uses this phone');
  }
  if (data.optedOut === true) data.optedOutAt = new Date();
  const contact = await Contact.findOneAndUpdate({ _id: req.params.id, tenantId: req.tenantId }, data, {
    returnDocument: 'after',
    runValidators: true,
  });
  if (!contact) throw notFound('Contact not found');
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
  const { ids } = validate(z.object({ ids: z.array(z.string().refine(mongoose.isValidObjectId)).min(1) }), req.body);
  const contacts = await Contact.find({ _id: { $in: ids }, tenantId: req.tenantId }).select('_id');
  const contactIds = contacts.map((c) => c._id);
  const convs = await Conversation.find({ tenantId: req.tenantId, contactId: { $in: contactIds } }).select('_id');
  await Message.deleteMany({ conversationId: { $in: convs.map((c) => c._id) } });
  await Conversation.deleteMany({ _id: { $in: convs.map((c) => c._id) } });
  await Contact.deleteMany({ _id: { $in: contactIds } });
  await audit(req, 'contact.bulk_delete', { meta: { count: contactIds.length } });
  res.json({ deleted: contactIds.length });
});

router.post('/bulk-tag', async (req, res) => {
  const { ids, tags, action } = validate(
    z.object({ ids: z.array(z.string()).min(1), tags: z.array(z.string().trim().min(1)).min(1), action: z.enum(['add', 'remove']) }),
    req.body
  );
  const update = action === 'add' ? { $addToSet: { tags: { $each: tags } } } : { $pull: { tags: { $in: tags } } };
  const result = await Contact.updateMany({ _id: { $in: ids }, tenantId: req.tenantId }, update);
  res.json({ updated: result.modifiedCount });
});

/**
 * CSV import. Required column: phone. Optional: name, email, tags (separated by | or ;), lead_status.
 * Any other column is saved as a custom field.
 */
router.post('/import', authorize('admin'), upload.single('file'), async (req, res) => {
  if (!req.file) throw badRequest('CSV file is required');
  const extraTags = (req.body.tags || '').split(',').map((t) => t.trim()).filter(Boolean);

  let rows;
  try {
    rows = parse(req.file.buffer, { columns: (h) => h.map((c) => c.trim().toLowerCase()), skip_empty_lines: true, trim: true, bom: true });
  } catch (err) {
    throw badRequest(`Invalid CSV: ${err.message}`);
  }
  if (!rows.length) throw badRequest('CSV is empty');
  if (!('phone' in rows[0])) throw badRequest('CSV must have a "phone" column');

  const known = new Set(['name', 'phone', 'email', 'tags', 'lead_status']);
  const result = { created: 0, updated: 0, invalid: 0, skippedLimit: 0, errors: [] };
  let slots = await remainingContactSlots(req.tenant);

  for (const [index, row] of rows.entries()) {
    const phone = normalizePhone(row.phone);
    if (!/^\d{8,15}$/.test(phone)) {
      result.invalid += 1;
      if (result.errors.length < 20) result.errors.push(`Row ${index + 2}: invalid phone "${row.phone}"`);
      continue;
    }
    const tags = [...(row.tags || '').split(/[|;]/).map((t) => t.trim()).filter(Boolean), ...extraTags];
    const customFields = Object.fromEntries(Object.entries(row).filter(([k, v]) => !known.has(k) && v));
    const set = {};
    if (row.name) set.name = row.name;
    if (row.email) set.email = row.email.toLowerCase();
    if (LEAD_STATUSES.includes(row.lead_status)) set.leadStatus = row.lead_status;
    for (const [k, v] of Object.entries(customFields)) set[`customFields.${k}`] = v;

    const existing = await Contact.findOne({ tenantId: req.tenantId, phone }).select('_id');
    if (existing) {
      await Contact.updateOne({ _id: existing._id }, { $set: set, $addToSet: { tags: { $each: tags } } });
      result.updated += 1;
    } else if (slots > 0) {
      await Contact.create({ tenantId: req.tenantId, phone, tags, source: 'import', ...Object.fromEntries(Object.entries(set).filter(([k]) => !k.startsWith('customFields.'))), customFields });
      result.created += 1;
      slots -= 1;
    } else {
      result.skippedLimit += 1;
    }
  }
  await audit(req, 'contact.import', { meta: { ...result, errors: undefined, file: req.file.originalname } });
  res.json(result);
});

export default router;
