/**
 * Where chat files (photos, PDFs… sent or received on WhatsApp) are kept so the CRM can show them later.
 *
 *   STORAGE_DRIVER=local       server/uploads/ only (development)
 *   STORAGE_DRIVER=cloudinary  CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
 *                              (+ optional CLOUDINARY_FOLDER, default "whatsapp-crm")
 *
 * With a cloud driver the disk is only a waiting room: a file whose cloud upload fails is kept on disk
 * (the chat works as usual), the worker uploads it again later and deletes the disk copy once it is in
 * the cloud. Files that can not go up by themselves are marked "failed" and the admins are alerted;
 * they can open, retry or delete them in Settings → Disk files. Too many waiting files also alerts them.
 * Moving to S3 later = one more driver here.
 */
import axios from 'axios';
import mongoose from 'mongoose';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DiskFile, Message, User } from '../models/index.js';

const env = () => ({
  driver: (process.env.STORAGE_DRIVER || 'local').toLowerCase(),
  cloud: process.env.CLOUDINARY_CLOUD_NAME || '',
  key: process.env.CLOUDINARY_API_KEY || '',
  secret: process.env.CLOUDINARY_API_SECRET || '',
  folder: (process.env.CLOUDINARY_FOLDER || 'whatsapp-crm').replace(/^\/+|\/+$/g, ''),
});

/** The driver in .env ("cloudinary" even when its keys are still empty) */
export const wantedDriver = () => (env().driver === 'cloudinary' ? 'cloudinary' : 'local');
const cloudReady = () => {
  const e = env();
  return !!(e.cloud && e.key && e.secret);
};
/** The driver that can work right now */
export const storageDriver = () => (wantedDriver() === 'cloudinary' && cloudReady() ? 'cloudinary' : 'local');

const safeName = (name = 'file') => String(name).replace(/[^\w.\-]+/g, '_').slice(-80) || 'file';
const extOf = (name = '') => path.extname(safeName(name)).toLowerCase();

async function saveLocal({ tenantId, buffer, fileName }) {
  const rel = path.join(String(tenantId), `${crypto.randomBytes(10).toString('hex')}${extOf(fileName)}`);
  await fs.mkdir(path.resolve('uploads', String(tenantId)), { recursive: true });
  await fs.writeFile(path.resolve('uploads', rel), buffer);
  return { url: `/uploads/${rel.split(path.sep).join('/')}`, provider: 'local' };
}

/** Cloudinary signature: sha1 of the sorted "key=value&…" params + the API secret */
export function cloudinarySignature(params, secret) {
  const base = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== '')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return crypto.createHash('sha1').update(base + secret).digest('hex');
}

/** image | video (also audio) | raw (documents) */
export const cloudinaryResourceType = (mimeType = '') => (mimeType.startsWith('image/') ? 'image' : mimeType.startsWith('video/') || mimeType.startsWith('audio/') ? 'video' : 'raw');

async function saveCloudinary({ tenantId, buffer, fileName, mimeType }) {
  const e = env();
  const resourceType = cloudinaryResourceType(mimeType);
  // Random, unguessable name in a folder per business; documents keep their extension (needed to open them)
  const publicId = `${crypto.randomBytes(12).toString('hex')}${resourceType === 'raw' ? extOf(fileName) : ''}`;
  const params = { folder: `${e.folder}/${tenantId}`, public_id: publicId, timestamp: Math.floor(Date.now() / 1000) };
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType || 'application/octet-stream' }), safeName(fileName));
  for (const [k, v] of Object.entries(params)) form.append(k, String(v));
  form.append('api_key', e.key);
  form.append('signature', cloudinarySignature(params, e.secret));
  const res = await axios.post(`https://api.cloudinary.com/v1_1/${e.cloud}/${resourceType}/upload`, form, { timeout: 60000, maxBodyLength: Infinity });
  if (!res.data?.secure_url) throw new Error('Cloudinary did not return a URL');
  return { url: res.data.secure_url, provider: 'cloudinary' };
}

