// Chatbot: course history on the lead, "typing…" indicator before replies
import axios from 'axios';
import { M, call, cleanup, crash, finish, newBusiness, ok, processInbound, stamp, wait } from './lib.mjs';

const { encrypt } = await import(new URL('../src/utils/crypto.js', import.meta.url).pathname);
const graph = [];
axios.defaults.adapter = async (config) => {
  const body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
  graph.push({ url: config.url, body });
  return { data: { messages: [{ id: `wamid.HBgFAKE${graph.length}` }] }, status: 200, statusText: 'OK', headers: {}, config };
};
const tids = [];
let seq = 0;
try {
  const b = await newBusiness('Bot Academy');
  tids.push(b.id);
  await M.Chatbot.updateOne({ tenantId: b.id }, { $set: { enabled: true } });
  await M.Tenant.updateOne({ _id: b.id }, { $set: { 'settings.autoAssign': false } });
  const P = '919811900001';
  const say = async (text, replyId) => {
    const list = /^(aq_|cat_|crs_|nav_courses)/.test(replyId || '');
    const msg = replyId
      ? { id: `wamid.HBgB.${stamp}.${seq++}`, from: P, type: 'interactive', interactive: { type: list ? 'list_reply' : 'button_reply', [list ? 'list_reply' : 'button_reply']: { id: replyId, title: replyId } }, timestamp: String(Math.floor(Date.now() / 1000)) }
      : { id: `wamid.HBgB.${stamp}.${seq++}`, from: P, type: 'text', text: { body: text }, timestamp: String(Math.floor(Date.now() / 1000)) };
    await processInbound(await M.Tenant.findById(b.id), msg, 'Rohit');
    await wait(150);
  };
  const lines = async () => (await M.Message.find({ tenantId: b.id, direction: 'internal', text: /^📘/ }).sort({ createdAt: 1 }).lean()).flatMap((m) => m.text.split('\n'));
  const courses = await M.Course.find({ tenantId: b.id }).select('code name').lean();
  const A = courses.find((c) => c.code === 'DM');
  const Bc = courses.find((c) => c.code === 'PY');

  await say('hi');
  await say('', 'nav_courses');
  await say('', `crs_${A.code}`);
  await say('', `cf_fees_${A.code}`);
  await say('', `cf_fees_${A.code}`);
  let n = await lines();
  ok(n.length === 2 && /opened the course/.test(n[0]) && /checked the fees/.test(n[1]), 'Course opened + fees noted once each', JSON.stringify(n));
  await say('', `crs_${Bc.code}`);
  await say('', `cf_yes_${Bc.code}`);
  n = await lines();
  const c = await M.Contact.findOne({ tenantId: b.id, phone: P });
  ok(n.includes(`📘 Course changed: ${A.code} → ${Bc.code} (chose it in the chatbot)`) && n.some((l) => /said YES, interested/.test(l)) && c.course === Bc.code && c.courseInterest.length === 2, 'Interested in another course → course changed + both remembered');
  await call(b.tok, 'PATCH', `/contacts/${c._id}`, { course: A.code });
  const manual = await M.Message.findOne({ tenantId: b.id, text: /^📘 Course changed: .*\(PY\) →/ }).populate('sentBy', 'name').lean();
  ok(!!manual?.sentBy?.name, 'Course changed by a person → note with who');

  // typing indicator (live mode, Meta faked)
  await M.Tenant.updateOne({ _id: b.id }, { $set: { 'whatsapp.mode': 'live', 'whatsapp.accessTokenEnc': encrypt('fake-token') } });
  graph.length = 0;
  await processInbound(await M.Tenant.findById(b.id), { id: `wamid.HBgT.${stamp}`, from: '919811900002', type: 'text', text: { body: 'hi' }, timestamp: String(Math.floor(Date.now() / 1000)) }, 'Neha');
  await wait(300);
  const ti = graph.findIndex((g) => g.body?.typing_indicator);
  ok(ti === 0 && graph[ti].url.includes('/v23.0/') && graph.some((g, i) => i > ti && g.body?.to === '919811900002'), '"typing…" sent before the bot reply');
  await M.Chatbot.updateOne({ tenantId: b.id }, { $set: { typingIndicator: false } });
  graph.length = 0;
  await processInbound(await M.Tenant.findById(b.id), { id: `wamid.HBgT2.${stamp}`, from: '919811900003', type: 'text', text: { body: 'hi' }, timestamp: String(Math.floor(Date.now() / 1000)) }, 'Om');
  await wait(300);
  ok(!graph.some((g) => g.body?.typing_indicator) && graph.some((g) => g.body?.to === '919811900003'), 'Typing switched off → only the reply');
} catch (e) {
  crash(e);
} finally {
  await cleanup(tids);
  finish();
}
