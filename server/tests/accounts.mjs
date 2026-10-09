// One login, several businesses: migration, switch, team, link, super admin
import bcrypt from 'bcryptjs';
import { M, call, cleanup, crash, finish, login, ok, plan, sa, stamp } from './lib.mjs';

const { migrateAccounts } = await import(new URL('../src/services/accounts.js', import.meta.url).pathname);
const tids = [];
const em = (k) => `${k}${stamp}@temp.local`;
const PW = 'Temp@12345';
const newTenant = async (name, admin) => {
  const r = await call(sa, 'POST', '/superadmin/tenants', { name: `(temp) ${name}`, planId: String(plan._id), admin });
  if (r._id) tids.push(r._id);
  return r;
};
const userIn = async (email, tid) => (await M.User.findOne({ email, tenantId: tid }))._id.toString();
try {
  const legacyEmail = em('legacy');
  await M.User.collection.insertOne({ name: 'Old User', email: legacyEmail, password: await bcrypt.hash(PW, 10), role: 'super_admin', tenantId: null, isActive: true, createdAt: new Date() });
  await migrateAccounts();
  ok(!(await M.User.collection.indexes()).some((i) => i.key?.email === 1 && i.unique) && (await M.User.countDocuments({ accountId: null })) === 0, 'Migration: every user has a login, old unique email index gone');
  ok((await login(legacyEmail, PW)).status === 200, 'Old user logs in with the old password');
  ok((await migrateAccounts()).usersLinked === 0, 'Migration is safe to run again');

  const A = await newTenant('Alpha Academy', { name: 'Asha', email: em('asha'), password: PW });
  let r = await newTenant('Beta Jobs', { name: 'Asha', email: em('asha'), password: PW });
  ok(r.status === 409, 'Same email without "already has a login" → refused');
  r = await newTenant('Ghost', { existingLogin: true, email: em('nobody') });
  ok(r.status === 400, '"Already has a login" with an unknown email → refused');
  const B = await newTenant('Beta Jobs', { existingLogin: true, email: em('asha') });
  ok(!!B._id && (await M.Account.countDocuments({ email: em('asha') })) === 1 && (await M.User.countDocuments({ email: em('asha') })) === 2, 'Business B added to the same login');

  r = await login(em('asha'), PW);
  const tokA = r.token;
  ok(r.businessCount === 2 && r.tenant.name === '(temp) Alpha Academy', 'Login knows there are 2 businesses');
  r = await call(tokA, 'GET', '/auth/businesses');
  ok(r.items.length === 2 && r.items.every((b) => typeof b.unread === 'number'), 'Switcher list with counts');
  r = await call(tokA, 'POST', '/auth/switch', { userId: await userIn(em('asha'), B._id) });
  const tokB = r.token;
  ok(r.status === 200 && r.tenant.name === '(temp) Beta Jobs', 'Switch to B without logging out');
  await call(tokA, 'POST', '/contacts', { phone: '919811400001', name: 'Only in A' });
  ok((await call(tokB, 'GET', '/contacts?search=Only in A')).items.length === 0, "B can not see A's leads");
  ok((await login(em('asha'), PW)).tenant.name === '(temp) Beta Jobs', 'Next login opens the business used last');

  const C = await newTenant('Gamma Classes', { name: 'Chetan', email: em('chetan'), password: PW });
  ok((await call(tokA, 'POST', '/auth/switch', { userId: await userIn(em('chetan'), C._id) })).status === 403, "Can not switch into someone else's business");

  ok((await call(tokB, 'POST', '/auth/change-password', { currentPassword: PW, newPassword: 'NewPass@123' })).status === 200, 'Change password');
  ok((await login(em('asha'), PW)).status === 401 && (await login(em('asha'), 'NewPass@123')).status === 200, 'New password works for the whole login');
  const tokA2 = (await login(em('asha'), 'NewPass@123', { userId: await userIn(em('asha'), A._id) })).token;

  r = await call(tokA2, 'POST', '/team', { name: 'Chetan', email: em('chetan') });
  ok(r.status === 201 && r.existingLogin === true, 'Team: add someone who already has a login (no password)');
  ok((await login(em('chetan'), PW)).businessCount === 2, 'Chetan now has 2 businesses');
  const chetanInA = await userIn(em('chetan'), A._id);
  ok((await call(tokA2, 'PATCH', `/team/${chetanInA}`, { password: 'Hijack@123' })).status === 403, "Can not change a shared login's password");
  r = await call(tokA2, 'GET', '/team');
  ok(r._json.find((u) => u.email === em('chetan'))?.sharedLogin === true && !JSON.stringify(r._json).includes('Gamma'), 'Team shows "shared login" without the other business name');
  ok((await call(tokA2, 'POST', '/team', { name: 'Dev', email: em('dev') })).status === 400, 'New email without password → refused');
  r = await call(tokA2, 'POST', '/team', { name: 'Dev', email: em('dev'), password: PW });
  ok(r.status === 201 && (await call(tokA2, 'PATCH', `/team/${r._id}`, { password: 'DevNew@123' })).status === 200, 'Own agent: add + reset password');
  await call(tokA2, 'DELETE', `/team/${r._id}`);
  ok(!(await M.Account.exists({ email: em('dev') })), 'Removed agent with no other business → login removed');
  await call(tokA2, 'DELETE', `/team/${chetanInA}`);
  ok(!!(await M.Account.exists({ email: em('chetan') })), 'Removed from A → login kept (still admin of C)');

  const E = await newTenant('Epsilon Tours', { name: 'Asha P', email: em('ashap'), password: 'Other@123' });
  ok((await call(tokA2, 'POST', '/auth/link', { email: em('ashap'), password: 'wrong' })).status === 400, 'Link with wrong password → refused, not logged out');
  r = await call(tokA2, 'POST', '/auth/link', { email: em('ashap'), password: 'Other@123' });
  ok(r.status === 200 && r.moved === 1 && r.items.length === 3, 'Link with the right password → business moves');
  ok((await login(em('ashap'), 'Other@123')).status === 401, 'Other email no longer logs in');

  r = await call(sa, 'POST', `/superadmin/tenants/${A._id}/reset-admin-password`, { password: 'Reset@1234' });
  ok(r.otherBusinesses?.length === 2, 'Super Admin reset shows the other businesses of the login');
  r = await call(sa, 'POST', `/superadmin/tenants/${A._id}/impersonate`);
  ok((await call(r.token, 'POST', '/auth/switch', { userId: await userIn(em('asha'), B._id) })).status === 403, 'No switching while viewing as the business');
  await call(sa, 'DELETE', `/superadmin/tenants/${E._id}`, { confirmName: '(temp) Epsilon Tours' });
  ok((await login(em('asha'), 'Reset@1234')).businessCount === 2, 'Business deleted → membership gone, login stays');
} catch (e) {
  crash(e);
} finally {
  await cleanup(tids);
  finish();
}
