import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { SavedView } from '../models/index.js';
import { validate, notFound, forbidden } from '../utils/http.js';

// Saved filter views for list pages (own views + views an admin shared with the team)
const router = Router();
const PAGES = ['contacts'];

router.get('/', async (req, res) => {
  const page = PAGES.includes(req.query.page) ? req.query.page : 'contacts';
  const views = await SavedView.find({ tenantId: req.tenantId, page, $or: [{ userId: req.user._id }, { shared: true }] })
    .sort({ shared: -1, name: 1 })
    .populate('userId', 'name')
    .lean();
  res.json(views.map((v) => ({ ...v, mine: String(v.userId?._id || v.userId) === String(req.user._id) })));
});

router.post('/', async (req, res) => {
  const data = validate(
    z.object({
      page: z.enum(PAGES).default('contacts'),
      name: z.string().trim().min(1, 'Give the view a name').max(60),
      // only simple filter values (strings), never anything else
      query: z.record(z.string(), z.string().max(2000)).default({}),
      shared: z.boolean().default(false),
    }),
    req.body
  );
  if (data.shared && req.user.role !== 'admin') data.shared = false; // only admins share with the team
  const count = await SavedView.countDocuments({ tenantId: req.tenantId, userId: req.user._id });
  if (count >= 50) throw forbidden('You can keep up to 50 saved views');
  const view = await SavedView.create({ ...data, tenantId: req.tenantId, userId: req.user._id });
  res.status(201).json(view);
});

router.delete('/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw notFound('View not found');
  const view = await SavedView.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!view) throw notFound('View not found');
  if (String(view.userId) !== String(req.user._id) && req.user.role !== 'admin') throw forbidden('Only its owner or an admin can delete this view');
  await view.deleteOne();
  res.json({ ok: true });
});

export default router;
