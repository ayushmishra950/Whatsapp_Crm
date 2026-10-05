import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Campaign, CampaignRecipient, Contact, Template } from '../models/index.js';
import { validate, notFound, badRequest, forbidden, paginate } from '../utils/http.js';
import { audit } from '../services/audit.js';
import { audienceFilter, buildRecipients } from '../services/campaigns.js';
import { assertCanSend } from '../services/subscription.js';

const router = Router();

// Bulk messaging: admins always; agents only if the business allows it
router.use((req, _res, next) => {
  if (req.user.role === 'admin' || req.tenant.settings?.agentsCanBroadcast) return next();
  throw forbidden('Bulk messaging is not enabled for agents');
});

const objectId = z.string().refine(mongoose.isValidObjectId, 'Invalid id');

const campaignSchema = z.object({
  name: z.string().trim().min(2),
  templateId: objectId,
  audience: z.object({
    type: z.enum(['all', 'tags', 'contacts']),
    tags: z.array(z.string()).optional(),
    contactIds: z.array(objectId).optional(),
  }),
  variables: z
    .array(z.object({ source: z.enum(['field', 'static']), value: z.string() }))
    .optional(),
  launch: z.boolean().optional(),
  scheduledAt: z.coerce.date().nullable().optional(),
});

async function launch(req, campaign, scheduledAt) {
  const template = await Template.findOne({ _id: campaign.templateId, tenantId: req.tenantId });
  if (!template) throw badRequest('Template not found');
  if (template.status !== 'approved') throw badRequest('Template must be approved by WhatsApp before sending');
  if ((campaign.variables?.length || 0) < template.variableCount) {
    throw badRequest(`Template needs ${template.variableCount} variable value(s)`);
  }

  const audienceSize = await Contact.countDocuments(audienceFilter(req.tenantId, campaign.audience));
  if (!audienceSize) throw badRequest('No contacts match this audience (opted-out contacts are excluded)');
  assertCanSend(req.tenant, audienceSize);

  await buildRecipients(campaign);
  if (scheduledAt && scheduledAt > new Date()) {
    campaign.status = 'scheduled';
    campaign.scheduledAt = scheduledAt;
  } else {
    campaign.status = 'running';
    campaign.startedAt = new Date();
  }
  await campaign.save();
  await audit(req, 'campaign.launch', { targetType: 'Campaign', targetId: campaign._id, meta: { recipients: campaign.stats.total, scheduledAt } });
}

router.get('/', async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const filter = { tenantId: req.tenantId };
  const [items, total] = await Promise.all([
    Campaign.find(filter).populate('templateId', 'name').populate('createdBy', 'name').sort({ createdAt: -1 }).skip(skip).limit(limit),
    Campaign.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit });
});

router.post('/', async (req, res) => {
  const { launch: launchNow, scheduledAt, ...data } = validate(campaignSchema, req.body);
  if (data.audience.type === 'tags' && !data.audience.tags?.length) throw badRequest('Select at least one tag');
  if (data.audience.type === 'contacts' && !data.audience.contactIds?.length) throw badRequest('Select at least one contact');
  if (!(await Template.exists({ _id: data.templateId, tenantId: req.tenantId }))) throw badRequest('Template not found');

  const campaign = new Campaign({ ...data, tenantId: req.tenantId, createdBy: req.user._id, status: 'draft' });
  await campaign.save();
  await audit(req, 'campaign.create', { targetType: 'Campaign', targetId: campaign._id });
  if (launchNow || scheduledAt) {
    try {
      await launch(req, campaign, scheduledAt);
    } catch (err) {
      // Keep the draft so the user can fix and relaunch
      err.details = { ...(err.details || {}), campaignId: campaign._id };
      throw err;
    }
  }
  res.status(201).json(campaign);
});

async function findCampaign(req) {
  if (!mongoose.isValidObjectId(req.params.id)) throw notFound('Campaign not found');
  const campaign = await Campaign.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!campaign) throw notFound('Campaign not found');
  return campaign;
}

router.get('/:id', async (req, res) => {
  const campaign = await findCampaign(req);
  await campaign.populate([{ path: 'templateId' }, { path: 'createdBy', select: 'name' }]);
  res.json(campaign);
});

router.get('/:id/recipients', async (req, res) => {
  const campaign = await findCampaign(req);
  const { page, limit, skip } = paginate(req.query);
  const filter = { campaignId: campaign._id };
  if (req.query.status) filter.status = req.query.status;
  const [items, total] = await Promise.all([
    CampaignRecipient.find(filter).populate('contactId', 'name phone').sort({ updatedAt: -1 }).skip(skip).limit(limit),
    CampaignRecipient.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit });
});

router.patch('/:id', async (req, res) => {
  const campaign = await findCampaign(req);
  if (campaign.status !== 'draft') throw badRequest('Only draft campaigns can be edited');
  const { launch: _l, scheduledAt: _s, ...data } = validate(campaignSchema.partial(), req.body);
  Object.assign(campaign, data);
  await campaign.save();
  res.json(campaign);
});

router.post('/:id/launch', async (req, res) => {
  const { scheduledAt } = validate(z.object({ scheduledAt: z.coerce.date().nullable().optional() }), req.body || {});
  const campaign = await findCampaign(req);
  if (campaign.status !== 'draft') throw badRequest('Campaign was already launched');
  await launch(req, campaign, scheduledAt);
  res.json(campaign);
});

const transitions = {
  pause: { from: ['running', 'scheduled'], to: 'paused' },
  resume: { from: ['paused'], to: 'running' },
  cancel: { from: ['running', 'scheduled', 'paused'], to: 'cancelled' },
};

router.post('/:id/:action', async (req, res) => {
  const { action } = req.params;
  if (!Object.hasOwn(transitions, action)) throw notFound();
  const campaign = await findCampaign(req);
  const t = transitions[action];
  if (!t.from.includes(campaign.status)) throw badRequest(`Can not ${action} a ${campaign.status} campaign`);
  if (action === 'resume') assertCanSend(req.tenant);

  campaign.status = t.to;
  campaign.pauseReason = undefined;
  if (action === 'cancel') {
    const result = await CampaignRecipient.updateMany(
      { campaignId: campaign._id, status: 'pending' },
      { $set: { status: 'skipped', error: 'Campaign cancelled' } }
    );
    campaign.stats.skipped += result.modifiedCount;
    campaign.completedAt = new Date();
  }
  await campaign.save();
  await audit(req, `campaign.${action}`, { targetType: 'Campaign', targetId: campaign._id });
  res.json(campaign);
});

router.delete('/:id', async (req, res) => {
  const campaign = await findCampaign(req);
  if (['running', 'scheduled'].includes(campaign.status)) throw badRequest('Pause or cancel the campaign before deleting');
  await CampaignRecipient.deleteMany({ campaignId: campaign._id });
  await campaign.deleteOne();
  await audit(req, 'campaign.delete', { targetType: 'Campaign', targetId: campaign._id });
  res.json({ ok: true });
});

export default router;
