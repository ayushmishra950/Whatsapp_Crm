import { Router } from 'express';
import mongoose from 'mongoose';
import { Notification } from '../models/index.js';

// The bell icon: the logged-in person's own alerts
const router = Router();

router.get('/', async (req, res) => {
  const filter = { userId: req.user._id, tenantId: req.tenantId };
  const [items, unread] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).limit(Math.min(Number(req.query.limit) || 30, 100)).populate('contactId', 'name phone').lean(),
    Notification.countDocuments({ ...filter, readAt: null }),
  ]);
  res.json({ items, unread });
});

/** Mark as read: { ids: [...] } or { all: true } */
router.post('/read', async (req, res) => {
  const filter = { userId: req.user._id, tenantId: req.tenantId, readAt: null };
  if (!req.body?.all) filter._id = { $in: (req.body?.ids || []).filter((id) => mongoose.isValidObjectId(id)) };
  const r = await Notification.updateMany(filter, { $set: { readAt: new Date() } });
  res.json({ updated: r.modifiedCount });
});

export default router;
