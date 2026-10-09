// Walk-in quick add, lead history, Excel import (only phone + name required)
import { API, ExcelJS, M, call, cleanup, crash, finish, newBusiness, ok, processInbound, stamp, wait } from './lib.mjs';

const tids = [];
try {
  const b = await newBusiness('Walkin Academy');
  tids.push(b.id);
  await M.Drip.updateMany({ tenantId: b.id }, { $set: { status: 'active' } });
  let r = await call(b.tok, 'POST', '/contacts/quick', { name: 'Aman Walk', phone: '98115 00101' });
  ok(r.status === 201 && r.welcome === 'no_template' && r.contact.phone === '919811500101' && r.contact.tags.includes('walk-in'), 'Walk-in saved with name + 10-digit mobile (+91); no template → not sent');
  ok((await call(b.tok, 'POST', '/contacts/quick', { name: '', phone: '9811500102' })).status === 400, 'Name required');
  await M.Template.updateMany({ tenantId: b.id, name: /^walkin_welcome_/ }, { $set: { status: 'approved' } });
  r = await call(b.tok, 'POST', '/contacts/quick', { name: 'Sneha Gupta', phone: '9811500103', course: 'DM', language: 'hi', note: 'Came with father' });
  const sneha = r.contact;
  const sent = await M.Message.findOne({ contactId: sneha._id, type: 'template' }).lean();
  ok(r.welcome === 'sent' && sent?.template?.name === 'walkin_welcome_hi', 'Welcome sent at once in Hinglish');
  r = await call(b.tok, 'POST', '/contacts/quick', { name: 'Other', phone: '919811500103', course: 'PY' });
  ok(r.status === 200 && !r.created && r.contact.name === 'Sneha Gupta' && r.contact.course === 'PY', 'Same number again → updated, not duplicated');
  await wait(400);
  ok(!!(await M.DripEnrollment.exists({ contactId: sneha._id })), 'Walk-in starts the new-lead drips');

  await call(b.tok, 'PATCH', `/contacts/${sneha._id}`, { leadStatus: 'hot' });
  await call(b.tok, 'POST', `/contacts/${sneha._id}/calls`, { outcome: 'connected', note: 'Weekend batch', nextAt: new Date(Date.now() + 864e5).toISOString(), nextTitle: 'Send batch dates' });
  await processInbound(await M.Tenant.findById(b.id), { id: `wamid.W.${stamp}.1`, from: '919811500103', type: 'text', text: { body: 'weekend batch kab se hai?' }, timestamp: String(Math.floor(Date.now() / 1000)) }, 'Sneha');
  await wait(300);
  r = await call(b.tok, 'GET', `/contacts/${sneha._id}/history`);
  const kinds = new Set(r.events.map((e) => e.kind));
  ok(['start', 'visit', 'template', 'status', 'call', 'task', 'drip', 'course'].every((k) => kinds.has(k)), 'History: enquiry, visit, welcome, status, call, task, drip, course change', [...kinds].join(','));
  ok(!kinds.has('customer') && r.stats.inbound >= 1 && r.openTasks.length === 1, 'Chat hidden by default; stats + open task');
  r = await call(b.tok, 'GET', `/contacts/${sneha._id}/history?chat=true`);
  ok(r.events.some((e) => e.kind === 'customer'), 'With chat: customer message listed');

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('S');
  ws.addRow(['Mobile', 'Student name', 'Course']);
  ws.addRow(['9811600201', 'Full Detail', 'Digital Marketing']);
  ws.addRow(['9811600202', '', '']);
  ws.addRow(['9811600203', 'Only Name', '']);
  const buf = await wb.xlsx.writeBuffer();
  const send = async (opts) => {
    const fd = new FormData();
    fd.append('file', new Blob([buf]), 'old.xlsx');
    fd.append('options', JSON.stringify(opts));
    const res = await fetch(API + '/contacts/import', { method: 'POST', headers: { Authorization: `Bearer ${b.tok}` }, body: fd });
    return { status: res.status, ...(await res.json()) };
  };
  ok((await send({ mapping: { phone: 'Mobile' }, startDrips: false })).status === 400, 'Import without a name column → refused');
  r = await send({ mapping: { phone: 'Mobile', name: 'Student name', course: 'Course' }, startDrips: false });
  ok(r.created === 3 && r.noName === 1, 'Half-filled rows import; missing name reported');
} catch (e) {
  crash(e);
} finally {
  await cleanup(tids);
  finish();
}
