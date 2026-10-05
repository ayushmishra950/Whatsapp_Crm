import { Tenant, User, Contact } from '../models/index.js';
import { HttpError } from '../utils/http.js';

export const currentMonth = () => new Date().toISOString().slice(0, 7);

export function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

export function isSubscriptionActive(tenant) {
  const sub = tenant.subscription || {};
  if (!['trial', 'active'].includes(sub.status)) return false;
  return !sub.currentPeriodEnd || new Date(sub.currentPeriodEnd) > new Date();
}

export function messagesUsedThisMonth(tenant) {
  return tenant.usage?.month === currentMonth() ? tenant.usage.messagesSent || 0 : 0;
}

const paymentRequired = (msg) => new HttpError(402, msg);

// Throws if the tenant can not send `count` more outbound messages right now
export function assertCanSend(tenant, count = 1) {
  if (tenant.status === 'suspended') throw paymentRequired('Business account is suspended');
  if (!isSubscriptionActive(tenant)) throw paymentRequired('Subscription expired. Please renew your plan to send messages.');
  const limit = tenant.plan?.limits?.monthlyMessages;
  if (limit != null && messagesUsedThisMonth(tenant) + count > limit) {
    throw paymentRequired(`Monthly message limit (${limit}) reached. Upgrade your plan.`);
  }
}

export async function incrementUsage(tenantId, count = 1) {
  const month = currentMonth();
  const res = await Tenant.updateOne({ _id: tenantId, 'usage.month': month }, { $inc: { 'usage.messagesSent': count } });
  if (res.matchedCount === 0) {
    // New month: reset counter
    await Tenant.updateOne({ _id: tenantId }, { $set: { usage: { month, messagesSent: count } } });
  }
}

export async function assertAgentLimit(tenant) {
  const limit = tenant.plan?.limits?.agents;
  if (limit == null) return;
  const count = await User.countDocuments({ tenantId: tenant._id, role: 'agent' });
  if (count >= limit) throw paymentRequired(`Your plan allows only ${limit} agents. Upgrade to add more.`);
}

export async function assertContactLimit(tenant, adding = 1) {
  const limit = tenant.plan?.limits?.contacts;
  if (limit == null) return;
  const count = await Contact.countDocuments({ tenantId: tenant._id });
  if (count + adding > limit) throw paymentRequired(`Your plan allows only ${limit} contacts. Upgrade to add more.`);
}

export async function remainingContactSlots(tenant) {
  const limit = tenant.plan?.limits?.contacts;
  if (limit == null) return Infinity;
  const count = await Contact.countDocuments({ tenantId: tenant._id });
  return Math.max(0, limit - count);
}
