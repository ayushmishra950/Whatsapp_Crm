import { Router } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { Tenant, User, Contact, Template, Campaign, Chatbot, Drip } from '../models/index.js';
import { authorize } from '../middleware/auth.js';
import { validate, conflict, normalizePhone, badRequest } from '../utils/http.js';
import { STATUS_COLORS, STAGE_KEYS, getLeadStatuses, statusKeyFromLabel } from '../services/leadStatuses.js';
import { applyCoachingPreset, checkLogo, requireCoaching } from '../services/coaching.js';
import { loadCoachingContent } from '../services/coachingContent.js';
import { encrypt } from '../utils/crypto.js';
import { verifyCredentials } from '../services/whatsapp.js';
import { audit } from '../services/audit.js';
import { emitToSuperAdmins, emitToTenant } from '../services/socket.js';
import { BUILTIN_CONTACT_FIELDS, FIELD_TYPES, fieldKeyFromLabel, getContactFields, isReservedFieldKey } from '../services/contactFields.js';
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
          autoLeadStatus: z.boolean().optional(),
          optOutKeywords: z.array(z.string().trim().min(1)).optional(),
          automation: z
            .object({
              quietStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:MM'),
              quietEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:MM'),
              maxPerContactPerDay: z.coerce.number().int().min(0).max(10),
              oneDripAtATime: z.boolean(),
              alertOnReply: z.boolean(),
              overdueAlertMinutes: z.coerce.number().int().min(0).max(1440),
              feeReminders: z.boolean(),
              walkInTemplateId: z.string().refine((v) => !v || mongoose.isValidObjectId(v), 'Invalid template').transform((v) => v || null).nullable(),
              dailyReportTime: z.string().regex(/^(([01]\d|2[0-3]):[0-5]\d)?$/, 'Time must be HH:MM'),
              returningLead: z.object({ enabled: z.boolean(), fromStatuses: z.array(z.string()).max(20), toStatus: z.string() }),
            })
            .partial()
            .optional(),
          referral: z
            .object({
              enabled: z.boolean(),
              rewardText: z.string().trim().max(200),
              rewardAmount: z.coerce.number().min(0).max(1000000),
              linkNumber: z.string().trim().max(20).transform((v) => v.replace(/\D/g, '')),
              messageText: z.string().trim().min(5).max(500),
            })
            .partial()
            .optional(),
          waRates: z
            .object({ marketing: z.coerce.number().min(0).max(100), utility: z.coerce.number().min(0).max(100), authentication: z.coerce.number().min(0).max(100) })
            .partial()
            .optional(),
          messageInfo: z
            .object({
              reviewLink: z.string().trim().max(300),
              proofLink: z.string().trim().max(300),
              offerEnd: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Offer end must be a date'),
              address: z.string().trim().max(300),
              mapsLink: z.string().trim().max(300),
              paymentDetails: z.string().trim().max(500),
              city: z.string().trim().max(60),
              studentsTrained: z.string().trim().max(20),
              sinceYear: z.string().trim().max(10),
              rating: z.string().trim().max(20),
            })
            .partial()
            .optional(),
        })
        .optional(),
    }),
    req.body
  );
  const rl = data.settings?.automation?.returningLead;
  if (rl?.enabled) {
    const keys = new Set(getLeadStatuses(req.tenant).map((s) => s.key));
    if (!keys.has(rl.toStatus)) throw badRequest('Choose the status a returning lead moves to');
    rl.fromStatuses = rl.fromStatuses.filter((k) => keys.has(k));
  }
  const set = {};
  for (const k of ['name', 'email', 'phone']) if (data[k] !== undefined) set[k] = data[k];
  for (const [k, v] of Object.entries(data.settings || {})) {
    // Nested groups are merged field by field so a partial update keeps the other values
    if (k === 'automation' || k === 'referral' || k === 'messageInfo' || k === 'waRates') for (const [kk, vv] of Object.entries(v)) set[`settings.${k}.${kk}`] = vv;
    else set[`settings.${k}`] = k === 'optOutKeywords' ? v.map((w) => w.toUpperCase()) : v;
  }
  const before = { name: req.tenant.name, email: req.tenant.email || '', phone: req.tenant.phone || '' };
  const tenant = await Tenant.findByIdAndUpdate(req.tenantId, { $set: set }, { returnDocument: 'after' });
  await audit(req, 'settings.update', { meta: set });
  // Business profile changed by its admin: Super Admin panel updates live and shows a notification
  const changes = Object.fromEntries(
    ['name', 'email', 'phone'].filter((k) => data[k] !== undefined && String(data[k] || '') !== String(before[k] || '')).map((k) => [k, { from: before[k], to: data[k] || '' }])
  );
  if (Object.keys(changes).length) {
    const payload = { tenantId: String(tenant._id), name: tenant.name, email: tenant.email, phone: tenant.phone, changes, by: { name: req.user.name, role: req.user.role, viaSuperAdmin: !!req.impersonatedBy }, at: new Date() };
    emitToSuperAdmins('tenant:updated', payload);
    emitToTenant(tenant._id, 'tenant:profile', payload);
  }
  res.json({ settings: tenant.settings, name: tenant.name, email: tenant.email, phone: tenant.phone });
});

