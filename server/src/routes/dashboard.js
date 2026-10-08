import { Router } from 'express';
import { z } from 'zod';
import { AdSource, Contact, Conversation, Message, Campaign, Task, Template, User } from '../models/index.js';
import { authorize } from '../middleware/auth.js';
import { validate } from '../utils/http.js';
import { messagesUsedThisMonth } from '../services/subscription.js';
import { needsAttention } from '../services/automation.js';
import { DEFAULT_TZ, safeTimeZone, dayKey, startOfDayIn } from '../utils/time.js';

const router = Router();

router.get('/', async (req, res) => {
  const tenantId = req.tenantId;
  const isAgent = req.user.role === 'agent';
  const tz = safeTimeZone(req.query.tz || DEFAULT_TZ);
  const startOfDay = startOfDayIn(tz);
  const last7 = new Date(startOfDay.getTime() - 6 * 864e5);

  const convScope = { tenantId, ...(isAgent && { assignedTo: req.user._id }) };

  const [contacts, newLeadsToday, openChats, pendingChats, unassigned, todayIn, todayOut, daily, leadFunnel, recentCampaigns] =
    await Promise.all([
      Contact.countDocuments({ tenantId }),
      Contact.countDocuments({ tenantId, createdAt: { $gte: startOfDay } }),
      Conversation.countDocuments({ ...convScope, status: 'open' }),
      Conversation.countDocuments({ ...convScope, status: 'pending' }),
      Conversation.countDocuments({ tenantId, assignedTo: null, status: { $ne: 'resolved' }, 'bot.active': { $ne: true } }),
      Message.countDocuments({ tenantId, direction: 'inbound', createdAt: { $gte: startOfDay } }),
      Message.countDocuments({ tenantId, direction: 'outbound', createdAt: { $gte: startOfDay }, ...(isAgent && { sentBy: req.user._id }) }),
      Message.aggregate([
        { $match: { tenantId, direction: { $in: ['inbound', 'outbound'] }, createdAt: { $gte: last7 } } },
        {
          $group: {
            _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: tz } }, direction: '$direction' },
            count: { $sum: 1 },
          },
        },
      ]),
      Contact.aggregate([{ $match: { tenantId } }, { $group: { _id: '$leadStatus', count: { $sum: 1 } } }]),
      isAgent ? [] : Campaign.find({ tenantId }).sort({ createdAt: -1 }).limit(5).select('name status stats createdAt'),
    ]);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = dayKey(new Date(startOfDay.getTime() - (6 - i) * 864e5 + 12 * 3600e3), tz);
    const pick = (dir) => daily.find((x) => x._id.day === d && x._id.direction === dir)?.count || 0;
    return { day: d, inbound: pick('inbound'), outbound: pick('outbound') };
  });

  const botActive = await Conversation.countDocuments({ tenantId, 'bot.active': true, status: { $ne: 'resolved' } });

  // Follow-ups due by end of today (incl. overdue). Agents see the ones they set.
  const endOfToday = new Date(startOfDay.getTime() + 864e5);
  const followUpFilter = { tenantId, followUpAt: { $lt: endOfToday }, ...(isAgent && { followUpBy: req.user._id }) };
  const [followUpsDue, followUps] = await Promise.all([
    Contact.countDocuments(followUpFilter),
    Contact.find(followUpFilter).select('name phone followUpAt followUpNote followUpAction followUpSentAt leadStatus followUpBy').populate('followUpBy', 'name').sort({ followUpAt: 1 }).limit(8).lean(),
  ]);

  // Leads from Facebook/Instagram ads in the last 30 days
  const adLeads = await Contact.aggregate([
    { $match: { tenantId, 'adSource.sourceId': { $exists: true, $ne: null }, 'adSource.at': { $gte: new Date(Date.now() - 30 * 864e5) } } },
    { $group: { _id: '$adSource.sourceId', headline: { $last: '$adSource.headline' }, leads: { $sum: 1 }, converted: { $sum: { $cond: [{ $eq: ['$leadStatus', 'converted'] }, 1, 0] } } } },
    { $sort: { leads: -1 } },
    { $limit: 5 },
  ]);
  const adNames = Object.fromEntries(
    (await AdSource.find({ tenantId, sourceId: { $in: adLeads.map((a) => a._id) } }).select('sourceId name').lean()).map((a) => [a.sourceId, a.name])
  );
  res.json({
    botActive,
    contacts,
    newLeadsToday,
    openChats,
    pendingChats,
    unassigned,
    todayIn,
    todayOut,
    messagesThisMonth: messagesUsedThisMonth(req.tenant),
    monthlyLimit: req.tenant.plan?.limits?.monthlyMessages ?? null,
    daily: days,
    leadFunnel: Object.fromEntries(leadFunnel.map((l) => [l._id, l.count])),
    recentCampaigns,
    followUpsDue,
    followUps,
    adLeads: adLeads.map(({ _id, ...a }) => ({ adId: _id, ...a, name: adNames[_id] || '' })),
  });
});

