import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { startAutomationWorker } from './services/automation.js';
import { startDripWorker } from './services/drips.js';
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
import dripRoutes from './routes/drips.js';
import segmentRoutes from './routes/segments.js';
import adRoutes from './routes/ads.js';
import referralRoutes from './routes/referrals.js';
import courseRoutes from './routes/courses.js';
import { requireCoaching } from './services/coaching.js';
import { syncContactOwners } from './models/Conversation.js';
import { migrateAccounts } from './services/accounts.js';
import taskRoutes from './routes/tasks.js';
import notificationRoutes from './routes/notifications.js';
import viewRoutes from './routes/views.js';
import feeRoutes from './routes/fees.js';

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: env.clientUrl, credentials: true, exposedHeaders: ['Content-Disposition'] }));
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
tenantRouter.use('/drips', dripRoutes);
tenantRouter.use('/segments', segmentRoutes);
tenantRouter.use('/ads', adRoutes);
tenantRouter.use('/referrals', referralRoutes);
tenantRouter.use('/courses', requireCoaching, courseRoutes);
tenantRouter.use('/tasks', taskRoutes);
tenantRouter.use('/notifications', notificationRoutes);
tenantRouter.use('/views', viewRoutes);
tenantRouter.use('/fees', feeRoutes);
tenantRouter.use('/', miscRoutes);
app.use('/api', tenantRouter);

let frontendHandler;
app.use((req, res, next) => {
  if (req.path === '/api' || req.path.startsWith('/api/')) {
    return next(new HttpError(404, 'Route not found'));
  }
  if (frontendHandler) return frontendHandler(req, res);
  return next(new HttpError(404, 'Route not found'));
});

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

/**
 * In production this service can also serve the built Next.js app (one URL for app + API).
 * That needs web/ installed and built next to server/. When the frontend is deployed as its own
 * service (e.g. two Render services) it is not there, so the server runs as API only instead of crashing.
 * SERVE_FRONTEND=false forces API-only mode.
 */
async function loadFrontend() {
  if (!env.isProd || process.env.SERVE_FRONTEND === 'false') return null;
  const webDir = fileURLToPath(new URL('../../web/', import.meta.url));
  let next;
  try {
    const requireWeb = createRequire(new URL('../../web/package.json', import.meta.url));
    next = requireWeb('next');
  } catch {
    console.log('[server] Frontend packages (web/) are not installed with this service: running as API only.');
    return null;
  }
  if (!fs.existsSync(path.join(webDir, '.next'))) {
    console.log('[server] Frontend build (web/.next) not found: running as API only. Build the web app to serve it from here.');
    return null;
  }
  const frontend = next({ dev: false, dir: webDir });
  await frontend.prepare();
  console.log('[server] Serving the frontend from this service');
  return frontend.getRequestHandler();
}

async function start() {
  frontendHandler = await loadFrontend();

  await connectDB();
  // One login for several businesses: every user gets a login (Account) once; safe to run on every start
  try {
    const m = await migrateAccounts();
    if (m.usersLinked || m.indexDropped) console.log(`[db] logins: ${m.accountsCreated} created, ${m.usersLinked} users linked${m.indexDropped ? ', old unique email index dropped' : ''}`);
  } catch (err) {
    console.error('[db] login migration', err.message); // logins still work: each user gets one on first login
  }
  if (!(await User.exists({ role: 'super_admin' }))) {
    console.warn('[setup] No super admin found. Run "npm run seed" to create one.');
  }
  const server = http.createServer(app);
  initSocket(server);
  startCampaignWorker();
  startDripWorker();
  // Leads take their chat's counsellor as owner (older data had it only on the chat)
  syncContactOwners().then((n) => n && console.log(`[db] lead owners synced from chats: ${n}`)).catch((err) => console.error('[db] owner sync', err.message));
  startAutomationWorker();
  server.listen(env.port, () => console.log(`[server] App running on http://localhost:${env.port}`));

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
