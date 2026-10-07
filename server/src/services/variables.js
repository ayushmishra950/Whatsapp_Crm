import { ensureReferralCode, referralLink } from './referrals.js';

/**
 * Values for a template's {{1}}, {{2}}... for one contact.
 * variable = { source: 'field', value: 'name' | 'phone' | 'email' | 'custom.<key>' | 'referral_code' | 'referral_link' }
 *          | { source: 'static', value: 'text' }
 * Date fields are shown as "15 Aug" / "15 Aug 2002".
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const prettyDate = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || '');
  if (!m) return v;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}${m[1] !== '0000' ? ` ${m[1]}` : ''}`;
};

async function resolveOne(variable, contact, tenant) {
  if (variable.source === 'static') return variable.value;
  const field = variable.value || '';
  if (field === 'referral_code') return ensureReferralCode(contact);
  if (field === 'referral_link') {
    await ensureReferralCode(contact);
    return referralLink(tenant, contact);
  }
  if (field.startsWith('custom.')) {
    const v = contact.customFields?.get ? contact.customFields.get(field.slice(7)) : contact.customFields?.[field.slice(7)];
    return prettyDate(v || '');
  }
  return contact[field] || '';
}

// WhatsApp rejects empty parameters, so an empty value becomes a single space
export async function resolveVariables(variables = [], contact, tenant) {
  const out = [];
  for (const v of variables) out.push((await resolveOne(v, contact, tenant)) || ' ');
  return out;
}