/**
 * Team performance (admin): per team member for the last N days
 * chats handled, messages sent, leads marked converted, average time to reply to a customer.
 */
router.get('/team', authorize('admin'), async (req, res) => {
  const { days } = validate(z.object({ days: z.coerce.number().int().min(1).max(90).default(7) }), req.query);
  const tenantId = req.tenantId;
  const since = new Date(Date.now() - days * 864e5);

  const users = await User.find({ tenantId }).select('name role isActive').sort({ role: 1, name: 1 }).lean();
  const [handled, openNow, sent, converted, msgs, botStarted, botEnded] = await Promise.all([
    Conversation.aggregate([{ $match: { tenantId, assignedTo: { $ne: null }, lastMessageAt: { $gte: since } } }, { $group: { _id: '$assignedTo', n: { $sum: 1 } } }]),
    Conversation.aggregate([{ $match: { tenantId, assignedTo: { $ne: null }, status: { $ne: 'resolved' } } }, { $group: { _id: '$assignedTo', n: { $sum: 1 } } }]),
    Message.aggregate([{ $match: { tenantId, direction: 'outbound', isBot: { $ne: true }, campaignId: { $exists: false }, createdAt: { $gte: since } } }, { $group: { _id: '$sentBy', n: { $sum: 1 } } }]),
    Contact.aggregate([{ $match: { tenantId, leadStatus: 'converted', statusUpdatedAt: { $gte: since } } }, { $group: { _id: '$statusUpdatedBy', n: { $sum: 1 } } }]),
    // For reply time: customer messages and the team's replies in the period, per chat in time order
    Message.find({ tenantId, createdAt: { $gte: since }, $or: [{ direction: 'inbound' }, { direction: 'outbound', isBot: { $ne: true }, campaignId: { $exists: false } }] })
      .select('conversationId direction sentBy createdAt').sort({ conversationId: 1, createdAt: 1 }).limit(100000).lean(),
    Conversation.countDocuments({ tenantId, 'bot.startedAt': { $gte: since } }),
    Conversation.aggregate([{ $match: { tenantId, 'bot.endedAt': { $gte: since } } }, { $group: { _id: '$bot.endReason', n: { $sum: 1 } } }]),
  ]);

  // Time from the first unanswered customer message to the team member's reply
  const replyTimes = {};
  let currentConv = null;
  let waitingSince = null;
  for (const m of msgs) {
    if (String(m.conversationId) !== currentConv) {
      currentConv = String(m.conversationId);
      waitingSince = null;
    }
    if (m.direction === 'inbound') waitingSince ||= m.createdAt;
    else if (waitingSince && m.sentBy) {
      (replyTimes[m.sentBy] ||= []).push(m.createdAt - waitingSince);
      waitingSince = null;
    }
  }
  const byId = (rows) => Object.fromEntries(rows.map((r) => [String(r._id), r.n]));
  const [h, o, s, c] = [byId(handled), byId(openNow), byId(sent), byId(converted)];
  const median = (arr) => {
    if (!arr?.length) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    return Math.round(sorted[Math.floor(sorted.length / 2)] / 60000);
  };

  res.json({
    days,
    members: users.map((u) => {
      const id = String(u._id);
      return {
        _id: u._id, name: u.name, role: u.role, isActive: u.isActive,
        chatsHandled: h[id] || 0, openChats: o[id] || 0, messagesSent: s[id] || 0, converted: c[id] || 0,
        replies: replyTimes[id]?.length || 0,
        medianReplyMinutes: median(replyTimes[id]),
      };
    }),
    bot: { chatsStarted: botStarted, ended: Object.fromEntries(botEnded.map((b) => [b._id || 'other', b.n])) },
  });
});