/**
 * Save the business's lead statuses. Existing keys keep their key (contacts store it); new ones get a key from the label.
 * Removing a status moves its contacts to "New" ("new" itself can't be removed).
 */
// ---------- Contact fields ----------

// Where is customFields.<key> used? (so a field in use is not deleted by mistake)
async function fieldUsage(tenantId, key) {
  const path = `custom.${key}`;
  const [templates, campaigns, bot, drips] = await Promise.all([
    Template.find({ tenantId, variableDefaults: { $elemMatch: { source: 'field', value: path } } }).select('name').lean(),
    Campaign.find({ tenantId, status: { $in: ['draft', 'scheduled', 'running', 'paused'] }, variables: { $elemMatch: { source: 'field', value: path } } }).select('name').lean(),
    Chatbot.exists({ tenantId, 'leadQuestions.field': path }),
    Drip.find({ tenantId, $or: [{ 'trigger.field': path }, { 'steps.variables': { $elemMatch: { source: 'field', value: path } } }] }).select('name').lean(),
  ]);
  return [
    ...templates.map((t) => `template "${t.name}"`),
    ...campaigns.map((c) => `campaign "${c.name}"`),
    ...(bot ? ['chatbot lead questions'] : []),
    ...drips.map((d) => `drip "${d.name}"`),
  ];
}

/** Built-in + custom fields, how many contacts have a value, and keys found on contacts but not in the list */
router.get('/contact-fields', async (req, res) => {
  const rows = await Contact.aggregate([
    { $match: { tenantId: req.tenantId } },
    { $project: { kv: { $objectToArray: { $ifNull: ['$customFields', {}] } } } },
    { $unwind: '$kv' },
    { $match: { 'kv.v': { $nin: ['', null] } } },
    { $group: { _id: '$kv.k', n: { $sum: 1 } } },
  ]);
  const counts = Object.fromEntries(rows.map((r) => [r._id, r.n]));
  const fields = getContactFields(req.tenant);
  const known = new Set(fields.map((f) => f.key));
  res.json({
    builtin: BUILTIN_CONTACT_FIELDS,
    fields: await Promise.all(fields.map(async (f) => ({ ...f, contacts: counts[f.key] || 0, usedIn: await fieldUsage(req.tenantId, f.key) }))),
    discovered: Object.keys(counts).filter((k) => !known.has(k)).map((key) => ({ key, contacts: counts[key] })),
  });
});

/**
 * Save the custom field list. Existing keys stay (contacts store them), new keys come from the label.
 * Removing a field that a template / campaign / chatbot uses is refused; otherwise its saved values are
 * deleted from all contacts.
 */
