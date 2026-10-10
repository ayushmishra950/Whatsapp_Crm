/**
 * Shared setup for the end-to-end tests (local dev database only — never production).
 * Needs the API running on http://localhost:4100 against the local dev DB:
 *   MONGO_URI= PORT=4100 LOGIN_RATE_LIMIT=500 PUSH_DISABLED=true CLOUDINARY_CLOUD_NAME= CLOUDINARY_API_KEY= CLOUDINARY_API_SECRET= node src/index.js
 * (empty CLOUDINARY_* = test files never go to the real Cloudinary account)
 * Run one test:  node tests/walkin.mjs     Run all: node tests/run.mjs
 */
import { rmSync } from 'node:fs';
import mongoose from 'mongoose';
import ExcelJS from 'exceljs';

const LOCAL = 'mongodb://127.0.0.1:27018/whatsapp_crm';
export const S = new URL('../src/', import.meta.url).pathname;
await mongoose.connect(process.env.TEST_MONGO_URI || LOCAL);
if (!/127\.0\.0\.1|localhost/.test(mongoose.connection.host)) throw new Error('Tests only run on a local database');

export const M = await import(S + 'models/index.js');
export const { signToken } = await import(S + 'middleware/auth.js');
export const { processInbound } = await import(S + 'services/webhookProcessor.js');
export { mongoose, ExcelJS };

export const API = process.env.TEST_API || 'http://localhost:4100/api';
export const stamp = Date.now();
let pass = 0;
let fail = 0;
export const ok = (c, n, x = '') => {
  c ? pass++ : fail++;
  console.log(`${c ? '✅' : '❌'} ${n}${!c && x ? ' → ' + x : ''}`);
};
export const crash = (e) => {
  fail++;
  console.error('CRASH', e);
};
/** fetch the API: returns the JSON plus status (arrays are under _json) */
export const call = async (tok, m, p, b) => {
  const r = await fetch(API + p, { method: m, headers: { 'Content-Type': 'application/json', ...(tok && { Authorization: `Bearer ${tok}` }) }, body: b && JSON.stringify(b) });
  const j = await r.json().catch(() => ({}));
  return { ...j, status: r.status, _json: j };
};
export const login = (email, password, extra = {}) => call(null, 'POST', '/auth/login', { email, password, ...extra });
export const sa = signToken(await M.User.findOne({ role: 'super_admin' }));
export const plan = await M.Plan.findOne({ name: 'Growth' });
export const wait = (ms = 250) => new Promise((r) => setTimeout(r, ms));

/** Remove test businesses and logins */
export async function cleanup(tids = []) {
  for (const tid of tids.filter(Boolean)) {
    for (const m of ['Contact', 'Conversation', 'Message', 'Course', 'Task', 'Notification', 'Drip', 'DripEnrollment', 'Template', 'AdSource', 'User', 'AuditLog', 'Chatbot', 'SavedView', 'Campaign', 'Segment', 'DiskFile', 'SocialPost', 'SocialComment']) if (M[m]) await M[m].deleteMany({ tenantId: tid });
    await M.Tenant.deleteOne({ _id: tid });
    rmSync(new URL(`../uploads/${tid}`, import.meta.url), { recursive: true, force: true }); // files a test business saved
  }
  await M.User.deleteMany({ email: /temp\.local$/, tenantId: null });
  await M.Account.deleteMany({ email: /temp\.local$/ });
}
export function finish() {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
/** New coaching / general business through the Super Admin API, in mock WhatsApp mode */
export async function newBusiness(name, { coaching = true, admin } = {}) {
  const r = await call(sa, 'POST', '/superadmin/tenants', { name: `(temp) ${name}`, planId: String(plan._id), businessType: coaching ? 'coaching' : 'general', sampleCourses: coaching, admin: admin || { name: `${name} Admin`, email: `${name.replace(/\W/g, '').toLowerCase()}${stamp}@temp.local`, password: 'Temp@12345' } });
  if (!r._id) throw new Error(`create business failed: ${r.error}`);
  await M.Tenant.updateOne({ _id: r._id }, { $set: { 'whatsapp.mode': 'mock', 'whatsapp.phoneNumberId': `T${stamp}${Math.random().toString(36).slice(2, 7)}`, 'settings.automation.quietStart': '00:00', 'settings.automation.quietEnd': '00:00', 'settings.automation.maxPerContactPerDay': 9 } });
  const adminUser = await M.User.findOne({ tenantId: r._id, role: 'admin' });
  const tok = signToken(adminUser);
  // Never put test files on the real Cloudinary account (.env has the real keys)
  const disk = await call(tok, 'GET', '/settings/disk-files');
  if (disk.storage?.active !== 'local') {
    await cleanup([r._id]);
    throw new Error('The test API is using real Cloudinary keys. Start it with empty CLOUDINARY_* (see the command at the top of tests/lib.mjs).');
  }
  return { id: r._id, tok, admin: adminUser };
}
