import { Router } from 'express';
import { env } from '../config/env.js';
import { authenticate, authorize, requireTenant } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { channelsReady } from '../services/channelMigration.js';
import { completeConnect, connectUrl, readState } from '../services/instagramConnect.js';
import { instagramAllowed } from '../services/instagramInbound.js';
import { badRequest } from '../utils/http.js';

const router = Router();

/** Admin: Instagram's login page for this business */
router.get('/connect-url', authenticate, requireTenant, authorize('admin'), async (req, res) => {
  if (!channelsReady()) throw badRequest('The database update for Instagram has not run yet (CHANNEL_MIGRATION=run).');
  if (!(await instagramAllowed(req.tenant))) throw badRequest('Instagram is not part of your plan.');
  res.json({ url: connectUrl({ tenantId: req.tenantId, userId: req.user._id, switchAccount: req.query.switch === '1' }) });
});

/** Instagram sends the admin back here after login (public: the signed state says which business) */
router.get('/callback', async (req, res) => {
  const back = (q) => res.redirect(`${env.clientUrl}/app/settings?${new URLSearchParams(q)}#instagram`);
  if (req.query.error) return back({ instagram: 'error', reason: String(req.query.error_description || req.query.error_reason || req.query.error).slice(0, 200) });
  try {
    const { tenantId, userId } = readState(req.query.state);
    const r = await completeConnect({ tenantId, code: req.query.code });
    await audit({ user: { _id: userId, role: 'admin' }, tenantId, ip: req.ip }, 'instagram.connect', { meta: { username: r.username, igUserId: r.igUserId } });
    back({ instagram: 'connected', username: r.username || '' });
  } catch (err) {
    back({ instagram: 'error', reason: String(err.message).slice(0, 200) });
  }
});

export default router;
