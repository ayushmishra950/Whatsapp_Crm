/**
 * Instagram webhooks (object: "instagram") → the same lead / chat / message flow as WhatsApp.
 * entry.id is the business's Instagram account id (Tenant.instagram.igUserId); the customer is the IGSID.
 */
import { Contact, Conversation, Message, Plan, Tenant } from '../models/index.js';
import { channelsReady } from './channelMigration.js';
import * as ig from './instagram.js';
import { emitMessageUpdate, emitMessage, previewOf, MESSAGE_POPULATE, getOrCreateConversation } from './messaging.js';
import { emitConversationEvent } from './socket.js';
import { keepForRetry, saveFile } from './storage.js';
import { ingestInbound } from './webhookProcessor.js';
import { withDbRetry } from '../utils/dbRetry.js';

// An ad / ig.me link opens the chat before the first message: keep its referral for that customer's next message
const pendingReferral = new Map(); // `${tenantId}:${igsid}` -> { referral, at }
const REFERRAL_TTL = 30 * 60 * 1000;

/** Is Instagram allowed for this business (plan module) and is the database ready for leads without a phone? */
export async function instagramAllowed(tenant) {
  if (!channelsReady()) return false;
  const plan = tenant.plan?.modules ? tenant.plan : tenant.plan ? await Plan.findById(tenant.plan).select('modules').lean() : null;
  return plan?.modules?.instagram !== false;
}

export async function handleInstagramPayload(body, webhookAt = new Date()) {
  if (body.object !== 'instagram') return;
  console.log(`[instagram] webhook: ${(body.entry || []).length} entr${(body.entry || []).length === 1 ? 'y' : 'ies'} for account(s) ${(body.entry || []).map((e) => e.id).join(', ')}`);
  for (const entry of body.entry || []) {
    const tenant = await Tenant.findOne({ 'instagram.igUserId': String(entry.id) });
    if (!tenant) {
      console.warn('[instagram] no business for account', entry.id);
      continue;
    }
    if (!(await instagramAllowed(tenant))) {
      console.warn(`[instagram] ${tenant.name}: Instagram is off (plan) or the channel migration has not run`);
      continue;
    }
    // DMs normally come as entry.messaging[]; some deliveries (and the App Dashboard "Test" button) use
    // entry.changes[{ field: 'messages', value: <event> }]: both are handled the same way
    const events = [...(entry.messaging || []), ...(entry.changes || []).filter((c) => ['messages', 'messaging_postbacks', 'message_reactions', 'messaging_seen', 'messaging_referral'].includes(c.field) && c.value).map((c) => c.value)];
    for (const ev of events) {
      try {
        await withDbRetry(() => processInstagramEvent(tenant, ev, String(entry.id), { webhookAt }), { label: 'instagram message' });
      } catch (err) {
        console.error('[instagram] event error', err);
      }
    }
  }
}

const adReferral = (r) =>
  r && (r.ad_id || r.ref)
    ? {
        sourceType: r.ad_id ? 'ad' : 'link',
        sourceId: r.ad_id || `ref:${r.ref}`,
        headline: r.ads_context_data?.ad_title || (r.ref ? `Link: ${r.ref}` : ''),
        sourceUrl: r.ads_context_data?.photo_url || r.ads_context_data?.video_url || '',
        mediaType: r.ads_context_data?.video_url ? 'video' : r.ads_context_data?.photo_url ? 'image' : undefined,
        imageUrl: r.ads_context_data?.photo_url,
      }
    : null;

const ATTACH_TYPE = { image: 'image', video: 'video', audio: 'audio', file: 'document' };

