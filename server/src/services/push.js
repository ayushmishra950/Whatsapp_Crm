/**
 * Phone notifications for the mobile app (Expo push service).
 *
 * The app registers its Expo push token on the person's login (Account), so one phone gets the alerts
 * of every business that login opens. Each push says which business it is from and carries
 * { userId, url } so a tap opens the right business and screen.
 */
import axios from 'axios';
import { Account, Tenant, User } from '../models/index.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const isExpoToken = (t) => /^Expo(nent)?PushToken\[.+\]$/.test(String(t || ''));
const disabled = () => process.env.PUSH_DISABLED === 'true';

/** Save the phone's token on the login (max 10 phones per login) */
export async function registerPushToken(accountId, { token, platform = '', device = '' }) {
  if (!isExpoToken(token)) return false;
  await Account.updateMany({ 'pushTokens.token': token, _id: { $ne: accountId } }, { $pull: { pushTokens: { token } } }); // phone moved to another login
  const acc = await Account.findById(accountId).select('pushTokens').lean();
  if (!acc) return false;
  const rest = (acc.pushTokens || []).filter((t) => t.token !== token);
  await Account.updateOne({ _id: accountId }, { $set: { pushTokens: [...rest, { token, platform, device, at: new Date() }].slice(-10) } });
  return true;
}

export async function removePushToken(accountId, token) {
  await Account.updateOne({ _id: accountId }, { $pull: { pushTokens: { token } } });
}

/**
 * Send one notification to these memberships (User ids).
 * { title, body, url } — url = app path to open (e.g. "/chat/<id>", "/lead/<id>").
 * Never throws: a failed push must not break the CRM.
 */
export async function pushToUsers(userIds, { title, body = '', url = '', tenantId }) {
  if (disabled()) return 0;
  try {
    const ids = [...new Set((userIds || []).filter(Boolean).map(String))];
    if (!ids.length) return 0;
    const users = await User.find({ _id: { $in: ids }, isActive: true }).select('accountId tenantId').lean();
    const accounts = await Account.find({ _id: { $in: users.map((u) => u.accountId).filter(Boolean) } }).select('pushTokens').lean();
    const tokensOf = Object.fromEntries(accounts.map((a) => [String(a._id), (a.pushTokens || []).map((t) => t.token)]));
    // Logins with more than one business see the business name on the alert
    const multi = new Set(
      (await User.aggregate([{ $match: { accountId: { $in: accounts.map((a) => a._id) }, isActive: true } }, { $group: { _id: '$accountId', n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }])).map((x) => String(x._id))
    );
    const tenant = tenantId ? await Tenant.findById(tenantId).select('name').lean() : null;
    const messages = [];
    for (const u of users) {
      for (const to of tokensOf[String(u.accountId)] || []) {
        messages.push({
          to,
          sound: 'default',
          title: multi.has(String(u.accountId)) && tenant ? `${tenant.name} · ${title}` : title,
          body: String(body || '').slice(0, 180),
          data: { userId: String(u._id), url },
          channelId: 'default',
        });
      }
    }
    if (!messages.length) return 0;
    let sent = 0;
    for (let i = 0; i < messages.length; i += 100) {
      const batch = messages.slice(i, i + 100);
      const res = await axios.post(EXPO_PUSH_URL, batch, { headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, timeout: 8000 });
      const tickets = res.data?.data || [];
      // Phone uninstalled the app / token expired: forget it
      const dead = tickets.map((t, k) => (t?.details?.error === 'DeviceNotRegistered' ? batch[k].to : null)).filter(Boolean);
      if (dead.length) await Account.updateMany({}, { $pull: { pushTokens: { token: { $in: dead } } } });
      sent += tickets.filter((t) => t?.status === 'ok').length;
    }
    return sent;
  } catch (err) {
    console.warn('[push] not sent:', err.response?.data?.errors?.[0]?.message || err.message);
    return 0;
  }
}
