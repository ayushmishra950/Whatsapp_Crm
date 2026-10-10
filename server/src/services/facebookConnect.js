/**
 * Connecting a business's Facebook Page (Facebook Login for Business):
 * login dialog (config_id) → code → user token → long-lived user token → the Pages the admin manages
 * (each with its own Page token, which does not expire) → the admin picks one → webhook "feed" subscription.
 */
import axios from 'axios';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { Tenant } from '../models/index.js';
import { decrypt, encrypt } from '../utils/crypto.js';
import { HttpError } from '../utils/http.js';

// Used only when no Login for Business configuration is set (classic Facebook Login)
export const FB_SCOPES = ['pages_show_list', 'pages_manage_posts', 'pages_read_engagement', 'pages_read_user_content', 'pages_manage_engagement', 'pages_manage_metadata', 'pages_messaging'];
const v = () => env.facebook.graphVersion;
const graph = (path) => `https://graph.facebook.com/${v()}/${path}`;
const metaError = (err) => err.response?.data?.error?.message || err.message;
const PENDING_MINUTES = 30;

export const facebookReady = () => !!(env.facebook.appId && env.facebook.appSecret && env.facebook.redirectUrl);

export function facebookConnectUrl({ tenantId, userId }) {
  if (!facebookReady()) throw new HttpError(400, 'Facebook is not set up on this server yet (FB_APP_ID / FB_REDIRECT_URL in .env).');
  const state = jwt.sign({ t: String(tenantId), u: String(userId), p: 'fb-connect' }, env.jwtSecret, { expiresIn: '15m' });
  const q = new URLSearchParams({
    client_id: env.facebook.appId,
    redirect_uri: env.facebook.redirectUrl,
    response_type: 'code',
    state,
    ...(env.facebook.loginConfigId ? { config_id: env.facebook.loginConfigId } : { scope: FB_SCOPES.join(',') }),
  });
  return `https://www.facebook.com/${v()}/dialog/oauth?${q}`;
}

export function readFacebookState(state) {
  try {
    const s = jwt.verify(String(state || ''), env.jwtSecret);
    if (s.p !== 'fb-connect') throw new Error('wrong purpose');
    return { tenantId: s.t, userId: s.u };
  } catch {
    throw new HttpError(400, 'The Facebook login link expired. Open Settings → Facebook and connect again.');
  }
}

/** code → the Pages this person manages. One Page: connected at once. Several: kept for 30 minutes to choose from. */
export async function completeFacebookConnect({ tenantId, code }) {
  if (!code) throw new HttpError(400, 'Facebook did not send a login code.');
  let userToken;
  try {
    const short = (await axios.get(graph('oauth/access_token'), { params: { client_id: env.facebook.appId, client_secret: env.facebook.appSecret, redirect_uri: env.facebook.redirectUrl, code }, timeout: 20000 })).data;
    const long = (await axios.get(graph('oauth/access_token'), { params: { grant_type: 'fb_exchange_token', client_id: env.facebook.appId, client_secret: env.facebook.appSecret, fb_exchange_token: short.access_token }, timeout: 20000 })).data;
    userToken = long.access_token;
  } catch (err) {
    throw new HttpError(502, `Facebook login failed: ${metaError(err)}`);
  }
  let pages;
  try {
    pages = (await axios.get(graph('me/accounts'), { params: { fields: 'id,name,access_token,picture{url},tasks', limit: 100, access_token: userToken }, timeout: 20000 })).data.data || [];
  } catch (err) {
    throw new HttpError(502, `Could not read your Facebook Pages: ${metaError(err)}`);
  }
  if (!pages.length) throw new HttpError(400, 'No Facebook Page was shared. Connect again and tick the Page you want to use.');
  const list = pages.map((p) => ({ id: p.id, name: p.name, picture: p.picture?.data?.url || '', token: p.access_token, tasks: p.tasks || [] }));
  if (list.length === 1) {
    const page = await choosePage(tenantId, list[0]);
    return { connected: true, pageName: page.name };
  }
  await Tenant.updateOne({ _id: tenantId }, { $set: { 'facebook.pendingPagesEnc': encrypt(JSON.stringify(list)), 'facebook.pendingAt': new Date() } });
  return { connected: false, choose: list.length };
}

/** Pages waiting to be chosen (names only, never tokens) */
export async function pendingPages(tenantId) {
  const t = await Tenant.findById(tenantId).select('+facebook.pendingPagesEnc facebook.pendingAt');
  if (!t?.facebook?.pendingPagesEnc || Date.now() - new Date(t.facebook.pendingAt).getTime() > PENDING_MINUTES * 60000) return [];
  return JSON.parse(decrypt(t.facebook.pendingPagesEnc)).map(({ id, name, picture }) => ({ id, name, picture }));
}

export async function chooseFromPending(tenantId, pageId) {
  const t = await Tenant.findById(tenantId).select('+facebook.pendingPagesEnc facebook.pendingAt');
  if (!t?.facebook?.pendingPagesEnc || Date.now() - new Date(t.facebook.pendingAt).getTime() > PENDING_MINUTES * 60000) {
    throw new HttpError(400, 'The list of Pages expired. Connect Facebook again.');
  }
  const page = JSON.parse(decrypt(t.facebook.pendingPagesEnc)).find((p) => p.id === String(pageId));
  if (!page) throw new HttpError(400, 'That Page was not in the list. Connect Facebook again.');
  return choosePage(tenantId, page);
}

async function choosePage(tenantId, page) {
  const taken = await Tenant.findOne({ 'facebook.pageId': page.id, _id: { $ne: tenantId } }).select('name');
  if (taken) throw new HttpError(409, `The Page “${page.name}” is already connected to another business on this CRM.`);
  // Ask Facebook to send this Page's comments (feed) to our webhook
  try {
    await axios.post(graph(`${page.id}/subscribed_apps`), null, { params: { subscribed_fields: 'feed', access_token: page.token }, timeout: 20000 });
  } catch (err) {
    throw new HttpError(502, `Facebook webhook subscription failed: ${metaError(err)}`);
  }
  await Tenant.updateOne(
    { _id: tenantId },
    {
      $set: { 'facebook.mode': 'live', 'facebook.pageId': page.id, 'facebook.pageName': page.name, 'facebook.pagePicture': page.picture || '', 'facebook.pageTokenEnc': encrypt(page.token), 'facebook.connectedAt': new Date() },
      $unset: { 'facebook.pendingPagesEnc': 1, 'facebook.pendingAt': 1, 'facebook.tokenError': 1 },
    }
  );
  return page;
}

export async function disconnectFacebook(tenantId) {
  await Tenant.updateOne(
    { _id: tenantId },
    { $set: { 'facebook.mode': 'mock' }, $unset: { 'facebook.pageId': 1, 'facebook.pageName': 1, 'facebook.pagePicture': 1, 'facebook.pageTokenEnc': 1, 'facebook.pendingPagesEnc': 1, 'facebook.pendingAt': 1, 'facebook.tokenError': 1, 'facebook.connectedAt': 1 } }
  );
}
