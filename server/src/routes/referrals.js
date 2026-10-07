import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Contact, Tenant } from '../models/index.js';
import { authorize } from '../middleware/auth.js';
import { validate, notFound, badRequest } from '../utils/http.js';
import { audit } from '../services/audit.js';
import { ensureReferralCode, referralLink } from '../services/referrals.js';

/**
 * Refer & earn report. A reward (fee discount) is earned for every referred lead that converts;
 * the admin marks rewards as given. No money is handled here.
 */
const router = Router();

router.get('/', async (req, res) => {
  const tenant = await Tenant.findById(req.tenantId).select('settings.referral whatsapp.displayPhoneNumber phone');
  const rows = await Contact.aggregate([
    { $match: { tenantId: req.tenantId, referredBy: { $ne: null } } },
    {
      $group: {
        _id: '$referredBy',
        referred: { $sum: 1 },
        converted: { $sum: { $cond: [{ $eq: ['$leadStatus', 'converted'] }, 1, 0] } },
        lastAt: { $max: '$referredAt' },
      },
    },
    { $sort: { converted: -1, referred: -1 } },
    { $lookup: { from: 'contacts', localField: '_id', foreignField: '_id', as: 'referrer' } },
    { $unwind: '$referrer' },
  ]);
  const amount = tenant.settings?.referral?.rewardAmount || 0;
  const items = rows.map((r) => {
    const given = r.referrer.referralRewardsGiven || 0;
    return {
      contactId: r._id,
      name: r.referrer.name,
      phone: r.referrer.phone,
      code: r.referrer.referralCode,
      referred: r.referred,
      converted: r.converted,
      rewardsEarned: r.converted,
      rewardsGiven: given,
      rewardsPending: Math.max(0, r.converted - given),
      pendingValue: Math.max(0, r.converted - given) * amount,
      lastAt: r.lastAt,
    };
  });
  const totals = items.reduce((t, i) => ({ referred: t.referred + i.referred, converted: t.converted + i.converted, pending: t.pending + i.rewardsPending }), { referred: 0, converted: 0, pending: 0 });
  res.json({ settings: tenant.settings?.referral || {}, totals, items });
});

/** Code + share link of one contact (creates the code if needed) */
router.get('/contact/:contactId', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.contactId)) throw notFound('Contact not found');
  const contact = await Contact.findOne({ _id: req.params.contactId, tenantId: req.tenantId }).populate('referredBy', 'name phone referralCode');
  if (!contact) throw notFound('Contact not found');
  const tenant = await Tenant.findById(req.tenantId).select('settings.referral whatsapp.displayPhoneNumber phone');
  await ensureReferralCode(contact);
  const [referred, converted] = await Promise.all([
    Contact.countDocuments({ tenantId: req.tenantId, referredBy: contact._id }),
    Contact.countDocuments({ tenantId: req.tenantId, referredBy: contact._id, leadStatus: 'converted' }),
  ]);
  res.json({
    code: contact.referralCode,
    link: referralLink(tenant, contact),
    hasNumber: !!String(tenant.settings?.referral?.linkNumber || tenant.whatsapp?.displayPhoneNumber || tenant.phone || '').replace(/\D/g, ''),
    referredBy: contact.referredBy,
    referred,
    converted,
    rewardsGiven: contact.referralRewardsGiven || 0,
  });
});

/** Record fee discounts given to a referrer (given = total given so far) */
router.patch('/contact/:contactId/rewards', authorize('admin'), async (req, res) => {
  const { given } = validate(z.object({ given: z.coerce.number().int().min(0).max(10000) }), req.body);
  if (!mongoose.isValidObjectId(req.params.contactId)) throw notFound('Contact not found');
  const contact = await Contact.findOne({ _id: req.params.contactId, tenantId: req.tenantId });
  if (!contact) throw notFound('Contact not found');
  const converted = await Contact.countDocuments({ tenantId: req.tenantId, referredBy: contact._id, leadStatus: 'converted' });
  if (given > converted) throw badRequest(`Only ${converted} referral(s) have converted so far`);
  const before = contact.referralRewardsGiven || 0;
  contact.referralRewardsGiven = given;
  await contact.save();
  await audit(req, 'referral.reward', { targetType: 'Contact', targetId: contact._id, meta: { before, given } });
  res.json({ rewardsGiven: given });
});

export default router;
