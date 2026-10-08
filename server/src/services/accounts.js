/**
 * One login for several businesses.
 *
 *   Account  = the person's login (email + password)
 *   User     = their membership in one business (role admin / agent), or the super admin
 *
 * Everything in the CRM (chats, tasks, assignment, notifications…) keeps pointing at the User,
 * so a membership works exactly like a user did before. Logins are joined only with proof:
 * the Super Admin adds a business to an existing login, a business admin adds an existing
 * login to their team, or the person links a second login by typing its password.
 */
import { Account, Tenant, User, Conversation, Task } from '../models/index.js';
import { HttpError, conflict, badRequest, forbidden } from '../utils/http.js';

export const normEmail = (e) => String(e || '').trim().toLowerCase();

/** Account of a membership; creates it for users made before Accounts existed */
export async function ensureAccountForUser(user) {
  if (user.accountId) {
    const acc = await Account.findById(user.accountId);
    if (acc) return acc;
  }
  const email = normEmail(user.email);
  let account = await Account.findOne({ email });
  if (!account) {
    // Copy the old password hash as it is (the Account does not hash a bcrypt hash again)
    const raw = await User.collection.findOne({ _id: user._id }, { projection: { password: 1 } });
    if (!raw?.password) throw new HttpError(500, `User ${email} has no password to migrate`);
    account = await Account.create({ email, name: user.name, password: raw.password, lastUserId: user._id });
  }
  await User.updateOne({ _id: user._id }, { $set: { accountId: account._id } });
  user.accountId = account._id;
  return account;
}

/**
 * Run once at start-up (idempotent): give every user an Account and drop the old
 * "one email = one user" unique index, so one login can be a member of several businesses.
 */
export async function migrateAccounts() {
  const result = { accountsCreated: 0, usersLinked: 0, indexDropped: false };
  try {
    const indexes = await User.collection.indexes();
    const old = indexes.find((i) => i.key?.email === 1 && i.unique);
    if (old) {
      await User.collection.dropIndex(old.name);
      result.indexDropped = true;
    }
  } catch (err) {
    if (err.codeName !== 'NamespaceNotFound') throw err;
  }
  const users = await User.find({ $or: [{ accountId: null }, { accountId: { $exists: false } }] });
  for (const u of users) {
    const before = await Account.countDocuments({ email: normEmail(u.email) });
    await ensureAccountForUser(u);
    result.usersLinked += 1;
    if (!before) result.accountsCreated += 1;
  }
  return result;
}

/** Logins left without any business (team member removed, business deleted) are deleted */
export async function removeOrphanAccounts(accountIds) {
  const ids = [...new Set(accountIds.filter(Boolean).map(String))];
  let removed = 0;
  for (const id of ids) {
    if (!(await User.exists({ accountId: id }))) removed += (await Account.deleteOne({ _id: id })).deletedCount;
  }
  return removed;
}

/**
 * Add a person to a business.
 * - New email: a login is created with `password`.
 * - Email that already has a login: allowed only with `allowExisting` (the person keeps their own password;
 *   any password given here is ignored), never twice in the same business.
 * Returns { user, account, existing }.
 */
export async function addMember({ tenantId, role, name, email, phone, password, allowExisting = false }) {
  email = normEmail(email);
  let account = await Account.findOne({ email });
  if (!account) {
    // A user made before Accounts existed (migration not run yet) still counts as a login
    const legacy = await User.findOne({ email });
    if (legacy) account = await ensureAccountForUser(legacy);
  }
  const existing = !!account;
  if (account) {
    if (!allowExisting) throw conflict('This email already has a login (for another business).');
    if (await User.exists({ accountId: account._id, tenantId })) throw conflict('This person is already in this business');
    if (await User.exists({ accountId: account._id, role: 'super_admin' })) throw forbidden('The Super Admin login can not be added to a business');
  } else {
    if (!password || password.length < 8) throw badRequest('Password must be at least 8 characters');
    account = await Account.create({ email, name, password });
  }
  const user = await User.create({ accountId: account._id, tenantId, role, name: name || account.name, email: account.email, ...(phone && { phone }) });
  return { user, account, existing };
}

