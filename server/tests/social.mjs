// Posting to Facebook Page / Instagram and their comments (sandbox + faked Meta API for the live paths)
import axios from 'axios';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { API, M, S, call, cleanup, crash, finish, newBusiness, ok, signToken, stamp, wait } from './lib.mjs';

const fileEnv = dotenv.parse(fs.existsSync('.env') ? fs.readFileSync('.env') : '');
const fbSecret = process.env.FB_APP_SECRET || fileEnv.FB_APP_SECRET || fileEnv.WA_APP_SECRET || '';
const igSecret = fileEnv.IG_APP_SECRET || fileEnv.INSTAGRAM_APP_SECRET || fileEnv.WA_APP_SECRET || '';
const { env } = await import(S + 'config/env.js');
const { encrypt } = await import(S + 'utils/crypto.js');
const social = await import(S + 'services/social.js');
const FBC = await import(S + 'services/facebookConnect.js');

// Fake Meta API for the "live" checks run in this process
const calls = [];
const flaky = { reply: 0 };
let igStatus = ['IN_PROGRESS', 'FINISHED'];
axios.defaults.adapter = async (config) => {
  let data = config.data;
  if (typeof data === 'string' && data.startsWith('{')) data = JSON.parse(data);
  calls.push({ method: config.method, url: config.url, params: config.params || {}, data });
  const reply = (d) => ({ data: d, status: 200, statusText: 'OK', headers: {}, config });
  const u = config.url;
  if (u.includes('/oauth/access_token')) return reply({ access_token: config.params?.grant_type ? 'LONG-USER' : 'SHORT-USER' });
  if (u.endsWith('/me/accounts')) return reply({ data: [{ id: `PAGE${stamp}`, name: 'Infonic Page', access_token: 'PAGE-TOKEN', picture: { data: { url: 'https://x/p.jpg' } } }, { id: `PAGE2${stamp}`, name: 'Second Page', access_token: 'PAGE2-TOKEN' }] });
  if (u.endsWith('/subscribed_apps')) return reply({ success: true });
  if (u.endsWith('/feed')) return reply({ id: `PAGE${stamp}_111` });
  if (u.endsWith('/photos')) return reply({ id: `PH${calls.length}`, post_id: `PAGE${stamp}_222` });
  if (/\/media$/.test(u)) return reply({ id: `CONT${calls.length}` });
  if (/\/CONT\d+$/.test(u)) return reply({ status_code: igStatus.shift() || 'FINISHED' });
  if (u.endsWith('/media_publish')) return reply({ id: `IGMEDIA${stamp}` });
  // Comment actions on the live Page: a temporary Meta error first (code 2), a hide that errors but did happen
  const metaErr = (status, error) => Object.assign(new Error('meta'), { response: { status, data: { error } } });
  if (u.endsWith(`FBC1${stamp}/comments`) && config.method === 'post') {
    flaky.reply += 1;
    if (flaky.reply === 1) throw metaErr(500, { code: 2, is_transient: true, message: 'An unexpected error has occurred. Please retry your request later.' });
    return reply({ id: `LIVEREPLY${stamp}` });
  }
  if (u.endsWith(`FBC1${stamp}`) && config.method === 'post') throw metaErr(400, { code: 100, message: 'Hide answered with an error' });
  if (u.endsWith(`FBC1${stamp}`) && config.method === 'get') return reply({ is_hidden: true, id: `FBC1${stamp}` });
  // Comments read back by the sync (one from a customer, one from the Page / account itself)
  if (/_222\/comments$/.test(u)) return reply({ data: [{ id: `FBC1${stamp}`, from: { id: `CUST${stamp}`, name: 'Sync Customer' }, message: 'Missed by the webhook', created_time: new Date().toISOString() }, { id: `FBC2${stamp}`, from: { id: `PAGE${stamp}`, name: 'Infonic Page' }, message: 'Page own comment', created_time: new Date().toISOString() }] });
  if (/IGMEDIA\d+\/comments$/.test(u)) return reply({ data: [{ id: `IGC1${stamp}`, text: 'IG missed one', username: 'ig.cust', from: { id: `IGCUST${stamp}` }, timestamp: new Date().toISOString(), replies: { data: [] } }] });
  if (/_111$|_222$|IGMEDIA/.test(u)) return reply({ permalink_url: 'https://facebook.com/p/1', permalink: 'https://instagram.com/p/1' });
  throw new Error(`unexpected Meta call ${u}`);
};

