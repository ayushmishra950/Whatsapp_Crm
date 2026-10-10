/**
 * Posts to the business's Facebook Page / Instagram account, and the comments on them.
 * Posting runs in a small worker (also for "post now"), so a slow Meta call never blocks the request,
 * scheduled posts go out on time, and Instagram videos can finish processing before they are published.
 */
import { Contact, Notification, Plan, SocialComment, SocialPost, Tenant } from '../models/index.js';
import { HttpError } from '../utils/http.js';
import { notify } from './alerts.js';
import * as fb from './facebook.js';
import * as ig from './instagram.js';
import { emitToTenant } from './socket.js';
import { channelsReady } from './channelMigration.js';

export const PLATFORMS = ['facebook', 'instagram'];
const MAX_ATTEMPTS = 3;
const IG_PROCESS_LIMIT_MS = 30 * 60 * 1000; // give up on an Instagram video still processing after 30 min

/** Plan allows posting / comments */
export async function socialAllowed(tenant) {
  const plan = tenant.plan?.modules ? tenant.plan : tenant.plan ? await Plan.findById(tenant.plan).select('modules').lean() : null;
  return plan?.modules?.social !== false;
}

/** Is the platform usable for this business (connected, or sandbox)? */
export function platformState(tenant, platform) {
  const mode = tenant[platform]?.mode || 'mock';
  const connected = platform === 'facebook' ? !!tenant.facebook?.pageId : !!tenant.instagram?.igUserId;
  // Instagram posting / comments need the newer permissions (businesses connected earlier must connect again)
  const scopes = tenant.instagram?.scopes || [];
  const igScopesOk = platform !== 'instagram' || mode !== 'live' || (scopes.includes('instagram_business_content_publish') && scopes.includes('instagram_business_manage_comments'));
  return { mode, connected, live: mode === 'live' && connected, igScopesOk };
}

// ---------- posting ----------
export async function createPost({ tenant, user, text = '', link = '', media = [], platforms = [], scheduledAt }) {
  const when = scheduledAt ? new Date(scheduledAt) : new Date();
  const post = await SocialPost.create({
    tenantId: tenant._id,
    text,
    link,
    media,
    targets: platforms.map((platform) => ({ platform })),
    status: 'scheduled',
    scheduledAt: when,
    createdBy: user?._id,
  });
  if (when <= new Date()) setImmediate(() => publishDue().catch((err) => console.error('[social] publish', err.message)));
  return post;
}

function overallStatus(post) {
  const s = post.targets.map((t) => t.status);
  if (s.every((x) => x === 'posted')) return 'posted';
  if (s.some((x) => x === 'pending' || x === 'publishing')) return 'publishing';
  if (s.some((x) => x === 'posted')) return 'partial';
  return 'failed';
}

async function publishTarget(post, t) {
  const media = post.media.map((m) => ({ url: m.url, type: m.type }));
  if (t.platform === 'facebook') {
    const r = await fb.publishPost(post.tenantId, { text: post.text, link: post.link, media });
    Object.assign(t, { status: 'posted', externalId: r.id, permalink: r.permalink, postedAt: new Date(), error: undefined });
    return;
  }
  // Instagram: container → (video: processing) → publish
  if (!t.containerId) {
    const caption = [post.text, post.link].filter(Boolean).join('\n\n').slice(0, ig.IG_CAPTION_LIMIT);
    t.containerId = (await ig.createPostContainer(post.tenantId, { text: caption, media })).containerId;
    t.status = 'publishing';
  }
  const { status, detail } = await ig.containerStatus(post.tenantId, t.containerId);
  if (status === 'IN_PROGRESS') {
    if (Date.now() - new Date(post.scheduledAt).getTime() > IG_PROCESS_LIMIT_MS) throw new HttpError(502, 'Instagram took too long to process the video');
    t.status = 'publishing'; // checked again on the next run
    return;
  }
  if (status !== 'FINISHED') throw new HttpError(400, `Instagram could not use this media (${status}${detail ? `: ${detail}` : ''}). Photos must be JPG; videos MP4/MOV.`);
  const r = await ig.publishContainer(post.tenantId, t.containerId);
  Object.assign(t, { status: 'posted', externalId: r.id, permalink: r.permalink, postedAt: new Date(), error: undefined });
}

