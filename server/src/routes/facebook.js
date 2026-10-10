import { Router } from 'express';
import { env } from '../config/env.js';
import { authenticate, authorize, requireTenant } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { completeFacebookConnect, facebookConnectUrl, readFacebookState } from '../services/facebookConnect.js';
import { socialAllowed } from '../services/social.js';
import { forbidden } from '../utils/http.js';

const router = Router();

/** Admin: Facebook's login page (choose the Page to connect) */
router.get('/connect-url', authenticate, requireTenant, authorize('admin'), async (req, res) => {
  if (!(await socialAllowed(req.tenant))) throw forbidden('Facebook posting is not part of your plan.');
  res.json({ url: facebookConnectUrl({ tenantId: req.tenantId, userId: req.user._id }) });
});

/** Facebook sends the admin back here after login (public: the signed state says which business) */
router.get('/callback', async (req, res) => {
  const back = (q) => res.redirect(`${env.clientUrl}/app/settings?${new URLSearchParams(q)}#facebook`);
  if (req.query.error) return back({ facebook: 'error', reason: String(req.query.error_description || req.query.error_reason || req.query.error).slice(0, 200) });
  try {
    const { tenantId, userId } = readFacebookState(req.query.state);
    const r = await completeFacebookConnect({ tenantId, code: req.query.code });
    await audit({ user: { _id: userId, role: 'admin' }, tenantId, ip: req.ip }, 'facebook.connect', { meta: r });
    back(r.connected ? { facebook: 'connected', page: r.pageName || '' } : { facebook: 'choose' });
  } catch (err) {
    back({ facebook: 'error', reason: String(err.message).slice(0, 200) });
  }
});

export default router;