/** Instagram message → { type, text, media: { remoteUrl, … }, interactiveReplyId } */
export function parseInstagramMessage(m = {}, postback) {
  if (postback) return { type: 'text', text: postback.title || postback.payload || '', interactiveReplyId: postback.payload };
  const story = m.reply_to?.story;
  const prefix = story ? `↩️ Replied to your story${story.url ? ` (${story.url})` : ''}\n` : '';
  const att = (m.attachments || [])[0];
  if (att) {
    const url = att.payload?.url;
    if (ATTACH_TYPE[att.type]) return { type: ATTACH_TYPE[att.type], text: `${prefix}${m.text || ''}`.trim(), media: { remoteUrl: url, caption: m.text || '' } };
    if (att.type === 'story_mention') return { type: 'image', text: '📣 Mentioned you in their story', media: { remoteUrl: url, caption: 'Story mention' } };
    if (['share', 'ig_reel', 'reel', 'ig_post'].includes(att.type)) return { type: 'text', text: `${prefix}🔗 Shared a post${url ? `: ${url}` : ''}${m.text ? `\n${m.text}` : ''}` };
    if (att.type === 'like_heart') return { type: 'text', text: '❤️' };
    return { type: 'other', text: `${prefix}[Instagram ${att.type} message]` };
  }
  return { type: 'text', text: `${prefix}${m.text || ''}`.trim() || '[empty message]', interactiveReplyId: m.quick_reply?.payload };
}

/** Download what the customer sent now (Instagram links expire) and keep it like WhatsApp media */
async function keepAttachment(tenant, parsed) {
  if (!parsed.media?.remoteUrl) return null;
  try {
    const { buffer, mimeType } = await ig.downloadAttachment(parsed.media.remoteUrl);
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'video/mp4': 'mp4', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'application/pdf': 'pdf' }[mimeType] || 'bin';
    const fileName = `instagram-${parsed.type}-${Date.now()}.${ext}`;
    const stored = await saveFile({ tenantId: tenant._id, buffer, fileName, mimeType });
    parsed.media = { url: stored.url, mimeType, fileName, caption: parsed.media.caption };
    return { stored, size: buffer.length, fileName, mimeType };
  } catch (err) {
    console.warn('[instagram] attachment not downloaded, keeping the link:', err.message);
    parsed.media = { url: parsed.media.remoteUrl, caption: parsed.media.caption };
    return null;
  }
}

/**
 * The customer's username / name / photo. A new customer: read now (the first reply can greet them by name).
 * A known customer with an old copy: refreshed after the message is handled, so replies are not held up.
 */
async function profileFor(tenant, igsid) {
  const existing = await Contact.findOne({ tenantId: tenant._id, 'instagram.igsid': igsid }).select('instagram').lean();
  if (!existing) return { now: await ig.getProfile(tenant._id, igsid) };
  const fresh = existing.instagram?.profileAt && Date.now() - new Date(existing.instagram.profileAt).getTime() < 3 * 864e5;
  return { now: null, later: !fresh };
}

async function refreshProfile(tenant, igsid) {
  const p = await ig.getProfile(tenant._id, igsid);
  if (!p) return;
  const set = { 'instagram.profileAt': new Date() };
  for (const [k, v] of Object.entries({ username: p.username, name: p.name, profilePic: p.profilePic })) if (v) set[`instagram.${k}`] = v;
  await Contact.updateOne({ tenantId: tenant._id, 'instagram.igsid': igsid }, { $set: set });
}

export async function processInstagramEvent(tenant, ev, accountId, { profile: givenProfile, webhookAt } = {}) {
  const senderId = String(ev.sender?.id || '');
  const recipientId = String(ev.recipient?.id || '');
  const at = ev.timestamp ? new Date(Number(ev.timestamp)) : new Date();

  // The business wrote from the Instagram app itself (echo): show it in the chat too
  if (ev.message?.is_echo) return recordEcho(tenant, recipientId, ev.message, at);
  const igsid = senderId;
  if (!igsid || igsid === accountId) return null;
  const key = `${tenant._id}:${igsid}`;

  if (ev.reaction) return processInstagramReaction(tenant, ev.reaction);
  if (ev.read?.mid) return processInstagramSeen(tenant._id, [ev.read.mid]);
  if (ev.message?.is_deleted) return processInstagramUnsend(tenant, ev.message.mid);
  if (ev.referral && !ev.message) {
    const r = adReferral(ev.referral);
    if (r) pendingReferral.set(key, { referral: r, at: Date.now() });
    return null;
  }
  if (!ev.message && !ev.postback) return null;

  const parsed = parseInstagramMessage(ev.message, ev.postback);
  const waiting = pendingReferral.get(key);
  if (waiting) pendingReferral.delete(key);
  const referral = adReferral(ev.message?.referral || ev.postback?.referral) || (waiting && Date.now() - waiting.at < REFERRAL_TTL ? waiting.referral : null);

  const kept = await keepAttachment(tenant, parsed);
  const lookup = givenProfile !== undefined ? { now: givenProfile } : await profileFor(tenant, igsid);
  const profile = lookup.now;
  const message = await ingestInbound(tenant, {
    channel: 'instagram',
    externalId: ev.message?.mid || (ev.postback ? `postback.${igsid}.${ev.timestamp}` : undefined),
    igsid,
    profileName: profile?.name || '',
    instagram: profile ? { username: profile.username, name: profile.name, profilePic: profile.profilePic } : undefined,
    parsed,
    replyToExternalId: ev.message?.reply_to?.mid,
    referral,
    timestamp: at,
    webhookAt,
  });
  if (lookup.later) refreshProfile(tenant, igsid).catch((err) => console.warn('[instagram] profile refresh', err.message));
  if (message && kept?.stored?.waiting) {
    await keepForRetry({ tenantId: tenant._id, messageId: message._id, contactId: message.contactId, url: kept.stored.url, fileName: kept.fileName, mimeType: kept.mimeType, size: kept.size, direction: 'received', error: kept.stored.error });
  }
  return message;
}

