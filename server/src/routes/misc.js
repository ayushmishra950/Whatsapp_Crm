import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Message } from '../models/index.js';
import { validate, notFound, badRequest, normalizePhone } from '../utils/http.js';
import { downloadMedia } from '../services/whatsapp.js';
import { processInbound } from '../services/webhookProcessor.js';

const router = Router();

// Inbound media proxy (live mode): fetches the file from Meta with the tenant token
router.get('/media/:messageId', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.messageId)) throw notFound();
  const message = await Message.findOne({ _id: req.params.messageId, tenantId: req.tenantId });
  if (!message?.media?.waMediaId) throw notFound('Media not found');
  const { buffer, mimeType } = await downloadMedia(req.tenantId, message.media.waMediaId);
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

export default router;
