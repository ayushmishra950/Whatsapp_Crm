import { ensureReferralCode, referralLink } from './referrals.js';
import { Course } from '../models/index.js';
import { counsellorOf } from './alerts.js';
import { feeVariable } from './fees.js';
import User from '../models/User.js';

/**
 * Extra variable fields (besides contact fields):
 *  course.name / course.outcome / course.next_batch / course.per_day / course.fees / course.greeting /
 *  course.proof_link / course.duration / course.internship  -> the lead's course (Courses page);
 *    fees / greeting use the Hinglish text for Hinglish leads
 *  counsellor -> name of the person the chat is assigned to
 *  business.name / business.review_link / business.proof_link / business.offer_end / business.address /
 *  business.maps_link / business.payment_details -> Settings → Message info
 */
export const EXTRA_VARIABLE_FIELDS = [
  { key: 'course.name', label: 'Course name' },
  { key: 'course.outcome', label: 'Course outcome' },
  { key: 'course.next_batch', label: 'Next batch date' },
  { key: 'course.per_day', label: 'Fee per day' },
  { key: 'course.fees', label: 'Course fees text' },
  { key: 'course.greeting', label: 'Course greeting' },
  { key: 'course.duration', label: 'Course duration' },
  { key: 'course.internship', label: 'Internship line' },
  { key: 'course.proof_link', label: 'Course proof link' },
  { key: 'course.link', label: 'Course website page' },
  { key: 'fee.next_amount', label: 'Next instalment amount' },
  { key: 'fee.next_due', label: 'Next instalment due date' },
  { key: 'fee.balance', label: 'Fee balance' },
  { key: 'fee.paid', label: 'Fee paid so far' },
  { key: 'fee.total', label: 'Total fee (after discount)' },
  { key: 'fee.last_amount', label: 'Last payment amount' },
  { key: 'fee.last_paid_date', label: 'Last payment date' },
  { key: 'fee.last_receipt', label: 'Last receipt number' },
  { key: 'counsellor', label: 'Counsellor name' },
  { key: 'business.name', label: 'Business name' },
  { key: 'business.review_link', label: 'Review link' },
  { key: 'business.proof_link', label: 'Proof / results link' },
  { key: 'business.offer_end', label: 'Offer end date' },
  { key: 'business.address', label: 'Address' },
  { key: 'business.maps_link', label: 'Google Maps link' },
  { key: 'business.payment_details', label: 'Payment details' },
  { key: 'business.city', label: 'City' },
  { key: 'business.students_trained', label: 'Students trained' },
  { key: 'business.since_year', label: 'Since (year)' },
  { key: 'business.rating', label: 'Rating' },
];

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

async function courseValue(key, contact, cache) {
  if (!contact.course) return '';
  if (!cache.course) cache.course = (await Course.findOne({ tenantId: contact.tenantId, code: contact.course })) || { missing: true };
  const c = cache.course;
  if (c.missing) return '';
  const hi = contact.language === 'hi';
  switch (key) {
    case 'name': return c.name;
    case 'outcome': return c.outcome;
    case 'next_batch': return prettyDate(c.nextBatchDate);
    case 'per_day': return c.perDay;
    case 'fees': return (hi && c.feesHi) || c.feesEn || c.feesHi;
    case 'greeting': return (hi && c.greetingHi) || c.greetingEn || c.greetingHi;
    case 'duration': return c.durationDays ? `${c.durationDays} days` : '';
    case 'internship': return c.internshipLine;
    case 'proof_link': return c.proofLink || '';
    case 'link': return c.pageUrl || '';
    default: return '';
  }
}

async function resolveOne(variable, contact, tenant, cache) {
  if (variable.source === 'static') return variable.value;
  const field = variable.value || '';
  if (field.startsWith('course.')) {
    if (tenant?.businessType !== 'coaching') return '';
    const v = await courseValue(field.slice(7), contact, cache);
    return v || (field === 'course.proof_link' ? tenant?.settings?.messageInfo?.proofLink || '' : '');
  }
  if (field.startsWith('fee.')) return feeVariable(contact, field.slice(4));
  if (field === 'counsellor') {
    const id = await counsellorOf(contact);
    return id ? (await User.findById(id).select('name').lean())?.name || '' : '';
  }
  if (field.startsWith('business.')) {
    const info = tenant?.settings?.messageInfo || {};
    const map = {
      name: tenant?.name, review_link: info.reviewLink, proof_link: info.proofLink, offer_end: prettyDate(info.offerEnd),
      address: info.address, maps_link: info.mapsLink, payment_details: info.paymentDetails,
      city: info.city, students_trained: info.studentsTrained, since_year: info.sinceYear, rating: info.rating,
    };
    return map[field.slice(9)] || '';
  }
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
  const cache = {};
  for (const v of variables) out.push((await resolveOne(v, contact, tenant, cache)) || ' ');
  return out;
}