async function recordEcho(tenant, igsid, m, at) {
  if (!igsid || !m.mid || (await Message.exists({ tenantId: tenant._id, igMessageId: m.mid }))) return null; // sent from the CRM: already saved
  const contact = await Contact.findOne({ tenantId: tenant._id, 'instagram.igsid': igsid });
  if (!contact) return null;
  const conversation = await getOrCreateConversation(tenant._id, contact._id, 'instagram');
  const parsed = parseInstagramMessage(m);
  if (parsed.media?.remoteUrl) parsed.media = { url: parsed.media.remoteUrl, caption: parsed.media.caption };
  const message = await Message.create({
    tenantId: tenant._id, conversationId: conversation._id, contactId: contact._id, direction: 'outbound',
    type: parsed.type, text: parsed.text ? `${parsed.text}` : '', media: parsed.media, status: 'sent', igMessageId: m.mid,
    error: undefined,
  });
  await Conversation.updateOne({ _id: conversation._id }, { $set: { lastMessageAt: at, lastMessagePreview: `📱 ${previewOf(message)}` } });
  await message.populate(MESSAGE_POPULATE);
  await emitMessage(conversation._id, message);
  return message;
}

async function processInstagramReaction(tenant, r) {
  if (!r?.mid) return null;
  const target = await Message.findOne({ tenantId: tenant._id, igMessageId: r.mid });
  if (!target) return null;
  target.customerReaction = r.action === 'unreact' ? undefined : { emoji: r.emoji || '❤️', at: new Date() };
  await target.save();
  await emitMessageUpdate(target);
  return target;
}

/** Customer saw our messages: Instagram names the last one seen, everything we sent before it is read too */
export async function processInstagramSeen(tenantId, mids) {
  for (const mid of mids) {
    const last = await Message.findOne({ tenantId, igMessageId: mid }).select('conversationId createdAt');
    if (!last) continue;
    const res = await Message.updateMany(
      { conversationId: last.conversationId, direction: 'outbound', status: { $in: ['queued', 'sent', 'delivered'] }, createdAt: { $lte: last.createdAt } },
      { $set: { status: 'read' } }
    );
    if (!res.modifiedCount) continue;
    const conversation = await Conversation.findById(last.conversationId);
    const read = await Message.find({ conversationId: last.conversationId, direction: 'outbound', status: 'read', createdAt: { $lte: last.createdAt } }).sort({ createdAt: -1 }).limit(res.modifiedCount).select('_id');
    for (const m of read) emitConversationEvent(conversation, 'message:status', { messageId: m._id, conversationId: last.conversationId, status: 'read' });
  }
  return null;
}

async function processInstagramUnsend(tenant, mid) {
  const target = await Message.findOne({ tenantId: tenant._id, igMessageId: mid, direction: 'inbound' });
  if (!target) return null;
  target.text = '🚫 The customer unsent this message';
  target.media = undefined;
  target.type = 'text';
  await target.save();
  await emitMessageUpdate(target);
  return target;
}
