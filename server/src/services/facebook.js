/**
 * Facebook Page wrapper (Graph API, Page access token): publish posts, read / reply / hide / delete comments,
 * private replies. "mock" = sandbox that fakes Meta's answers until a Page is connected.
 */
import crypto from 'node:crypto';
import axios from 'axios';
import { env } from '../config/env.js';
import { Tenant } from '../models/index.js';
import { decrypt } from '../utils/crypto.js';
import { HttpError } from '../utils/http.js';

const graphUrl = (path, host = 'graph.facebook.com') => `https://${host}/${env.facebook.graphVersion}/${path}`;
export const FB_PHOTO_MAX = 10 * 1024 * 1024;

export async function loadFacebookCredentials(tenantId) {
  const tenant = await Tenant.findById(tenantId).select('+facebook.pageTokenEnc');
  if (!tenant) throw new HttpError(404, 'Business not found');
  const fb = tenant.facebook || {};
  return { mode: fb.mode || 'mock', pageId: fb.pageId, token: fb.pageTokenEnc ? decrypt(fb.pageTokenEnc) : '' };
}

function toHttpError(err) {
  const meta = err.response?.data?.error;
  const message = meta?.error_user_msg || meta?.message || err.message;
  const expired = meta?.code === 190;
  return new HttpError(expired ? 401 : 502, expired ? 'Facebook connection expired. Ask the admin to connect the Facebook Page again in Settings.' : `Facebook API error: ${message}`, meta);
}

async function graph(creds, method, path, { data, params, host } = {}) {
  try {
    const res = await axios({ method, url: graphUrl(path, host), data, params: { ...params, access_token: creds.token }, timeout: 60000 });
    return res.data;
  } catch (err) {
    throw toHttpError(err);
  }
}

const mockId = (prefix) => `${prefix}_MOCK_${crypto.randomBytes(8).toString('hex')}`;

/**
 * Publish to the Page. media: [{ url, type: 'image'|'video' }] (public links).
 * text only / link → /feed; 1 photo → /photos; several photos → unpublished photos + /feed; 1 video → /videos.
 * Returns { id, permalink }.
 */
export async function publishPost(tenantId, { text = '', link = '', media = [] }) {
  const creds = await loadFacebookCredentials(tenantId);
  if (creds.mode === 'mock') return { id: mockId(`${creds.pageId || 'PAGE'}`), permalink: '' };
  const page = creds.pageId;
  let id;
  // Facebook downloads the files itself: they need full public links (Cloudinary, or PUBLIC_URL + /uploads/…)
  const links = media.map((m) => ({ ...m, url: /^https?:\/\//.test(m.url || '') ? m.url : env.publicUrl && m.url ? `${env.publicUrl}${m.url}` : '' }));
  if (links.some((m) => !m.url)) throw new HttpError(400, 'Facebook needs a public link to the file: turn on Cloudinary (STORAGE_DRIVER=cloudinary) or set PUBLIC_URL in .env.');
  const video = links.find((m) => m.type === 'video');
  const photos = links.filter((m) => m.type === 'image');
  if (video) {
    const r = await graph(creds, 'post', `${page}/videos`, { host: 'graph-video.facebook.com', data: { file_url: video.url, description: text } });
    id = r.id;
  } else if (photos.length === 1) {
    const r = await graph(creds, 'post', `${page}/photos`, { data: { url: photos[0].url, caption: text } });
    id = r.post_id || r.id;
  } else if (photos.length > 1) {
    const ids = [];
    for (const p of photos) ids.push((await graph(creds, 'post', `${page}/photos`, { data: { url: p.url, published: false, temporary: true } })).id);
    const data = { message: text };
    ids.forEach((fbid, i) => { data[`attached_media[${i}]`] = JSON.stringify({ media_fbid: fbid }); });
    id = (await graph(creds, 'post', `${page}/feed`, { data })).id;
  } else {
    id = (await graph(creds, 'post', `${page}/feed`, { data: { message: text, ...(link && { link }) } })).id;
  }
  let permalink = '';
  try {
    permalink = (await graph(creds, 'get', id, { params: { fields: 'permalink_url' } })).permalink_url || '';
  } catch {
    // the post is up even if its link can not be read
  }
  return { id, permalink };
}

export async function deletePost(tenantId, postId) {
  const creds = await loadFacebookCredentials(tenantId);
  if (creds.mode === 'mock') return true;
  await graph(creds, 'delete', postId);
  return true;
}

/** All comments on a post (newest last), including replies */
export async function listComments(tenantId, postId) {
  const creds = await loadFacebookCredentials(tenantId);
  if (creds.mode === 'mock') return [];
  const out = [];
  let after;
  for (let page = 0; page < 5; page += 1) {
    const r = await graph(creds, 'get', `${postId}/comments`, {
      params: { filter: 'stream', order: 'chronological', limit: 100, fields: 'id,from{id,name},message,created_time,parent{id},is_hidden', ...(after && { after }) },
    });
    for (const c of r.data || []) out.push({ externalId: c.id, parentExternalId: c.parent?.id, from: { id: c.from?.id, name: c.from?.name }, text: c.message || '', at: new Date(c.created_time), hidden: !!c.is_hidden });
    after = r.paging?.cursors?.after;
    if (!r.paging?.next) break;
  }
  return out;
}

export async function replyToComment(tenantId, commentId, text) {
  const creds = await loadFacebookCredentials(tenantId);
  if (creds.mode === 'mock') return { id: mockId('COMMENT') };
  return graph(creds, 'post', `${commentId}/comments`, { data: { message: text } });
}

export async function hideComment(tenantId, commentId, hidden) {
  const creds = await loadFacebookCredentials(tenantId);
  if (creds.mode === 'mock') return true;
  await graph(creds, 'post', commentId, { data: { is_hidden: hidden } });
  return true;
}

export async function deleteComment(tenantId, commentId) {
  const creds = await loadFacebookCredentials(tenantId);
  if (creds.mode === 'mock') return true;
  await graph(creds, 'delete', commentId);
  return true;
}

/** One private Messenger message to the person who wrote the comment (within 7 days of the comment) */
export async function privateReply(tenantId, commentId, text) {
  const creds = await loadFacebookCredentials(tenantId);
  if (creds.mode === 'mock') return { message_id: mockId('MSG') };
  return graph(creds, 'post', `${creds.pageId}/messages`, { data: { recipient: { comment_id: commentId }, message: { text } } });
}
