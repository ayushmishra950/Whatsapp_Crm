/**
 * Bulk messaging. Recipients are stored in MongoDB and a small in-process worker
 * sends them at a controlled rate, so no Redis is needed and a restart resumes safely.
 */
import { Campaign, CampaignRecipient, Contact, Template, Tenant } from '../models/index.js';
import { env } from '../config/env.js';
import { sendOutbound, renderTemplate } from './messaging.js';
import { resolveVariables } from './variables.js';
import { segmentQuery } from './segments.js';
import { emitToTenantAdmins } from './socket.js';
import { isSubscriptionActive, messagesUsedThisMonth } from './subscription.js';

export function audienceFilter(tenantId, audience, tz) {
  // Smart filter: date ranges + status + tags + ads + fields together (services/segments.js)
  if (audience.type === 'filter') return { $and: [segmentQuery(tenantId, audience.filter || {}, tz), { optedOut: false }] };
  const filter = { tenantId, optedOut: false };
  if (audience.type === 'tags') filter.tags = { $in: audience.tags || [] };
  if (audience.type === 'status') filter.leadStatus = { $in: audience.leadStatuses || [] };
  if (audience.type === 'ads') filter['adSource.sourceId'] = { $in: audience.adIds || [] };
  if (audience.type === 'contacts') filter._id = { $in: audience.contactIds || [] };
  return filter;
}

// Build recipient rows once when the campaign is launched (snapshot of the audience)
export async function buildRecipients(campaign) {
  const contacts = await Contact.find(audienceFilter(campaign.tenantId, campaign.audience)).select('_id phone').lean();
  if (contacts.length) {
    const docs = contacts.map((c) => ({
      campaignId: campaign._id,
      tenantId: campaign.tenantId,
      contactId: c._id,
      phone: c.phone,
    }));
    // In batches of 1000 so no single DB call runs long (see the socket timeout in config/db.js)
    for (let i = 0; i < docs.length; i += 1000) {
      try {
        await CampaignRecipient.insertMany(docs.slice(i, i + 1000), { ordered: false });
      } catch (err) {
        if (err.code !== 11000 && !err.writeErrors) throw err; // ignore duplicates on retry
      }
    }
  }
  const total = await CampaignRecipient.countDocuments({ campaignId: campaign._id });
  campaign.stats.total = total;
  return total;
}


function emitCampaign(campaign) {
  emitToTenantAdmins(campaign.tenantId, 'campaign:update', {
    _id: campaign._id,
    status: campaign.status,
    stats: campaign.stats,
  });
}

async function finishIfDone(campaign) {
  const remaining = await CampaignRecipient.countDocuments({
    campaignId: campaign._id,
    status: { $in: ['pending', 'sending'] },
  });
  if (remaining === 0) {
    campaign.status = 'completed';
    campaign.completedAt = new Date();
    await campaign.save();
    emitCampaign(campaign);
  }
}

async function pause(campaign, reason) {
  campaign.status = 'paused';
  await Campaign.updateOne({ _id: campaign._id }, { $set: { status: 'paused', pauseReason: reason } });
  emitToTenantAdmins(campaign.tenantId, 'campaign:update', { _id: campaign._id, status: 'paused', stats: campaign.stats, reason });
}

async function processCampaign(campaign, batchSize) {
  const tenant = await Tenant.findById(campaign.tenantId).populate('plan');
  const template = await Template.findById(campaign.templateId);
  if (!tenant || !template || template.status !== 'approved') {
    campaign.status = 'failed';
    await campaign.save();
    emitCampaign(campaign);
    return;
  }
  if (tenant.status === 'suspended' || !isSubscriptionActive(tenant)) return pause(campaign, 'Subscription inactive');

  const limit = tenant.plan?.limits?.monthlyMessages;
  let budget = limit == null ? batchSize : Math.min(batchSize, limit - messagesUsedThisMonth(tenant));
  if (budget <= 0) return pause(campaign, 'Monthly message limit reached');

  while (budget > 0) {
    // Atomic claim so two workers never send the same recipient
    const recipient = await CampaignRecipient.findOneAndUpdate(
      { campaignId: campaign._id, status: 'pending' },
      { $set: { status: 'sending' } },
      { returnDocument: 'after' }
    );
    if (!recipient) break;
    budget -= 1;

    const contact = await Contact.findById(recipient.contactId);
    const inc = {};
    if (!contact || contact.optedOut) {
      recipient.status = 'skipped';
      recipient.error = contact ? 'Contact opted out' : 'Contact deleted';
      inc['stats.skipped'] = 1;
    } else {
      const params = await resolveVariables(campaign.variables, contact, tenant);
      try {
        const message = await sendOutbound({
          tenant,
          contact,
          kind: 'template',
          template: {
            name: template.name,
            language: template.language,
            params,
            renderedText: renderTemplate(template.body, params),
          },
          campaignId: campaign._id,
          user: { _id: campaign.createdBy },
        });
        recipient.messageId = message._id;
        recipient.sentAt = new Date();
        if (message.status === 'failed') {
          recipient.status = 'failed';
          recipient.error = message.error;
          inc['stats.failed'] = 1;
        } else {
          recipient.status = 'sent';
          recipient.waMessageId = message.waMessageId;
          inc['stats.sent'] = 1;
        }
      } catch (err) {
        recipient.status = 'failed';
        recipient.error = err.message;
        inc['stats.failed'] = 1;
      }
    }
    await recipient.save();
    await Campaign.updateOne({ _id: campaign._id }, { $inc: inc });
  }

  const fresh = await Campaign.findById(campaign._id);
  emitCampaign(fresh);
  if (fresh.status === 'running') await finishIfDone(fresh);
}

let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    // Recover recipients stuck in "sending" after a crash (older than 5 minutes)
    await CampaignRecipient.updateMany(
      { status: 'sending', updatedAt: { $lt: new Date(Date.now() - 5 * 60 * 1000) } },
      { $set: { status: 'pending' } }
    );

    // Start scheduled campaigns that are due
    const due = await Campaign.find({ status: 'scheduled', scheduledAt: { $lte: new Date() } });
    for (const c of due) {
      c.status = 'running';
      c.startedAt = new Date();
      await c.save();
      emitCampaign(c);
    }

    const batchSize = Math.max(1, Math.round((env.campaign.messagesPerSecond * env.campaign.workerIntervalMs) / 1000));
    const active = await Campaign.find({ status: 'running' });
    for (const c of active) {
      try {
        await processCampaign(c, batchSize);
      } catch (err) {
        console.error(`[campaign] ${c._id} error`, err.message);
      }
    }
  } catch (err) {
    console.error('[campaign] worker error', err);
  } finally {
    running = false;
  }
}

export function startCampaignWorker() {
  setInterval(tick, env.campaign.workerIntervalMs);
  console.log('[campaign] worker started');
}
