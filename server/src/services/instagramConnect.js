/**
 * Connecting a business's Instagram professional account (Business Login for Instagram):
 * authorize URL → code → short-lived token → long-lived token (~60 days) → profile → webhook subscription.
 * The long-lived token is refreshed by a worker before it expires (a token that has expired can not be refreshed).
 */
import axios from 'axios';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { Tenant, Notification } from '../models/index.js';
import { encrypt, decrypt } from '../utils/crypto.js';
import { HttpError } from '../utils/http.js';
import { notify } from './alerts.js';

// DMs + posting + comments. A business connected before posting existed must connect again to add the last two.
export const IG_SCOPES = ['instagram_business_basic', 'instagram_business_manage_messages', 'instagram_business_content_publish', 'instagram_business_manage_comments'];
export const IG_WEBHOOK_FIELDS = ['messages', 'messaging_postbacks', 'messaging_seen', 'message_reactions', 'messaging_referral', 'comments'];
const grantedScopes = (p) => (Array.isArray(p) ? p : String(p || IG_SCOPES.join(',')).split(',')).map((x) => String(x).trim()).filter(Boolean);
const graph = (path) => `https://graph.instagram.com/${env.instagram.graphVersion}/${path}`;
const metaError = (err) => err.response?.data?.error_message || err.response?.data?.error?.message || err.message;

/**
 * Instagram's login page for this business (state = signed tenant + user, 15 minutes).
 * Normally Instagram shows the account already logged in on that browser ("Allow"), or its login form.
 * switchAccount = always ask to log in, for when another (e.g. personal) account is logged in there.
 */
export function connectUrl({ tenantId, userId, switchAccount = false }) {
  if (!env.instagram.appId || !env.instagram.redirectUrl) throw new HttpError(400, 'Instagram is not set up on this server yet (IG_APP_ID / IG_REDIRECT_URL in .env).');
  const state = jwt.sign({ t: String(tenantId), u: String(userId), p: 'ig-connect' }, env.jwtSecret, { expiresIn: '15m' });
  const q = new URLSearchParams({ client_id: env.instagram.appId, redirect_uri: env.instagram.redirectUrl, response_type: 'code', scope: IG_SCOPES.join(','), state, ...(switchAccount && { force_reauth: 'true' }) });
  return `https://www.instagram.com/oauth/authorize?${q}`;
}

export function readState(state) {
  try {
    const s = jwt.verify(String(state || ''), env.jwtSecret);
    if (s.p !== 'ig-connect') throw new Error('wrong purpose');
    return { tenantId: s.t, userId: s.u };
  } catch {
    throw new HttpError(400, 'The Instagram login link expired. Open Settings → Instagram and connect again.');
  }
}

