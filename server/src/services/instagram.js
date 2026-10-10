/**
 * Instagram DM wrapper (Instagram API with Instagram Login, graph.instagram.com).
 * Same idea as whatsapp.js: each business is either
 *  - "live": real calls with the business's own long-lived Instagram token
 *  - "mock": sandbox that fakes Instagram's answers, so the CRM works before the account is connected.
 * The recipient is always the customer's Instagram-scoped id (IGSID), never a phone number.
 */
import crypto from 'node:crypto';
import axios from 'axios';
import { env } from '../config/env.js';
import { Tenant } from '../models/index.js';
import { decrypt } from '../utils/crypto.js';
import { HttpError } from '../utils/http.js';

const graphUrl = (path) => `https://graph.instagram.com/${env.instagram.graphVersion}/${path}`;

// Instagram's own limits (Send API)
export const IG_TEXT_LIMIT = 1000; // bytes of UTF-8
export const IG_QUICK_REPLIES = 13;
export const IG_QUICK_REPLY_TITLE = 20;
export const IG_MEDIA = {
  image: { types: ['image/jpeg', 'image/png', 'image/gif'], max: 8 * 1024 * 1024 },
  video: { types: ['video/mp4', 'video/quicktime', 'video/webm', 'video/ogg', 'video/x-msvideo'], max: 25 * 1024 * 1024 },
  audio: { types: ['audio/aac', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/x-wav', 'audio/mpeg'], max: 25 * 1024 * 1024 },
  document: { types: ['application/pdf'], max: 25 * 1024 * 1024 },
};

export async function loadInstagramCredentials(tenantId) {
  const tenant = await Tenant.findById(tenantId).select('+instagram.accessTokenEnc');
  if (!tenant) throw new HttpError(404, 'Business not found');
  const ig = tenant.instagram || {};
  return { mode: ig.mode || 'mock', igUserId: ig.igUserId, accessToken: ig.accessTokenEnc ? decrypt(ig.accessTokenEnc) : '' };
}

function toHttpError(err) {
  const meta = err.response?.data?.error;
  const message = meta?.error_user_msg || meta?.message || err.message;
  // 190 = token expired / revoked: the admin has to connect Instagram again
  const expired = meta?.code === 190;
  return new HttpError(expired ? 401 : 502, expired ? 'Instagram connection expired. Ask the admin to connect Instagram again in Settings.' : `Instagram API error: ${message}`, meta);
}

async function graph(creds, method, path, { data, params } = {}) {
  try {
    const res = await axios({ method, url: graphUrl(path), data, params, headers: { Authorization: `Bearer ${creds.accessToken}` }, timeout: 20000 });
    return res.data;
  } catch (err) {
    throw toHttpError(err);
  }
}

// ---------- Mock ----------
const mockId = () => `mid.MOCK.${crypto.randomBytes(12).toString('hex')}`;

// Instagram only tells us "seen" (no delivered): pretend the customer read it a moment later
function simulateSeen(tenantId, mid) {
  setTimeout(async () => {
    const { processInstagramSeen } = await import('./instagramInbound.js');
    processInstagramSeen(tenantId, [mid]).catch((e) => console.error('[mock-ig] seen error', e.message));
  }, 3000);
}

// ---------- Sending ----------
async function send(tenantId, igsid, message) {
  if (!igsid) throw new HttpError(400, 'This lead has no Instagram chat');
  const creds = await loadInstagramCredentials(tenantId);
  if (creds.mode === 'mock') {
    const id = mockId();
    simulateSeen(tenantId, id);
    return { id };
  }
  const data = await graph(creds, 'post', `${creds.igUserId || 'me'}/messages`, { data: { recipient: { id: igsid }, message } });
  return { id: data.message_id };
}

const clip = (text, max) => (Buffer.byteLength(text, 'utf8') <= max ? text : `${Buffer.from(text, 'utf8').subarray(0, max - 3).toString('utf8').replace(/�+$/, '')}...`);

export function sendText(tenantId, igsid, text) {
  return send(tenantId, igsid, { text: clip(String(text || ''), IG_TEXT_LIMIT) });
}

/**
 * Chatbot menu. Instagram has no WhatsApp-style list: every option becomes a quick-reply chip
 * (max 13, 20 characters). A list's descriptions go into the text so nothing is lost.
 */
export function sendInteractive(tenantId, igsid, { kind, body, options = [] }) {
  const shown = options.slice(0, IG_QUICK_REPLIES);
  const details = kind === 'list' ? shown.filter((o) => o.description).map((o) => `• ${o.title}: ${o.description}`).join('\n') : '';
  const text = [body, details].filter(Boolean).join('\n\n');
  return send(tenantId, igsid, {
    text: clip(text, IG_TEXT_LIMIT),
    quick_replies: shown.map((o) => ({ content_type: 'text', title: o.title.slice(0, IG_QUICK_REPLY_TITLE), payload: o.id })),
  });
}

/**
 * Photo / video / audio / PDF by a public https link (Instagram downloads it). A caption is sent as a
 * separate text after the file (Instagram attachments have no caption).
 */
export async function sendMedia(tenantId, igsid, { type, url, caption }) {
  const link = /^https?:\/\//.test(url || '') ? url : env.publicUrl && url ? `${env.publicUrl}${url}` : '';
  if (!link || /^http:\/\/(localhost|127\.)/.test(link)) {
    const creds = await loadInstagramCredentials(tenantId);
    if (creds.mode !== 'mock') throw new HttpError(400, 'Instagram needs a public link to the file: turn on Cloudinary (STORAGE_DRIVER=cloudinary) or set PUBLIC_URL in .env.');
  }
  const attachmentType = type === 'document' ? 'file' : type;
  const result = await send(tenantId, igsid, { attachment: { type: attachmentType, payload: { url: link || url } } });
  if (caption?.trim()) await sendText(tenantId, igsid, caption.trim()).catch(() => {});
  return result;
}

/** "typing…" in the customer's Instagram while the chatbot answers. Never throws. */
export async function sendTypingIndicator(tenantId, igsid) {
  try {
    const creds = await loadInstagramCredentials(tenantId);
    if (creds.mode === 'mock' || !igsid) return false;
    await graph(creds, 'post', `${creds.igUserId || 'me'}/messages`, { data: { recipient: { id: igsid }, sender_action: 'typing_on' } });
    return true;
  } catch (err) {
    console.warn('[instagram] typing not sent:', err.message);
    return false;
  }
}

/** Mark the customer's messages seen when an agent opens the chat. Never throws. */
export async function markSeen(tenantId, igsid) {
  try {
    const creds = await loadInstagramCredentials(tenantId);
    if (creds.mode === 'mock' || !igsid) return false;
    await graph(creds, 'post', `${creds.igUserId || 'me'}/messages`, { data: { recipient: { id: igsid }, sender_action: 'mark_seen' } });
    return true;
  } catch {
    return false;
  }
}

/**
 * The customer's public profile (allowed once they have messaged us). name / profile_pic may be empty;
 * the picture link expires after a few days. Returns null if Instagram does not answer.
 */
export async function getProfile(tenantId, igsid) {
  const creds = await loadInstagramCredentials(tenantId);
  if (creds.mode === 'mock') return null;
  try {
    const p = await graph(creds, 'get', igsid, { params: { fields: 'name,username,profile_pic' } });
    return { name: p.name || '', username: p.username || '', profilePic: p.profile_pic || '' };
  } catch (err) {
    console.warn('[instagram] profile not read:', err.message);
    return null;
  }
}

/** Download a file the customer sent (Instagram gives a temporary CDN link) */
export async function downloadAttachment(url) {
  const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000, maxContentLength: 30 * 1024 * 1024 });
  return { buffer: Buffer.from(res.data), mimeType: String(res.headers['content-type'] || '').split(';')[0] };
}

