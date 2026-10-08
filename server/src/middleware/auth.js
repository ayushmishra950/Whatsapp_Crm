import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { User, Tenant, Plan } from '../models/index.js';
import { unauthorized, forbidden } from '../utils/http.js';

// Plans change rarely: keep them in memory for a minute (every API call needs the business's plan)
const planCache = new Map(); // id -> { plan, at }
const PLAN_TTL_MS = 60 * 1000;
async function cachedPlan(id) {
  const key = String(id);
  const hit = planCache.get(key);
  if (hit && Date.now() - hit.at < PLAN_TTL_MS) return hit.plan;
  const plan = await Plan.findById(key);
  if (plan) planCache.set(key, { plan, at: Date.now() });
  return plan || id;
}
export const clearPlanCache = () => planCache.clear();

export function signToken(user, { impersonatedBy } = {}) {
  const payload = { sub: String(user._id) };
  if (impersonatedBy) payload.imp = String(impersonatedBy);
  return jwt.sign(payload, env.jwtSecret, { expiresIn: impersonatedBy ? '2h' : env.jwtExpiresIn });
}

// Shared by HTTP middleware and socket.io handshake
export async function resolveSession(token) {
  if (!token) throw unauthorized('Login required');
  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret);
  } catch {
    throw unauthorized('Session expired, please login again');
  }

  const user = await User.findById(payload.sub);
  if (!user || !user.isActive) throw unauthorized('Account is disabled');

  let tenant = null;
  if (user.tenantId) {
    tenant = await Tenant.findById(user.tenantId);
    if (tenant?.plan) tenant.plan = await cachedPlan(tenant.plan); // same as populate('plan'), one DB call less
    if (!tenant) throw unauthorized('Business not found');
    // Super admin can still enter a suspended business while impersonating
    if (tenant.status === 'suspended' && !payload.imp) {
      throw forbidden('This business account is suspended. Contact support.');
    }
  }
  return { user, tenant, impersonatedBy: payload.imp || null };
}

export async function authenticate(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const session = await resolveSession(token);
  req.user = session.user;
  req.tenant = session.tenant;
  req.tenantId = session.tenant?._id || null;
  req.impersonatedBy = session.impersonatedBy;
  next();
}

export const authorize =
  (...roles) =>
  (req, _res, next) => {
    if (!roles.includes(req.user.role)) throw forbidden('You do not have permission for this action');
    next();
  };

// Every business-scoped route must go through this so queries always filter by tenantId
export function requireTenant(req, _res, next) {
  if (!req.tenantId) throw forbidden('This action is only available inside a business account');
  next();
}