/** code from Instagram → everything saved on the business. Returns the connected username. */
export async function completeConnect({ tenantId, code }) {
  const cleanCode = String(code || '').replace(/#_$/, '');
  if (!cleanCode) throw new HttpError(400, 'Instagram did not send a login code.');
  let short;
  try {
    const form = new URLSearchParams({ client_id: env.instagram.appId, client_secret: env.instagram.appSecret, grant_type: 'authorization_code', redirect_uri: env.instagram.redirectUrl, code: cleanCode });
    short = (await axios.post('https://api.instagram.com/oauth/access_token', form, { timeout: 20000 })).data;
  } catch (err) {
    throw new HttpError(502, `Instagram login failed: ${metaError(err)}`);
  }
  let long;
  try {
    long = (await axios.get('https://graph.instagram.com/access_token', { params: { grant_type: 'ig_exchange_token', client_secret: env.instagram.appSecret, access_token: short.access_token }, timeout: 20000 })).data;
  } catch (err) {
    throw new HttpError(502, `Instagram token exchange failed: ${metaError(err)}`);
  }
  const token = long.access_token;
  const auth = { headers: { Authorization: `Bearer ${token}` }, timeout: 20000 };
  const me = (await axios.get(graph('me'), { params: { fields: 'user_id,username,name,profile_picture_url' }, ...auth }).catch((err) => {
    throw new HttpError(502, `Could not read the Instagram account: ${metaError(err)}`);
  })).data;
  const igUserId = String(me.user_id || short.user_id || me.id);
  const taken = await Tenant.findOne({ 'instagram.igUserId': igUserId, _id: { $ne: tenantId } }).select('name');
  if (taken) throw new HttpError(409, `@${me.username} is already connected to another business on this CRM.`);
  // Ask Instagram to send this account's DMs to our webhook
  await axios.post(graph('me/subscribed_apps'), null, { params: { subscribed_fields: IG_WEBHOOK_FIELDS.join(',') }, ...auth }).catch((err) => {
    throw new HttpError(502, `Instagram webhook subscription failed: ${metaError(err)}`);
  });
  await Tenant.updateOne(
    { _id: tenantId },
    {
      $set: {
        'instagram.mode': 'live',
        'instagram.igUserId': igUserId,
        'instagram.username': me.username || '',
        'instagram.name': me.name || '',
        'instagram.profilePic': me.profile_picture_url || '',
        'instagram.accessTokenEnc': encrypt(token),
        'instagram.tokenExpiresAt': new Date(Date.now() + (Number(long.expires_in) || 60 * 86400) * 1000),
        'instagram.tokenRefreshedAt': new Date(),
        'instagram.connectedAt': new Date(),
        // What the business allowed (Instagram may send it as a list or a comma-separated text)
        'instagram.scopes': grantedScopes(short.permissions),
      },
      $unset: { 'instagram.tokenError': 1 },
    }
  );
  return { username: me.username, igUserId };
}

export async function disconnectInstagram(tenantId) {
  await Tenant.updateOne(
    { _id: tenantId },
    { $set: { 'instagram.mode': 'mock' }, $unset: { 'instagram.igUserId': 1, 'instagram.accessTokenEnc': 1, 'instagram.tokenExpiresAt': 1, 'instagram.tokenRefreshedAt': 1, 'instagram.tokenError': 1, 'instagram.connectedAt': 1, 'instagram.scopes': 1 } }
  );
}

/** Alert the business's admins once a day about an Instagram connection problem */
async function alertAdmins(tenant, title, body) {
  const key = 'instagram:token';
  if (await Notification.exists({ tenantId: tenant._id, key, createdAt: { $gte: new Date(Date.now() - 24 * 3600 * 1000) } })) return;
  await notify(tenant._id, { to: 'admins', kind: 'alert', title, body, key, url: '/settings' });
}

/** One worker run: refresh tokens that expire within 10 days (each at most once a day) */
export async function refreshInstagramTokens(now = new Date()) {
  const due = await Tenant.find({
    'instagram.mode': 'live',
    'instagram.tokenExpiresAt': { $lte: new Date(now.getTime() + 10 * 86400 * 1000) },
    $or: [{ 'instagram.tokenRefreshedAt': { $lte: new Date(now.getTime() - 86400 * 1000) } }, { 'instagram.tokenRefreshedAt': null }],
  }).select('+instagram.accessTokenEnc');
  let refreshed = 0;
  for (const t of due) {
    try {
      if (t.instagram.tokenExpiresAt <= now) throw new Error('the connection expired');
      const { data } = await axios.get('https://graph.instagram.com/refresh_access_token', { params: { grant_type: 'ig_refresh_token', access_token: decrypt(t.instagram.accessTokenEnc) }, timeout: 20000 });
      await Tenant.updateOne(
        { _id: t._id },
        { $set: { 'instagram.accessTokenEnc': encrypt(data.access_token), 'instagram.tokenExpiresAt': new Date(now.getTime() + (Number(data.expires_in) || 60 * 86400) * 1000), 'instagram.tokenRefreshedAt': now }, $unset: { 'instagram.tokenError': 1 } }
      );
      refreshed += 1;
    } catch (err) {
      const reason = metaError(err);
      await Tenant.updateOne({ _id: t._id }, { $set: { 'instagram.tokenError': `Instagram connection could not be renewed (${reason}). Connect Instagram again in Settings.`, 'instagram.tokenRefreshedAt': now } });
      await alertAdmins(t, 'Instagram needs to be connected again', `${reason}. Until then Instagram DMs can not be answered. Settings → Instagram → Connect.`);
    }
  }
  return { refreshed, checked: due.length };
}

let timer = null;
export function startInstagramWorker() {
  if (timer) return;
  const run = () => refreshInstagramTokens().then((r) => r.refreshed && console.log(`[instagram] ${r.refreshed} connection(s) renewed`)).catch((err) => console.error('[instagram] token worker', err.message));
  timer = setInterval(run, 6 * 3600 * 1000);
  setTimeout(run, 60 * 1000);
}
