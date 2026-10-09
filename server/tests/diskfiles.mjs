// Disk waiting room: a file Cloudinary refused stays on disk, uploads later by itself, admin alerts, admin open / retry / delete
// (Cloudinary's API is faked in this process; the admin routes run on the test API, which has no Cloudinary keys)
process.env.PUSH_DISABLED = 'true';
import axios from 'axios';
import fs from 'node:fs';
import path from 'node:path';
import { M, S as SRC, call, cleanup, crash, finish, newBusiness, ok, signToken, stamp } from './lib.mjs';

const S = await import(SRC + 'services/storage.js');
let mode = 'ok'; // ok | permanent | temporary
axios.defaults.adapter = async (config) => {
  if (mode !== 'ok') {
    const e = new Error('Request failed');
    e.response = mode === 'permanent' ? { status: 400, data: { error: { message: 'File size too large. Maximum is 10485760.' } } } : { status: 503, data: { error: { message: 'Service unavailable' } } };
    throw e;
  }
  return { data: { secure_url: `https://res.cloudinary.com/demo/raw/upload/v1/x/${Date.now()}.pdf` }, status: 200, statusText: 'OK', headers: {}, config };
};
const set = (o) => Object.assign(process.env, o);
const keys = { STORAGE_DRIVER: 'cloudinary', CLOUDINARY_CLOUD_NAME: 'demo', CLOUDINARY_API_KEY: '123', CLOUDINARY_API_SECRET: 'shh' };
const later = (min) => new Date(Date.now() + min * 60 * 1000);
const onDisk = (url) => fs.existsSync(path.resolve(url.slice(1)));
const tids = [];