router.put('/contact-fields', authorize('admin'), async (req, res) => {
  const { fields } = validate(
    z.object({
      fields: z
        .array(
          z.object({
            key: z.string().trim().optional(),
            label: z.string().trim().min(1).max(40),
            type: z.enum(FIELD_TYPES).default('text'),
            options: z.array(z.string().trim().min(1).max(60)).max(100).default([]),
          })
        )
        .max(50),
    }),
    req.body
  );
  const current = getContactFields(req.tenant);
  const used = new Set();
  const next = fields.map(({ key, label, type, options }) => {
    let k = key && current.some((f) => f.key === key) ? key : fieldKeyFromLabel(label);
    if (!key && isReservedFieldKey(k)) throw badRequest(`"${label}" is already a built-in field`);
    if (!key) for (let n = 2; used.has(k) || current.some((f) => f.key === k && !fields.some((x) => x.key === k)); n += 1) k = `${fieldKeyFromLabel(label)}_${n}`;
    if (used.has(k)) throw badRequest(`Two fields are called "${label}"`);
    used.add(k);
    const opts = options.filter((o, i) => options.findIndex((x) => x.toLowerCase() === o.toLowerCase()) === i);
    if ((type === 'select' || type === 'multiselect') && !opts.length) throw badRequest(`"${label}" is a dropdown: add at least one option`);
    return { key: k, label, type, options: type === 'select' || type === 'multiselect' ? opts : [] };
  });
  if (new Set(next.map((f) => f.label.toLowerCase())).size !== next.length) throw badRequest('Field names must be different');

  const removed = current.filter((f) => !next.some((x) => x.key === f.key));
  for (const f of removed) {
    const where = await fieldUsage(req.tenantId, f.key);
    if (where.length) {
      throw conflict(`"${f.label}" can not be deleted because it is used in ${where.join(', ')}. Remove it there first, then delete the field.`);
    }
  }
  let valuesRemoved = 0;
  if (removed.length) {
    const unset = Object.fromEntries(removed.map((f) => [`customFields.${f.key}`, '']));
    const result = await Contact.updateMany({ tenantId: req.tenantId, $or: removed.map((f) => ({ [`customFields.${f.key}`]: { $exists: true } })) }, { $unset: unset });
    valuesRemoved = result.modifiedCount;
  }
  await Tenant.updateOne({ _id: req.tenantId }, { $set: { 'settings.contactFields': next } });
  await audit(req, 'settings.contact_fields', { meta: { fields: next.map((f) => f.key), removed: removed.map((f) => f.key) } });
  res.json({ fields: next, removed: removed.map((f) => f.label), contactsUpdated: valuesRemoved });
});

router.put('/lead-statuses', authorize('admin'), async (req, res) => {
  const { statuses } = validate(
    z.object({
      statuses: z
        .array(
          z.object({
            key: z.string().trim().optional(),
            label: z.string().trim().min(1, 'Status name is required').max(30),
            color: z.enum(STATUS_COLORS).default('gray'),
            stage: z.enum(['', ...STAGE_KEYS]).default(''),
            timeLimit: z
              .object({ amount: z.coerce.number().int().min(0).max(10000).default(0), unit: z.enum(['minutes', 'hours', 'days']).default('days') })
              .default({ amount: 0, unit: 'days' }),
            onTimeout: z
              .object({ moveTo: z.string().trim().default(''), task: z.string().trim().max(120).default(''), alert: z.boolean().default(false) })
              .default({ moveTo: '', task: '', alert: false }),
          })
        )
        .min(2, 'Keep at least 2 statuses')
        .max(20, 'Max 20 statuses'),
    }),
    req.body
  );
  const current = getLeadStatuses(req.tenant);
  const currentKeys = new Set(current.map((s) => s.key));
  const used = new Set();
  const next = statuses.map((s) => {
    let key = s.key && currentKeys.has(s.key) ? s.key : statusKeyFromLabel(s.label);
    if (used.has(key)) {
      if (s.key && currentKeys.has(s.key)) throw badRequest(`Status "${s.label}" is listed twice`);
      let n = 2;
      while (used.has(`${key}_${n}`) || (currentKeys.has(`${key}_${n}`) && !statuses.some((x) => x.key === `${key}_${n}`))) n += 1;
      key = `${key}_${n}`;
    }
    used.add(key);
    return { key, label: s.label, color: s.color, stage: s.stage, timeLimit: s.timeLimit, onTimeout: s.onTimeout };
  });
  // "When time runs out → move to" may point at an existing key or at a new status by its label
  const byLabel = Object.fromEntries(next.map((s) => [s.label.toLowerCase(), s.key]));
  for (const s of next) {
    const to = s.onTimeout.moveTo;
    if (!to) continue;
    const key = used.has(to) ? to : byLabel[to.toLowerCase()];
    if (!key) throw badRequest(`"${s.label}": the status to move to after the time limit no longer exists`);
    if (key === s.key) throw badRequest(`"${s.label}" can not move to itself after the time limit`);
    s.onTimeout.moveTo = key;
  }
  const now = new Date();
  const limitKey = (s) => JSON.stringify([s.timeLimit.amount, s.timeLimit.unit]);
  for (const s of next) {
    if (!s.timeLimit.amount && (s.onTimeout.moveTo || s.onTimeout.task || s.onTimeout.alert)) s.onTimeout = { moveTo: '', task: '', alert: false };
    // A new / changed limit starts counting now for leads already in the status
    const old = current.find((c) => c.key === s.key);
    if (s.timeLimit.amount) s.limitSince = old && old.limitSince && limitKey(old) === limitKey(s) ? old.limitSince : now;
  }
  if (!next.some((s) => s.key === 'new')) throw badRequest('"New" status can not be removed (new leads get it automatically). You can rename it.');
  const labels = next.map((s) => s.label.toLowerCase());
  if (new Set(labels).size !== labels.length) throw badRequest('Two statuses have the same name');

  const removed = current.filter((s) => !used.has(s.key)).map((s) => s.key);
  const moved = removed.length
    ? (await Contact.updateMany({ tenantId: req.tenantId, leadStatus: { $in: removed } }, { $set: { leadStatus: 'new' } })).modifiedCount
    : 0;
  await Tenant.updateOne({ _id: req.tenantId }, { $set: { 'settings.leadStatuses': next } });
  await audit(req, 'settings.lead_statuses', { meta: { statuses: next.map((s) => s.label), removed, moved } });
  res.json({ leadStatuses: next, movedToNew: moved });
});

