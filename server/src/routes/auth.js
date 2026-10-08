import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { Account, User, Tenant } from '../models/index.js';
import { authenticate, signToken } from '../middleware/auth.js';
import { validate, unauthorized, forbidden, badRequest } from '../utils/http.js';
import { audit } from '../services/audit.js';
import { businessesOf, ensureAccountForUser, linkAccounts, normEmail, pickMembership } from '../services/accounts.js';
import { isSubscriptionActive, messagesUsedThisMonth } from '../services/subscription.js';

const router = Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: Number(process.env.LOGIN_RATE_LIMIT) || 20, standardHeaders: true, legacyHeaders: false });

export function sessionPayload(user, tenant, impersonatedBy) {
  return {
    user: { _id: user._id, name: user.name, email: user.email, role: user.role, tenantId: user.tenantId },
    tenant: tenant && {
      _id: tenant._id,
      name: tenant.name,
      status: tenant.status,
      businessType: tenant.businessType || 'general',
      logo: tenant.logo || '',
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

/** The person's login: find it by email (users made before Accounts get one on their first login) */
async function findAccount(email) {
  email = normEmail(email);
  const account = await Account.findOne({ email }).select('+password');
  if (account) return account;
  const legacy = await User.findOne({ email });
  if (!legacy) return null;
  await ensureAccountForUser(legacy);
  return Account.findOne({ email }).select('+password');
}

/** Open one membership: token + session (also used by the business switcher) */
async function openMembership(req, res, account, userId, action) {
  const pick = await pickMembership(account, userId);
  const user = await User.findById(pick.userId);
  if (!user || !user.isActive) throw forbidden('Your account is disabled');
  let tenant = null;
  if (user.tenantId) {
    tenant = await Tenant.findById(user.tenantId).populate('plan');
    if (!tenant) throw forbidden('Business not found');
    if (tenant.status === 'suspended') throw forbidden('This business account is suspended. Contact support.');
  }
  const now = new Date();
  user.lastLoginAt = now;
  await user.save();
  await Account.updateOne({ _id: account._id }, { $set: { lastUserId: user._id, lastLoginAt: now } });
  req.user = user;
  req.tenantId = user.tenantId;
  await audit(req, action, action === 'auth.switch' ? { targetType: 'User', targetId: user._id } : undefined);
  const businesses = await businessesOf(account._id);
  res.json({ token: signToken(user), ...sessionPayload(user, tenant), businessCount: businesses.length });
}

router.post('/login', loginLimiter, async (req, res) => {
  const { email, password, userId } = validate(
    z.object({ email: z.string().email(), password: z.string().min(1), userId: z.string().optional() }),
    req.body
  );
  const account = await findAccount(email);
  if (!account || !(await account.comparePassword(password))) throw unauthorized('Invalid email or password');
  await openMembership(req, res, account, userId, 'auth.login');
});

/** Businesses this login can open, with unread chats / tasks due in each (the switcher) */
router.get('/businesses', authenticate, async (req, res) => {
  if (!req.user.accountId) return res.json({ items: [], current: String(req.user._id) });
  res.json({ items: await businessesOf(req.user.accountId, { counts: true }), current: String(req.user._id), email: req.user.email });
});

/** Open another business of the same login, without logging out */
router.post('/switch', authenticate, async (req, res) => {
  const { userId } = validate(z.object({ userId: z.string().min(1) }), req.body);
  if (req.impersonatedBy) throw forbidden('Exit "view as business" first');
  const target = await User.findById(userId).select('accountId isActive').lean().catch(() => null);
  if (!target || !req.user.accountId || String(target.accountId) !== String(req.user.accountId)) throw forbidden('This business is not on your login');
  if (!target.isActive) throw forbidden('Your access to this business is disabled');
  const account = await Account.findById(req.user.accountId);
  await openMembership(req, res, account, userId, 'auth.switch');
});

/**
 * "I also have a login for another business": prove it with that login's email + password.
 * Its businesses move to this login; the other email stops working as a login.
 */
router.post('/link', authenticate, async (req, res) => {
  const data = validate(z.object({ email: z.string().email(), password: z.string().min(1) }), req.body);
  if (req.impersonatedBy) throw forbidden('Not available while viewing as a business');
  if (req.user.role === 'super_admin') throw forbidden('The Super Admin login can not be linked with a business login');
  const account = await ensureAccountForUser(req.user);
  const result = await linkAccounts(account, data);
  await audit(req, 'auth.link_login', { meta: { removedEmail: result.removedEmail, businesses: result.businesses } });
  res.json({ ...result, items: await businessesOf(account._id, { counts: true }) });
});

router.get('/me', authenticate, async (req, res) => {
  // How many businesses this login can open (the sidebar shows the switcher when more than one)
  const businessCount = req.user.accountId && !req.impersonatedBy ? await User.countDocuments({ accountId: req.user.accountId, isActive: true }) : 1;
  res.json({ ...sessionPayload(req.user, req.tenant, req.impersonatedBy), businessCount });
});

router.post('/change-password', authenticate, async (req, res) => {
  const { currentPassword, newPassword } = validate(
    z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8, 'Password must be at least 8 characters') }),
    req.body
  );
  if (req.impersonatedBy) throw forbidden('Cannot change password while impersonating');
  // The password belongs to the login, so it changes for every business of this person
  const account = await Account.findById((await ensureAccountForUser(req.user))._id).select('+password');
  if (!(await account.comparePassword(currentPassword))) throw badRequest('Current password is incorrect');
  account.password = newPassword;
  await account.save();
  await audit(req, 'auth.change_password');
  res.json({ ok: true });
});

export default router;
