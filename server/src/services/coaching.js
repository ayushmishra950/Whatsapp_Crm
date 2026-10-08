/**
 * "Coaching institute" business type (Infonic playbook). Only businesses the Super Admin marks as coaching get
 * the coaching format: Courses page, course / Hinglish variables and templates, language + course detection,
 * and the 19-status playbook preset with its keyword rules. Other businesses use the general CRM.
 */
import { Contact, Tenant } from '../models/index.js';
import { badRequest, forbidden } from '../utils/http.js';
import { INFONIC_AUTOMATION_RULES, INFONIC_LEAD_STATUSES, INFONIC_RETURNING_LEAD, getLeadStatuses } from './leadStatuses.js';

export const BUSINESS_TYPES = ['general', 'coaching'];
export const isCoaching = (tenant) => tenant?.businessType === 'coaching';

/** Express middleware: coaching businesses only */
export function requireCoaching(req, _res, next) {
  if (!isCoaching(req.tenant)) return next(forbidden('This feature is for coaching institutes. Ask your platform admin to switch it on.'));
  next();
}

/**
 * Apply the playbook to a business: 19 statuses with stages and time limits, hot-word / objection keyword rules
 * (added to the business's own rules) and "lead came back → Hot". Leads in a status that no longer exists move to New.
 */
export async function applyCoachingPreset(tenantId, { rules = true } = {}) {
  const tenant = await Tenant.findById(tenantId);
  const now = new Date();
  const next = INFONIC_LEAD_STATUSES.map((s) => ({ ...s, timeLimit: { ...s.timeLimit }, onTimeout: { ...s.onTimeout }, ...(s.timeLimit.amount && { limitSince: now }) }));
  const keys = new Set(next.map((s) => s.key));
  const removed = getLeadStatuses(tenant).filter((s) => !keys.has(s.key)).map((s) => s.key);
  const moved = removed.length ? (await Contact.updateMany({ tenantId, leadStatus: { $in: removed } }, { $set: { leadStatus: 'new' } })).modifiedCount : 0;
  const set = { 'settings.leadStatuses': next };
  if (rules) {
    const own = (tenant.settings?.automationRules || []).map((r) => (r.toObject ? r.toObject() : r));
    const names = new Set(own.map((r) => r.name));
    set['settings.automationRules'] = [...own, ...INFONIC_AUTOMATION_RULES.filter((r) => !names.has(r.name)).map((r) => ({ ...r, enabled: true }))];
    set['settings.automation.returningLead'] = INFONIC_RETURNING_LEAD;
  }
  await Tenant.updateOne({ _id: tenantId }, { $set: set });
  return { removed, moved };
}

/** Business uses the playbook statuses already? (so switching the type on does not overwrite edits) */
export const hasPlaybookStatuses = (tenant) => getLeadStatuses(tenant).some((s) => s.key === 'call_pending' || s.key === 'hot');

// ---------- logo ----------
// Small PNG / JPEG / WebP as a data URL (the browser shrinks it before upload). SVG is not accepted (it can carry scripts).
export const LOGO_MAX_CHARS = 300 * 1024;
export function checkLogo(value) {
  const logo = String(value || '');
  if (!logo) return '';
  if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(logo)) throw badRequest('Logo must be a PNG, JPG or WebP image');
  if (logo.length > LOGO_MAX_CHARS) throw badRequest('Logo is too big (max ~200 KB)');
  return logo;
}
