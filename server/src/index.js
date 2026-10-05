import http from 'node:http';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import mongoose from 'mongoose';
import { env } from './config/env.js';
import { connectDB, disconnectDB } from './config/db.js';
import { authenticate, requireTenant } from './middleware/auth.js';
import { initSocket } from './services/socket.js';
import { startCampaignWorker } from './services/campaigns.js';
import { HttpError } from './utils/http.js';
import { User } from './models/index.js';

import authRoutes from './routes/auth.js';
import superadminRoutes from './routes/superadmin.js';
import teamRoutes from './routes/team.js';
import contactRoutes from './routes/contacts.js';
import conversationRoutes from './routes/conversations.js';
import templateRoutes from './routes/templates.js';
import campaignRoutes from './routes/campaigns.js';
import settingsRoutes from './routes/settings.js';
import dashboardRoutes from './routes/dashboard.js';
import webhookRoutes from './routes/webhook.js';
import miscRoutes from './routes/misc.js';
import chatbotRoutes from './routes/chatbot.js';

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: env.clientUrl, credentials: true }));
// Keep raw body for WhatsApp webhook signature verification
app.use(express.json({ limit: '2mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use(morgan(env.isProd ? 'combined' : 'dev'));
app.use('/uploads', express.static(path.resolve('uploads')));

app.get('/api/health', (_req, res) => res.json({ ok: true, db: mongoose.connection.readyState === 1 }));

app.use('/api/auth', authRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/superadmin', superadminRoutes);

// Everything below is scoped to the logged-in user's business
const tenantRouter = express.Router();
tenantRouter.use(authenticate, requireTenant);
tenantRouter.use('/dashboard', dashboardRoutes);
tenantRouter.use('/team', teamRoutes);
tenantRouter.use('/contacts', contactRoutes);
tenantRouter.use('/conversations', conversationRoutes);
tenantRouter.use('/templates', templateRoutes);
tenantRouter.use('/campaigns', campaignRoutes);
tenantRouter.use('/settings', settingsRoutes);
tenantRouter.use('/chatbot', chatbotRoutes);
tenantRouter.use('/', miscRoutes);
app.use('/api', tenantRouter);

app.use((_req, _res, next) => next(new HttpError(404, 'Route not found')));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  let status = err.status || 500;
  let message = err.message;
  if (err.name === 'MulterError') status = 400;
  if (err.code === 11000) {
    status = 409;
    message = 'Duplicate value: this record already exists';
  }
  if (err.name === 'CastError' || err.name === 'ValidationError') status = 400;
  if (status >= 500) {
    console.error(err);
    if (env.isProd) message = 'Something went wrong';
  }
  res.status(status).json({ error: message, details: err.details });
});

async function start() {
  await connectDB();
  if (!(await User.exists({ role: 'super_admin' }))) {
    console.warn('[setup] No super admin found. Run "npm run seed" to create one.');
  }
  const server = http.createServer(app);
  initSocket(server);
  startCampaignWorker();
  server.listen(env.port, () => console.log(`[server] API running on http://localhost:${env.port}`));

  const shutdown = async () => {
    server.close();
    await disconnectDB();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start().catch((err) => {
  console.error('Failed to start server', err);
  process.exit(1);
});
