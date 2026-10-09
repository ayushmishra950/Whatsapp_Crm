import { Router } from 'express';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { handleWebhookPayload } from '../services/webhookProcessor.js';
import { handleInstagramPayload } from '../services/instagramInbound.js';

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

function validSignature(req, secret = env.whatsapp.appSecret) {
  if (!secret) return !env.isProd; // allow unsigned only in development
  const signature = req.get('x-hub-signature-256') || '';
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(req.rawBody || '').digest('hex')}`;
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

router.post('/whatsapp', (req, res) => {
  if (!validSignature(req)) return res.sendStatus(401);
  // Acknowledge fast; Meta retries if we take too long
  res.sendStatus(200);
  handleWebhookPayload(req.body, new Date()).catch((err) => console.error('[webhook] processing error', err));
});

// ---------- Instagram DMs (App Dashboard → Instagram → Webhooks: callback <PUBLIC_URL>/api/webhook/instagram) ----------
router.get('/instagram', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === env.instagram.webhookVerifyToken) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

router.post('/instagram', (req, res) => {
  if (!validSignature(req, env.instagram.appSecret)) return res.sendStatus(401);
  res.sendStatus(200);
  handleInstagramPayload(req.body, new Date()).catch((err) => console.error('[webhook] instagram processing error', err));
});

export default router;
