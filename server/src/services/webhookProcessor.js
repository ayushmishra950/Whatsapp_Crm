import { Tenant, Contact, Conversation, Message, CampaignRecipient, Campaign, Template } from '../models/index.js';
import { normalizePhone } from '../utils/http.js';
import {
  autoAssign, emitMessage, emitMessageUpdate, previewOf, getOrCreateConversation, MESSAGE_POPULATE, CONVERSATION_POPULATE,
} from './messaging.js';
import { emitConversationEvent, emitToTenantAdmins } from './socket.js';
import { runChatbot } from './chatbot.js';

const STATUS_RANK = { queued: 0, sending: 0, pending: 0, sent: 1, delivered: 2, read: 3 };
const STAT_FOR_RANK = { 1: 'sent', 2: 'delivered', 3: 'read' };

// Entry point for Meta's webhook body (object: "whatsapp_business_account")
export async function handleWebhookPayload(body) {
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};

      if (change.field === 'message_template_status_update') {
        await processTemplateStatus(value);
        continue;
      }
      if (change.field !== 'messages') continue;

      const tenant = await Tenant.findOne({ 'whatsapp.phoneNumberId': value.metadata?.phone_number_id });
      if (!tenant) {
        console.warn('[webhook] no tenant for phone_number_id', value.metadata?.phone_number_id);
        continue;
      }
      const profileName = value.contacts?.[0]?.profile?.name;
      for (const msg of value.messages || []) await processInbound(tenant, msg, profileName);
      for (const status of value.statuses || []) await processStatus(tenant._id, status);
    }
  }
}

function parseInbound(msg) {
  const base = { type: 'text', text: '', media: undefined };
  switch (msg.type) {
    case 'text':
      return { ...base, text: msg.text?.body || '' };
    case 'image':
    case 'video':
    case 'audio':
    case 'document':
    case 'sticker': {
      const m = msg[msg.type] || {};
      return {
        type: msg.type === 'sticker' ? 'image' : msg.type,
        text: m.caption || '',
        media: { waMediaId: m.id, mimeType: m.mime_type, caption: m.caption, fileName: m.filename },
      };
    }
    case 'button': // quick-reply button on a template
      return { ...base, text: msg.button?.text || '', interactiveReplyId: msg.button?.payload };
    case 'interactive': {
      const reply = msg.interactive?.button_reply || msg.interactive?.list_reply;
      return { ...base, text: reply?.title || '[interactive reply]', interactiveReplyId: reply?.id };
    }
    case 'location':
      return { ...base, text: `📍 ${msg.location?.name || ''} (${msg.location?.latitude}, ${msg.location?.longitude})` };
    default:
      return { ...base, type: 'other', text: `[${msg.type} message not supported]` };
  }
}

// Customer reacted to (or removed a reaction from) one of the chat messages
async function processReaction(tenant, msg) {
  const { message_id: targetWaId, emoji } = msg.reaction || {};
  if (!targetWaId) return null;
  const target = await Message.findOne({ tenantId: tenant._id, waMessageId: targetWaId });
  if (!target) return null;
  // Empty emoji = reaction removed
  target.customerReaction = emoji ? { emoji, at: msg.timestamp ? new Date(Number(msg.timestamp) * 1000) : new Date() } : undefined;
  await target.save();
  await emitMessageUpdate(target);
  return target;
}

