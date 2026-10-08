import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { AdSource, Course, Contact } from '../models/index.js';
import { authorize } from '../middleware/auth.js';
import { validate, notFound } from '../utils/http.js';
import { audit } from '../services/audit.js';
import { triggerDrips } from '../services/drips.js';
import { isCoaching } from '../services/coaching.js';

/**
 * Facebook / Instagram Click-to-WhatsApp ads. Every ad that brought a lead is listed; the admin names
 * it ("Video Editing – Oct") and gives it a tag, which every lead from that ad gets automatically.
 */
const router = Router();

// Ads seen on contacts before this page existed get their AdSource row now
async function syncFromContacts(tenantId) {
  const rows = await Contact.aggregate([
    { $match: { tenantId, 'adSource.sourceId': { $nin: [null, ''] } } },
    { $sort: { createdAt: 1 } },
    { $group: { _id: '$adSource.sourceId', headline: { $first: '$adSource.headline' }, sourceType: { $first: '$adSource.sourceType' }, sourceUrl: { $first: '$adSource.sourceUrl' }, first: { $min: '$createdAt' }, last: { $max: '$createdAt' } } },
  ]);
  if (!rows.length) return;
  await AdSource.bulkWrite(
    rows.map((r) => ({
      updateOne: {
        filter: { tenantId, sourceId: r._id },
        update: { $setOnInsert: { tenantId, sourceId: r._id, headline: r.headline, sourceType: r.sourceType, sourceUrl: r.sourceUrl, firstSeenAt: r.first, lastLeadAt: r.last } },
        upsert: true,
      },
    }))
  );
}

router.get('/', async (req, res) => {
  await syncFromContacts(req.tenantId);
  const [ads, stats] = await Promise.all([
    AdSource.find({ tenantId: req.tenantId }).sort({ lastLeadAt: -1 }).lean(),
    Contact.aggregate([
      { $match: { tenantId: req.tenantId, 'adSource.sourceId': { $nin: [null, ''] } } },
      {
        $group: {
          _id: '$adSource.sourceId',
          leads: { $sum: 1 },
          last30: { $sum: { $cond: [{ $gte: ['$createdAt', new Date(Date.now() - 30 * 864e5)] }, 1, 0] } },
          interested: { $sum: { $cond: [{ $eq: ['$leadStatus', 'qualified'] }, 1, 0] } },
          converted: { $sum: { $cond: [{ $eq: ['$leadStatus', 'converted'] }, 1, 0] } },
          lastLeadAt: { $max: '$createdAt' },
        },
      },
    ]),
  ]);
  const byId = Object.fromEntries(stats.map((s) => [s._id, s]));
  res.json(
    ads.map((a) => {
      const s = byId[a.sourceId] || {};
      return { ...a, displayName: a.name || a.headline || `Ad ${a.sourceId}`, leads: s.leads || 0, last30: s.last30 || 0, interested: s.interested || 0, converted: s.converted || 0, lastLeadAt: s.lastLeadAt || a.lastLeadAt };
    })
  );
});

/** Rename an ad and set its tag. applyToExisting = also tag the leads that already came from it. */
router.patch('/:id', authorize('admin'), async (req, res) => {
  const data = validate(
    z.object({
      name: z.string().trim().max(80).optional(),
      tag: z.string().trim().toLowerCase().max(40).regex(/^[a-z0-9 _-]*$/, 'Tag can use letters, numbers, - and _').optional(),
      courseCode: z.string().trim().toUpperCase().max(20).optional(),
      applyToExisting: z.boolean().default(true),
    }),
    req.body
  );
  if (!mongoose.isValidObjectId(req.params.id)) throw notFound('Ad not found');
  const ad = await AdSource.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!ad) throw notFound('Ad not found');
  if (data.name !== undefined) ad.name = data.name;
  if (data.tag !== undefined) ad.tag = data.tag.replace(/\s+/g, '-');
  if (data.courseCode !== undefined && isCoaching(req.tenant)) {
    if (data.courseCode && !(await Course.exists({ tenantId: req.tenantId, code: data.courseCode }))) throw notFound('Course not found');
    ad.courseCode = data.courseCode;
  }
  await ad.save();
  // Leads from this ad without a course get the ad's course
  let coursed = 0;
  if (ad.courseCode && data.applyToExisting) {
    coursed = (await Contact.updateMany({ tenantId: req.tenantId, 'adSource.sourceId': ad.sourceId, course: { $in: ['', null] } }, { $set: { course: ad.courseCode } })).modifiedCount;
  }
  let tagged = 0;
  if (ad.tag && data.applyToExisting) {
    const ids = (await Contact.find({ tenantId: req.tenantId, 'adSource.sourceId': ad.sourceId, tags: { $ne: ad.tag } }).select('_id').lean()).map((c) => c._id);
    if (ids.length) {
      const r = await Contact.updateMany({ _id: { $in: ids } }, { $addToSet: { tags: ad.tag } });
      tagged = r.modifiedCount;
      triggerDrips(req.tenantId, { type: 'tag_added', contactIds: ids, tags: [ad.tag] });
    }
  }
  await audit(req, 'ad.update', { targetType: 'AdSource', targetId: ad._id, meta: { name: ad.name, tag: ad.tag, tagged } });
  res.json({ ad, tagged, coursed });
});

export default router;
