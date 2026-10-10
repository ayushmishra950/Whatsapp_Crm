import { Router } from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import { z } from 'zod';
import { authorize } from '../middleware/auth.js';
import { SocialComment, SocialPost } from '../models/index.js';
import { audit } from '../services/audit.js';
import * as fb from '../services/facebook.js';
import * as social from '../services/social.js';
import { saveFile } from '../services/storage.js';
import { badRequest, escapeRegex, forbidden, notFound, validate } from '../utils/http.js';
import { cleanUploadName } from '../utils/uploadName.js';

const router = Router();
const MB = 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * MB, files: 10 }, fileFilter: cleanUploadName });

router.use(async (req, _res, next) => {
  if (!(await social.socialAllowed(req.tenant))) throw forbidden('Posting and comments are not part of your plan.');
  next();
});

/** What can be used right now (connection state per platform) */
router.get('/status', (req, res) => {
  res.json(Object.fromEntries(social.PLATFORMS.map((p) => [p, social.platformState(req.tenant, p)])));
});

// ---------- posts ----------
router.get('/posts', async (req, res) => {
  const { status } = req.query;
  const filter = { tenantId: req.tenantId, status: { $ne: 'deleted' } };
  if (['scheduled', 'publishing', 'posted', 'partial', 'failed'].includes(status)) filter.status = status;
  const page = Math.max(1, Number(req.query.page) || 1);
  const [items, total] = await Promise.all([
    SocialPost.find(filter).sort({ scheduledAt: -1 }).skip((page - 1) * 20).limit(20).populate('createdBy', 'name').lean(),
    SocialPost.countDocuments(filter),
  ]);
  res.json({ items, total, page });
});

const postSchema = z.object({
  text: z.string().max(5000).default(''),
  link: z.string().url().or(z.literal('')).default(''),
  platforms: z.string().transform((v) => [...new Set(v.split(',').map((x) => x.trim()).filter(Boolean))]).pipe(z.array(z.enum(['facebook', 'instagram'])).min(1, 'Choose Facebook, Instagram or both')),
  scheduledAt: z.string().datetime({ offset: true }).or(z.literal('')).optional(),
});

/** New post (multipart: text, link, platforms "facebook,instagram", scheduledAt ISO, files[] = photos (max 10) or 1 video) */
router.post('/posts', authorize('admin'), upload.array('files', 10), async (req, res) => {
  const d = validate(postSchema, req.body || {});
  const files = req.files || [];
  const videos = files.filter((f) => f.mimetype.startsWith('video/'));
  const photos = files.filter((f) => f.mimetype.startsWith('image/'));
  if (files.length !== videos.length + photos.length) throw badRequest('Only photos and videos can be posted.');
  if (videos.length > 1 || (videos.length && photos.length)) throw badRequest('Post either photos (up to 10) or one video.');
  if (!d.text.trim() && !files.length && !d.link) throw badRequest('Write something or add a photo / video.');

  for (const p of d.platforms) {
    const st = social.platformState(req.tenant, p);
    if (st.mode === 'live' && !st.connected) throw badRequest(`${p === 'facebook' ? 'Facebook Page' : 'Instagram'} is not connected (Settings).`);
    if (!st.igScopesOk) throw badRequest('Instagram was connected before posting was added. Connect Instagram again in Settings to allow posting.');
  }
  if (d.platforms.includes('instagram')) {
    if (!files.length) throw badRequest('Instagram posts need a photo or a video (text-only posts are not possible on Instagram).');
    if (d.text.length > 2200) throw badRequest('Instagram captions can be up to 2,200 characters.');
    for (const f of photos) {
      if (!/image\/(jpeg|png|webp|heic|heif)/.test(f.mimetype)) throw badRequest(`${f.originalname}: Instagram needs JPG photos.`);
      if (f.size > 8 * MB) throw badRequest(`${f.originalname}: Instagram photos can be up to 8 MB.`);
    }
    for (const f of videos) if (!/video\/(mp4|quicktime)/.test(f.mimetype)) throw badRequest(`${f.originalname}: Instagram needs MP4 or MOV videos.`);
  }
  if (d.platforms.includes('facebook')) for (const f of photos) if (f.size > fb.FB_PHOTO_MAX) throw badRequest(`${f.originalname}: Facebook photos can be up to 10 MB.`);

  let scheduledAt;
  if (d.scheduledAt) {
    scheduledAt = new Date(d.scheduledAt);
    if (scheduledAt.getTime() > Date.now() + 75 * 86400000) throw badRequest('Posts can be scheduled up to 75 days ahead.');
    if (scheduledAt.getTime() < Date.now() - 60000) scheduledAt = undefined; // in the past = now
  }
  // Keep the files (Cloudinary gives the public link Facebook / Instagram download from)
  const media = [];
  for (const f of files) {
    const stored = await saveFile({ tenantId: req.tenantId, buffer: f.buffer, fileName: f.originalname, mimeType: f.mimetype });
    media.push({ url: stored.url, type: f.mimetype.startsWith('video/') ? 'video' : 'image', mimeType: f.mimetype, fileName: f.originalname });
  }
  const post = await social.createPost({ tenant: req.tenant, user: req.user, text: d.text.trim(), link: d.link, media, platforms: d.platforms, scheduledAt });
  await audit(req, 'social.post', { targetType: 'SocialPost', targetId: post._id, meta: { platforms: d.platforms, scheduledAt: post.scheduledAt, media: media.length } });
  res.status(201).json(post);
});

