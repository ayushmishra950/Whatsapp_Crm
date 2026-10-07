import { Router } from 'express';
import { z } from 'zod';
import { AdSource, Contact, Conversation, Message, Campaign, User } from '../models/index.js';
import { authorize } from '../middleware/auth.js';
import { validate } from '../utils/http.js';
import { messagesUsedThisMonth } from '../services/subscription.js';
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

export default router;
