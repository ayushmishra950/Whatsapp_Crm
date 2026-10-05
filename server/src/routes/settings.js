import { Router } from 'express';
import { z } from 'zod';
import { Tenant, User, Contact } from '../models/index.js';
import { authorize } from '../middleware/auth.js';
import { validate, conflict, normalizePhone } from '../utils/http.js';
import { encrypt } from '../utils/crypto.js';
import { verifyCredentials } from '../services/whatsapp.js';
import { audit } from '../services/audit.js';
import { isSubscriptionActive, messagesUsedThisMonth } from '../services/subscription.js';
import { env } from '../config/env.js';

const router = Router();

router.get('/', async (req, res) => {
  const t = req.tenant;
  const [agents, contacts] = await Promise.all([
    User.countDocuments({ tenantId: t._id, role: 'agent' }),
    Contact.countDocuments({ tenantId: t._id }),
  ]);
  res.json({
    _id: t._id,
    name: t.name,
    email: t.email,
    phone: t.phone,
    plan: t.plan,
    subscription: t.subscription,
    subscriptionActive: isSubscriptionActive(t),
    usage: { agents, contacts, messagesThisMonth: messagesUsedThisMonth(t) },
    whatsapp: {
      mode: t.whatsapp?.mode || 'mock',
      phoneNumberId: t.whatsapp?.phoneNumberId,
      wabaId: t.whatsapp?.wabaId,
      displayPhoneNumber: t.whatsapp?.displayPhoneNumber,
      connectedAt: t.whatsapp?.connectedAt,
    },
    webhook: { path: '/api/webhook/whatsapp', verifyToken: req.user.role === 'admin' ? env.whatsapp.webhookVerifyToken : undefined },
    settings: t.settings,
  });
});

router.patch('/', authorize('admin'), async (req, res) => {
  const data = validate(
    z.object({
      name: z.string().min(2).optional(),
      email: z.string().email().optional().or(z.literal('')),
      phone: z.string().optional(),
      settings: z
        .object({
          autoAssign: z.boolean().optional(),
          agentsCanBroadcast: z.boolean().optional(),
          optOutKeywords: z.array(z.string().trim().min(1)).optional(),
        })
        .optional(),
    }),
    req.body
  );
  const set = {};
  for (const k of ['name', 'email', 'phone']) if (data[k] !== undefined) set[k] = data[k];
  for (const [k, v] of Object.entries(data.settings || {})) {
    set[`settings.${k}`] = k === 'optOutKeywords' ? v.map((w) => w.toUpperCase()) : v;
  }
  const tenant = await Tenant.findByIdAndUpdate(req.tenantId, { $set: set }, { returnDocument: 'after' });
  await audit(req, 'settings.update', { meta: set });
  res.json({ settings: tenant.settings, name: tenant.name });
});

// Connect the business's single WhatsApp number (Cloud API credentials)
router.put('/whatsapp', authorize('admin'), async (req, res) => {
  const data = validate(
    z.object({
      phoneNumberId: z.string().trim().min(5),
      wabaId: z.string().trim().min(5),
      accessToken: z.string().trim().min(20),
    }),
    req.body
  );
  const taken = await Tenant.exists({ 'whatsapp.phoneNumberId': data.phoneNumberId, _id: { $ne: req.tenantId } });
  if (taken) throw conflict('This WhatsApp number is already connected to another business');

  const info = await verifyCredentials(data); // throws if Meta rejects the token / id
  await Tenant.updateOne(
    { _id: req.tenantId },
    {
      $set: {
        'whatsapp.mode': 'live',
        'whatsapp.phoneNumberId': data.phoneNumberId,
        'whatsapp.wabaId': data.wabaId,
        'whatsapp.accessTokenEnc': encrypt(data.accessToken),
        'whatsapp.displayPhoneNumber': normalizePhone(info.display_phone_number || ''),
        'whatsapp.connectedAt': new Date(),
      },
    }
  );
  await audit(req, 'whatsapp.connect', { meta: { phoneNumberId: data.phoneNumberId, verifiedName: info.verified_name } });
  res.json({ ok: true, displayPhoneNumber: info.display_phone_number, verifiedName: info.verified_name, qualityRating: info.quality_rating });
});

// Disconnect = back to mock (sandbox) mode
router.delete('/whatsapp', authorize('admin'), async (req, res) => {
  await Tenant.updateOne(
    { _id: req.tenantId },
    {
      $set: { 'whatsapp.mode': 'mock' },
      $unset: {
        'whatsapp.phoneNumberId': 1,
        'whatsapp.wabaId': 1,
        'whatsapp.accessTokenEnc': 1,
        'whatsapp.displayPhoneNumber': 1,
        'whatsapp.connectedAt': 1,
      },
    }
  );
  await audit(req, 'whatsapp.disconnect');
  res.json({ ok: true });
});

export default router;