/**
 * Keep a file. Returns { url, provider, waiting } — url is absolute (https://…) for cloud storage,
 * or "/uploads/…" on this server. waiting = kept on disk because the cloud upload failed:
 * call keepForRetry() once the message exists, so the worker uploads it later.
 */
export async function saveFile({ tenantId, buffer, fileName, mimeType }) {
  if (wantedDriver() === 'cloudinary') {
    if (cloudReady()) {
      try {
        return { ...(await saveCloudinary({ tenantId, buffer, fileName, mimeType })), waiting: false };
      } catch (err) {
        const reason = errorText(err);
        console.warn('[storage] Cloudinary upload failed, kept on this server for now:', reason);
        return { ...(await saveLocal({ tenantId, buffer, fileName })), waiting: true, error: reason, size: buffer.length };
      }
    }
    return { ...(await saveLocal({ tenantId, buffer, fileName })), waiting: true, error: 'Cloudinary keys are not set in .env yet', size: buffer.length };
  }
  return { ...(await saveLocal({ tenantId, buffer, fileName })), waiting: false };
}

const errorText = (err) => err.response?.data?.error?.message || err.message || 'Upload failed';

/** Will this error go away by itself? size / format = never; wrong keys = only after a fix in .env */
export function classifyError(err) {
  const status = err?.response?.status;
  const text = errorText(err);
  if (status === 401 || status === 403 || /api[_ ]?key|cloud[_ ]?name|signature|not set in \.env/i.test(text)) return 'config';
  if (status === 400 && /size|too large|maximum|invalid|unsupported|format/i.test(text)) return 'permanent';
  return 'temporary';
}

/** Remember a disk file that still has to go to the cloud */
export async function keepForRetry({ tenantId, messageId, contactId, url, fileName, mimeType, size, direction = 'sent', error = '' }) {
  if (!url?.startsWith('/uploads/')) return null;
  const doc = await DiskFile.create({ tenantId, messageId, contactId, path: url.slice('/uploads/'.length), fileName, mimeType, size, direction, lastError: error, nextTryAt: new Date(Date.now() + 5 * 60 * 1000) });
  checkDiskAlert(tenantId).catch(() => {});
  return doc;
}

const BACKOFF_MIN = [5, 15, 60, 180, 360, 720, 1440]; // after attempt n
const MAX_ATTEMPTS = 10;
const fullPath = (rel) => path.resolve('uploads', rel);

/** One worker run: upload waiting disk files (a few at a time), delete the disk copy when done */
export async function retryDiskFiles(now = new Date(), { limit = 20, tenantId } = {}) {
  if (wantedDriver() !== 'cloudinary') return { done: 0, failed: 0 };
  const due = await DiskFile.find({ status: 'pending', nextTryAt: { $lte: now }, ...(tenantId && { tenantId }) }).sort({ nextTryAt: 1 }).limit(limit);
  let done = 0;
  let failed = 0;
  for (const f of due) {
    let buffer;
    try {
      buffer = await fs.readFile(fullPath(f.path));
    } catch {
      await f.deleteOne(); // copy no longer on disk (deleted by hand): nothing to upload
      continue;
    }
    try {
      if (!cloudReady()) throw new Error('Cloudinary keys are not set in .env yet');
      const up = await saveCloudinary({ tenantId: f.tenantId, buffer, fileName: f.fileName, mimeType: f.mimeType });
      if (f.messageId) {
        await Message.updateOne({ _id: f.messageId, 'media.url': `/uploads/${f.path}` }, { $set: { 'media.url': up.url } });
        const m = await Message.findById(f.messageId);
        if (m) emitUpdate(m);
      }
      await fs.rm(fullPath(f.path), { force: true });
      await f.deleteOne();
      done += 1;
    } catch (err) {
      const kind = classifyError(err);
      f.attempts += 1;
      f.lastError = errorText(err);
      if (kind === 'permanent' || f.attempts >= MAX_ATTEMPTS) {
        f.status = 'failed';
        failed += 1;
        await alertAdmins(f.tenantId, `File not saved to Cloudinary: ${f.fileName || 'file'}`, `${f.lastError}. It is kept on this server: open, retry or delete it in Settings → Disk files.`, `failed:${f._id}`);
      } else {
        // Wrong / missing keys: try again in an hour (no point sooner)
        f.nextTryAt = new Date(now.getTime() + (kind === 'config' ? 60 : BACKOFF_MIN[Math.min(f.attempts - 1, BACKOFF_MIN.length - 1)]) * 60 * 1000);
        if (kind === 'config') await alertAdmins(f.tenantId, 'Files are waiting: Cloudinary is not working', `${f.lastError}. Check CLOUDINARY_* in .env. Files stay on this server until then (Settings → Disk files).`, 'config');
      }
      await f.save();
    }
  }
  const tenants = [...new Set(due.map((f) => String(f.tenantId)))];
  for (const t of tenants) await checkDiskAlert(t).catch(() => {});
  return { done, failed };
}