const findPost = async (req) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw notFound('Post not found');
  const post = await SocialPost.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!post) throw notFound('Post not found');
  return post;
};

/** Cancel a scheduled post, or delete a posted one (Facebook: removed from the Page; Instagram: delete it in the Instagram app) */
router.delete('/posts/:id', authorize('admin'), async (req, res) => {
  const post = await findPost(req);
  if (post.status === 'scheduled') {
    await post.deleteOne();
    await audit(req, 'social.cancel', { targetType: 'SocialPost', targetId: post._id });
    return res.json({ ok: true, cancelled: true });
  }
  const notes = [];
  for (const t of post.targets) {
    if (t.status !== 'posted') continue;
    if (t.platform === 'facebook') await fb.deletePost(req.tenantId, t.externalId);
    else notes.push('Instagram posts can not be deleted from here: delete it in the Instagram app.');
  }
  post.status = 'deleted';
  await post.save();
  await audit(req, 'social.delete', { targetType: 'SocialPost', targetId: post._id });
  res.json({ ok: true, note: notes[0] || '' });
});

/** Try the failed platforms of a post again */
router.post('/posts/:id/retry', authorize('admin'), async (req, res) => {
  const post = await findPost(req);
  const failed = post.targets.filter((t) => t.status === 'failed');
  if (!failed.length) throw badRequest('Nothing to retry');
  for (const t of failed) Object.assign(t, { status: 'pending', error: undefined, attempts: 0, containerId: undefined });
  post.status = 'scheduled';
  post.scheduledAt = new Date();
  post.markModified('targets');
  await post.save();
  setImmediate(() => social.publishDue().catch(() => {}));
  res.json(post);
});

/** A post's comments (oldest first); ?sync=1 first reads them from Facebook / Instagram */
router.get('/posts/:id/comments', async (req, res) => {
  const post = await findPost(req);
  let synced = 0;
  if (req.query.sync === '1') synced = await social.syncPostComments(req.tenant, post);
  const items = await SocialComment.find({ tenantId: req.tenantId, socialPostId: post._id }).sort({ at: 1 }).populate('sentBy', 'name').lean();
  res.json({ post, items, synced });
});

