import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Message } from '../models/index.js';
import { validate, notFound, badRequest, normalizePhone } from '../utils/http.js';
import { downloadMedia } from '../services/whatsapp.js';
import { keepForRetry, saveFile } from '../services/storage.js';
import { processInbound } from '../services/webhookProcessor.js';
import crypto from 'node:crypto';
import { instagramAllowed, processInstagramEvent } from '../services/instagramInbound.js';

const router = Router();

// Inbound media proxy (live mode): fetches the file from Meta with the tenant token
router.get('/media/:messageId', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.messageId)) throw notFound();
  const message = await Message.findOne({ _id: req.params.messageId, tenantId: req.tenantId });
  if (!message?.media?.waMediaId) throw notFound('Media not found');
  if (message.media.removed) throw notFound('This file was removed by the admin');
  const { buffer, mimeType } = await downloadMedia(req.tenantId, message.media.waMediaId);
  // A customer's file is kept on first view (Meta deletes its copy after a while): next time the CRM shows it from storage
  if (!message.media.url) {
    try {
      const fileName = message.media.fileName || `${message.type}-${message._id}`;
      const stored = await saveFile({ tenantId: req.tenantId, buffer, fileName, mimeType });
      await Message.updateOne({ _id: message._id }, { $set: { 'media.url': stored.url, ...(mimeType && !message.media.mimeType && { 'media.mimeType': mimeType }) } });
      if (stored.waiting) await keepForRetry({ tenantId: req.tenantId, messageId: message._id, contactId: message.contactId, url: stored.url, fileName, mimeType, size: buffer.length, direction: 'received', error: stored.error });
    } catch (err) {
      console.warn('[media] could not keep a copy', err.message);
    }
  }
  res.set('Content-Type', mimeType || 'application/octet-stream');
  res.set('Cache-Control', 'private, max-age=3600');
  res.send(buffer);
});

// Sandbox helpers: pretend a customer sent a WhatsApp message, a quoted reply, or a reaction (mock mode only)
const sandboxSchema = z.object({
  phone: z.string().transform(normalizePhone).refine((p) => /^\d{8,15}$/.test(p), 'Phone must include country code'),
  name: z.string().optional(),
  text: z.string().trim().optional(),
  replyToMessageId: z.string().refine(mongoose.isValidObjectId).optional(), // our Message _id being quoted
  reaction: z.object({ messageId: z.string().refine(mongoose.isValidObjectId), emoji: z.string().max(16) }).optional(),
  // Customer tapped a chatbot button / list row
  interactiveReply: z.object({ id: z.string().min(1), title: z.string().min(1) }).optional(),
  // Pretend the customer came from a Click-to-WhatsApp ad
  referral: z.object({ adId: z.string().min(1), headline: z.string().optional(), body: z.string().optional() }).optional(),
});

router.post('/sandbox/inbound', async (req, res) => {
  if (req.tenant.whatsapp?.mode === 'live') throw badRequest('Sandbox is disabled when a live WhatsApp number is connected');
  const { phone, name, text, replyToMessageId, reaction, interactiveReply, referral } = validate(sandboxSchema, req.body);
  const waId = `wamid.MOCK.IN.${Date.now()}${Math.random().toString(16).slice(2, 8)}`;
  const base = { from: phone, id: waId, timestamp: String(Math.floor(Date.now() / 1000)) };

  const waIdOf = async (id) => {
    const m = await Message.findOne({ _id: id, tenantId: req.tenantId }).select('waMessageId');
    if (!m?.waMessageId) throw badRequest('Target message not found or has no WhatsApp id');
    return m.waMessageId;
  };

  let payload;
  if (interactiveReply) {
    payload = { ...base, type: 'interactive', interactive: { type: 'button_reply', button_reply: interactiveReply } };
  } else if (reaction) {
    payload = { ...base, type: 'reaction', reaction: { message_id: await waIdOf(reaction.messageId), emoji: reaction.emoji } };
  } else {
    if (!text) throw badRequest('text is required');
    payload = { ...base, type: 'text', text: { body: text } };
    if (replyToMessageId) payload.context = { from: phone, id: await waIdOf(replyToMessageId) };
  }
  if (referral) {
    payload.referral = {
      source_type: 'ad', source_id: referral.adId, headline: referral.headline || 'Sandbox ad', body: referral.body || '',
      source_url: `https://fb.me/${referral.adId}`, media_type: 'image', ctwa_clid: `MOCK_${Date.now()}`,
    };
  }
  const message = await processInbound(req.tenant, payload, name);
  res.status(201).json(message);
});

