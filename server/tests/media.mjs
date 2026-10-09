// Sending files in a chat (web + app use the same API): WhatsApp's types and sizes
import fs from 'node:fs';
import path from 'node:path';
import { API, M, cleanup, crash, finish, newBusiness, ok, processInbound, stamp } from './lib.mjs';

const tids = [];
try {
  const b = await newBusiness('Media Co', { coaching: false });
  tids.push(b.id);
  await processInbound(await M.Tenant.findById(b.id), { id: `wamid.MD.${stamp}`, from: '919811100001', type: 'text', text: { body: 'hi' }, timestamp: String(Math.floor(Date.now() / 1000)) }, 'Asha');
  const conv = await M.Conversation.findOne({ tenantId: b.id });
  const dir = path.resolve('uploads', String(b.id));
  const filesNow = () => (fs.existsSync(dir) ? fs.readdirSync(dir).length : 0);
  const send = async (name, type, bytes = 2000, extra = {}) => {
    const fd = new FormData();
    fd.append('file', new Blob([Buffer.alloc(bytes, 1)], type ? { type } : {}), name);
    for (const [k, v] of Object.entries(extra)) fd.append(k, v);
    const r = await fetch(`${API}/conversations/${conv._id}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${b.tok}` }, body: fd });
    return { ...(await r.json()), status: r.status };
  };

  let r = await send('photo.jpg', 'image/jpeg', 2000, { caption: 'Our classroom' });
  ok(r.status === 201 && r.type === 'image' && r.media.caption === 'Our classroom' && r.media.url?.startsWith('/uploads/'), 'JPG photo with caption sent', r.error);
  const img = await fetch(API.replace('/api', '') + r.media.url);
  ok(img.status === 200, 'Sent photo is served back to the chat (/uploads)');
  ok((await send('logo.png', 'image/png')).status === 201, 'PNG photo sent');
  r = await send('brochure.pdf', 'application/pdf', 4000);
  ok(r.status === 201 && r.type === 'document' && r.media.fileName === 'brochure.pdf', 'PDF document sent');
  ok((await send('fees.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).status === 201, 'Word document sent');
  r = await send('timetable.xlsx', 'application/octet-stream');
  ok(r.status === 201 && r.media.mimeType.includes('spreadsheetml'), 'Unknown type from the phone → taken from the file name (.xlsx)', r.error);
  ok((await send('demo.mp4', 'video/mp4', 5000)).type === 'video', 'MP4 video sent');

  const before = filesNow();
  r = await send('IMG_1234.HEIC', 'image/heic');
  ok(r.status === 400 && /HEIC/.test(r.error), 'iPhone HEIC photo → clear message', r.error);
  r = await send('IMG_5678.MOV', 'video/quicktime');
  ok(r.status === 400 && /MOV/.test(r.error), 'iPhone MOV video → clear message', r.error);
  r = await send('notes.zip', 'application/zip');
  ok(r.status === 400 && /PDF, Word/.test(r.error), 'ZIP → "only PDF, Word, Excel…"', r.error);
  r = await send('big.jpg', 'image/jpeg', 6 * 1024 * 1024);
  ok(r.status === 400 && /5 MB/.test(r.error), 'Photo over 5 MB → clear message', r.error);
  r = await send('huge.pdf', 'application/pdf', 17 * 1024 * 1024);
  ok(r.status === 400, 'File over 16 MB → refused', r.error);
  ok(filesNow() === before, 'Refused files are not stored on the server');

  await M.Conversation.updateOne({ _id: conv._id }, { $set: { lastInboundAt: new Date(Date.now() - 25 * 3600 * 1000) } });
  r = await send('late.jpg', 'image/jpeg');
  ok(r.status === 400 && /24-hour/.test(r.error), '24h window closed → only templates', r.error);
} catch (e) {
  crash(e);
} finally {
  for (const t of tids) fs.rmSync(path.resolve('uploads', String(t)), { recursive: true, force: true });
  await cleanup(tids);
  finish();
}
