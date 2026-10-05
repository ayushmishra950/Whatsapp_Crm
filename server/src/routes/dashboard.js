import { Router } from 'express';
import { Contact, Conversation, Message, Campaign } from '../models/index.js';
import { messagesUsedThisMonth } from '../services/subscription.js';

const router = Router();

const DEFAULT_TZ = 'Asia/Kolkata';

function safeTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
}

// "YYYY-MM-DD" of a date as seen in the given time zone
const dayKey = (date, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(date);

// Midnight today in the given time zone, as a UTC Date
function startOfDayIn(tz) {
  const now = new Date();
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map((p) => [p.type, Number(p.value)])
  );
  const elapsedMs = ((parts.hour * 60 + parts.minute) * 60 + parts.second) * 1000 + now.getMilliseconds();
  return new Date(now.getTime() - elapsedMs);
}

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
  });
});

export default router;