// ---------- Posting (content publishing) ----------
// Instagram needs public links; photos must be JPEG (Cloudinary photos are turned into JPEG through the link)
export const IG_CAPTION_LIMIT = 2200;
export const IG_CAROUSEL_MAX = 10;
export const toJpegUrl = (url = '') =>
  /res\.cloudinary\.com\/.+\/image\/upload\//.test(url) && !/\.jpe?g($|\?)/i.test(url) ? url.replace('/image/upload/', '/image/upload/f_jpg/').replace(/\.(png|gif|webp|heic|bmp)($|\?)/i, '.jpg$2') : url;
const publicLink = (url) => (/^https?:\/\//.test(url || '') ? url : env.publicUrl && url ? `${env.publicUrl}${url}` : url);

/**
 * Step 1: create the media container(s). media = [{ url, type: 'image'|'video' }].
 * 1 photo → image container; 1 video → Reel; 2–10 items → carousel. Returns { containerId }.
 */
export async function createPostContainer(tenantId, { text = '', media = [] }) {
  const creds = await loadInstagramCredentials(tenantId);
  if (creds.mode === 'mock') return { containerId: `MOCKCONTAINER${crypto.randomBytes(6).toString('hex')}` };
  if (!media.length) throw new HttpError(400, 'Instagram posts need a photo or a video');
  const me = creds.igUserId || 'me';
  const item = (m, extra = {}) => (m.type === 'video' ? { media_type: extra.is_carousel_item ? 'VIDEO' : 'REELS', video_url: publicLink(m.url) } : { image_url: toJpegUrl(publicLink(m.url)) });
  if (media.length === 1) {
    const r = await graph(creds, 'post', `${me}/media`, { data: { ...item(media[0]), caption: text } });
    return { containerId: r.id };
  }
  const children = [];
  for (const m of media.slice(0, IG_CAROUSEL_MAX)) children.push((await graph(creds, 'post', `${me}/media`, { data: { ...item(m, { is_carousel_item: true }), is_carousel_item: true } })).id);
  const r = await graph(creds, 'post', `${me}/media`, { data: { media_type: 'CAROUSEL', children: children.join(','), caption: text } });
  return { containerId: r.id };
}

/** Step 2: FINISHED / IN_PROGRESS / ERROR / EXPIRED for a container */
export async function containerStatus(tenantId, containerId) {
  const creds = await loadInstagramCredentials(tenantId);
  if (creds.mode === 'mock') return { status: 'FINISHED' };
  const r = await graph(creds, 'get', containerId, { params: { fields: 'status_code,status' } });
  return { status: r.status_code, detail: r.status };
}

/** Step 3: publish a FINISHED container. Returns { id, permalink } */
export async function publishContainer(tenantId, containerId) {
  const creds = await loadInstagramCredentials(tenantId);
  if (creds.mode === 'mock') return { id: `MOCKMEDIA${crypto.randomBytes(6).toString('hex')}`, permalink: '' };
  const me = creds.igUserId || 'me';
  const { id } = await graph(creds, 'post', `${me}/media_publish`, { data: { creation_id: containerId } });
  let permalink = '';
  try {
    permalink = (await graph(creds, 'get', id, { params: { fields: 'permalink' } })).permalink || '';
  } catch {
    // posted even if the link can not be read
  }
  return { id, permalink };
}

// ---------- Comments ----------
export async function listMediaComments(tenantId, mediaId) {
  const creds = await loadInstagramCredentials(tenantId);
  if (creds.mode === 'mock') return [];
  const r = await graph(creds, 'get', `${mediaId}/comments`, { params: { fields: 'id,text,username,timestamp,from,hidden,replies{id,text,username,timestamp,from,hidden}', limit: 100 } });
  const out = [];
  const add = (c, parent) => out.push({ externalId: c.id, parentExternalId: parent, from: { id: c.from?.id, username: c.username || c.from?.username }, text: c.text || '', at: new Date(c.timestamp), hidden: !!c.hidden });
  for (const c of r.data || []) {
    add(c);
    for (const rep of c.replies?.data || []) add(rep, c.id);
  }
  return out;
}

export async function replyToMediaComment(tenantId, commentId, text) {
  const creds = await loadInstagramCredentials(tenantId);
  if (creds.mode === 'mock') return { id: `MOCKREPLY${crypto.randomBytes(6).toString('hex')}` };
  return graph(creds, 'post', `${commentId}/replies`, { data: { message: text } });
}

export async function hideMediaComment(tenantId, commentId, hidden) {
  const creds = await loadInstagramCredentials(tenantId);
  if (creds.mode === 'mock') return true;
  await graph(creds, 'post', commentId, { data: { hide: hidden } });
  return true;
}

export async function deleteMediaComment(tenantId, commentId) {
  const creds = await loadInstagramCredentials(tenantId);
  if (creds.mode === 'mock') return true;
  await graph(creds, 'delete', commentId);
  return true;
}

/** One private DM to the person who wrote the comment (within 7 days of the comment) */
export async function privateReplyToComment(tenantId, commentId, text) {
  const creds = await loadInstagramCredentials(tenantId);
  if (creds.mode === 'mock') return { message_id: `mid.MOCK.${crypto.randomBytes(6).toString('hex')}` };
  return graph(creds, 'post', `${creds.igUserId || 'me'}/messages`, { data: { recipient: { comment_id: commentId }, message: { text } } });
}
