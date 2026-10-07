import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Campaign, CampaignRecipient, Contact, Template } from '../models/index.js';
import { validate, notFound, badRequest, forbidden, paginate } from '../utils/http.js';
import { audit } from '../services/audit.js';
import { audienceFilter, buildRecipients } from '../services/campaigns.js';
import { assertCanSend } from '../services/subscription.js';
import { segmentFilterSchema } from '../services/segments.js';

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
    type: z.enum(['all', 'tags', 'status', 'ads', 'contacts', 'filter']),
    tags: z.array(z.string()).optional(),
    leadStatuses: z.array(z.string()).optional(),
    adIds: z.array(z.string()).optional(),
    contactIds: z.array(objectId).optional(),
    filter: segmentFilterSchema.optional(),
    segmentName: z.string().max(80).optional(),
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

async function checkCampaignInput(req, data) {
  if (data.audience.type === 'tags' && !data.audience.tags?.length) throw badRequest('Select at least one tag');
  if (data.audience.type === 'contacts' && !data.audience.contactIds?.length) throw badRequest('Select at least one contact');
  if (data.audience.type === 'status' && !data.audience.leadStatuses?.length) throw badRequest('Select at least one lead status');
  if (data.audience.type === 'ads' && !data.audience.adIds?.length) throw badRequest('Select at least one ad');
  if (data.audience.type === 'filter' && !data.audience.filter) throw badRequest('Set the smart filter');
  if (!(await Template.exists({ _id: data.templateId, tenantId: req.tenantId }))) throw badRequest('Template not found');
}

router.post('/', async (req, res) => {
  const { launch: launchNow, scheduledAt, ...data } = validate(campaignSchema, req.body);
  await checkCampaignInput(req, data);

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

// A scheduled campaign can be edited until shortly before it starts (the worker must not pick it up mid-edit)
const EDIT_CUTOFF_MS = 60 * 1000;

/**
 * Edit a draft or a scheduled campaign (name, template, audience, variables, time).
 * launch=true sends now, scheduledAt (future) schedules, neither keeps / turns it into a draft.
 * Recipients of a scheduled campaign are rebuilt from the new audience.
 */
router.put('/:id', async (req, res) => {
  const { launch: launchNow, scheduledAt, ...data } = validate(campaignSchema, req.body);
  await checkCampaignInput(req, data);
  if (scheduledAt && scheduledAt.getTime() < Date.now() + EDIT_CUTOFF_MS) throw badRequest('Pick a time at least 1 minute from now, or choose "Send now"');
  let campaign = await findCampaign(req);
  if (!['draft', 'scheduled'].includes(campaign.status)) {
    throw badRequest(`A ${campaign.status} campaign can not be edited. Only draft and scheduled campaigns can.`);
  }

  let restore = null;
  if (campaign.status === 'scheduled') {
    // Take it away from the worker atomically; fails if it is about to start (or just started)
    const claimed = await Campaign.findOneAndUpdate(
      { _id: campaign._id, tenantId: req.tenantId, status: 'scheduled', scheduledAt: { $gt: new Date(Date.now() + EDIT_CUTOFF_MS) } },
      { $set: { status: 'draft' } },
      { returnDocument: 'after' }
    );
    if (!claimed) throw badRequest('This campaign starts in less than a minute (or has already started), so it can not be edited any more. You can still pause or cancel it.');
    restore = { name: campaign.name, templateId: campaign.templateId, audience: campaign.toObject().audience, variables: campaign.toObject().variables, scheduledAt: campaign.scheduledAt };
    campaign = claimed;
    await CampaignRecipient.deleteMany({ campaignId: campaign._id });
    campaign.stats.total = 0;
    campaign.scheduledAt = undefined;
  }

  Object.assign(campaign, data);
  await campaign.save();
  try {
    if (launchNow || scheduledAt) await launch(req, campaign, scheduledAt);
  } catch (err) {
    if (restore) {
      // Put the scheduled campaign back exactly as it was
      Object.assign(campaign, restore);
      await campaign.save();
      await buildRecipients(campaign);
      campaign.status = 'scheduled';
      await campaign.save();
    }
    throw err;
  }
  await audit(req, 'campaign.edit', { targetType: 'Campaign', targetId: campaign._id, meta: { status: campaign.status, scheduledAt: campaign.scheduledAt } });
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
  // Resuming a campaign that was paused before its scheduled time: wait for that time again
  if (action === 'resume' && !campaign.startedAt && campaign.scheduledAt > new Date()) campaign.status = 'scheduled';
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