/** One worker run: posts that are due (or still being processed by Instagram) */
export async function publishDue(now = new Date()) {
  let done = 0;
  for (let i = 0; i < 20; i += 1) {
    // Claim one post at a time so two workers never publish the same post
    const post = await SocialPost.findOneAndUpdate(
      { $or: [{ status: 'scheduled', scheduledAt: { $lte: now } }, { status: 'publishing', updatedAt: { $lte: new Date(now.getTime() - 20000) } }] },
      { $set: { status: 'publishing' } },
      { sort: { scheduledAt: 1 }, returnDocument: 'after' }
    );
    if (!post) break;
    for (const t of post.targets) {
      if (t.status === 'posted' || t.status === 'failed') continue;
      try {
        t.attempts += 1;
        await publishTarget(post, t);
      } catch (err) {
        t.error = err.message;
        // Wrong file / no permission: no point trying again. Network trouble: up to 3 tries.
        t.status = err.status && err.status < 500 ? 'failed' : t.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
      }
    }
    post.status = overallStatus(post);
    post.markModified('targets');
    await post.save();
    emitToTenant(post.tenantId, 'social:post', post.toJSON());
    if (post.status === 'failed' || post.status === 'partial') {
      const failed = post.targets.filter((t) => t.status === 'failed').map((t) => `${t.platform}: ${t.error}`).join(' · ');
      notify(post.tenantId, { to: post.createdBy ? [post.createdBy] : 'admins', kind: 'alert', title: 'A post was not published everywhere', body: failed.slice(0, 300), url: '/social' }).catch(() => {});
    }
    done += 1;
  }
  return done;
}

let timer = null;
export function startSocialWorker() {
  if (timer) return;
  const run = () => publishDue().catch((err) => console.error('[social] worker', err.message));
  timer = setInterval(run, 30000);
  setTimeout(run, 15000);
  const sync = () => autoSyncComments().catch((err) => console.error('[social] comment sync', err.message));
  setInterval(sync, 5 * 60 * 1000);
  setTimeout(sync, 60000);
}

// ---------- comments ----------
const ownAccountId = (tenant, platform) => (platform === 'facebook' ? tenant.facebook?.pageId : tenant.instagram?.igUserId);

/**
 * A comment arrived (webhook) or was fetched. Saves it once (comment id), links it to the CRM post,
 * marks the business's own replies, and tells the team about new customer comments.
 */
export async function ingestComment(tenant, platform, c, { verb = 'add', notifyTeam = true } = {}) {
  if (!c?.externalId) return null;
  const key = { tenantId: tenant._id, platform, externalId: String(c.externalId) };
  if (verb === 'remove') {
    const removed = await SocialComment.findOneAndUpdate(key, { $set: { deletedAt: new Date() } }, { returnDocument: 'after' });
    if (removed) emitToTenant(tenant._id, 'social:comment', removed.toJSON());
    return removed;
  }
  const post = c.postExternalId ? await SocialPost.findOne({ tenantId: tenant._id, 'targets.externalId': String(c.postExternalId) }).select('_id text') : null;
  const fromBusiness = !!c.from?.id && String(c.from.id) === String(ownAccountId(tenant, platform) || '');
  const before = await SocialComment.findOne(key).select('text hidden deletedAt').lean();
  const existed = !!before;
  // Re-read by the sync with nothing new: no write, no live update
  if (before && !before.deletedAt && before.text === (c.text || '') && (c.hidden === undefined || !!before.hidden === !!c.hidden)) return SocialComment.findOne(key);
  const doc = await SocialComment.findOneAndUpdate(
    key,
    {
      $set: { text: c.text || '', ...(c.hidden !== undefined && { hidden: !!c.hidden }) },
      $setOnInsert: {
        postExternalId: c.postExternalId ? String(c.postExternalId) : undefined,
        socialPostId: post?._id,
        parentExternalId: c.parentExternalId && c.parentExternalId !== c.postExternalId ? String(c.parentExternalId) : undefined,
        from: { id: c.from?.id, name: c.from?.name, username: c.from?.username },
        at: c.at || new Date(),
        fromBusiness,
        ...(fromBusiness && { readAt: new Date() }),
      },
    },
    { upsert: true, returnDocument: 'after' }
  );
  if (!existed && post) {
    await SocialPost.updateOne({ _id: post._id }, { $inc: { commentCount: 1, ...(!fromBusiness && { unreadComments: 1 }) } });
  }
  emitToTenant(tenant._id, 'social:comment', doc.toJSON());
  if (!existed && !fromBusiness && notifyTeam) await alertNewComment(tenant, platform, doc);
  return doc;
}

/** Bell + phone for new comments: at most one alert per post every 10 minutes (busy posts would flood the team) */
async function alertNewComment(tenant, platform, comment) {
  const key = `comment:${comment.postExternalId || comment.externalId}`;
  if (await Notification.exists({ tenantId: tenant._id, key, createdAt: { $gte: new Date(Date.now() - 10 * 60000) } })) return;
  const who = comment.from?.name || (comment.from?.username ? `@${comment.from.username}` : 'Someone');
  await notify(tenant._id, { to: 'admins', kind: 'comment', title: `💬 New ${platform === 'facebook' ? 'Facebook' : 'Instagram'} comment from ${who}`, body: comment.text.slice(0, 140), key, url: '/social/comments' });
}