export async function processInbound(tenant, msg, profileName) {
  if (msg.type === 'reaction') return processReaction(tenant, msg);
  if (msg.id && (await Message.exists({ tenantId: tenant._id, waMessageId: msg.id }))) return null; // duplicate delivery

  const phone = normalizePhone(msg.from);
  let contact = await Contact.findOneAndUpdate(
    { tenantId: tenant._id, phone },
    { $setOnInsert: { tenantId: tenant._id, phone, name: profileName || '', source: 'whatsapp' } },
    { upsert: true, returnDocument: 'after' }
  );
  if (!contact.name && profileName) {
    contact.name = profileName;
    await contact.save();
  }

  const parsed = parseInbound(msg);

  // Opt-out / opt-in keywords
  const keyword = parsed.text.trim().toUpperCase();
  const optOutWords = (tenant.settings?.optOutKeywords || []).map((k) => k.toUpperCase());
  if (optOutWords.includes(keyword) && !contact.optedOut) {
    contact.optedOut = true;
    contact.optedOutAt = new Date();
    await contact.save();
  } else if (keyword === 'START' && contact.optedOut) {
    contact.optedOut = false;
    await contact.save();
  }

  let conversation = await getOrCreateConversation(tenant._id, contact._id);
  // For the chatbot: is this the customer's first message in this chat / are they coming back to a closed chat?
  const hadPreviousInbound = !!(await Message.exists({ conversationId: conversation._id, direction: 'inbound' }));
  const wasResolved = conversation.status === 'resolved';
  const receivedAt = msg.timestamp ? new Date(Number(msg.timestamp) * 1000) : new Date();

  // Customer swiped-to-reply on a message: link it if we know that message
  const quoted = msg.context?.id
    ? await Message.findOne({ conversationId: conversation._id, waMessageId: msg.context.id }).select('_id')
    : null;

  const message = await Message.create({
    tenantId: tenant._id,
    conversationId: conversation._id,
    contactId: contact._id,
    direction: 'inbound',
    type: parsed.type,
    text: parsed.text,
    media: parsed.media,
    status: 'received',
    waMessageId: msg.id,
    replyTo: quoted?._id,
    interactive: parsed.interactiveReplyId ? { replyId: parsed.interactiveReplyId } : undefined,
  });
  await message.populate(MESSAGE_POPULATE);

  conversation.lastInboundAt = receivedAt;
  conversation.lastMessageAt = receivedAt;
  conversation.lastMessagePreview = previewOf(message);
  conversation.unreadCount += 1;
  if (conversation.status === 'resolved') conversation.status = 'open';
  await conversation.save();

  contact.lastMessageAt = receivedAt;
  await contact.save();

  // Show the customer's message first, then let the bot answer
  await emitMessage(conversation._id, message);

  let botHandling = false;
  try {
    botHandling = await runChatbot({ tenant, conversation, parsed, hadPreviousInbound, wasResolved });
  } catch (err) {
    console.error('[chatbot] error', err);
  }

  // Bot is not (or no longer) handling it -> normal round-robin assignment
  if (!botHandling) {
    const fresh = await Conversation.findById(conversation._id);
    const before = fresh.assignedTo;
    await autoAssign(tenant, fresh);
    if (String(before) !== String(fresh.assignedTo)) {
      await fresh.populate(CONVERSATION_POPULATE);
      emitConversationEvent(fresh, 'conversation:updated', fresh, { wasUnassigned: !before });
    }
  }
  return message;
}

export async function processStatus(tenantId, { id, status, errors }) {
  if (!id) return;
  const failed = status === 'failed';
  const newRank = STATUS_RANK[status];
  if (!failed && newRank == null) return;

  const errorText = errors?.[0] ? `${errors[0].title || ''} ${errors[0].error_data?.details || ''}`.trim() : undefined;

  // Only move status forward (webhooks can arrive out of order)
  const lowerStatuses = Object.keys(STATUS_RANK).filter((s) => STATUS_RANK[s] < (failed ? 2 : newRank));
  const msgUpdate = failed ? { status: 'failed', error: errorText } : { status };
  const message = await Message.findOneAndUpdate(
    { waMessageId: id, status: { $in: lowerStatuses } },
    { $set: msgUpdate },
    { returnDocument: 'after' }
  );
  if (message) {
    const conversation = await Conversation.findById(message.conversationId);
    if (conversation) {
      emitConversationEvent(conversation, 'message:status', {
        messageId: message._id,
        conversationId: message.conversationId,
        status: message.status,
        error: message.error,
      });
    }
  }

  await updateCampaignRecipient(id, status, errorText);
}

async function updateCampaignRecipient(waMessageId, status, errorText) {
  const recipient = await CampaignRecipient.findOne({ waMessageId });
  if (!recipient) return;

  const oldRank = STATUS_RANK[recipient.status] ?? 0;
  const inc = {};

  if (status === 'failed') {
    if (recipient.status === 'failed') return;
    const res = await CampaignRecipient.updateOne(
      { _id: recipient._id, status: recipient.status },
      { $set: { status: 'failed', error: errorText } }
    );
    if (!res.modifiedCount) return;
    inc['stats.failed'] = 1;
  } else {
    const newRank = STATUS_RANK[status];
    if (newRank <= oldRank || recipient.status === 'failed') return;
    const res = await CampaignRecipient.updateOne({ _id: recipient._id, status: recipient.status }, { $set: { status } });
    if (!res.modifiedCount) return;
    // e.g. sent -> read without a "delivered" webhook counts as delivered too
    for (let r = oldRank + 1; r <= newRank; r += 1) inc[`stats.${STAT_FOR_RANK[r]}`] = 1;
  }

  const campaign = await Campaign.findByIdAndUpdate(recipient.campaignId, { $inc: inc }, { returnDocument: 'after' });
  if (campaign) emitToTenantAdmins(campaign.tenantId, 'campaign:update', { _id: campaign._id, stats: campaign.stats, status: campaign.status });
}

export async function processTemplateStatus(value) {
  const map = { APPROVED: 'approved', REJECTED: 'rejected', PENDING: 'pending', DISABLED: 'rejected', PAUSED: 'rejected' };
  const status = map[value.event];
  if (!status || !value.message_template_id) return;
  const template = await Template.findOneAndUpdate(
    { metaTemplateId: String(value.message_template_id) },
    { $set: { status, rejectionReason: status === 'rejected' ? value.reason || value.event : undefined } },
    { returnDocument: 'after' }
  );
  if (template) emitToTenantAdmins(template.tenantId, 'template:update', template);
}
