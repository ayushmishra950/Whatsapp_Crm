// Phone push notifications (Expo push API is faked in this process)
import axios from 'axios';
import { M, call, cleanup, crash, finish, login, newBusiness, ok, processInbound, sa, plan, stamp, wait } from './lib.mjs';

const calls = [];
let dead = '';
axios.defaults.adapter = async (config) => {
  const body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
  if (config.url.includes('exp.host')) {
    calls.push(...body);
    return { data: { data: body.map((m) => (m.to === dead ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok', id: 'x' })) }, status: 200, statusText: 'OK', headers: {}, config };
  }
  return { data: { messages: [{ id: `wamid.HBgFAKE${calls.length}` }] }, status: 200, statusText: 'OK', headers: {}, config };
};
const { notify } = await import(new URL('../src/services/alerts.js', import.meta.url).pathname);
const tids = [];
const em = `pia${stamp}@temp.local`;
try {
  const A = await newBusiness('Push A', { coaching: true, admin: { name: 'Pia', email: em, password: 'Temp@12345' } });
  const rb = await call(sa, 'POST', '/superadmin/tenants', { name: '(temp) Push B', planId: String(plan._id), admin: { existingLogin: true, email: em } });
  tids.push(A.id, rb._id);
  await M.Tenant.updateMany({ _id: { $in: tids } }, { $set: { 'whatsapp.mode': 'mock', 'settings.autoAssign': false } });
  await M.Tenant.updateOne({ _id: rb._id }, { $set: { 'whatsapp.phoneNumberId': `PB${stamp}` } });
  const tok = (await login(em, 'Temp@12345')).token;
  const T1 = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]';
  const T2 = 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]';
  let r = await call(tok, 'POST', '/auth/push-token', { token: T1, platform: 'ios', device: 'iPhone 16' });
  ok(r.ok === true, 'Phone token saved on the login', JSON.stringify(r._json));
  await call(tok, 'POST', '/auth/push-token', { token: T1, platform: 'ios' });
  r = await call(tok, 'POST', '/auth/push-token', { token: 'not-a-token-xxxxxxxx', platform: 'ios' });
  let acc = await M.Account.findOne({ email: em }).lean();
  ok(acc.pushTokens.length === 1 && r.ok === false, 'Same phone twice → one entry; junk token refused', JSON.stringify(acc.pushTokens));
  await call(tok, 'POST', '/auth/push-token', { token: T2, platform: 'android' });

  const ub = await M.User.findOne({ tenantId: rb._id });
  const c = await M.Contact.create({ tenantId: rb._id, phone: '919811300001', name: 'Hot Lead' });
  calls.length = 0;
  await notify(rb._id, { to: [ub._id], contact: c, kind: 'hot', title: '🔥 Hot lead', body: 'wants to join today' });
  await wait();
  ok(calls.length === 2 && calls.every((m) => m.title === '(temp) Push B · 🔥 Hot lead' && m.data.userId === String(ub._id) && m.data.url === `/lead/${c._id}`), 'Alert → both phones, business name in title, tap opens that lead in Push B', JSON.stringify(calls[0]));

  calls.length = 0;
  await processInbound(await M.Tenant.findById(A.id), { id: `wamid.PUSH.${stamp}.1`, from: '919811300002', type: 'text', text: { body: 'Fees kitni hai?' }, timestamp: String(Math.floor(Date.now() / 1000)) }, 'Ravi');
  await wait(400);
  const msgPush = calls.find((m) => m.title.includes('💬'));
  ok(msgPush && msgPush.title === '(temp) Push A · 💬 Ravi' && msgPush.body === 'Fees kitni hai?' && msgPush.data.userId === String(A.admin._id) && /^\/chat\//.test(msgPush.data.url), 'Customer message → phone alert that opens the chat', JSON.stringify(msgPush));

  await M.Chatbot.updateOne({ tenantId: A.id }, { $set: { enabled: true } });
  calls.length = 0;
  await processInbound(await M.Tenant.findById(A.id), { id: `wamid.PUSH.${stamp}.2`, from: '919811300003', type: 'text', text: { body: 'hi' }, timestamp: String(Math.floor(Date.now() / 1000)) }, 'Bot Lead');
  await wait(400);
  ok(!calls.some((m) => m.title.includes('💬')), 'Chatbot is answering → no "new message" alert');

  dead = T2;
  await notify(A.id, { to: [A.admin._id], kind: 'info', title: 'Test' });
  await wait();
  acc = await M.Account.findOne({ email: em }).lean();
  ok(acc.pushTokens.length === 1 && acc.pushTokens[0].token === T1, 'Uninstalled phone (DeviceNotRegistered) is forgotten');

  r = await call(tok, 'DELETE', '/auth/push-token', { token: T1 });
  acc = await M.Account.findOne({ email: em }).lean();
  ok(r.ok && acc.pushTokens.length === 0, 'Logout → phone removed');
  calls.length = 0;
  await notify(A.id, { to: [A.admin._id], kind: 'info', title: 'After logout' });
  await wait();
  ok(calls.length === 0, 'No phones → nothing sent');
} catch (e) {
  crash(e);
} finally {
  await cleanup(tids);
  finish();
}
