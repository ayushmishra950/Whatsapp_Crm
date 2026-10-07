import { Conversation, Contact, Message, User } from '../models/index.js';
import { HttpError } from '../utils/http.js';
import * as wa from './whatsapp.js';
import { assertCanSend, incrementUsage } from './subscription.js';
import { emitConversationEvent } from './socket.js';

export const CONVERSATION_POPULATE = [
  { path: 'contactId', select: 'name phone tags leadStatus optedOut adSource.headline adSource.sourceId followUpAt' },
  { path: 'assignedTo', select: 'name email role' },
];

// Fields every message sent to the UI should carry
export const MESSAGE_POPULATE = [
  { path: 'sentBy', select: 'name' },
  { path: 'deletedBy', select: 'name' },
  {
    path: 'replyTo',
    select: 'direction type text media.fileName media.caption template.name sentBy deletedAt createdAt',
    populate: { path: 'sentBy', select: 'name' },
  },
];

export function previewOf(message) {
  if (message.deletedAt) return '🚫 Message deleted';
  if (message.automation?.kind) return `⚡ ${message.template?.name || 'Automation'}`;
  if (message.type === 'template') return `📋 ${message.template?.name || 'Template'}`;
  if (message.isBot) return `🤖 ${(message.text || '').slice(0, 110)}`;
  if (['image', 'video', 'audio', 'document'].includes(message.type)) {
    return `📎 ${message.media?.caption || message.media?.fileName || message.type}`;
  }
  return (message.text || '').slice(0, 120);
}

export async function getOrCreateConversation(tenantId, contactId) {
  return Conversation.findOneAndUpdate(
    { tenantId, contactId },
    { $setOnInsert: { tenantId, contactId, lastMessageAt: new Date() } },
    { upsert: true, returnDocument: 'after' }
  );
}

// Round-robin: pick the active agent who was assigned a chat least recently
export async function autoAssign(tenant, conversation) {
  if (conversation.assignedTo || !tenant.settings?.autoAssign) return conversation;
  const agent = await User.findOneAndUpdate(
    { tenantId: tenant._id, role: 'agent', isActive: true },
    { $set: { lastAssignedAt: new Date() } },
    { sort: { lastAssignedAt: 1 }, returnDocument: 'after' }
  );
  if (agent) {
    conversation.assignedTo = agent._id;
    await conversation.save();
  }
  return conversation;
}

export async function emitMessage(conversationId, message, extra) {
  const conversation = await Conversation.findById(conversationId).populate(CONVERSATION_POPULATE);
  if (conversation) emitConversationEvent(conversation, 'message:new', { message, conversation }, extra);
  return conversation;
}

// An existing message changed (reaction, edit, hidden) -> push the fresh copy to everyone who can see the chat
export async function emitMessageUpdate(message) {
  const conversation = await Conversation.findById(message.conversationId);
  if (!conversation) return;
  await message.populate(MESSAGE_POPULATE);
  emitConversationEvent(conversation, 'message:updated', message);
}

/**
 * Validate the message being quoted. It must be in the same conversation, visible, and known to WhatsApp
 * (WhatsApp needs its wamid as the reply context).
 */
export async function resolveReplyTarget(conversation, replyToId) {
  if (!replyToId) return null;
  const target = await Message.findOne({ _id: replyToId, conversationId: conversation._id });
  if (!target) throw new HttpError(400, 'The message you are replying to was not found in this chat');
  if (target.deletedAt) throw new HttpError(400, 'You can not reply to a hidden message');
  if (target.direction === 'internal') throw new HttpError(400, 'Internal notes can not be quoted to the customer');
  if (!target.waMessageId) throw new HttpError(400, 'This message was never delivered to WhatsApp, so it can not be quoted');
  return target;
}

/**
 * Send one outbound message to a contact and record it in the conversation.
 * kind: 'text' | 'template' | 'media'
 * Returns the saved Message (status "failed" with `error` if WhatsApp rejected it).
 */