const tids = [];
const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(2000).fill(1)]);
const postForm = (tok, fields, files = []) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  for (const f of files) fd.append('files', new Blob([f.buf], { type: f.type }), f.name);
  return fetch(`${API}/social/posts`, { method: 'POST', headers: { Authorization: `Bearer ${tok}` }, body: fd }).then(async (r) => ({ ...(await r.json()), status: r.status }));
};
const waitPost = async (id, want = ['posted', 'failed', 'partial']) => {
  for (let i = 0; i < 20; i += 1) {
    const p = await M.SocialPost.findById(id).lean();
    if (want.includes(p.status)) return p;
    await wait(250);
  }
  return M.SocialPost.findById(id).lean();
};

try {
  const b = await newBusiness(`Social ${stamp}`);
  tids.push(b.id);
  const T = b.id;

  // ---------- posting (sandbox) ----------
  let r = await call(b.tok, 'GET', '/social/status');
  ok(r.facebook?.mode === 'mock' && r.instagram?.mode === 'mock', 'Both platforms start in sandbox');

  r = await postForm(b.tok, { text: 'Admission open for the new Python batch!', platforms: 'facebook' });
  ok(r.status === 201 && r.status !== 'failed', 'Text post to the Facebook Page accepted', r.error);
  let p = await waitPost(r._id);
  ok(p.status === 'posted' && p.targets[0].externalId, 'Posted on Facebook (sandbox) right away');

  r = await postForm(b.tok, { text: 'Only text', platforms: 'instagram' });
  ok(r.status === 400 && /photo or a video/.test(r.error), 'Instagram text-only post is refused with the reason');

  r = await postForm(b.tok, { text: 'Our new classroom 📸', platforms: 'facebook,instagram' }, [{ buf: jpg, type: 'image/jpeg', name: 'class.jpg' }]);
  p = await waitPost(r._id);
  ok(r.status === 201 && p.status === 'posted' && p.targets.length === 2 && p.targets.every((t) => t.status === 'posted' && t.externalId) && p.media[0].url, 'Photo post to Facebook + Instagram, both posted');
  const igPost = p;

  r = await postForm(b.tok, { text: 'x', platforms: 'instagram' }, [{ buf: Buffer.from('GIF89a....'), type: 'image/gif', name: 'a.gif' }]);
  ok(r.status === 400 && /JPG/.test(r.error), 'Instagram refuses non-JPG photos');
  r = await postForm(b.tok, { text: 'x', platforms: 'facebook' }, [{ buf: jpg, type: 'image/jpeg', name: 'a.jpg' }, { buf: Buffer.alloc(100), type: 'video/mp4', name: 'v.mp4' }]);
  ok(r.status === 400 && /either photos/.test(r.error), 'Photos and a video can not be mixed in one post');

  const later = new Date(Date.now() + 3600 * 1000).toISOString();
  r = await postForm(b.tok, { text: 'Tomorrow: free demo class', platforms: 'facebook', scheduledAt: later });
  ok(r.status === 201 && r.status !== 'failed' && (await M.SocialPost.findById(r._id)).status === 'scheduled', 'Post scheduled for later');
  await social.publishDue(new Date());
  ok((await M.SocialPost.findById(r._id)).status === 'scheduled', 'Not posted before its time');
  await social.publishDue(new Date(Date.now() + 2 * 3600 * 1000));
  ok((await M.SocialPost.findById(r._id)).status === 'posted', 'Posted when its time comes');

  const agent = await M.User.create({ tenantId: T, name: 'Social Agent (temp)', email: `socialagent${stamp}@temp.local`, role: 'agent' });
  const atok = signToken(agent);
  r = await postForm(atok, { text: 'agent post', platforms: 'facebook' });
  ok(r.status === 403, 'Counsellors can not post (admin only)');

  r = await call(b.tok, 'GET', '/social/posts');
  ok(r.items?.length >= 3 && r.items.every((x) => x.status !== 'deleted'), 'Posts list');

  // ---------- comments (sandbox) ----------
  const fbTarget = igPost.targets.find((t) => t.platform === 'facebook');
  r = await call(b.tok, 'POST', '/social/sandbox/comment', { platform: 'facebook', postId: String(igPost._id), name: 'Rohit Kumar', text: 'Fees kitni hai?' });
  ok(r.status === 201 && r.from?.name === 'Rohit Kumar' && String(r.socialPostId) === String(igPost._id), 'Facebook comment lands on the right post');
  const fbComment = r;
  r = await call(b.tok, 'POST', '/social/sandbox/comment', { platform: 'instagram', postId: String(igPost._id), name: 'priya.learns', text: 'Batch kab se hai?' });
  const igComment = r;
  ok(r.status === 201 && r.from?.username === 'priya.learns', 'Instagram comment saved with the username');
  let post = await M.SocialPost.findById(igPost._id);
  ok(post.commentCount === 2 && post.unreadComments === 2, 'Post shows 2 comments, 2 unread');
  const notes = await M.Notification.find({ tenantId: T, kind: 'comment' });
  ok(notes.length >= 1 && notes.every((n) => String(n.userId) === String(b.admin._id)), 'Admin gets a new-comment alert');
  await call(b.tok, 'POST', '/social/sandbox/comment', { platform: 'facebook', postId: String(igPost._id), name: 'Another', text: 'Me too' });
  ok((await M.Notification.countDocuments({ tenantId: T, kind: 'comment', key: `comment:${fbTarget.externalId}` })) === 1, 'Busy post: one alert, not one per comment');

  r = await call(b.tok, 'GET', '/social/comments?unread=1');
  ok(r.items?.length === 3 && r.unread === 3, 'Comments inbox: unread comments from both platforms');
  r = await call(b.tok, 'GET', '/social/comments?platform=instagram');
  ok(r.items.length === 1 && r.items[0].platform === 'instagram', 'Filter by platform');
  r = await call(b.tok, 'POST', '/social/comments/sync');
  ok(r.added === 0 && Array.isArray(r.errors) && !r.errors.length, 'Refresh button (sandbox): nothing to read, no error');

  r = await call(b.tok, 'POST', `/social/comments/${fbComment._id}/reply`, { text: 'Fees ₹15,000, details DM kar di hai' });
  ok(r.status === 201 && r.fromBusiness && r.parentExternalId === fbComment.externalId, 'Public reply saved as the business, under the comment');
  await wait(300); // marked read right after the answer
  ok((await M.SocialComment.findById(fbComment._id)).readAt, 'Replied comment is marked read');

  r = await call(atok, 'POST', `/social/comments/${igComment._id}/private-reply`, { text: 'Hi Priya, batch details: ...' });
  ok(r.status === 200 && r.privateReplyAt, 'Counsellor sends a private DM about the comment');
  r = await call(b.tok, 'POST', `/social/comments/${igComment._id}/private-reply`, { text: 'again' });
  ok(r.status === 400 && /only one/.test(r.error), 'Only one private reply per comment (Meta rule)');

  r = await call(atok, 'POST', `/social/comments/${fbComment._id}/hide`, { hidden: true });
  ok(r.hidden === true, 'Comment hidden');
  r = await call(atok, 'DELETE', `/social/comments/${fbComment._id}`);
  ok(r.status === 403, 'Counsellors can not delete comments');
  r = await call(b.tok, 'DELETE', `/social/comments/${fbComment._id}`);
  ok(r.status === 200 && r.deletedAt, 'Admin deletes a comment');

  r = await call(b.tok, 'POST', `/social/comments/${igComment._id}/lead`);
  const igLead = await M.Contact.findById(r.contact?._id);
  ok(r.status === 201 && igLead?.instagram?.username === 'priya.learns' && !igLead.phone, 'Instagram commenter becomes a lead (same Instagram id as DMs)');
  r = await call(b.tok, 'POST', `/social/comments/${igComment._id}/lead`);
  ok(r.status === 200 && String(r.contact._id) === String(igLead._id), 'Making the lead again returns the same lead');

  r = await call(b.tok, 'POST', '/social/comments/read', { all: true });
  ok((await call(b.tok, 'GET', '/social/comments?unread=1')).unread === 0, 'Mark all comments read');

  // ---------- webhooks ----------
  await M.Tenant.updateOne({ _id: T }, { $set: { 'facebook.pageId': `PAGE${stamp}`, 'instagram.igUserId': `IGU${stamp}` } });
  const send = (pathName, body, secret) => {
    const raw = JSON.stringify(body);
    return fetch(`${API}/webhook/${pathName}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(secret && { 'X-Hub-Signature-256': `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}` }) }, body: raw });
  };
  const fbHook = (value) => ({ object: 'page', entry: [{ id: `PAGE${stamp}`, time: Date.now(), changes: [{ field: 'feed', value }] }] });
  let res = await send('facebook', fbHook({ item: 'comment', verb: 'add', comment_id: `C1_${stamp}`, post_id: fbTarget.externalId, parent_id: fbTarget.externalId, from: { id: 'U9', name: 'Neha' }, message: 'Is there a weekend batch?', created_time: Math.floor(Date.now() / 1000) }), fbSecret);
  await wait(500);
  const hooked = await M.SocialComment.findOne({ externalId: `C1_${stamp}` });
  ok(res.status === 200 && hooked && hooked.from.name === 'Neha' && String(hooked.socialPostId) === String(igPost._id) && !hooked.parentExternalId, 'Facebook comment webhook saved on the right post');
  if (fbSecret) ok((await send('facebook', fbHook({ item: 'comment', verb: 'add', comment_id: 'X' }), 'wrong-secret')).status === 401, 'Facebook webhook with a wrong signature is refused');
  await send('facebook', fbHook({ item: 'comment', verb: 'add', comment_id: `C2_${stamp}`, post_id: fbTarget.externalId, parent_id: `C1_${stamp}`, from: { id: `PAGE${stamp}`, name: 'Infonic Page' }, message: 'Yes, Sat-Sun', created_time: Math.floor(Date.now() / 1000) }), fbSecret);
  await wait(500);
  const own = await M.SocialComment.findOne({ externalId: `C2_${stamp}` });
  ok(own?.fromBusiness && own.readAt && own.parentExternalId === `C1_${stamp}`, 'Reply typed on Facebook by the Page is shown as the business (not unread)');
  await send('facebook', fbHook({ item: 'comment', verb: 'remove', comment_id: `C1_${stamp}`, post_id: fbTarget.externalId }), fbSecret);
  await wait(500);
  ok(!!(await M.SocialComment.findOne({ externalId: `C1_${stamp}` })).deletedAt, 'Comment removed on Facebook is removed here too');
  const igTarget = igPost.targets.find((t) => t.platform === 'instagram');
  const igBody = { object: 'instagram', entry: [{ id: `IGU${stamp}`, time: Date.now(), changes: [{ field: 'comments', value: { id: `IC1_${stamp}`, text: 'Price?', from: { id: 'IGS77', username: 'aman.k' }, media: { id: igTarget.externalId } } }] }] };
  // The test API signs Instagram webhooks with the Instagram secret, or the WhatsApp one when that is empty
  res = await send('instagram', igBody, igSecret);
  if (res.status === 401) res = await send('instagram', igBody, fileEnv.WA_APP_SECRET);
  await wait(800);
  const igHooked = await M.SocialComment.findOne({ externalId: `IC1_${stamp}` });
  ok(res.status === 200 && igHooked?.from?.username === 'aman.k' && String(igHooked.socialPostId) === String(igPost._id), 'Instagram comment webhook saved on the right post');
  ok((await fetch(`${API}/webhook/facebook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1`)).status === 403, 'Facebook webhook verification refuses a wrong token');
  await M.Tenant.updateOne({ _id: T }, { $unset: { 'facebook.pageId': 1, 'instagram.igUserId': 1 } });

  // ---------- live paths (faked Meta API in this process) ----------
  await M.Tenant.updateOne({ _id: T }, { $set: { 'facebook.mode': 'live', 'facebook.pageId': `PAGE${stamp}`, 'facebook.pageTokenEnc': encrypt('PAGE-TOKEN'), 'instagram.mode': 'live', 'instagram.igUserId': `IGU${stamp}`, 'instagram.accessTokenEnc': encrypt('IG-TOKEN'), 'instagram.scopes': ['instagram_business_basic', 'instagram_business_manage_messages', 'instagram_business_content_publish', 'instagram_business_manage_comments'] } });
  const tenant = await M.Tenant.findById(T);
  const livePost = await social.createPost({ tenant, user: b.admin, text: 'Live photo', media: [{ url: 'https://res.cloudinary.com/demo/image/upload/v1/x/a.png', type: 'image' }], platforms: ['facebook', 'instagram'] });
  await wait(100);
  await social.publishDue(new Date(Date.now() + 1000));
  let lp = await M.SocialPost.findById(livePost._id).lean();
  const photoCall = calls.find((c) => c.url.endsWith(`PAGE${stamp}/photos`));
  const igCreate = calls.find((c) => c.url.endsWith(`IGU${stamp}/media`));
  ok(photoCall?.params?.access_token === 'PAGE-TOKEN' && photoCall.data.caption === 'Live photo', 'Live Facebook: photo posted with the Page token and caption');
  ok(igCreate && /\/upload\/f_jpg\//.test(igCreate.data.image_url) && /\.jpg$/.test(igCreate.data.image_url), 'Live Instagram: PNG on Cloudinary is turned into JPG for Instagram');
  ok(lp.targets.find((t) => t.platform === 'instagram').status === 'publishing', 'Instagram waits while Meta processes the media');
  await M.SocialPost.updateOne({ _id: livePost._id }, { $set: { updatedAt: new Date(Date.now() - 60000) } }, { timestamps: false });
  await social.publishDue(new Date(Date.now() + 60000));
  lp = await M.SocialPost.findById(livePost._id).lean();
  ok(lp.status === 'posted' && lp.targets.every((t) => t.status === 'posted') && calls.some((c) => c.url.endsWith('/media_publish')), 'Then published on Instagram (container → publish)');

  // Refresh / auto-sync: comments whose webhook never came
  const alertsBefore = await M.Notification.countDocuments({ tenantId: T, kind: 'comment' });
  let sync = await social.syncRecentComments(await M.Tenant.findById(T), { notifyTeam: true });
  const synced = await M.SocialComment.find({ tenantId: T, externalId: { $in: [`FBC1${stamp}`, `FBC2${stamp}`, `IGC1${stamp}`] } }).lean();
  ok(sync.added === 3 && !sync.errors.length && synced.length === 3, 'Sync finds the comments the webhook missed (Facebook + Instagram)', JSON.stringify(sync));
  ok(synced.find((c) => c.externalId === `FBC2${stamp}`).fromBusiness && !synced.find((c) => c.externalId === `FBC1${stamp}`).fromBusiness, "Page's own comment marked as yours, the customer's as unread");
  ok((await M.Notification.countDocuments({ tenantId: T, kind: 'comment' })) > alertsBefore, 'Auto-sync alerts the team about missed customer comments');
  const stamps = synced.map((c) => String(c.updatedAt)).join();
  sync = await social.syncRecentComments(await M.Tenant.findById(T), { notifyTeam: true });
  const again = await M.SocialComment.find({ tenantId: T, externalId: { $in: [`FBC1${stamp}`, `FBC2${stamp}`, `IGC1${stamp}`] } }).lean();
  ok(sync.added === 0 && again.map((c) => String(c.updatedAt)).join() === stamps, 'Syncing again: nothing new, nothing rewritten');

  // Name hidden in the first answer (sync), sent later (webhook): filled in, still one comment
  const t2 = await M.Tenant.findById(T);
  await social.ingestComment(t2, 'facebook', { externalId: `NONAME${stamp}`, postExternalId: `PAGE${stamp}_222`, from: {}, text: 'Who am I' }, { notifyTeam: false });
  await social.ingestComment(t2, 'facebook', { externalId: `NONAME${stamp}`, postExternalId: `PAGE${stamp}_222`, from: { id: `CUSTX${stamp}`, name: 'Named Later' }, text: 'Who am I' }, { notifyTeam: false });
  const named = await M.SocialComment.find({ tenantId: T, externalId: `NONAME${stamp}` }).lean();
  ok(named.length === 1 && named[0].from?.name === 'Named Later' && !named[0].fromBusiness, 'Commenter name filled in when Facebook sends it later');

  const t3 = await M.Tenant.findById(T);
  const live1 = await M.SocialComment.findOne({ tenantId: T, externalId: `FBC1${stamp}` });
  const rp = await social.replyToComment(t3, b.admin, String(live1._id), 'Details DM kar di');
  ok(flaky.reply === 2 && rp.externalId === `LIVEREPLY${stamp}` && rp.fromBusiness, "Meta's temporary error: the reply is tried again and goes through");
  const hd = await social.setHidden(t3, String(live1._id), true);
  ok(hd.hidden === true, 'Hide answered with an error but the comment is hidden on Facebook: shown as hidden, no error');
  await M.Tenant.updateOne({ _id: T }, { $set: { 'instagram.scopes': ['instagram_business_basic', 'instagram_business_manage_messages'] } });
  const igC = await M.SocialComment.findOne({ tenantId: T, externalId: `IGC1${stamp}` });
  let igErr;
  await social.setHidden(await M.Tenant.findById(T), String(igC._id), true).catch((e) => (igErr = e));
  ok(igErr?.status === 400 && /Connect again/.test(igErr.message), 'Instagram connected before comments: clear "connect again" message');
  await M.Tenant.updateOne({ _id: T }, { $set: { 'instagram.scopes': ['instagram_business_basic', 'instagram_business_manage_messages', 'instagram_business_content_publish', 'instagram_business_manage_comments'] } });

  // Instagram connected before posting existed → asked to connect again
  await M.Tenant.updateOne({ _id: T }, { $set: { 'instagram.scopes': ['instagram_business_basic', 'instagram_business_manage_messages'] } });
  r = await postForm(b.tok, { text: 'x', platforms: 'instagram' }, [{ buf: jpg, type: 'image/jpeg', name: 'a.jpg' }]);
  ok(r.status === 400 && /Connect Instagram again/.test(r.error), 'Old Instagram connection without posting permission: asks to connect again');
  r = await call(b.tok, 'GET', '/settings');
  ok(r.instagram.canPost === false && r.facebook.mode === 'live', 'Settings shows Instagram needs reconnecting for posts');
  await M.Tenant.updateOne({ _id: T }, { $set: { 'facebook.mode': 'mock', 'instagram.mode': 'mock' }, $unset: { 'facebook.pageId': 1, 'facebook.pageTokenEnc': 1, 'instagram.igUserId': 1 } });

  // Retry a failed platform
  const failedPost = await M.SocialPost.create({ tenantId: T, text: 'retry me', targets: [{ platform: 'facebook', status: 'failed', error: 'boom' }], status: 'failed', scheduledAt: new Date() });
  r = await call(b.tok, 'POST', `/social/posts/${failedPost._id}/retry`);
  const retried = await waitPost(failedPost._id, ['posted']);
  ok(r.status === 200 && retried.status === 'posted', 'Retry posts the failed platform again');

  // Cancel a scheduled post / delete a posted one
  r = await postForm(b.tok, { text: 'cancel me', platforms: 'facebook', scheduledAt: later });
  const cancel = await call(b.tok, 'DELETE', `/social/posts/${r._id}`);
  ok(cancel.cancelled && !(await M.SocialPost.findById(r._id)), 'Scheduled post cancelled');
  r = await call(b.tok, 'DELETE', `/social/posts/${igPost._id}`);
  ok(r.ok && /Instagram app/.test(r.note) && (await M.SocialPost.findById(igPost._id)).status === 'deleted', 'Posted post deleted (Facebook) with a note for Instagram');

  // ---------- connecting a Facebook Page (faked) ----------
  Object.assign(env.facebook, { appId: '999', appSecret: 'fb-secret', redirectUrl: 'https://api.example.test/api/facebook/callback', loginConfigId: 'CFG1' });
  const url = new URL(FBC.facebookConnectUrl({ tenantId: T, userId: b.admin._id }));
  ok(url.host === 'www.facebook.com' && url.searchParams.get('config_id') === 'CFG1' && url.searchParams.get('redirect_uri') === env.facebook.redirectUrl, 'Facebook login link: Login for Business configuration + our redirect');
  const done = await FBC.completeFacebookConnect({ tenantId: T, code: 'CODE' });
  ok(done.connected === false && done.choose === 2, 'Two Pages shared → the admin chooses one');
  const pages = await FBC.pendingPages(T);
  ok(pages.length === 2 && !JSON.stringify(pages).includes('TOKEN'), 'Pages to choose from (names only, never tokens)');
  const chosen = await FBC.chooseFromPending(T, `PAGE${stamp}`);
  const tf = await M.Tenant.findById(T).select('+facebook.pageTokenEnc');
  ok(chosen.name === 'Infonic Page' && tf.facebook.mode === 'live' && tf.facebook.pageId === `PAGE${stamp}` && tf.facebook.pageTokenEnc && calls.some((c) => c.url.endsWith(`PAGE${stamp}/subscribed_apps`) && c.params.subscribed_fields === 'feed'), 'Page connected: token saved encrypted, comments webhook subscribed');
  const other = await newBusiness(`Social other ${stamp}`, { coaching: false });
  tids.push(other.id);
  await M.Tenant.updateOne({ _id: other.id }, { $set: { 'facebook.pendingPagesEnc': encrypt(JSON.stringify([{ id: `PAGE${stamp}`, name: 'Infonic Page', token: 'x' }])), 'facebook.pendingAt': new Date() } });
  let threw = null;
  try { await FBC.chooseFromPending(other.id, `PAGE${stamp}`); } catch (e) { threw = e; }
  ok(threw?.status === 409, 'The same Page can not be connected to two businesses');
  r = await call(b.tok, 'DELETE', '/settings/facebook');
  ok(r.ok && (await M.Tenant.findById(T)).facebook.mode === 'mock', 'Facebook disconnected');

  // Another business never sees these comments; plan without the module is refused
  r = await call(other.tok, 'GET', '/social/comments');
  ok(r.items.length === 0, 'Another business sees none of these comments');
  const plan = await M.Plan.findOne({ name: 'Growth' });
  await M.Plan.updateOne({ _id: plan._id }, { $set: { 'modules.social': false } });
  const allowed = await social.socialAllowed(await M.Tenant.findById(T));
  await M.Plan.updateOne({ _id: plan._id }, { $set: { 'modules.social': true } });
  ok(allowed === false, 'Plan without the posting module: refused');
} catch (e) {
  crash(e);
} finally {
  for (const t of tids) fs.rmSync(path.resolve('uploads', String(t)), { recursive: true, force: true });
  await M.SocialPost.deleteMany({ tenantId: { $in: tids } });
  await M.SocialComment.deleteMany({ tenantId: { $in: tids } });
  await cleanup(tids);
  finish();
}
