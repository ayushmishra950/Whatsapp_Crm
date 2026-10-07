import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Contact, Segment, Tenant } from '../models/index.js';
import { authorize } from '../middleware/auth.js';
import { validate, notFound } from '../utils/http.js';
import { describeSegment, segmentFilterSchema, segmentQuery } from '../services/segments.js';
import { automationSettings } from '../services/drips.js';

// Saved smart filters ("Hot PHP leads – last 30 days"). Everyone in the business can use them; admins save them.
const router = Router();

const tzOf = async (req) => automationSettings(await Tenant.findById(req.tenantId).select('settings.automation')).tz;

router.get('/', async (req, res) => {
  const items = await Segment.find({ tenantId: req.tenantId }).sort({ name: 1 }).lean();
  res.json(items.map((s) => ({ ...s, summary: describeSegment(s.filter) })));
});

/** How many contacts match a filter (opted-out ones shown separately, campaigns skip them) */
router.post('/count', async (req, res) => {
  const { filter } = validate(z.object({ filter: segmentFilterSchema.default({}) }), req.body);
  const query = segmentQuery(req.tenantId, filter, await tzOf(req));
  const [total, optedOut] = await Promise.all([Contact.countDocuments(query), Contact.countDocuments({ $and: [query, { optedOut: true }] })]);
  res.json({ total, optedOut, reachable: total - optedOut });
});

const segmentSchema = z.object({ name: z.string().trim().min(2).max(80), filter: segmentFilterSchema });

router.post('/', authorize('admin'), async (req, res) => {
  const data = validate(segmentSchema, req.body);
  const seg = await Segment.create({ ...data, tenantId: req.tenantId, createdBy: req.user._id });
  res.status(201).json({ ...seg.toObject(), summary: describeSegment(seg.filter) });
});

router.put('/:id', authorize('admin'), async (req, res) => {
  const data = validate(segmentSchema, req.body);
  if (!mongoose.isValidObjectId(req.params.id)) throw notFound('Segment not found');
  const seg = await Segment.findOneAndUpdate({ _id: req.params.id, tenantId: req.tenantId }, { $set: data }, { returnDocument: 'after' });
  if (!seg) throw notFound('Segment not found');
  res.json({ ...seg.toObject(), summary: describeSegment(seg.filter) });
});

router.delete('/:id', authorize('admin'), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw notFound('Segment not found');
  await Segment.deleteOne({ _id: req.params.id, tenantId: req.tenantId });
  res.json({ ok: true });
});

export default router;
