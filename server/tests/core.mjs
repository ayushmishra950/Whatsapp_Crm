// Core CRM flows still work: chat send, tasks + Today, fees + reminders, status drips, campaigns, dashboard
import { M, call, cleanup, crash, finish, newBusiness, ok, processInbound, stamp, wait } from './lib.mjs';

const { runFeeReminders } = await import(new URL('../src/services/fees.js', import.meta.url).pathname);
const tids = [];
const day = (n) => new Date(Date.now() + n * 864e5 + 5.5 * 36e5).toISOString().slice(0, 10);
try {
  const b = await newBusiness('Core Academy');
  tids.push(b.id);
  await M.Template.updateMany({ tenantId: b.id }, { $set: { status: 'approved' } });
  const t = await M.Tenant.findById(b.id);

  // chat: customer writes, team replies (text, note, template)
  await processInbound(t, { id: `wamid.C.${stamp}.1`, from: '919811200001', type: 'text', text: { body: 'Hello, course details?' }, timestamp: String(Math.floor(Date.now() / 1000)) }, 'Kiran');
  const conv = await M.Conversation.findOne({ tenantId: b.id });
  let r = await call(b.tok, 'POST', `/conversations/${conv._id}/messages`, { type: 'text', text: 'Hi Kiran!' });
  ok(r.status === 201 && r.direction === 'outbound', 'Reply sent in the 24h window');
  r = await call(b.tok, 'POST', `/conversations/${conv._id}/messages`, { type: 'note', text: 'Asked about weekend batch' });
  ok(r.status === 201 && r.direction === 'internal', 'Internal note');
  const tpl = await M.Template.findOne({ tenantId: b.id, name: 'walkin_welcome_en' });
  r = await call(b.tok, 'POST', `/conversations/${conv._id}/messages`, { type: 'template', templateId: String(tpl._id), params: ['Kiran', 'Core Academy'] });
  ok(r.status === 201 && r.type === 'template', 'Template message');
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from('%PDF-1.4 test')], { type: 'application/pdf' }), 'brochure.pdf');
  fd.append('caption', 'Our brochure');
  const up = await fetch(`http://localhost:4100/api/conversations/${conv._id}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${b.tok}` }, body: fd });
  const upJ = await up.json();
  ok(up.status === 201 && upJ.type === 'document' && upJ.media?.fileName === 'brochure.pdf', 'File attachment (PDF) sent', JSON.stringify(upJ).slice(0, 150));

  // tasks, Today, counts
  const contact = await M.Contact.findOne({ tenantId: b.id, phone: '919811200001' });
  r = await call(b.tok, 'POST', '/tasks', { contactId: String(contact._id), title: 'Call Kiran', dueAt: new Date(Date.now() - 6e4).toISOString(), kind: 'call' });
  ok(r.status === 201, 'Task created');
  r = await call(b.tok, 'GET', '/dashboard/today');
  ok(r.tasks?.some((x) => x.title === 'Call Kiran'), 'Today lists the overdue task');
  r = await call(b.tok, 'GET', '/dashboard/counts');
  ok(r.tasksDue >= 1, 'Tab badge count');

  // fees
  const s1 = (await call(b.tok, 'POST', '/contacts', { phone: '919811200002', name: 'Karan', course: 'DM', leadStatus: 'fee_pending' }))._id;
  r = await call(b.tok, 'PUT', `/fees/contact/${s1}`, { total: 30000, discount: 2000, installments: [{ amount: 10000, dueDate: day(-2) }, { amount: 10000, dueDate: day(3) }, { amount: 8000, dueDate: day(33) }] });
  ok(r.status === 200 && r.fees.payable === 28000, 'Fee plan saved');
  r = await call(b.tok, 'POST', `/fees/contact/${s1}/payments`, { amount: 12000, mode: 'UPI', sendReceipt: true });
  ok(r.status === 201 && r.fees.balance === 16000 && r.statusChanged === 'converted', 'Payment → balance + Converted');
  await runFeeReminders(new Date());
  ok((await M.Contact.findById(s1)).fees.installments[1].reminded.soon, '"Due soon" reminder');

  // status drip
  const hotDrip = await M.Drip.findOne({ tenantId: b.id, 'trigger.type': 'status_changed' });
  if (hotDrip) {
    await M.Drip.updateOne({ _id: hotDrip._id }, { $set: { status: 'active' } });
    const st = hotDrip.trigger.statuses?.[0] || hotDrip.trigger.status;
    await call(b.tok, 'PATCH', `/contacts/${contact._id}`, { leadStatus: st });
    await wait(800);
    ok(!!(await M.DripEnrollment.exists({ contactId: contact._id, dripId: hotDrip._id })), `Status "${st}" → its drip starts`);
  }

  // campaign to everyone (mock WhatsApp)
  r = await call(b.tok, 'POST', '/campaigns', { name: 'Test blast', templateId: String(tpl._id), audience: { type: 'all' }, variables: [{ source: 'field', value: 'name' }, { source: 'static', value: 'Core Academy' }] });
  ok(!!r._id, 'Campaign draft', r.error);
  r = await call(b.tok, 'POST', `/campaigns/${r._id}/launch`, {});
  ok(r.status === 200, 'Campaign launched', r.error);

  // dashboard + misc endpoints answer
  for (const p of ['/dashboard', '/dashboard/attention', '/dashboard/messages', '/contacts/status-counts', '/notifications', '/team', '/settings', '/drips', '/templates', '/courses', '/chatbot', '/ads', '/referrals', '/views?page=contacts', '/fees?when=all']) {
    const x = await call(b.tok, 'GET', p);
    ok(x.status === 200, `GET ${p}`, x.error);
  }
} catch (e) {
  crash(e);
} finally {
  await cleanup(tids);
  finish();
}