// Message updated live in open chats (lazy import: messaging imports this service's users indirectly)
async function emitUpdate(message) {
  const { emitMessageUpdate } = await import('./messaging.js');
  await emitMessageUpdate(message).catch(() => {});
}

const LIMIT_FILES = () => Number(process.env.DISK_ALERT_FILES) || 100;
const LIMIT_MB = () => Number(process.env.DISK_ALERT_MB) || 500;

/** Files / MB waiting on disk for one business */
export async function diskUsage(tenantId) {
  const [row] = await DiskFile.aggregate([
    { $match: { tenantId: new mongoose.Types.ObjectId(String(tenantId)) } },
    { $group: { _id: null, files: { $sum: 1 }, bytes: { $sum: '$size' }, failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } } } },
  ]);
  return { files: row?.files || 0, bytes: row?.bytes || 0, failed: row?.failed || 0 };
}

/** Too many files waiting → alert the admins (at most once a day) */
export async function checkDiskAlert(tenantId) {
  const u = await diskUsage(tenantId);
  if (u.files >= LIMIT_FILES() || u.bytes >= LIMIT_MB() * 1024 * 1024) {
    await alertAdmins(tenantId, `${u.files} file(s) waiting on the server disk`, `${(u.bytes / 1024 / 1024).toFixed(1)} MB not saved to Cloudinary yet. Check Settings → Disk files.`, 'usage');
  }
  return u;
}

/** Alert every admin of the business (bell + phone); the same alert at most once in 24 h */
async function alertAdmins(tenantId, title, body, dedupeKey) {
  const { Notification } = await import('../models/index.js');
  const key = `storage:${dedupeKey}`;
  if (await Notification.exists({ tenantId, key, createdAt: { $gte: new Date(Date.now() - 24 * 3600 * 1000) } })) return;
  const admins = await User.find({ tenantId, role: 'admin', isActive: true }).select('_id').lean();
  if (!admins.length) return;
  const { notify } = await import('./alerts.js');
  await notify(tenantId, { to: admins.map((a) => a._id), kind: 'storage', title, body, key, url: '/disk-files' });
}

/** Admin: delete kept copies for good; the chat shows "file removed" */
export async function deleteDiskFiles(tenantId, ids) {
  const files = await DiskFile.find({ tenantId, _id: { $in: ids } });
  for (const f of files) {
    await fs.rm(fullPath(f.path), { force: true });
    if (f.messageId) {
      await Message.updateOne({ _id: f.messageId, 'media.url': `/uploads/${f.path}` }, { $set: { 'media.url': '', 'media.removed': true } });
      const m = await Message.findById(f.messageId);
      if (m) emitUpdate(m);
    }
    await f.deleteOne();
  }
  return files.length;
}

let timer = null;
/** Every 5 minutes: try the waiting files again */
export function startStorageWorker() {
  if (timer) return;
  const run = () => retryDiskFiles().then((r) => r.done && console.log(`[storage] ${r.done} file(s) moved from disk to Cloudinary`)).catch((err) => console.error('[storage] worker', err.message));
  timer = setInterval(run, 5 * 60 * 1000);
  setTimeout(run, 30 * 1000);
}
