import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Contact } from '../models/index.js';
import { authorize } from '../middleware/auth.js';
import { validate, notFound, badRequest } from '../utils/http.js';
import { audit } from '../services/audit.js';
import { afterPayment, feeSummary, refreshFeeFields, statusOnPayment } from '../services/fees.js';
import { triggerDrips, automationSettings } from '../services/drips.js';
import { addDays, dayKey } from '../utils/time.js';

// Student fees: plan, payments, and the dues list / totals for the Fees page
const router = Router();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');
const amount = z.coerce.number().min(0).max(100000000);

async function findContact(req) {
  if (!mongoose.isValidObjectId(req.params.id)) throw notFound('Contact not found');
  const contact = await Contact.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!contact) throw notFound('Contact not found');
  return contact;
}
const today = (req) => dayKey(new Date(), automationSettings(req.tenant).tz);
const reply = (contact, req) => ({ fees: { ...feeSummary(contact.fees, today(req)), note: contact.fees.note || '' }, contactId: contact._id });

router.get('/contact/:id', async (req, res) => {
  res.json(reply(await findContact(req), req));
});

/** Save the plan: total, discount and instalments (reminder flags kept for unchanged instalments) */
router.put('/contact/:id', async (req, res) => {
  const data = validate(
    z.object({
      total: amount,
      discount: amount.default(0),
      note: z.string().trim().max(500).default(''),
      installments: z.array(z.object({ _id: z.string().optional(), amount: amount.refine((v) => v > 0, 'Instalment amount must be more than 0'), dueDate: day })).max(60),
    }),
    req.body
  );
  if (data.discount > data.total) throw badRequest('Discount can not be more than the total fee');
  const sum = data.installments.reduce((s, i) => s + i.amount, 0);
  if (data.installments.length && Math.abs(sum - (data.total - data.discount)) > 1) {
    throw badRequest(`Instalments add up to ₹${sum.toLocaleString('en-IN')}, but the fee after discount is ₹${(data.total - data.discount).toLocaleString('en-IN')}`);
  }
  const contact = await findContact(req);
  const old = new Map((contact.fees.installments || []).map((i) => [String(i._id), i]));
  contact.fees.total = data.total;
  contact.fees.discount = data.discount;
  contact.fees.note = data.note;
  contact.fees.installments = data.installments.map((i) => {
    const prev = i._id && old.get(i._id);
    // Same instalment, same date and amount: keep "already reminded"; a new date / amount gets fresh reminders
    const reminded = prev && prev.dueDate === i.dueDate && prev.amount === i.amount ? prev.reminded : {};
    return { ...(prev && { _id: prev._id }), amount: i.amount, dueDate: i.dueDate, reminded };
  });
  refreshFeeFields(contact);
  await contact.save();
  await audit(req, 'fees.plan', { targetType: 'Contact', targetId: contact._id, meta: { total: data.total, discount: data.discount, installments: data.installments.length } });
  res.json(reply(contact, req));
});

/** Record a payment (covers instalments in order) */
router.post('/contact/:id/payments', async (req, res) => {
  const data = validate(
    z.object({
      amount: amount.refine((v) => v > 0, 'Enter the amount received'),
      date: day.optional(),
      mode: z.string().trim().max(30).default(''),
      receiptNo: z.string().trim().max(40).default(''),
      note: z.string().trim().max(300).default(''),
      sendReceipt: z.boolean().default(true),
    }),
    req.body
  );
  const contact = await findContact(req);
  const payment = { amount: data.amount, date: data.date || today(req), mode: data.mode, receiptNo: data.receiptNo, note: data.note, by: req.user._id, at: new Date() };
  contact.fees.payments.push(payment);
  refreshFeeFields(contact);
  // First payment of a lead in Fee pending / Hot -> Converted – Enrolled
  const newStatus = statusOnPayment(req.tenant, contact);
  if (newStatus) Object.assign(contact, { leadStatus: newStatus, statusUpdatedAt: new Date(), statusUpdatedBy: req.user._id });
  await contact.save();
  await afterPayment(req.tenant, contact, payment, { sendReceipt: data.sendReceipt });
  if (newStatus) triggerDrips(req.tenantId, { type: 'status_changed', contactIds: [contact._id], status: newStatus });
  await audit(req, 'fees.payment', { targetType: 'Contact', targetId: contact._id, meta: { amount: data.amount, mode: data.mode } });
  res.status(201).json({ ...reply(contact, req), statusChanged: newStatus });
});

