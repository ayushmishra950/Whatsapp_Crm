import { HttpError } from '../utils/http.js';

/**
 * Each business has its own lead statuses (Settings → Lead statuses).
 * Keys never change once created (contacts store the key); labels and colors can be edited.
 * The first five keep the original keys so existing data stays valid.
 */
const NO_LIMIT = { amount: 0, unit: 'days' };
const NO_TIMEOUT = { moveTo: '', task: '', alert: false };
const status = (key, label, color, stage, limit = NO_LIMIT, onTimeout = {}) => ({
  key, label, color, stage, timeLimit: limit, onTimeout: { ...NO_TIMEOUT, ...onTimeout },
});

export const DEFAULT_LEAD_STATUSES = [
  status('new', 'New', 'purple', 'new'),
  status('contacted', 'Contacted', 'blue', 'contacted'),
  status('qualified', 'Interested', 'yellow', 'interested'),
  status('converted', 'Converted', 'green', 'converted'),
  status('lost', 'Not interested', 'red', 'closed'),
];
export const STATUS_COLORS = ['gray', 'blue', 'green', 'yellow', 'red', 'purple'];

// The 7 stages of a lead's journey; every status belongs to one (used for tabs and reports)
export const STAGES = [
  { key: 'new', label: 'New' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'interested', label: 'Interested' },
  { key: 'demo', label: 'Demo' },
  { key: 'admission', label: 'Admission' },
  { key: 'converted', label: 'Converted' },
  { key: 'closed', label: 'Nurture & Lost' },
];
export const STAGE_KEYS = STAGES.map((s) => s.key);

const h = (amount) => ({ amount, unit: 'hours' });
const m = (amount) => ({ amount, unit: 'minutes' });
const d = (amount) => ({ amount, unit: 'days' });

/**
 * "Infonic 19 statuses" preset (Lead Stages Playbook). The old default keys are reused
 * (new, contacted, qualified, converted, lost) so existing leads keep a sensible status.
 */
export const INFONIC_LEAD_STATUSES = [
  status('new', 'New – Bot chat', 'purple', 'new', h(2), { task: 'Call this new lead' }),
  status('call_pending', 'New – Call pending', 'purple', 'new', m(30), { alert: true, task: 'Call now – lead asked for a call' }),
  status('contacted', 'Contacted – No answer', 'blue', 'contacted', d(7), { moveTo: 'lost' }),
  status('call_back', 'Contacted – Call back', 'blue', 'contacted'),
  status('counselled', 'Counselled', 'blue', 'contacted', d(2), { moveTo: 'qualified' }),
  status('hot', 'Interested – Hot', 'red', 'interested', d(2), { alert: true }),
  status('qualified', 'Interested – Warm', 'yellow', 'interested', d(12), { moveTo: 'nurture_later' }),
  status('family_approval', 'Interested – Family approval', 'yellow', 'interested', d(9), { moveTo: 'qualified' }),
  status('price_concern', 'Interested – Price concern', 'yellow', 'interested', d(7), { moveTo: 'qualified', task: 'Call with a custom fee plan' }),
  status('demo_booked', 'Demo – Booked', 'green', 'demo'),
  status('demo_attended', 'Demo – Attended', 'green', 'demo', d(10), { moveTo: 'qualified' }),
  status('demo_no_show', 'Demo – No-show', 'gray', 'demo', d(4), { moveTo: 'qualified' }),
  status('fee_pending', 'Admission – Fee pending', 'green', 'admission', d(3), { moveTo: 'hot', alert: true }),
  status('converted', 'Converted – Enrolled', 'green', 'converted'),
  status('completed', 'Converted – Completed', 'green', 'converted'),
  status('nurture_later', 'Nurture – Later', 'gray', 'closed'),
  status('joined_elsewhere', 'Lost – Joined elsewhere', 'gray', 'closed'),
  status('lost', 'Lost – Not reachable / Junk', 'red', 'closed'),
  status('opted_out', 'Opted out', 'gray', 'closed'),
];

// A3/A4 keyword rules and A8 "came back" rule that go with the Infonic preset
export const INFONIC_AUTOMATION_RULES = [
  {
    name: 'Hot words → Interested – Hot',
    keywords: ['join', 'admission', 'fees jama', 'fee jama', 'account number', 'address', 'seat', 'kab se start', 'enroll'],
    onlyIfStatusIn: ['new', 'call_pending', 'contacted', 'call_back', 'counselled', 'qualified', 'family_approval', 'price_concern', 'demo_attended', 'demo_no_show', 'nurture_later'],
    setStatus: 'hot',
    addTags: [],
    alert: true,
    task: 'Hot lead – call within 15 minutes',
  },
  {
    name: 'Price objection',
    keywords: ['mehenga', 'mehnga', 'costly', 'expensive', 'budget nahi', 'budget nhi', 'discount', 'kam karo', 'fees zyada'],
    onlyIfStatusIn: ['new', 'contacted', 'call_back', 'counselled', 'qualified', 'demo_attended'],
    setStatus: 'price_concern',
    addTags: ['objection-price'],
    alert: false,
    task: '',
  },
  {
    name: 'Family approval',
    keywords: ['papa se', 'mummy se', 'family se', 'ghar pe baat', 'ghar par baat', 'parents se', 'gharwalon'],
    onlyIfStatusIn: ['new', 'contacted', 'call_back', 'counselled', 'qualified', 'demo_attended'],
    setStatus: 'family_approval',
    addTags: ['objection-family'],
    alert: false,
    task: '',
  },
];
export const INFONIC_RETURNING_LEAD = { enabled: true, fromStatuses: ['nurture_later', 'joined_elsewhere', 'lost'], toStatus: 'hot' };

const clean = (s) => ({
  key: s.key,
  label: s.label,
  color: s.color,
  stage: STAGE_KEYS.includes(s.stage) ? s.stage : '',
  timeLimit: { amount: s.timeLimit?.amount || 0, unit: s.timeLimit?.unit || 'days' },
  onTimeout: { moveTo: s.onTimeout?.moveTo || '', task: s.onTimeout?.task || '', alert: !!s.onTimeout?.alert },
  ...(s.limitSince && { limitSince: s.limitSince }),
});

export function getLeadStatuses(tenant) {
  const list = tenant?.settings?.leadStatuses;
  return list?.length ? list.map(clean) : DEFAULT_LEAD_STATUSES;
}

export const statusLabel = (tenant, key) => getLeadStatuses(tenant).find((s) => s.key === key)?.label || key;

const UNIT_MS = { minutes: 6e4, hours: 36e5, days: 864e5 };
export const limitMs = (limit) => (limit?.amount > 0 ? limit.amount * (UNIT_MS[limit.unit] || UNIT_MS.days) : 0);

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