/**
 * Read the comments of a CRM post from Facebook / Instagram: picks up comments whose webhook never came
 * (webhook not set up yet, Meta did not send it, server was down). notifyTeam: alert for new customer comments.
 * Returns the number of new comments; a platform that fails is listed in `errors` (the others still sync).
 */
export async function syncPostComments(tenant, post, { notifyTeam = false, errors = [] } = {}) {
  let added = 0;
  for (const t of post.targets) {
    if (t.status !== 'posted' || !t.externalId) continue;
    // Pretend (sandbox) posts made before the Page / account was connected do not exist on Facebook / Instagram
    if (/MOCK/.test(t.externalId) && platformState(tenant, t.platform).live) continue;
    let list;
    try {
      list = t.platform === 'facebook' ? await fb.listComments(tenant._id, t.externalId) : await ig.listMediaComments(tenant._id, t.externalId);
    } catch (err) {
      errors.push(`${t.platform === 'facebook' ? 'Facebook' : 'Instagram'}: ${err.message}`);
      continue;
    }
    for (const c of list) {
      const existed = await SocialComment.exists({ tenantId: tenant._id, platform: t.platform, externalId: c.externalId });
      await ingestComment(tenant, t.platform, { ...c, postExternalId: t.externalId }, { notifyTeam });
      if (!existed) added += 1;
    }
  }
  return added;
}

/** Sync the comments of the business's recent posts (Refresh button, and every few minutes in the worker) */
export async function syncRecentComments(tenant, { days = 7, notifyTeam = false } = {}) {
  const posts = await SocialPost.find({ tenantId: tenant._id, status: { $in: ['posted', 'partial'] }, scheduledAt: { $gte: new Date(Date.now() - days * 86400000) } })
    .sort({ scheduledAt: -1 })
    .limit(30);
  const errors = [];
  let added = 0;
  for (const post of posts) added += await syncPostComments(tenant, post, { notifyTeam, errors });
  return { added, posts: posts.length, errors: [...new Set(errors)] };
}

// Safety net for missed webhooks: every 5 minutes, the last 3 days' posts of connected businesses
async function autoSyncComments() {
  const tenants = await Tenant.find({ $or: [{ 'facebook.mode': 'live', 'facebook.pageId': { $exists: true } }, { 'instagram.mode': 'live', 'instagram.igUserId': { $exists: true } }] }).populate('plan', 'modules');
  for (const tenant of tenants) {
    if (!(await socialAllowed(tenant))) continue;
    await syncRecentComments(tenant, { days: 3, notifyTeam: true }).catch((err) => console.error('[social] comment sync', String(tenant._id), err.message));
  }
}

async function loadComment(tenant, id) {
  const c = await SocialComment.findOne({ _id: id, tenantId: tenant._id });
  if (!c) throw new HttpError(404, 'Comment not found');
  if (c.deletedAt) throw new HttpError(400, 'This comment was deleted');
  return c;
}

/** Public reply under the comment (appears on Facebook / Instagram as the business) */
export async function replyToComment(tenant, user, id, text) {
  const c = await loadComment(tenant, id);
  const r = c.platform === 'facebook' ? await fb.replyToComment(tenant._id, c.externalId, text) : await ig.replyToMediaComment(tenant._id, c.externalId, text);
  const reply = await SocialComment.findOneAndUpdate(
    { tenantId: tenant._id, platform: c.platform, externalId: String(r.id) },
    {
      $set: { text },
      $setOnInsert: { postExternalId: c.postExternalId, socialPostId: c.socialPostId, parentExternalId: c.parentExternalId || c.externalId, from: { id: ownAccountId(tenant, c.platform) }, at: new Date(), fromBusiness: true, sentBy: user._id, readAt: new Date() },
    },
    { upsert: true, returnDocument: 'after' }
  );
  await markRead(tenant, [c._id]);
  emitToTenant(tenant._id, 'social:comment', reply.toJSON());
  return reply;
}

/** One private message (Messenger / Instagram DM) about the comment; Meta allows it once, within 7 days */
export async function privateReply(tenant, id, text) {
  const c = await loadComment(tenant, id);
  if (c.fromBusiness) throw new HttpError(400, 'This is your own comment');
  if (c.privateReplyAt) throw new HttpError(400, 'A private message was already sent for this comment (Facebook / Instagram allow only one).');
  if (Date.now() - new Date(c.at).getTime() > 7 * 86400000) throw new HttpError(400, 'Private replies are possible only within 7 days of the comment.');
  if (c.platform === 'facebook') await fb.privateReply(tenant._id, c.externalId, text);
  else await ig.privateReplyToComment(tenant._id, c.externalId, text);
  c.privateReplyAt = new Date();
  c.readAt ||= new Date();
  await c.save();
  emitToTenant(tenant._id, 'social:comment', c.toJSON());
  return c;
}

