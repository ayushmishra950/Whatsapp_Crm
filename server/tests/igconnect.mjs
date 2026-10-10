// Connecting Instagram (Business Login for Instagram) and live sending — Instagram's API is faked in this process
import axios from 'axios';
import { API, M, S, call, cleanup, crash, finish, newBusiness, ok, stamp } from './lib.mjs';

const { env } = await import(S + 'config/env.js');
const { decrypt, encrypt } = await import(S + 'utils/crypto.js');
const C = await import(S + 'services/instagramConnect.js');
const ig = await import(S + 'services/instagram.js');

const calls = [];
let refreshFails = false;
axios.defaults.adapter = async (config) => {
  const url = config.url;
  const params = config.params || {};
  let data = config.data;
  if (typeof data === 'string' && data.startsWith('{')) data = JSON.parse(data); // axios turns JSON bodies into text before the adapter
  calls.push({ method: config.method, url, params, data, auth: config.headers?.Authorization });
  const reply = (data) => ({ data, status: 200, statusText: 'OK', headers: {}, config });
  if (url === 'https://api.instagram.com/oauth/access_token') return reply({ access_token: 'SHORT-TOKEN', user_id: 999 });
  if (url === 'https://graph.instagram.com/access_token') return reply({ access_token: 'LONG-TOKEN', token_type: 'bearer', expires_in: 5184000 });
  if (url.endsWith('/me')) return reply({ user_id: `1784${stamp}`, id: 'app-scoped', username: 'infonic.test', name: 'Infonic Solutions', profile_picture_url: 'https://cdn/x.jpg' });
  if (url.endsWith('/me/subscribed_apps')) return reply({ success: true });
  if (url === 'https://graph.instagram.com/refresh_access_token') {
    if (refreshFails) {
      const e = new Error('Request failed');
      e.response = { status: 400, data: { error: { message: 'Error validating access token: Session has expired', code: 190 } } };
      throw e;
    }
    return reply({ access_token: 'LONG-TOKEN-2', expires_in: 5184000 });
  }
  if (url.endsWith('/messages')) return reply({ recipient_id: data?.recipient?.id, message_id: `mid.LIVE.${calls.length}` });
  if (/graph\.instagram\.com\/v[\d.]+\/IGSID/.test(url)) return reply({ name: 'Riya', username: 'riya.live', profile_pic: 'https://cdn/p.jpg' });
  throw new Error(`unexpected call ${url}`);
};

