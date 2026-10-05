import 'dotenv/config';

const required = (name, fallback) => {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required env variable: ${name}`);
  }
  return value;
};

const isProd = process.env.NODE_ENV === 'production';

export const env = {
  isProd,
  port: Number(process.env.PORT || 4000),
  // Empty MONGO_URI in development = use a local persistent in-memory MongoDB (see config/db.js)
  mongoUri: process.env.MONGO_URI || '',
  jwtSecret: required('JWT_SECRET', isProd ? undefined : 'dev-only-jwt-secret-change-me'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  // 64 hex chars (32 bytes). Used to encrypt each tenant's WhatsApp access token at rest.
  encryptionKey: required(
    'ENCRYPTION_KEY',
    isProd ? undefined : '0000000000000000000000000000000000000000000000000000000000000000'
  ),
  clientUrl: process.env.CLIENT_URL || 'http://localhost:3000',

  whatsapp: {
    graphVersion: process.env.WA_GRAPH_VERSION || 'v21.0',
    // Meta App level values (one Meta App serves all tenants)
    appSecret: process.env.WA_APP_SECRET || '',
    webhookVerifyToken: process.env.WA_WEBHOOK_VERIFY_TOKEN || 'dev-verify-token',
  },

  campaign: {
    // Messages per second the worker sends per tenant (Cloud API allows ~80 mps, keep it safe)
    messagesPerSecond: Number(process.env.CAMPAIGN_MPS || 10),
    workerIntervalMs: Number(process.env.CAMPAIGN_WORKER_INTERVAL_MS || 2000),
  },
};