export async function setHidden(tenant, id, hidden) {
  const c = await loadComment(tenant, id);
  if (c.fromBusiness) throw new HttpError(400, 'Your own comments can not be hidden');
  if (c.platform === 'facebook') await fb.hideComment(tenant._id, c.externalId, hidden);
  else await ig.hideMediaComment(tenant._id, c.externalId, hidden);
  c.hidden = hidden;
  await c.save();
  emitToTenant(tenant._id, 'social:comment', c.toJSON());
  return c;
}

export async function removeComment(tenant, id) {
  const c = await loadComment(tenant, id);
  if (c.platform === 'facebook') await fb.deleteComment(tenant._id, c.externalId);
  else await ig.deleteMediaComment(tenant._id, c.externalId);
  c.deletedAt = new Date();
  await c.save();
  emitToTenant(tenant._id, 'social:comment', c.toJSON());
  return c;
}

export async function markRead(tenant, ids) {
  const filter = { tenantId: tenant._id, readAt: null, ...(ids === 'all' ? {} : { _id: { $in: ids } }) };
  const unread = await SocialComment.find(filter).select('socialPostId').lean();
  if (!unread.length) return 0;
  await SocialComment.updateMany(filter, { $set: { readAt: new Date() } });
  const perPost = {};
  for (const u of unread) if (u.socialPostId) perPost[u.socialPostId] = (perPost[u.socialPostId] || 0) + 1;
  for (const [postId, n] of Object.entries(perPost)) await SocialPost.updateOne({ _id: postId }, { $inc: { unreadComments: -n } });
  await SocialPost.updateMany({ tenantId: tenant._id, unreadComments: { $lt: 0 } }, { $set: { unreadComments: 0 } });
  return unread.length;
}

/** Make the commenter a lead (Instagram: their Instagram id, so DMs join the same lead; Facebook: their name) */
export async function commentToLead(tenant, user, id) {
  const c = await loadComment(tenant, id);
  if (c.fromBusiness) throw new HttpError(400, 'This is your own comment');
  if (c.contactId) return { contact: await Contact.findById(c.contactId), created: false };
  let contact;
  let created = false;
  if (c.platform === 'instagram') {
    if (!channelsReady()) throw new HttpError(400, 'The database update for Instagram has not run yet.');
    contact = await Contact.findOne({ tenantId: tenant._id, 'instagram.igsid': c.from?.id });
    if (!contact) {
      contact = await Contact.create({ tenantId: tenant._id, name: '', instagram: { igsid: c.from?.id, username: c.from?.username }, source: 'instagram', notes: `Commented on Instagram: “${c.text.slice(0, 200)}”`, assignedTo: user._id });
      created = true;
    }
  } else {
    contact = await Contact.findOne({ tenantId: tenant._id, 'facebook.userId': c.from?.id });
    if (!contact) {
      contact = await Contact.create({ tenantId: tenant._id, name: c.from?.name || '', facebook: { userId: c.from?.id, name: c.from?.name }, source: 'other', tags: ['facebook-comment'], notes: `Commented on Facebook: “${c.text.slice(0, 200)}”`, assignedTo: user._id });
      created = true;
    }
  }
  c.contactId = contact._id;
  c.readAt ||= new Date();
  await c.save();
  emitToTenant(tenant._id, 'social:comment', c.toJSON());
  return { contact, created };
}

/** Webhook entry for Instagram comments (field "comments" in an object:"instagram" payload) */
export async function handleInstagramCommentChange(tenant, value) {
  if (!value?.id) return null;
  return ingestComment(tenant, 'instagram', {
    externalId: value.id,
    postExternalId: value.media?.id,
    parentExternalId: value.parent_id,
    from: { id: value.from?.id, username: value.from?.username },
    text: value.text || '',
    at: new Date(),
  });
}

/** Facebook Page webhooks (object "page", field "feed", item "comment") */
export async function handleFacebookPayload(body) {
  if (body.object !== 'page') return;
  for (const entry of body.entry || []) {
    const tenant = await Tenant.findOne({ 'facebook.pageId': String(entry.id) });
    if (!tenant) {
      console.warn('[facebook] no business for page', entry.id);
      continue;
    }
    for (const change of entry.changes || []) {
      const v = change.value || {};
      if (change.field !== 'feed' || v.item !== 'comment') continue;
      try {
        await ingestComment(
          tenant,
          'facebook',
          { externalId: v.comment_id, postExternalId: v.post_id, parentExternalId: v.parent_id, from: { id: v.from?.id, name: v.from?.name }, text: v.message || '', at: v.created_time ? new Date(Number(v.created_time) * 1000) : new Date() },
          { verb: v.verb }
        );
      } catch (err) {
        console.error('[facebook] comment not saved', err.message);
      }
    }
  }
}