const tids = [];
try {
  const a = await newBusiness(`IG Connect A ${stamp}`, { coaching: false });
  const b = await newBusiness(`IG Connect B ${stamp}`, { coaching: false });
  tids.push(a.id, b.id);
  const keep = { ...env.instagram };

  // Not set up yet
  Object.assign(env.instagram, { appId: '', redirectUrl: '' });
  let threw = null;
  try { C.connectUrl({ tenantId: a.id, userId: a.admin._id }); } catch (e) { threw = e; }
  ok(threw && /not set up/.test(threw.message), 'Without IG_APP_ID / IG_REDIRECT_URL connecting says the server is not set up');

  Object.assign(env.instagram, { appId: '1234567890', appSecret: 'test-secret', redirectUrl: 'https://api.example.test/api/instagram/callback' });
  const url = new URL(C.connectUrl({ tenantId: a.id, userId: a.admin._id }));
  ok(url.origin === 'https://www.instagram.com' && url.searchParams.get('client_id') === '1234567890' && url.searchParams.get('scope') === 'instagram_business_basic,instagram_business_manage_messages,instagram_business_content_publish,instagram_business_manage_comments' && url.searchParams.get('redirect_uri') === env.instagram.redirectUrl, 'Login link: Instagram, our app, DM + posting + comment permissions, our redirect');
  ok(!url.searchParams.has('force_reauth'), 'Normal connect: Instagram shows the account already logged in (just "Allow")');
  const sw = new URL(C.connectUrl({ tenantId: a.id, userId: a.admin._id, switchAccount: true }));
  ok(sw.searchParams.get('force_reauth') === 'true', '"Use a different Instagram account": Instagram always asks to log in');
  const st = C.readState(url.searchParams.get('state'));
  ok(String(st.tenantId) === String(a.id) && String(st.userId) === String(a.admin._id), 'Signed state carries the business and the admin');
  threw = null;
  try { C.readState('forged.state.value'); } catch (e) { threw = e; }
  ok(threw && /expired/.test(threw.message), 'A forged / old state is refused');

  // Complete the login
  const r = await C.completeConnect({ tenantId: a.id, code: 'AUTH-CODE#_' });
  const ta = await M.Tenant.findById(a.id).select('+instagram.accessTokenEnc');
  const codeCall = calls.find((c) => c.url === 'https://api.instagram.com/oauth/access_token');
  ok(String(codeCall.data).includes('code=AUTH-CODE&') || String(codeCall.data).endsWith('code=AUTH-CODE'), 'Trailing "#_" is removed from the code');
  ok(r.username === 'infonic.test' && ta.instagram.mode === 'live' && ta.instagram.igUserId === `1784${stamp}` && ta.instagram.username === 'infonic.test', 'Business is live with its Instagram account id and username');
  ok(decrypt(ta.instagram.accessTokenEnc) === 'LONG-TOKEN' && !JSON.stringify(ta.toJSON()).includes('LONG-TOKEN'.slice(0, 4) + '-TOKEN"'), 'Long-lived token saved encrypted (short token not kept)');
  ok(Math.abs(ta.instagram.tokenExpiresAt - Date.now() - 60 * 864e5) < 864e5, 'Token valid ~60 days');
  const sub = calls.find((c) => c.url.endsWith('/me/subscribed_apps'));
  ok(sub && sub.params.subscribed_fields.includes('messages') && sub.auth === 'Bearer LONG-TOKEN', 'Account subscribed to our webhook (messages, seen, reactions, referrals…)');

  // Same Instagram account on another business
  threw = null;
  try { await C.completeConnect({ tenantId: b.id, code: 'X' }); } catch (e) { threw = e; }
  ok(threw?.status === 409 && /already connected/.test(threw.message), 'The same Instagram account can not be connected to two businesses');

  // Settings shows it
  const s = await call(a.tok, 'GET', '/settings');
  ok(s.instagram.mode === 'live' && s.instagram.username === 'infonic.test' && !JSON.stringify(s).includes('accessToken'), 'Settings shows the connection (never the token)');

  // Live sending uses the business token and the IG account
  const conv = { tenantId: a.id };
  const sent = await ig.sendText(a.id, 'IGSID-CUSTOMER', 'Hello from the CRM');
  const sendCall = calls.filter((c) => c.url.endsWith('/messages')).at(-1);
  ok(sent.id?.startsWith('mid.LIVE') && sendCall.url === `https://graph.instagram.com/${env.instagram.graphVersion}/1784${stamp}/messages` && sendCall.auth === 'Bearer LONG-TOKEN' && sendCall.data.recipient.id === 'IGSID-CUSTOMER', 'Live reply: POST /{ig-id}/messages with the business token to the IGSID');
  await ig.sendInteractive(a.id, 'IGSID-CUSTOMER', { kind: 'list', body: 'Choose a course', options: Array.from({ length: 15 }, (_, i) => ({ id: `c${i}`, title: `A very long course title number ${i}`, description: i < 2 ? 'details' : '' })) });
  const menu = calls.filter((c) => c.url.endsWith('/messages')).at(-1).data.message;
  ok(menu.quick_replies.length === 13 && menu.quick_replies.every((q) => q.title.length <= 20) && /details/.test(menu.text), 'Chatbot menu becomes Instagram quick replies (max 13, 20 characters)');
  let mediaErr = null;
  const keepPublic = env.publicUrl;
  env.publicUrl = '';
  try { await ig.sendMedia(a.id, 'IGSID-CUSTOMER', { type: 'image', url: '/uploads/x/photo.jpg' }); } catch (e) { mediaErr = e; }
  ok(mediaErr && /public link/.test(mediaErr.message), 'Live: a file kept only on this server needs PUBLIC_URL or Cloudinary (clear message)');
  env.publicUrl = 'https://api.example.test';
  await ig.sendMedia(a.id, 'IGSID-CUSTOMER', { type: 'document', url: '/uploads/x/fees.pdf', caption: 'Fee list' });
  const fileCalls = calls.filter((c) => c.url.endsWith('/messages')).slice(-2);
  ok(fileCalls[0].data.message.attachment.type === 'file' && fileCalls[0].data.message.attachment.payload.url === 'https://api.example.test/uploads/x/fees.pdf' && fileCalls[1].data.message.text === 'Fee list', 'PDF sent as a file by public link, caption as a separate text');
  env.publicUrl = keepPublic;
  const prof = await ig.getProfile(a.id, 'IGSID777');
  ok(prof?.username === 'riya.live' && prof.name === 'Riya', 'Customer profile (username, name, photo) read from Instagram');
  void conv;

  // Token renewal
  await M.Tenant.updateOne({ _id: a.id }, { $set: { 'instagram.tokenExpiresAt': new Date(Date.now() + 5 * 864e5), 'instagram.tokenRefreshedAt': new Date(Date.now() - 2 * 864e5) } });
  let w = await C.refreshInstagramTokens();
  const renewed = await M.Tenant.findById(a.id).select('+instagram.accessTokenEnc');
  ok(w.refreshed >= 1 && decrypt(renewed.instagram.accessTokenEnc) === 'LONG-TOKEN-2' && renewed.instagram.tokenExpiresAt > new Date(Date.now() + 50 * 864e5), 'Connection renewed before it expires (new token, new expiry)');
  w = await C.refreshInstagramTokens();
  ok(!calls.filter((c) => c.url.includes('refresh_access_token')).slice(1).length, 'Renewed at most once a day');

  refreshFails = true;
  await M.Tenant.updateOne({ _id: a.id }, { $set: { 'instagram.tokenExpiresAt': new Date(Date.now() + 3 * 864e5), 'instagram.tokenRefreshedAt': new Date(Date.now() - 2 * 864e5) } });
  await C.refreshInstagramTokens();
  const failed = await M.Tenant.findById(a.id);
  const alerts = await M.Notification.find({ tenantId: a.id, key: 'instagram:token' });
  ok(/could not be renewed/.test(failed.instagram.tokenError) && alerts.length === 1 && String(alerts[0].userId) === String(a.admin._id), 'Renewal fails → error shown in Settings + one alert to the admin');
  refreshFails = false;

  // Callback route (public): errors go back to Settings
  let res = await fetch(`${API}/instagram/callback?error=access_denied&error_description=User%20denied`, { redirect: 'manual' });
  ok(res.status === 302 && /\/app\/settings\?instagram=error&reason=User\+denied#instagram$/.test(res.headers.get('location')), 'Login cancelled → back to Settings with the reason');
  res = await fetch(`${API}/instagram/callback?code=abc&state=bad`, { redirect: 'manual' });
  ok(res.status === 302 && /instagram=error/.test(res.headers.get('location')), 'Bad state on the callback → back to Settings with an error');
  res = await call(a.tok, 'GET', '/instagram/connect-url');
  ok(res.status === 400 && /not set up/.test(res.error), 'Connect link while the server has no Instagram keys: clear message (test API has none)', res.error);
  const agent = await M.User.create({ tenantId: a.id, name: 'IG Agent (temp)', email: `igagent${stamp}@temp.local`, role: 'agent' });
  const { signToken } = await import(S + 'middleware/auth.js');
  res = await call(signToken(agent), 'GET', '/instagram/connect-url');
  ok(res.status === 403, 'Counsellors can not connect Instagram (admin only)');

  // Disconnect
  res = await call(a.tok, 'DELETE', '/settings/instagram');
  const off = await M.Tenant.findById(a.id).select('+instagram.accessTokenEnc');
  ok(res.status === 200 && off.instagram.mode === 'mock' && !off.instagram.igUserId && !off.instagram.accessTokenEnc, 'Disconnect: back to sandbox, account id and token removed');
  ok(!!(await M.AuditLog.findOne({ tenantId: a.id, action: 'instagram.disconnect' })), 'Disconnect is in the audit log');
  void encrypt;
  Object.assign(env.instagram, keep);
} catch (e) {
  crash(e);
} finally {
  await cleanup(tids);
  finish();
}
