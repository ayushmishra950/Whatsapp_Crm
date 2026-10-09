// Instagram DMs as a second channel: leads without a phone, one chat per channel, webhook, sending rules,
// WhatsApp-only features skip Instagram-only leads. Instagram is in mock mode (no real account needed).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { API, M, S, call, cleanup, crash, finish, newBusiness, ok, processInbound, stamp, wait } from './lib.mjs';

const fileEnv = dotenv.parse(fs.existsSync('.env') ? fs.readFileSync('.env') : '');
const igSecret = process.env.IG_APP_SECRET || fileEnv.IG_APP_SECRET || fileEnv.WA_APP_SECRET || '';
const { audienceFilter } = await import(S + 'services/campaigns.js');
const { enrollContacts } = await import(S + 'services/drips.js');
const { parseInstagramMessage } = await import(S + 'services/instagramInbound.js');

const tids = [];
try {
  const b = await newBusiness(`IG Coaching ${stamp}`);
  tids.push(b.id);
  const T = b.id;
  const dm = (body) => call(b.tok, 'POST', '/sandbox/instagram', body);
  const user = `riya.ig${String(stamp).slice(-5)}`;

  await M.Chatbot.updateOne({ tenantId: T }, { $set: { enabled: true } }); // the bot also answers on Instagram
  // ---------- inbound ----------
  let r = await dm({ username: user, name: 'Riya Sharma', text: 'Hi, Python course ki fees kya hai?' });
  ok(r.status === 201 && r.direction === 'inbound' && r.igMessageId?.startsWith('mid.MOCK'), 'Instagram DM saved as an inbound message', r.error);
  const lead = await M.Contact.findOne({ tenantId: T, 'instagram.username': user });
  ok(lead && !lead.phone && lead.source === 'instagram' && lead.instagram.igsid && lead.name === 'Riya Sharma', 'New lead without a phone: source Instagram, IGSID + username + name saved');
  const igConv = await M.Conversation.findOne({ tenantId: T, contactId: lead._id });
  ok(igConv?.channel === 'instagram' && igConv.lastInboundAt, 'Its chat is an Instagram chat with the 24h window open');

  r = await dm({ username: user, text: 'Batch timing bhi batao' });
  ok((await M.Contact.countDocuments({ tenantId: T, 'instagram.username': user })) === 1 && (await M.Conversation.countDocuments({ tenantId: T, contactId: lead._id })) === 1, 'Second DM: same lead, same chat');

  const tenantDoc = await M.Tenant.findById(T);
  const { processInstagramEvent } = await import(S + 'services/instagramInbound.js');
  const dupEv = { sender: { id: lead.instagram.igsid }, recipient: { id: 'X' }, timestamp: Date.now(), message: { mid: `mid.DUP.${stamp}`, text: 'dup' } };
  await processInstagramEvent(tenantDoc, dupEv, 'X', { profile: null });
  await processInstagramEvent(tenantDoc, dupEv, 'X', { profile: null });
  ok((await M.Message.countDocuments({ igMessageId: `mid.DUP.${stamp}` })) === 1, 'Same Instagram message delivered twice is saved once');

  // Two Instagram leads without phones in one business (the old phone index would have refused this)
  r = await dm({ username: `aman.ig${String(stamp).slice(-5)}`, text: 'hello' });
  ok(r.status === 201 && (await M.Contact.countDocuments({ tenantId: T, phone: { $exists: false } })) >= 2, 'Many leads without a phone can exist (new partial phone index)');

  // ---------- chatbot on Instagram ----------
  const botMsgs = await M.Message.find({ conversationId: igConv._id, direction: 'outbound', isBot: true });
  ok(botMsgs.length > 0 && botMsgs.every((m) => m.igMessageId && m.status !== 'failed'), 'Chatbot answers on Instagram too (sent through Instagram)', JSON.stringify(botMsgs.map((m) => m.error)));

  // Bot stopped on an error mid-flow (e.g. a database hiccup): "Hiii" brings the menu back
  await M.Conversation.updateOne({ _id: igConv._id }, { $set: { 'bot.active': false, 'bot.endReason': 'error', 'bot.endedAt': new Date() } });
  const botBefore = await M.Message.countDocuments({ conversationId: igConv._id, isBot: true, direction: 'outbound' });
  r = await dm({ username: user, text: 'Hiii' });
  const botAfter = await M.Message.countDocuments({ conversationId: igConv._id, isBot: true, direction: 'outbound' });
  ok(botAfter > botBefore && (await M.Conversation.findById(igConv._id)).bot.active, 'After the bot stopped on an error, "Hiii" starts it again (menu sent)');

  // ---------- replying ----------
  await M.Conversation.updateOne({ _id: igConv._id }, { $set: { 'bot.active': false } });
  r = await call(b.tok, 'POST', `/conversations/${igConv._id}/messages`, { type: 'text', text: 'Python fees ₹15,000 hai, EMI bhi hai.' });
  ok(r.status === 201 && r.status !== 'failed' && r.igMessageId && !r.waMessageId, 'Counsellor reply goes out on Instagram', r.error);
  const replyId = r._id;
  await wait(3500);
  ok((await M.Message.findById(replyId)).status === 'read', 'Customer "seen" marks our reply as read');

  const tpl = await M.Template.findOne({ tenantId: T });
  if (tpl) await M.Template.updateOne({ _id: tpl._id }, { $set: { status: 'approved' } });
  r = await call(b.tok, 'POST', `/conversations/${igConv._id}/messages`, { type: 'template', templateId: String(tpl?._id), params: ['a', 'b', 'c', 'd'] });
  ok(r.status === 400 && /WhatsApp only/i.test(r.error), 'Templates are refused on an Instagram chat with a clear message', r.error);

  // Media: Instagram rules
  const sendFile = async (name, type, bytes = 3000) => {
    const fd = new FormData();
    fd.append('file', new Blob([Buffer.alloc(bytes, 1)], { type }), name);
    const res = await fetch(`${API}/conversations/${igConv._id}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${b.tok}` }, body: fd });
    return { ...(await res.json()), status: res.status };
  };
  r = await sendFile('brochure.pdf', 'application/pdf');
  ok(r.status === 201 && r.type === 'document' && r.igMessageId, 'PDF sent on Instagram', r.error);
  r = await sendFile('fees.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  ok(r.status === 400 && /only PDF/i.test(r.error), 'Word file refused on Instagram (PDF only) with the reason', r.error);
  r = await sendFile('class.png', 'image/png');
  ok(r.status === 201 && r.type === 'image', 'Photo sent on Instagram');

  // Reaction from the customer on our reply
  r = await dm({ username: user, reaction: { messageId: String(replyId), emoji: '👍' } });
  ok((await M.Message.findById(replyId)).customerReaction?.emoji === '👍', 'Customer reaction on Instagram shows on our message');

  // 24h window
  await M.Conversation.updateOne({ _id: igConv._id }, { $set: { lastInboundAt: new Date(Date.now() - 25 * 3600 * 1000) } });
  r = await call(b.tok, 'POST', `/conversations/${igConv._id}/messages`, { type: 'text', text: 'late' });
  ok(r.status === 400 && /24-hour/.test(r.error), 'After 24 hours a free reply is refused on Instagram too');

  // ---------- lists, search, filters ----------
  const waTenant = await M.Tenant.findById(T);
  await processInbound(waTenant, { id: `wamid.IGT.${stamp}`, from: `9198${String(stamp).slice(-8)}`, type: 'text', text: { body: 'hi' }, timestamp: String(Math.floor(Date.now() / 1000)) }, 'WA Person');
  const igList = await call(b.tok, 'GET', '/conversations?status=all&channel=instagram');
  const waList = await call(b.tok, 'GET', '/conversations?status=all&channel=whatsapp');
  ok(igList._json.length >= 2 && igList._json.every((c) => c.channel === 'instagram') && waList._json.length >= 1 && waList._json.every((c) => c.channel !== 'instagram'), 'Inbox channel filter: Instagram / WhatsApp chats apart');
  ok(igList._json.find((c) => String(c._id) === String(igConv._id))?.contactId?.instagram?.username === user, 'Inbox rows carry the Instagram username');
  r = await call(b.tok, 'GET', `/conversations?status=all&search=${user.slice(0, 6)}`);
  ok(r._json.some((c) => String(c._id) === String(igConv._id)), 'Inbox search finds the lead by Instagram username');
  r = await call(b.tok, 'GET', '/contacts?channel=instagram');
  ok(r.items.length >= 2 && r.items.every((c) => !c.phone), 'Leads filter: Instagram only');
  r = await call(b.tok, 'GET', `/contacts?search=${user}`);
  ok(r.items.length === 1 && r.items[0].instagram.username === user, 'Leads search by @username');

  // ---------- WhatsApp-only features skip Instagram-only leads ----------
  const inAudience = await M.Contact.countDocuments({ ...audienceFilter(T, { type: 'status', leadStatuses: [lead.leadStatus, 'new'] }), _id: lead._id });
  ok(inAudience === 0, 'Bulk campaigns leave out leads without a WhatsApp number');
  const drip = await M.Drip.findOne({ tenantId: T, 'steps.0': { $exists: true } });
  if (drip) ok((await enrollContacts(drip, [lead._id])) === 0, 'Drips do not enroll Instagram-only leads (templates are WhatsApp)');
  else ok(true, 'No drip in this business to check (skipped)');
  r = await call(b.tok, 'POST', '/conversations/start', { contactId: String(lead._id), channel: 'whatsapp' });
  ok(r.status === 400 && /no WhatsApp number/i.test(r.error), 'Starting a WhatsApp chat for a lead without a number is refused with the reason');

  // ---------- same lead on both channels ----------
  const phone = `9197${String(stamp).slice(-8)}`;
  r = await call(b.tok, 'PATCH', `/contacts/${lead._id}`, { phone });
  ok(r.status === 200 && r.phone === phone, 'Instagram lead gets a WhatsApp number');
  r = await call(b.tok, 'POST', '/conversations/start', { contactId: String(lead._id), channel: 'whatsapp' });
  ok(r.status === 200 || r.status === 201, 'WhatsApp chat started for the same lead', r.error);
  const detail = await call(b.tok, 'GET', `/contacts/${lead._id}`);
  ok(detail.conversations?.length === 2 && new Set(detail.conversations.map((c) => c.channel)).size === 2, 'Lead page sees both chats (WhatsApp + Instagram)');

  // ---------- webhook ----------
  await M.Tenant.updateOne({ _id: T }, { $set: { 'instagram.igUserId': `1784${stamp}` } });
  const payload = { object: 'instagram', entry: [{ id: `1784${stamp}`, time: Date.now(), messaging: [{ sender: { id: `IGSID${stamp}` }, recipient: { id: `1784${stamp}` }, timestamp: Date.now(), message: { mid: `mid.WEBHOOK.${stamp}`, text: 'From the real webhook path' } }] }] };
  const raw = JSON.stringify(payload);
  const sig = igSecret ? `sha256=${crypto.createHmac('sha256', igSecret).update(raw).digest('hex')}` : '';
  const hook = (signature) => fetch(API + '/webhook/instagram', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(signature && { 'X-Hub-Signature-256': signature }) }, body: raw });
  if (igSecret) ok((await hook('sha256=bad')).status === 401, 'Webhook with a wrong signature is refused');
  ok((await hook(sig)).status === 200, 'Signed Instagram webhook accepted');
  await wait(800);
  const fromHook = await M.Message.findOne({ igMessageId: `mid.WEBHOOK.${stamp}` });
  ok(fromHook && String(fromHook.tenantId) === String(T), 'Webhook message lands in the right business (by Instagram account id)');
  const verify = await fetch(`${API}/webhook/instagram?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123`);
  ok(verify.status === 403, 'Webhook verification refuses a wrong token');

  // Another business never gets it
  const other = await newBusiness(`IG Other ${stamp}`, { coaching: false });
  tids.push(other.id);
  r = await call(other.tok, 'GET', '/conversations?status=all&channel=instagram');
  ok(r._json.length === 0, 'Another business sees none of these Instagram chats');

  // Parser
  const story = parseInstagramMessage({ text: 'wow', reply_to: { story: { url: 'https://x/s' } } });
  const mention = parseInstagramMessage({ attachments: [{ type: 'story_mention', payload: { url: 'https://x/m.jpg' } }] });
  ok(/Replied to your story/.test(story.text) && mention.type === 'image' && /Mentioned you/.test(mention.text), 'Story replies and mentions are shown as messages');

  // Plan module off → Instagram refused (checked directly: the API keeps plans cached for a minute)
  const { instagramAllowed } = await import(S + 'services/instagramInbound.js');
  await (await import(S + 'services/channelMigration.js')).migrateChannels(); // this test process learns the database is ready
  const plan = await M.Plan.findOne({ name: 'Growth' });
  await M.Plan.updateOne({ _id: plan._id }, { $set: { 'modules.instagram': false } });
  const offAllowed = await instagramAllowed(await M.Tenant.findById(T));
  await M.Plan.updateOne({ _id: plan._id }, { $set: { 'modules.instagram': true } });
  const onAllowed = await instagramAllowed(await M.Tenant.findById(T));
  ok(offAllowed === false && onAllowed === true, 'Plan without the Instagram module: Instagram messages are not taken in');

  // Deleting the lead deletes both chats and their messages
  const convIds = (await M.Conversation.find({ contactId: lead._id })).map((c) => c._id);
  r = await call(b.tok, 'DELETE', `/contacts/${lead._id}`);
  ok(r.status === 200 && (await M.Conversation.countDocuments({ _id: { $in: convIds } })) === 0 && (await M.Message.countDocuments({ conversationId: { $in: convIds } })) === 0, 'Deleting the lead removes both chats and all their messages');
} catch (e) {
  crash(e);
} finally {
  for (const t of tids) fs.rmSync(path.resolve('uploads', String(t)), { recursive: true, force: true });
  await cleanup(tids);
  finish();
}
