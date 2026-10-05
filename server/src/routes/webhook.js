import { Router } from 'express';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { handleWebhookPayload } from '../services/webhookProcessor.js';

const router = Router();

// Meta verification handshake when the webhook URL is registered in the Meta App dashboard
router.get('/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  if (mode === 'subscribe' && token === env.whatsapp.webhookVerifyToken) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

function validSignature(req) {
  if (!env.whatsapp.appSecret) return !env.isProd; // allow unsigned only in development
  const signature = req.get('x-hub-signature-256') || '';
  const expected = `sha256=${crypto.createHmac('sha256', env.whatsapp.appSecret).update(req.rawBody || '').digest('hex')}`;
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

router.post('/whatsapp', (req, res) => {
  if (!validSignature(req)) return res.sendStatus(401);
  // Acknowledge fast; Meta retries if we take too long
  res.sendStatus(200);
  handleWebhookPayload(req.body).catch((err) => console.error('[webhook] processing error', err));
});

export default router;
