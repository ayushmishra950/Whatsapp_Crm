/**
 * Student fees: a plan (total, discount, instalments with due dates) and payments. Payments cover instalments in
 * order, so a part payment simply leaves the rest of that instalment due. Reminders (worker, daily):
 * 3 days before -> fee_due_soon, on the day -> fee_due_today, a day late -> fee_overdue + a task to collect.
 */
import { Contact, Template, Tenant } from '../models/index.js';
import { automationNote, createTask, notify } from './alerts.js';
import { sendAutomatedTemplate, automationSettings } from './drips.js';
import { getLeadStatuses } from './leadStatuses.js';
import { addDays, dayKey, localMinutes } from '../utils/time.js';

const money = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const prettyDay = (d) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || '');
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : d || '';
};

/** Totals and the state of every instalment (paid / partial / overdue / due / upcoming) */
export function feeSummary(fees = {}, today = dayKey(new Date(), 'Asia/Kolkata')) {
  const total = Number(fees.total) || 0;
  const discount = Number(fees.discount) || 0;
  const payable = Math.max(0, total - discount);
  const paid = (fees.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  let left = paid;
  const installments = [...(fees.installments || [])]
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .map((i) => {
      const amount = Number(i.amount) || 0;
      const covered = Math.min(amount, Math.max(0, left));
      left -= covered;
      const remaining = amount - covered;
      const status = remaining <= 0 ? 'paid' : i.dueDate < today ? 'overdue' : i.dueDate === today ? 'due' : covered > 0 ? 'partial' : 'upcoming';
      return { _id: i._id, amount, dueDate: i.dueDate, covered, remaining, status, reminded: i.reminded || {} };
    });
  const next = installments.find((i) => i.remaining > 0) || null;
  const payments = [...(fees.payments || [])].sort((a, b) => (b.date || '').localeCompare(a.date || '') || new Date(b.at) - new Date(a.at));
  return {
    total, discount, payable, paid,
    balance: Math.max(0, payable - paid),
    installments,
    next: next && { amount: next.remaining, dueDate: next.dueDate, status: next.status },
    overdue: installments.filter((i) => i.status === 'overdue').reduce((s, i) => s + i.remaining, 0),
    lastPayment: payments[0] || null,
    payments,
  };
}

/** Keep the list / reminder fields (paid, balance, next due) in step with the plan and payments */
export function refreshFeeFields(contact) {
  const s = feeSummary(contact.fees);
  contact.fees.paid = s.paid;
  contact.fees.balance = s.balance;
  contact.fees.nextDue = s.next?.dueDate || '';
  contact.fees.nextAmount = s.next?.amount || 0;
  return s;
}

/** Values for fee template variables ({{fee.next_amount}}…) */
export function feeVariable(contact, key) {
  const s = feeSummary(contact.fees || {});
  switch (key) {
    case 'next_amount': return s.next ? money(s.next.amount) : '';
    case 'next_due': return s.next ? prettyDay(s.next.dueDate) : '';
    case 'balance': return money(s.balance);
    case 'paid': return money(s.paid);
    case 'total': return money(s.payable);
    case 'last_amount': return s.lastPayment ? money(s.lastPayment.amount) : '';
    case 'last_paid_date': return s.lastPayment ? prettyDay(s.lastPayment.date) : '';
    case 'last_receipt': return s.lastPayment?.receiptNo || '';
    default: return '';
  }
}

// Template of the business for a reminder, in the student's language (approved only)
export async function approvedTemplate(tenantId, base, lang) {
  const names = lang === 'hi' ? [`${base}_hi`, `${base}_en`, base] : [`${base}_en`, base, `${base}_hi`];
  const list = await Template.find({ tenantId, name: { $in: names }, status: 'approved' }).lean();
  return names.map((n) => list.find((t) => t.name === n)).find(Boolean) || null;
}

/** Send one of the fee templates (if the business has it approved). Returns 'sent' | 'no_template' | 'failed' | 'opted_out' */
export async function sendFeeMessage(tenant, contact, base) {
  if (contact.optedOut) return 'opted_out';
  const template = await approvedTemplate(tenant._id, base, contact.language);
  if (!template) return 'no_template';
  try {
    const msg = await sendAutomatedTemplate({ tenant, contact, template, variables: template.variableDefaults, automation: { kind: 'drip', name: 'Fee reminder' } });
    return msg.status === 'failed' ? 'failed' : 'sent';
  } catch {
    return 'failed';
  }
}

/** A payment was recorded: note, receipt, status Fee pending -> Enrolled. Returns the new summary. */
export async function afterPayment(tenant, contact, payment, { sendReceipt = true, statusChanged } = {}) {
  const s = feeSummary(contact.fees);
  let receipt = '';
  if (sendReceipt) {
    const r = await sendFeeMessage(tenant, contact, 'payment_receipt');
    receipt = r === 'sent' ? ' · receipt sent on WhatsApp' : r === 'no_template' ? ' · (no approved payment_receipt template, receipt not sent)' : '';
  }
  await automationNote(
    tenant,
    contact,
    `💰 Payment received: ${money(payment.amount)}${payment.mode ? ` (${payment.mode})` : ''}${payment.receiptNo ? ` · receipt ${payment.receiptNo}` : ''}\nPaid ${money(s.paid)} of ${money(s.payable)} · Balance ${money(s.balance)}${s.next ? ` · Next due ${money(s.next.amount)} on ${prettyDay(s.next.dueDate)}` : ' · Fully paid 🎉'}${receipt}`
  );
  if (statusChanged) statusChanged();
  return s;
}

export const ENROLLED_FROM = ['fee_pending', 'hot', 'demo_attended'];
/** The status a lead moves to on their first payment (Converted – Enrolled), or null */
export function statusOnPayment(tenant, contact) {
  const has = (k) => getLeadStatuses(tenant).some((x) => x.key === k);
  return ENROLLED_FROM.includes(contact.leadStatus) && has('converted') ? 'converted' : null;
}

// ---------- daily reminders ----------
async function remindersForTenant(tenant, now) {
  if (tenant.settings?.automation?.feeReminders === false) return;
  const s = automationSettings(tenant);
  const today = dayKey(now, s.tz);
  // Messages only in working hours (after quiet hours end, before they start)
  const minutes = localMinutes(now, s.tz);
  const quiet = s.quietStart != null && s.quietEnd != null && s.quietStart !== s.quietEnd
    && (s.quietStart < s.quietEnd ? minutes >= s.quietStart && minutes < s.quietEnd : minutes >= s.quietStart || minutes < s.quietEnd);
  if (quiet) return;
  const soonDay = addDays(today, 3);
  const contacts = await Contact.find({ tenantId: tenant._id, 'fees.nextDue': { $ne: '', $lte: soonDay }, 'fees.balance': { $gt: 0 } }).limit(500);
  for (const contact of contacts) {
    const sum = feeSummary(contact.fees, today);
    const inst = sum.installments.find((i) => i.remaining > 0);
    if (!inst) continue;
    const doc = contact.fees.installments.id(inst._id);
    if (!doc) continue;
    doc.reminded ||= {};
    let kind = null;
    if (inst.dueDate > today && inst.dueDate <= soonDay && !doc.reminded.soon) kind = 'soon';
    else if (inst.dueDate === today && !doc.reminded.due) kind = 'due';
    else if (inst.dueDate < today && !doc.reminded.overdue) kind = 'overdue';
    if (!kind) continue;
    doc.reminded[kind] = now;
    contact.markModified('fees.installments');
    await contact.save();
    const result = await sendFeeMessage(tenant, contact, { soon: 'fee_due_soon', due: 'fee_due_today', overdue: 'fee_overdue' }[kind]);
    const who = contact.name || `+${contact.phone}`;
    await automationNote(tenant, contact, `⏰ Fee ${kind === 'soon' ? 'due soon' : kind === 'due' ? 'due today' : 'overdue'}: ${money(inst.remaining)} (due ${prettyDay(inst.dueDate)})${result === 'sent' ? ' · WhatsApp reminder sent' : result === 'no_template' ? ' · no approved reminder template' : ''}`);
    if (kind === 'overdue') {
      await createTask({ tenantId: tenant._id, contact, title: `Collect fee ${money(inst.remaining)} from ${who} (due ${prettyDay(inst.dueDate)})`, kind: 'followup', dueAt: now, source: 'automation', sourceName: 'Fee overdue' });
      await notify(tenant._id, { to: 'both', contact, kind: 'overdue', title: `Fee overdue: ${who}`, body: `${money(inst.remaining)} was due on ${prettyDay(inst.dueDate)}` });
    }
  }
}

export async function runFeeReminders(now = new Date()) {
  const tenantIds = await Contact.distinct('tenantId', { 'fees.balance': { $gt: 0 }, 'fees.nextDue': { $ne: '' } });
  for (const id of tenantIds) {
    const tenant = await Tenant.findById(id).populate('plan');
    if (!tenant || tenant.status === 'suspended') continue;
    try {
      await remindersForTenant(tenant, now);
    } catch (err) {
      console.error('[fees] reminders error', err.message);
    }
  }
}
