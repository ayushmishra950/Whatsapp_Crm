import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { User, Tenant } from '../models/index.js';
import { authenticate, signToken } from '../middleware/auth.js';
import { validate, unauthorized, forbidden, badRequest } from '../utils/http.js';
import { audit } from '../services/audit.js';
import { isSubscriptionActive, messagesUsedThisMonth } from '../services/subscription.js';

const router = Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });

export function sessionPayload(user, tenant, impersonatedBy) {
  return {
    user: { _id: user._id, name: user.name, email: user.email, role: user.role, tenantId: user.tenantId },
    tenant: tenant && {
      _id: tenant._id,
      name: tenant.name,
      status: tenant.status,
      plan: tenant.plan && { _id: tenant.plan._id, name: tenant.plan.name, limits: tenant.plan.limits, modules: tenant.plan.modules },
      subscription: tenant.subscription,
      subscriptionActive: isSubscriptionActive(tenant),
      messagesUsed: messagesUsedThisMonth(tenant),
      whatsappMode: tenant.whatsapp?.mode || 'mock',
      settings: tenant.settings,
    },
    impersonating: !!impersonatedBy,
  };
}

router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = validate(
    z.object({ email: z.string().email(), password: z.string().min(1) }),
    req.body
  );
  const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
  if (!user || !(await user.comparePassword(password))) throw unauthorized('Invalid email or password');
  if (!user.isActive) throw forbidden('Your account is disabled');

  let tenant = null;
  if (user.tenantId) {
    tenant = await Tenant.findById(user.tenantId).populate('plan');
    if (tenant?.status === 'suspended') throw forbidden('This business account is suspended. Contact support.');
  }

  user.lastLoginAt = new Date();
  await user.save();
  req.user = user;
  req.tenantId = user.tenantId;
  await audit(req, 'auth.login');

  res.json({ token: signToken(user), ...sessionPayload(user, tenant) });
});

router.get('/me', authenticate, (req, res) => {
  res.json(sessionPayload(req.user, req.tenant, req.impersonatedBy));
});

router.post('/change-password', authenticate, async (req, res) => {
  const { currentPassword, newPassword } = validate(
    z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8, 'Password must be at least 8 characters') }),
    req.body
  );
  if (req.impersonatedBy) throw forbidden('Cannot change password while impersonating');
  const user = await User.findById(req.user._id).select('+password');
  if (!(await user.comparePassword(currentPassword))) throw badRequest('Current password is incorrect');
  user.password = newPassword;
  await user.save();
  await audit(req, 'auth.change_password');
  res.json({ ok: true });
});

export default router;