/** A11 "Needs attention" (admins: whole business, agents: their own leads and tasks) */
router.get('/attention', async (req, res) => {
  res.json(await needsAttention(req.tenant, { userId: req.user.role === 'agent' ? req.user._id : undefined }));
});

/**
 * Messages per day: customers who wrote (new = first message that day, returning = known before),
 * messages in / out, and the WhatsApp cost of template messages (estimate: Settings → WhatsApp rates).
 */
router.get('/messages', authorize('admin'), async (req, res) => {
  const { days, tz: rawTz } = validate(z.object({ days: z.coerce.number().int().min(1).max(90).default(14), tz: z.string().optional() }), req.query);
  const tz = safeTimeZone(rawTz || DEFAULT_TZ);
  const tenantId = req.tenantId;
  const since = new Date(startOfDayIn(tz).getTime() - (days - 1) * 864e5);
  const dayOf = (field) => ({ $dateToString: { format: '%Y-%m-%d', date: field, timezone: tz } });
  const [byContact, msgs, templates] = await Promise.all([
    // One row per (day, customer who wrote that day), with when the customer was first seen
    Message.aggregate([
      { $match: { tenantId, direction: 'inbound', createdAt: { $gte: since } } },
      { $group: { _id: { day: dayOf('$createdAt'), contactId: '$contactId' }, n: { $sum: 1 } } },
      { $lookup: { from: 'contacts', localField: '_id.contactId', foreignField: '_id', as: 'c', pipeline: [{ $project: { createdAt: 1 } }] } },
      { $project: { day: '$_id.day', n: 1, firstDay: { $cond: [{ $gt: [{ $size: '$c' }, 0] }, dayOf({ $arrayElemAt: ['$c.createdAt', 0] }), null] } } },
    ]),
    Message.aggregate([
      { $match: { tenantId, direction: 'outbound', createdAt: { $gte: since }, status: { $ne: 'failed' } } },
      { $group: { _id: { day: dayOf('$createdAt'), template: '$template.name', type: '$type' }, n: { $sum: 1 } } },
    ]),
    Template.find({ tenantId }).select('name category').lean(),
  ]);
  const category = Object.fromEntries(templates.map((t) => [t.name, t.category]));
  const rates = { MARKETING: 0.86, UTILITY: 0.115, AUTHENTICATION: 0.115 };
  const r = req.tenant.settings?.waRates || {};
  if (r.marketing != null) rates.MARKETING = r.marketing;
  if (r.utility != null) rates.UTILITY = r.utility;
  if (r.authentication != null) rates.AUTHENTICATION = r.authentication;

  const list = Array.from({ length: days }, (_, i) => {
    const day = dayKey(new Date(since.getTime() + i * 864e5 + 12 * 3600e3), tz);
    const rows = byContact.filter((x) => x.day === day);
    const out = msgs.filter((x) => x._id.day === day);
    const tpl = out.filter((x) => x._id.type === 'template' && x._id.template);
    const count = (cat) => tpl.filter((x) => (category[x._id.template] || 'MARKETING') === cat).reduce((s, x) => s + x.n, 0);
    const marketing = count('MARKETING');
    const utility = count('UTILITY');
    const authentication = count('AUTHENTICATION');
    return {
      day,
      newCustomers: rows.filter((x) => x.firstDay === day).length,
      returningCustomers: rows.filter((x) => x.firstDay !== day).length,
      inbound: rows.reduce((s, x) => s + x.n, 0),
      outbound: out.reduce((s, x) => s + x.n, 0),
      templates: { marketing, utility, authentication },
      cost: Math.round((marketing * rates.MARKETING + utility * rates.UTILITY + authentication * rates.AUTHENTICATION) * 100) / 100,
    };
  });
  const sum = (k) => list.reduce((s, d) => s + (typeof k === 'function' ? k(d) : d[k]), 0);
  res.json({
    days: list,
    rates: { marketing: rates.MARKETING, utility: rates.UTILITY, authentication: rates.AUTHENTICATION },
    totals: {
      newCustomers: sum('newCustomers'),
      returningCustomers: sum('returningCustomers'),
      inbound: sum('inbound'),
      outbound: sum('outbound'),
      marketing: sum((d) => d.templates.marketing),
      utility: sum((d) => d.templates.utility),
      cost: Math.round(sum('cost') * 100) / 100,
    },
  });
});

