// File storage: local disk or Cloudinary (Cloudinary's API is faked in this process)
import axios from 'axios';
import fs from 'node:fs';
import path from 'node:path';
import { crash, finish, ok } from './lib.mjs';

const S = await import(new URL('../src/services/storage.js', import.meta.url).pathname);
const calls = [];
let failNext = false;
axios.defaults.adapter = async (config) => {
  const fields = {};
  for (const [k, v] of config.data.entries()) fields[k] = typeof v === 'string' ? v : `[file ${v.size} bytes]`;
  calls.push({ url: config.url, fields });
  if (failNext) {
    failNext = false;
    const e = new Error('Request failed with status code 400');
    e.response = { status: 400, data: { error: { message: 'File size too large. Got 12000000. Maximum is 10485760.' } } };
    throw e;
  }
  const type = config.url.split('/').slice(-2)[0];
  return { data: { secure_url: `https://res.cloudinary.com/demo/${type}/upload/v1/${fields.folder}/${fields.public_id}` }, status: 200, statusText: 'OK', headers: {}, config };
};
const saved = [];
const set = (o) => Object.assign(process.env, o);
try {
  // Cloudinary's documented example signature
  ok(S.cloudinarySignature({ public_id: 'sample_image', timestamp: 1315060510 }, 'abcd') === 'b4ad47fb4e25c7bf5f92a20089f9db59bc302313', 'Signature matches Cloudinary\'s documented example');
  ok(S.cloudinaryResourceType('image/png') === 'image' && S.cloudinaryResourceType('video/mp4') === 'video' && S.cloudinaryResourceType('audio/mpeg') === 'video' && S.cloudinaryResourceType('application/pdf') === 'raw', 'Photo → image, video/audio → video, documents → raw');

  set({ STORAGE_DRIVER: 'cloudinary', CLOUDINARY_CLOUD_NAME: '', CLOUDINARY_API_KEY: '', CLOUDINARY_API_SECRET: '' });
  ok(S.storageDriver() === 'local', 'Keys not filled yet → keeps working on the local disk');
  let r = await S.saveFile({ tenantId: 'T1', buffer: Buffer.from('x'), fileName: 'a.pdf', mimeType: 'application/pdf' });
  saved.push(r.url);
  ok(r.provider === 'local' && r.url.startsWith('/uploads/T1/') && r.url.endsWith('.pdf') && calls.length === 0, 'Local file saved, nothing sent to Cloudinary');

  set({ CLOUDINARY_CLOUD_NAME: 'demo', CLOUDINARY_API_KEY: '123456', CLOUDINARY_API_SECRET: 'shh', CLOUDINARY_FOLDER: 'crm-test' });
  ok(S.storageDriver() === 'cloudinary', 'Keys filled → Cloudinary');
  r = await S.saveFile({ tenantId: 'T1', buffer: Buffer.alloc(2000), fileName: 'class photo.jpg', mimeType: 'image/jpeg' });
  const c = calls.at(-1);
  const expected = S.cloudinarySignature({ folder: c.fields.folder, public_id: c.fields.public_id, timestamp: c.fields.timestamp }, 'shh');
  ok(r.provider === 'cloudinary' && r.url.startsWith('https://res.cloudinary.com/') && c.url === 'https://api.cloudinary.com/v1_1/demo/image/upload', 'Photo uploaded to Cloudinary (image endpoint), https link returned');
  ok(c.fields.api_key === '123456' && c.fields.signature === expected && c.fields.folder === 'crm-test/T1' && /^[a-f0-9]{24}$/.test(c.fields.public_id) && !('api_secret' in c.fields), 'Signed upload: key + signature, folder per business, random name, secret never sent');
  r = await S.saveFile({ tenantId: 'T1', buffer: Buffer.alloc(3000), fileName: 'Fees 2026.pdf', mimeType: 'application/pdf' });
  ok(calls.at(-1).url.endsWith('/raw/upload') && /\.pdf$/.test(calls.at(-1).fields.public_id), 'PDF → raw upload, keeps .pdf so it opens');
  failNext = true;
  r = await S.saveFile({ tenantId: 'T1', buffer: Buffer.alloc(1000), fileName: 'big.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  saved.push(r.url);
  ok(r.provider === 'local' && r.url.startsWith('/uploads/T1/'), 'Cloudinary refuses (e.g. size limit) → kept on the server, sending does not fail');
} catch (e) {
  crash(e);
} finally {
  for (const u of saved) if (u?.startsWith('/uploads/')) fs.rmSync(path.resolve(u.slice(1)), { force: true });
  fs.rmSync(path.resolve('uploads', 'T1'), { recursive: true, force: true });
  finish();
}