/**
 * One click: the Infonic "19 statuses" (Lead Stages Playbook) with stages and time limits, plus the
 * hot-word / objection keyword rules and the "returning lead → Hot" rule. Leads in a status that no
 * longer exists move to "New".
 */
router.post('/lead-statuses/preset', authorize('admin'), requireCoaching, async (req, res) => {
  const { removed, moved } = await applyCoachingPreset(req.tenantId, { rules: req.body?.rules !== false });
  await audit(req, 'settings.lead_statuses_preset', { meta: { removed, moved } });
  const tenant = await Tenant.findById(req.tenantId);
  res.json({ leadStatuses: getLeadStatuses(tenant), automationRules: tenant.settings.automationRules, movedToNew: moved });
});

/** Business logo (sidebar). Empty string removes it. */
router.put('/logo', authorize('admin'), async (req, res) => {
  const logo = checkLogo(req.body?.logo);
  await Tenant.updateOne({ _id: req.tenantId }, { $set: { logo } });
  await audit(req, 'settings.logo', { meta: { removed: !logo } });
  emitToTenant(req.tenantId, 'tenant:profile', { tenantId: String(req.tenantId), logo: !!logo });
  res.json({ logo });
});

/** Coaching playbook content: courses, contact fields, template drafts (EN + Hinglish) and drip drafts. Adds only what is missing. */
router.post('/coaching-content', authorize('admin'), requireCoaching, async (req, res) => {
  const added = await loadCoachingContent(req.tenantId, { sampleCourses: req.body?.sampleCourses === true });
  await audit(req, 'settings.coaching_content', { meta: added });
  res.json(added);
});

/** A3/A4 keyword rules: words in a customer's message -> status / tags / alert / task */
router.put('/automation-rules', authorize('admin'), async (req, res) => {
  const { rules } = validate(
    z.object({
      rules: z
        .array(
          z.object({
            name: z.string().trim().min(1, 'Rule name is required').max(60),
            enabled: z.boolean().default(true),
            keywords: z.array(z.string().trim().toLowerCase().min(1)).min(1, 'Add at least one keyword').max(50),
            onlyIfStatusIn: z.array(z.string()).default([]),
            setStatus: z.string().default(''),
            addTags: z.array(z.string().trim().toLowerCase().min(1)).max(10).default([]),
            alert: z.boolean().default(false),
            task: z.string().trim().max(120).default(''),
          })
        )
        .max(30),
    }),
    req.body
  );
  const keys = new Set(getLeadStatuses(req.tenant).map((s) => s.key));
  for (const r of rules) {
    if (r.setStatus && !keys.has(r.setStatus)) throw badRequest(`Rule "${r.name}": unknown status`);
    if (!r.setStatus && !r.addTags.length && !r.alert && !r.task) throw badRequest(`Rule "${r.name}" does nothing: choose a status, tag, alert or task`);
    r.onlyIfStatusIn = r.onlyIfStatusIn.filter((k) => keys.has(k));
  }
  await Tenant.updateOne({ _id: req.tenantId }, { $set: { 'settings.automationRules': rules } });
  await audit(req, 'settings.automation_rules', { meta: { rules: rules.map((r) => r.name) } });
  res.json({ automationRules: rules });
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