router.delete('/contact/:id/payments/:paymentId', authorize('admin'), async (req, res) => {
  const contact = await findContact(req);
  const p = contact.fees.payments.id(req.params.paymentId);
  if (!p) throw notFound('Payment not found');
  const meta = { amount: p.amount, date: p.date, receiptNo: p.receiptNo };
  p.deleteOne();
  refreshFeeFields(contact);
  await contact.save();
  await audit(req, 'fees.payment_delete', { targetType: 'Contact', targetId: contact._id, meta });
  res.json(reply(contact, req));
});

/** Fees page: totals + students with dues. when = overdue | week | month | all */
router.get('/', async (req, res) => {
  const t = today(req);
  const when = req.query.when || 'all';
  const filter = { tenantId: req.tenantId, 'fees.balance': { $gt: 0 } };
  if (when === 'overdue') filter['fees.nextDue'] = { $ne: '', $lt: t };
  else if (when === 'today') filter['fees.nextDue'] = t;
  else if (when === 'week') filter['fees.nextDue'] = { $ne: '', $lte: addDays(t, 7) };
  else if (when === 'month') filter['fees.nextDue'] = { $ne: '', $lte: addDays(t, 31) };
  if (req.query.search) {
    const rx = { $regex: String(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    filter.$or = [{ name: rx }, { phone: rx }];
  }
  const monthStart = `${t.slice(0, 7)}-01`;
  const [items, totals, collected] = await Promise.all([
    Contact.find(filter).sort({ 'fees.nextDue': 1 }).limit(500).select('name phone course leadStatus assignedTo fees.total fees.discount fees.paid fees.balance fees.nextDue fees.nextAmount').populate('assignedTo', 'name').lean(),
    Contact.aggregate([
      { $match: { tenantId: req.tenantId, 'fees.total': { $gt: 0 } } },
      {
        $group: {
          _id: null,
          students: { $sum: 1 },
          billed: { $sum: { $subtract: ['$fees.total', { $ifNull: ['$fees.discount', 0] }] } },
          paid: { $sum: '$fees.paid' },
          balance: { $sum: '$fees.balance' },
          overdue: { $sum: { $cond: [{ $and: [{ $gt: ['$fees.balance', 0] }, { $ne: ['$fees.nextDue', ''] }, { $lt: ['$fees.nextDue', t] }] }, 1, 0] } },
          dueWeek: { $sum: { $cond: [{ $and: [{ $gt: ['$fees.balance', 0] }, { $ne: ['$fees.nextDue', ''] }, { $lte: ['$fees.nextDue', addDays(t, 7)] }, { $gte: ['$fees.nextDue', t] }] }, '$fees.nextAmount', 0] } },
        },
      },
    ]),
    Contact.aggregate([
      { $match: { tenantId: req.tenantId, 'fees.payments.0': { $exists: true } } },
      { $unwind: '$fees.payments' },
      { $match: { 'fees.payments.date': { $gte: monthStart } } },
      { $group: { _id: null, amount: { $sum: '$fees.payments.amount' }, count: { $sum: 1 } } },
    ]),
  ]);
  res.json({
    today: t,
    totals: { ...(totals[0] || { students: 0, billed: 0, paid: 0, balance: 0, overdue: 0, dueWeek: 0 }), collectedThisMonth: collected[0]?.amount || 0, paymentsThisMonth: collected[0]?.count || 0 },
    items,
  });
});

export default router;
