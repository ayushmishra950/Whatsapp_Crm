import { Tenant } from '../models/index.js';
import { badRequest } from '../utils/http.js';
import { parseDateInput } from '../utils/dates.js';

/**
 * Contact fields a business can use in templates / campaigns / chatbot questions.
 * Built-in fields are fixed; custom fields (Settings → Contact fields) are stored on the contact
 * as customFields.<key>. Keys never change once created, labels can.
 */
export const BUILTIN_CONTACT_FIELDS = [
  { key: 'name', label: 'Name' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
];
// Keys that would clash with real contact properties
const RESERVED = new Set(['name', 'phone', 'email', 'tags', 'notes', 'source', 'lead_status', 'leadstatus', 'status', 'id', '_id', 'course', 'language']);
export const FIELD_TYPES = ['text', 'date', 'select', 'multiselect'];
// Where a lead came from (automatic: whatsapp, ad, import; set by hand: the rest)
export const LEAD_SOURCES = ['whatsapp', 'ad', 'import', 'manual', 'website', 'walkin', 'referral', 'call', 'other'];
export const MANUAL_SOURCES = ['manual', 'website', 'walkin', 'referral', 'call', 'other'];

export const fieldKeyFromLabel = (label) =>
  String(label || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'field';

export const isReservedFieldKey = (key) => RESERVED.has(key);

export const getContactFields = (tenant) =>
  (tenant?.settings?.contactFields || []).map(({ key, label, type, options }) => ({
    key,
    label,
    type: type || 'text',
    ...((type === 'select' || type === 'multiselect') && { options: [...(options || [])] }),
  }));

// Is customFields.<key> a date field (birthday, anniversary...)?
export const isDateField = (tenant, key) => getContactFields(tenant).some((f) => f.key === key && f.type === 'date');

// "course_name" -> "Course name"
export const labelFromKey = (key) => {
  const s = String(key).replace(/_/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/**
 * Make sure these custom field keys exist in the business's field list (used by sheet import and the
 * chatbot, so fields they create show up in Settings and in template / campaign dropdowns).
 * labels: { key: label }
 */
export async function registerContactFields(tenantId, labels, types = {}) {
  const entries = Object.entries(labels).filter(([key]) => key && !isReservedFieldKey(key));
  if (!entries.length) return;
  const tenant = await Tenant.findById(tenantId).select('settings.contactFields');
  const existing = new Set(getContactFields(tenant).map((f) => f.key));
  const add = entries.filter(([key]) => !existing.has(key)).map(([key, label]) => ({ key, label: String(label || labelFromKey(key)).slice(0, 40), type: types[key] || 'text' }));
  if (add.length) await Tenant.updateOne({ _id: tenantId }, { $push: { 'settings.contactFields': { $each: add, $slice: 50 } } });
}

/**
 * Date fields are stored as "YYYY-MM-DD". Converts typed / imported values; strict = throw on a bad date
 * (contact form), otherwise bad dates are dropped (sheet import). Returns a new object.
 */
export function normalizeCustomFields(tenant, values = {}, { strict = false } = {}) {
  const fields = getContactFields(tenant);
  const out = {};
  for (const [key, raw] of Object.entries(values)) {
    const value = String(raw ?? '').trim();
    const def = fields.find((f) => f.key === key);
    if (def?.type === 'date' && value) {
      const iso = parseDateInput(value);
      if (!iso) {
        if (strict) throw badRequest(`"${def.label}" must be a date, e.g. 15/08/2002`);
        continue;
      }
      out[key] = iso;
    } else if ((def?.type === 'select' || def?.type === 'multiselect') && value) {
      // Dropdown fields: use the option's own spelling; multi-select is stored as "A, B"
      const parts = def.type === 'multiselect' ? value.split(',').map((v) => v.trim()).filter(Boolean) : [value];
      const picked = [];
      for (const p of parts) {
        const opt = def.options.find((o) => o.toLowerCase() === p.toLowerCase());
        if (!opt && strict) throw badRequest(`"${p}" is not an option of "${def.label}" (${def.options.join(', ')})`);
        picked.push(opt || p);
      }
      out[key] = [...new Set(picked)].join(', ');
    } else {
      out[key] = value;
    }
  }
  return out;
}