/**
 * kind 'interactive' = chatbot menu ({ kind: 'buttons'|'list', body, buttonLabel, options }).
 * isBot = sent by the chatbot. Any message sent by a person stops the bot for that chat (agent took over).
 */
export async function sendOutbound({ tenant, contact, conversation, user, kind, text, template, media, interactive, campaignId, replyTo, isBot = false, automation }) {
  assertCanSend(tenant);
  conversation ||= await getOrCreateConversation(tenant._id, contact._id);

  if (kind !== 'template' && !conversation.windowOpen) {
    throw new HttpError(
      400,
      'The 24-hour reply window is closed. Customer has not messaged in the last 24 hours, so only an approved template can be sent.'
    );
  }
  if (kind === 'template' && contact.optedOut && !conversation.windowOpen) {
    throw new HttpError(400, 'This contact has opted out of messages.');
  }

  const message = await Message.create({
    tenantId: tenant._id,
    conversationId: conversation._id,
    contactId: contact._id,
    direction: 'outbound',
    type: kind === 'media' ? media.type : kind,
    text: kind === 'text' ? text : kind === 'template' ? template.renderedText : kind === 'interactive' ? interactive.body : '',
    interactive: kind === 'interactive' ? { kind: interactive.kind, buttonLabel: interactive.buttonLabel, options: interactive.options } : undefined,
    isBot,
    template: kind === 'template' ? { name: template.name, language: template.language, params: template.params } : undefined,
    media: kind === 'media' ? media : undefined,
    status: 'queued',
    sentBy: user?._id,
    campaignId,
    automation,
    replyTo: replyTo?._id,
  });

  try {
    const options = { contextId: replyTo?.waMessageId };
    let result;
    if (kind === 'text') result = await wa.sendText(tenant._id, contact.phone, text, options);
    else if (kind === 'template') result = await wa.sendTemplate(tenant._id, contact.phone, template, options);
    else if (kind === 'interactive') result = await wa.sendInteractive(tenant._id, contact.phone, interactive, options);
    else result = await wa.sendMedia(tenant._id, contact.phone, media, options);

    message.status = 'sent';
    message.waMessageId = result.id;
    await incrementUsage(tenant._id, 1);
  } catch (err) {
    message.status = 'failed';
    message.error = err.message;
  }
  await message.save();
  await message.populate(MESSAGE_POPULATE);

  const now = new Date();
  const convUpdate = { lastMessageAt: now, lastMessagePreview: previewOf(message) };
  // A person replied (not the bot, not a bulk campaign) -> the bot steps back for this chat
  const takeover = !isBot && !campaignId && user && conversation.bot?.active;
  if (takeover) Object.assign(convUpdate, { 'bot.active': false, 'bot.endedAt': now, 'bot.endReason': 'takeover' });
  await Conversation.updateOne({ _id: conversation._id }, { $set: convUpdate });
  if (takeover) {
    const fresh = await Conversation.findById(conversation._id).populate(CONVERSATION_POPULATE);
    emitConversationEvent(fresh, 'conversation:updated', fresh);
  }
  await Contact.updateOne({ _id: contact._id }, { $set: { lastMessageAt: now } });
  await emitMessage(conversation._id, message);
  return message;
}

export async function addInternalNote({ tenant, conversation, user, text }) {
  const message = await Message.create({
    tenantId: tenant._id,
    conversationId: conversation._id,
    contactId: conversation.contactId,
    direction: 'internal',
    type: 'note',
    text,
    status: 'sent',
    sentBy: user._id,
  });
  await message.populate(MESSAGE_POPULATE);
  await emitMessage(conversation._id, message);
  return message;
}

// Replace {{1}}, {{2}} in template body with params
export function renderTemplate(body, params = []) {
  return body.replace(/\{\{(\d+)\}\}/g, (_, n) => params[Number(n) - 1] ?? `{{${n}}}`);
}