/** Every business this login can open (active memberships), with what is waiting in each */
export async function businessesOf(accountId, { counts = false } = {}) {
  const users = await User.find({ accountId, isActive: true }).select('tenantId role name').lean();
  const tenants = await Tenant.find({ _id: { $in: users.map((u) => u.tenantId).filter(Boolean) } }).select('name logo status businessType').lean();
  const byId = Object.fromEntries(tenants.map((t) => [String(t._id), t]));
  const list = [];
  for (const u of users) {
    const t = u.tenantId ? byId[String(u.tenantId)] : null;
    if (u.tenantId && !t) continue; // business deleted
    const item = {
      userId: u._id,
      role: u.role,
      tenantId: t?._id || null,
      name: t ? t.name : 'Super Admin panel',
      logo: t?.logo || '',
      businessType: t?.businessType || '',
      suspended: t?.status === 'suspended',
    };
    if (counts && t) {
      const mine = u.role === 'agent' ? { assignedTo: u._id } : {};
      const [unread, tasksDue] = await Promise.all([
        Conversation.countDocuments({ tenantId: t._id, unreadCount: { $gt: 0 }, status: { $ne: 'resolved' }, ...mine }),
        Task.countDocuments({ tenantId: t._id, status: 'open', dueAt: { $lte: new Date() }, ...(u.role === 'agent' ? { assignedTo: u._id } : {}) }),
      ]);
      Object.assign(item, { unread, tasksDue });
    }
    list.push(item);
  }
  // Super admin panel first, then businesses by name
  return list.sort((a, b) => (a.tenantId ? 1 : 0) - (b.tenantId ? 1 : 0) || a.name.localeCompare(b.name));
}

/** Membership to open at login: the business used last, else the first one that is not suspended */
export async function pickMembership(account, userId) {
  const list = await businessesOf(account._id);
  if (!list.length) throw forbidden('Your account is disabled');
  const want = String(userId || account.lastUserId || '');
  const usable = list.filter((b) => !b.suspended);
  if (!usable.length) throw forbidden('This business account is suspended. Contact support.');
  return usable.find((b) => String(b.userId) === want) || usable[0];
}

/**
 * The logged-in person proves they also own another login (its email + password):
 * that login's businesses move to this login, and the other login is removed.
 */
export async function linkAccounts(account, { email, password }) {
  email = normEmail(email);
  if (email === account.email) throw badRequest('That is the login you are using now');
  let other = await Account.findOne({ email }).select('+password');
  if (!other) {
    const legacy = await User.findOne({ email });
    if (legacy) other = await Account.findById((await ensureAccountForUser(legacy))._id).select('+password');
  }
  if (!other || !(await other.comparePassword(password))) throw badRequest('No login matches this email and password. Check the exact email (every letter and number) and the password of your other business.'); // 400, not 401: a 401 would log this person out
  const [mine, theirs] = await Promise.all([User.find({ accountId: account._id }).lean(), User.find({ accountId: other._id }).lean()]);
  if ([...mine, ...theirs].some((u) => u.role === 'super_admin')) throw forbidden('The Super Admin login can not be linked with a business login');
  const clash = theirs.find((u) => mine.some((m) => String(m.tenantId) === String(u.tenantId)));
  if (clash) {
    const t = await Tenant.findById(clash.tenantId).select('name').lean();
    throw conflict(`Both logins are already in "${t?.name || 'the same business'}". Ask its admin to remove one of them first.`);
  }
  await User.updateMany({ accountId: other._id }, { $set: { accountId: account._id, email: account.email } });
  await Account.deleteOne({ _id: other._id });
  const tenants = await Tenant.find({ _id: { $in: theirs.map((u) => u.tenantId) } }).select('name').lean();
  return { moved: theirs.length, businesses: tenants.map((t) => t.name), removedEmail: other.email };
}

/** Other businesses (names) that use this login besides `exceptTenantId` */
export async function otherBusinessesOf(accountId, exceptTenantId) {
  if (!accountId) return [];
  const users = await User.find({ accountId, tenantId: { $ne: exceptTenantId } }).select('tenantId role').lean();
  const tenants = await Tenant.find({ _id: { $in: users.map((u) => u.tenantId).filter(Boolean) } }).select('name').lean();
  return [...tenants.map((t) => t.name), ...(users.some((u) => u.role === 'super_admin') ? ['Super Admin panel'] : [])];
}