// ---------- comments inbox ----------
router.get('/comments', async (req, res) => {
  const { platform, unread, search } = req.query;
  const filter = { tenantId: req.tenantId, deletedAt: null };
  if (platform === 'facebook' || platform === 'instagram') filter.platform = platform;
  if (unread === '1') Object.assign(filter, { readAt: null, fromBusiness: false });
  if (req.query.postId && mongoose.isValidObjectId(req.query.postId)) filter.socialPostId = req.query.postId;
  if (search) {
    const rx = { $regex: escapeRegex(search), $options: 'i' };
    filter.$or = [{ text: rx }, { 'from.name': rx }, { 'from.username': rx }];
  }
  const page = Math.max(1, Number(req.query.page) || 1);
  const [items, total, unreadCount] = await Promise.all([
    SocialComment.find(filter).sort({ at: -1 }).skip((page - 1) * 50).limit(50).populate('socialPostId', 'text media targets.platform targets.permalink').populate('sentBy', 'name').lean(),
    SocialComment.countDocuments(filter),
    SocialComment.countDocuments({ tenantId: req.tenantId, deletedAt: null, readAt: null, fromBusiness: false }),
  ]);
  res.json({ items, total, unread: unreadCount, page });
});

router.post('/comments/read', async (req, res) => {
  const { ids, all } = validate(z.object({ ids: z.array(z.string().refine(mongoose.isValidObjectId)).optional(), all: z.boolean().optional() }), req.body || {});
  res.json({ marked: await social.markRead(req.tenant, all ? 'all' : ids || []) });
});

const textBody = z.object({ text: z.string().trim().min(1, 'Write a reply').max(2000) });
const cid = (req) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw notFound('Comment not found');
  return req.params.id;
};

router.post('/comments/:id/reply', async (req, res) => {
  const { text } = validate(textBody, req.body);
  res.status(201).json(await social.replyToComment(req.tenant, req.user, cid(req), text));
});
router.post('/comments/:id/private-reply', async (req, res) => {
  const { text } = validate(textBody, req.body);
  res.json(await social.privateReply(req.tenant, cid(req), text));
});
router.post('/comments/:id/hide', async (req, res) => {
  const { hidden } = validate(z.object({ hidden: z.boolean() }), req.body);
  res.json(await social.setHidden(req.tenant, cid(req), hidden));
});
router.delete('/comments/:id', authorize('admin'), async (req, res) => {
  const c = await social.removeComment(req.tenant, cid(req));
  await audit(req, 'social.comment.delete', { targetType: 'SocialComment', targetId: c._id, meta: { platform: c.platform } });
  res.json(c);
});
router.post('/comments/:id/lead', async (req, res) => {
  const r = await social.commentToLead(req.tenant, req.user, cid(req));
  res.status(r.created ? 201 : 200).json(r);
});

// ---------- sandbox (no connected Page / account): pretend someone commented ----------
router.post('/sandbox/comment', async (req, res) => {
  const d = validate(z.object({ platform: z.enum(['facebook', 'instagram']), postId: z.string().refine(mongoose.isValidObjectId).optional(), name: z.string().trim().min(1).max(60), text: z.string().trim().min(1).max(500) }), req.body);
  if (social.platformState(req.tenant, d.platform).live) throw badRequest('Sandbox is off while a real account is connected');
  const post = d.postId ? await SocialPost.findOne({ _id: d.postId, tenantId: req.tenantId }) : await SocialPost.findOne({ tenantId: req.tenantId, 'targets.platform': d.platform, 'targets.status': 'posted' }).sort({ createdAt: -1 });
  const target = post?.targets.find((t) => t.platform === d.platform && t.externalId);
  if (!target) throw badRequest(`Post something on ${d.platform} first (sandbox)`);
  const handle = d.name.toLowerCase().replace(/[^a-z0-9_.]+/g, '.');
  const comment = await social.ingestComment(req.tenant, d.platform, {
    externalId: `MOCKCOMMENT${Date.now()}${Math.random().toString(16).slice(2, 6)}`,
    postExternalId: target.externalId,
    from: d.platform === 'facebook' ? { id: `MOCKFBUSER${handle}`, name: d.name } : { id: `MOCKIGSID${handle}`, username: handle },
    text: d.text,
    at: new Date(),
  });
  res.status(201).json(comment);
});

export default router;