try {
  const biz = await newBusiness(`Disk ${stamp}`);
  tids.push(biz.id);
  const T = biz.id;
  const contact = await M.Contact.create({ tenantId: T, phone: `9199${String(stamp).slice(-8)}`, name: 'Disk Test (temp)' });
  const conv = await M.Conversation.create({ tenantId: T, contactId: contact._id });
  // A sent file that Cloudinary refused for now → kept on disk + queued
  const sendFile = async (name, error = 'Service unavailable') => {
    mode = 'temporary';
    const stored = await S.saveFile({ tenantId: T, buffer: Buffer.alloc(2048), fileName: name, mimeType: 'application/pdf' });
    const msg = await M.Message.create({ tenantId: T, conversationId: conv._id, contactId: contact._id, direction: 'outbound', type: 'document', media: { url: stored.url, fileName: name, mimeType: 'application/pdf' } });
    const f = await S.keepForRetry({ tenantId: T, messageId: msg._id, contactId: contact._id, url: stored.url, fileName: name, mimeType: 'application/pdf', size: 2048, direction: 'sent', error });
    return { stored, msg, f };
  };

  set({ ...keys, DISK_ALERT_FILES: '3', DISK_ALERT_MB: '500' });
  // 1. Upload fails → disk + queue; later it uploads, chat link changes, disk copy is removed
  const a = await sendFile('fees.pdf');
  ok(a.stored.waiting && a.stored.url.startsWith(`/uploads/${T}/`) && onDisk(a.stored.url), 'Cloudinary down → file kept on the server disk (chat still works)');
  ok(a.f && a.f.status === 'pending' && a.f.nextTryAt > new Date(), 'Queued to upload again in a few minutes');
  mode = 'ok';
  let r = await S.retryDiskFiles(later(10), { tenantId: T });
  const msgA = await M.Message.findById(a.msg._id);
  ok(r.done === 1 && msgA.media.url.startsWith('https://res.cloudinary.com/'), 'Cloudinary back → uploaded, chat now points to the cloud link');
  ok(!onDisk(a.stored.url) && !(await M.DiskFile.exists({ _id: a.f._id })), 'Disk copy and queue entry removed automatically');

  // 2. Temporary error → backoff, still pending
  const b = await sendFile('notes.pdf');
  mode = 'temporary';
  r = await S.retryDiskFiles(later(10), { tenantId: T });
  let fb = await M.DiskFile.findById(b.f._id);
  ok(fb.status === 'pending' && fb.attempts === 1 && fb.nextTryAt > later(10) && onDisk(b.stored.url), 'Network hiccup → tries again later (backoff), file stays safe');

  // 3. Permanent error (too big) → failed + one admin alert
  const c = await sendFile('huge.pdf');
  mode = 'permanent';
  await S.retryDiskFiles(later(10), { tenantId: T });
  const fc = await M.DiskFile.findById(c.f._id);
  const failAlerts = await M.Notification.find({ tenantId: T, key: `storage:failed:${c.f._id}` });
  ok(fc.status === 'failed' && /too large/.test(fc.lastError), 'Cloudinary refuses for good (size) → marked "needs you"');
  ok(failAlerts.length === 1 && failAlerts[0].kind === 'storage' && String(failAlerts[0].userId) === String(biz.admin._id), 'Admin gets an alert for that file');

  // 4. Usage over the limit (3 files) → one alert a day
  ok((await M.Notification.countDocuments({ tenantId: T, key: 'storage:usage' })) === 0, 'No usage alert below the limit');
  await sendFile('d.pdf');
  await new Promise((res) => setTimeout(res, 300));
  await S.checkDiskAlert(T);
  ok((await M.Notification.countDocuments({ tenantId: T, key: 'storage:usage' })) === 1, 'Too many files on disk → admin alerted once (not again the same day)');

  // 5. Keys removed from .env → config alert, deduped
  set({ CLOUDINARY_API_SECRET: '' });
  await M.DiskFile.updateMany({ tenantId: T, status: 'pending' }, { $set: { nextTryAt: new Date() } });
  await S.retryDiskFiles(later(1), { tenantId: T });
  await M.DiskFile.updateMany({ tenantId: T, status: 'pending' }, { $set: { nextTryAt: new Date() } });
  await S.retryDiskFiles(later(1), { tenantId: T });
  fb = await M.DiskFile.findById(b.f._id);
  ok((await M.Notification.countDocuments({ tenantId: T, key: 'storage:config' })) === 1 && fb.nextTryAt > later(50), 'Cloudinary keys missing → one "check .env" alert, next try in an hour');

  // 6. Admin panel (API)
  let list = await call(biz.tok, 'GET', '/settings/disk-files');
  ok(list.status === 200 && list.items.length === 3 && list.usage.files === 3 && list.usage.failed === 1, 'Admin sees every waiting file with totals', JSON.stringify(list.usage));
  const item = list.items.find((x) => String(x._id) === String(c.f._id));
  ok(item.fileName === 'huge.pdf' && item.contactId?.name === 'Disk Test (temp)' && item.url === c.stored.url && item.lastError, 'Each file shows name, customer, reason and an open link');
  const open = await fetch(process.env.TEST_FILES || `http://localhost:4100${item.url}`);
  ok(open.status === 200 && (await open.arrayBuffer()).byteLength === 2048, 'Admin can open the file');

  const agent = await M.User.create({ tenantId: T, name: 'Agent (temp)', email: `diskagent${stamp}@temp.local`, role: 'agent' });
  const atok = signToken(agent);
  ok((await call(atok, 'GET', '/settings/disk-files')).status === 403 && (await call(atok, 'DELETE', '/settings/disk-files', { ids: [String(c.f._id)] })).status === 403, 'Counsellors can not see or delete them (admin only)');

  const other = await newBusiness(`Disk other ${stamp}`);
  tids.push(other.id);
  const cross = await call(other.tok, 'DELETE', '/settings/disk-files', { ids: [String(c.f._id)] });
  ok(cross.deleted === 0 && onDisk(c.stored.url), 'Another business can not delete these files');

  r = await call(biz.tok, 'POST', '/settings/disk-files/retry', { ids: [String(c.f._id)] });
  ok(r.status === 200 && r.queued === 1 && r.done === 0, 'Retry now works (still waiting while the test API has no Cloudinary keys)');

  r = await call(biz.tok, 'DELETE', '/settings/disk-files', { ids: [String(c.f._id)] });
  const msgC = await M.Message.findById(c.msg._id);
  ok(r.deleted === 1 && !onDisk(c.stored.url) && !(await M.DiskFile.exists({ _id: c.f._id })), 'Admin delete removes the file from the disk');
  ok(msgC.media.removed === true && msgC.media.url === '' && r.usage.files === 2, 'Chat shows "file removed by admin", totals update');
  const audit = await M.AuditLog.findOne({ tenantId: T, action: 'storage.delete' });
  ok(!!audit, 'Delete is written to the audit log');
} catch (e) {
  crash(e);
} finally {
  for (const f of await M.DiskFile.find({ tenantId: { $in: tids } })) fs.rmSync(path.resolve('uploads', f.path), { force: true });
  for (const t of tids) fs.rmSync(path.resolve('uploads', String(t)), { recursive: true, force: true });
  await cleanup(tids);
  finish();
}