/** Sidebar badges: what needs doing now (agents: their own) */
router.get('/counts', async (req, res) => {
  const tenantId = req.tenantId;
  const isAgent = req.user.role === 'agent';
  const now = new Date();
  const endOfToday = new Date(startOfDayIn(safeTimeZone(req.query.tz || DEFAULT_TZ)).getTime() + 864e5);
  const mine = isAgent ? { $or: [{ assignedTo: req.user._id }, { assignedTo: null }] } : {};
  const today = dayKey(now, safeTimeZone(req.query.tz || DEFAULT_TZ));
  const [unreadChats, tasksDue, newLeads, feesDue] = await Promise.all([
    Conversation.countDocuments({ tenantId, unreadCount: { $gt: 0 }, status: { $ne: 'resolved' }, ...(isAgent && { assignedTo: { $in: [req.user._id, null] } }) }),
    Task.countDocuments({ tenantId, status: 'open', dueAt: { $lt: endOfToday }, ...(isAgent && { assignedTo: req.user._id }) }),
    Contact.countDocuments({ tenantId, leadStatus: { $in: ['new', 'call_pending'] }, callAttempts: { $in: [0, null] }, optedOut: false, ...mine }),
    Contact.countDocuments({ tenantId, 'fees.balance': { $gt: 0 }, 'fees.nextDue': { $ne: '', $lte: today }, ...mine }),
  ]);
  res.json({ unreadChats, tasksDue, newLeads, feesDue });
});

/**
 * Today: everything to act on now, in priority order (agents: their own + unassigned leads).
 * call = new leads never called · hot · tasks (overdue / today) · waiting for a reply · fees due · follow-ups
 */
router.get('/today', async (req, res) => {
  const tenantId = req.tenantId;
  const isAgent = req.user.role === 'agent';
  const tz = safeTimeZone(req.query.tz || DEFAULT_TZ);
  const now = new Date();
  const endOfToday = new Date(startOfDayIn(tz).getTime() + 864e5);
  const today = dayKey(now, tz);
  const mine = isAgent ? { $or: [{ assignedTo: req.user._id }, { assignedTo: null }] } : {};
  const lead = 'name phone course leadStatus assignedTo callAttempts lastCallAt lastInboundAt createdAt nextActionAt fees.balance fees.nextDue fees.nextAmount';
  const pop = { path: 'assignedTo', select: 'name' };
  const [call, hot, tasks, followUps, fees, waiting] = await Promise.all([
    Contact.find({ tenantId, leadStatus: { $in: ['new', 'call_pending'] }, callAttempts: { $in: [0, null] }, optedOut: false, ...mine }).sort({ leadStatus: 1, createdAt: -1 }).limit(30).select(lead).populate(pop).lean(),
    Contact.find({ tenantId, leadStatus: 'hot', optedOut: false, ...mine }).sort({ statusUpdatedAt: 1 }).limit(30).select(lead).populate(pop).lean(),
    Task.find({ tenantId, status: 'open', dueAt: { $lt: endOfToday }, ...(isAgent && { assignedTo: req.user._id }) }).sort({ dueAt: 1 }).limit(50).populate({ path: 'contactId', select: lead }).populate(pop).lean(),
    Contact.find({ tenantId, followUpAt: { $lt: endOfToday }, ...mine }).sort({ followUpAt: 1 }).limit(30).select(`${lead} followUpAt followUpNote`).populate(pop).lean(),
    Contact.find({ tenantId, 'fees.balance': { $gt: 0 }, 'fees.nextDue': { $ne: '', $lte: today }, ...mine }).sort({ 'fees.nextDue': 1 }).limit(30).select(lead).populate(pop).lean(),
    Conversation.find({ tenantId, status: { $ne: 'resolved' }, lastInboundAt: { $lte: new Date(now.getTime() - 30 * 6e4) }, $expr: { $gte: ['$lastInboundAt', '$lastMessageAt'] }, 'bot.active': { $ne: true }, ...(isAgent && { assignedTo: { $in: [req.user._id, null] } }) })
      .sort({ lastInboundAt: 1 }).limit(30).populate({ path: 'contactId', select: lead }).populate(pop).select('contactId assignedTo lastInboundAt lastMessagePreview').lean(),
  ]);
  res.json({ today, call, hot, tasks, followUps, fees, waiting });
});

export default router;
