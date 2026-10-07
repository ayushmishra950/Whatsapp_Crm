import { HttpError } from '../utils/http.js';

/**
 * Each business has its own lead statuses (Settings → Lead statuses).
 * Keys never change once created (contacts store the key); labels and colors can be edited.
 * The first five keep the original keys so existing data stays valid.
 */
export const DEFAULT_LEAD_STATUSES = [
  { key: 'new', label: 'New', color: 'purple' },
  { key: 'contacted', label: 'Contacted', color: 'blue' },
  { key: 'qualified', label: 'Interested', color: 'yellow' },
  { key: 'converted', label: 'Converted', color: 'green' },
  { key: 'lost', label: 'Not interested', color: 'red' },
];
export const STATUS_COLORS = ['gray', 'blue', 'green', 'yellow', 'red', 'purple'];

export function getLeadStatuses(tenant) {
  const list = tenant?.settings?.leadStatuses;
  return list?.length ? list.map(({ key, label, color }) => ({ key, label, color })) : DEFAULT_LEAD_STATUSES;
}

export function assertLeadStatus(tenant, key) {
  if (!getLeadStatuses(tenant).some((s) => s.key === key)) {
    throw new HttpError(400, `Unknown lead status "${key}". Add it in Settings → Lead statuses first.`);
  }
  return key;
}

// Accepts a key or a label ("Interested", "interested", "qualified") - used by sheet imports
export function matchLeadStatus(tenant, value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return null;
  return getLeadStatuses(tenant).find((s) => s.key === v || s.label.toLowerCase() === v)?.key || null;
}

export const statusKeyFromLabel = (label) =>
  label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'status';

// ---------- Auto lead status from the customer's own words ----------
const INTEREST = String.raw`(?:interested|intrested|intersted|intrsted|interestd|interseted|interest|intrest)`;
const NO = String.raw`(?:not|no|nahi|nhi|nahin|nai)`;
const NO_AFTER = String.raw`(?:nahi|nhi|nahin|nai|not)`; // after the word: "no" here is usually "no doubt" etc.
const NEGATIVE = [
  new RegExp(String.raw`\b${NO}\s+(?:\w+\s+)?${INTEREST}\b`), // "not interested", "no interest", "nahi interested"
  new RegExp(String.raw`\b${INTEREST}\s+(?:\w+\s+)?${NO_AFTER}\b`), // "interested nahi hu", "interest nahi hai"
  /\bun-?interested\b/,
  /^(?:no thanks?|no thank you|nahi chahiye|nhi chahiye|nahin chahiye)$/, // only when that is the whole message
];
const POSITIVE = [
  /\b(?:interested|intrested|intersted|intrsted|interestd|interseted)\b/,
  new RegExp(String.raw`\b(?:interest|intrest)\s+(?:hai|he|h|hu|hoon)\b`), // "interest hai"
];

/**
 * Reads a customer message and returns the lead status it implies:
 * "lost" for "not interested" / "interested nahi", "qualified" for "interested", otherwise null.
 * Only short messages count (long ones are usually questions or stories), and a question like
 * "interested ho to kya karna hai?" does not mark the lead as interested.
 */
export function detectLeadIntent(text) {
  const t = String(text || '')
    .toLowerCase()
    .replace(/(.)\1{2,}/g, '$1') // "interesteddd" -> "interested"
    .replace(/[^\p{L}\p{N}?'\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t || t.length > 150) return null;
  if (NEGATIVE.some((r) => r.test(t))) return 'lost';
  if (!t.includes('?') && POSITIVE.some((r) => r.test(t))) return 'qualified';
  return null;
}

/**
 * Applies detectLeadIntent to the contact (if the business has it on and has that status).
 * Never touches a "Converted" lead. Returns { from, to } when the status changed, else null.
 * The caller saves the contact.
 */
export function autoLeadStatus(tenant, contact, text) {
  if (tenant?.settings?.autoLeadStatus === false) return null;
  const to = detectLeadIntent(text);
  if (!to || contact.leadStatus === to || contact.leadStatus === 'converted') return null;
  if (!getLeadStatuses(tenant).some((s) => s.key === to)) return null;
  const from = contact.leadStatus;
  contact.leadStatus = to;
  contact.statusUpdatedAt = new Date();
  contact.statusUpdatedBy = undefined;
  return { from, to };
}