// Sandbox: pretend a customer sent an Instagram DM (mock Instagram only). The username gives a stable fake IGSID.
const igSandboxSchema = z.object({
  username: z.string().trim().min(1).max(30).regex(/^[\w.]+$/, 'Instagram usernames use letters, numbers, . and _'),
  name: z.string().trim().max(80).optional(),
  text: z.string().trim().optional(),
  replyToMessageId: z.string().refine(mongoose.isValidObjectId).optional(),
  reaction: z.object({ messageId: z.string().refine(mongoose.isValidObjectId), emoji: z.string().max(16) }).optional(),
  quickReply: z.object({ id: z.string().min(1), title: z.string().min(1) }).optional(),
  storyReply: z.boolean().optional(),
  imageUrl: z.string().url().optional(),
  referral: z.object({ adId: z.string().min(1), headline: z.string().optional() }).optional(),
});

router.post('/sandbox/instagram', async (req, res) => {
  if (req.tenant.instagram?.mode === 'live') throw badRequest('Sandbox is disabled when a live Instagram account is connected');
  if (!(await instagramAllowed(req.tenant))) throw badRequest('Instagram is not available: it is off in your plan, or the database update for Instagram has not run yet.');
  const d = validate(igSandboxSchema, req.body);
  const igsid = `MOCKIG${crypto.createHash('sha1').update(`${req.tenantId}:${d.username.toLowerCase()}`).digest('hex').slice(0, 14)}`;
  const midOf = async (id) => {
    const m = await Message.findOne({ _id: id, tenantId: req.tenantId }).select('igMessageId');
    if (!m?.igMessageId) throw badRequest('Target message not found or not an Instagram message');
    return m.igMessageId;
  };
  const ev = { sender: { id: igsid }, recipient: { id: 'MOCK_IG_ACCOUNT' }, timestamp: Date.now() };
  if (d.reaction) ev.reaction = { mid: await midOf(d.reaction.messageId), action: 'react', reaction: 'love', emoji: d.reaction.emoji };
  else {
    if (!d.text && !d.imageUrl && !d.quickReply) throw badRequest('text is required');
    ev.message = { mid: `mid.MOCK.IN.${Date.now()}${Math.random().toString(16).slice(2, 8)}`, text: d.quickReply?.title || d.text || '' };
    if (d.quickReply) ev.message.quick_reply = { payload: d.quickReply.id };
    if (d.imageUrl) ev.message.attachments = [{ type: 'image', payload: { url: d.imageUrl } }];
    if (d.storyReply) ev.message.reply_to = { story: { id: 'MOCK_STORY', url: 'https://instagram.com/stories/mock' } };
    if (d.replyToMessageId) ev.message.reply_to = { mid: await midOf(d.replyToMessageId) };
    if (d.referral) ev.message.referral = { ad_id: d.referral.adId, source: 'ADS', type: 'OPEN_THREAD', ads_context_data: { ad_title: d.referral.headline || 'Sandbox Instagram ad' } };
  }
  const message = await processInstagramEvent(req.tenant, ev, 'MOCK_IG_ACCOUNT', { profile: { username: d.username, name: d.name || '', profilePic: '' } });
  res.status(201).json(message);
});

export default router;
