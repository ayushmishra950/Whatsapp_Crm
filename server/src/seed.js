/**
 * Creates the super admin, default monthly plans and one demo business.
 * Safe to run multiple times (skips what already exists).
 * Credentials come from env (SEED_*) — see .env.example.
 */
import { connectDB, disconnectDB } from './config/db.js';
import { Account, Plan, Tenant, User, Contact, Template } from './models/index.js';
import { addMember, migrateAccounts } from './services/accounts.js';
import { addMonths, currentMonth } from './services/subscription.js';

const SUPERADMIN_EMAIL = process.env.SEED_SUPERADMIN_EMAIL || 'superadmin@crm.local';
const SUPERADMIN_PASSWORD = process.env.SEED_SUPERADMIN_PASSWORD || 'SuperAdmin@123';
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD || 'Demo@1234';

const PLANS = [
  { name: 'Starter', priceMonthly: 999, limits: { agents: 2, contacts: 1000, monthlyMessages: 2000 }, features: ['Team inbox', 'Bulk campaigns', 'CSV import'] },
  { name: 'Growth', priceMonthly: 2499, limits: { agents: 5, contacts: 10000, monthlyMessages: 20000 }, features: ['Everything in Starter', 'Auto-assignment', 'Campaign scheduling'] },
  { name: 'Business', priceMonthly: 5999, limits: { agents: 20, contacts: 100000, monthlyMessages: 100000 }, features: ['Everything in Growth', 'Priority support'] },
];

// One login (Account) per email; a business member is added to it (existing logins are reused)
async function upsertUser({ password, ...data }) {
  const existing = await User.findOne({ email: data.email, tenantId: data.tenantId || null });
  if (existing) return existing;
  if (data.role === 'super_admin') {
    const account = (await Account.findOne({ email: data.email })) || (await Account.create({ email: data.email, name: data.name, password }));
    return User.create({ ...data, accountId: account._id });
  }
  return (await addMember({ tenantId: data.tenantId, role: data.role, name: data.name, email: data.email, password, allowExisting: true })).user;
}

async function main() {
  await connectDB();
  await migrateAccounts();

  await upsertUser({ name: 'Super Admin', email: SUPERADMIN_EMAIL, password: SUPERADMIN_PASSWORD, role: 'super_admin' });

  for (const p of PLANS) {
    await Plan.updateOne({ name: p.name }, { $setOnInsert: p }, { upsert: true });
  }
  const growth = await Plan.findOne({ name: 'Growth' });

  let demo = await Tenant.findOne({ name: 'Demo Business' });
  if (!demo) {
    const now = new Date();
    demo = await Tenant.create({
      name: 'Demo Business',
      email: 'admin@demo.local',
      plan: growth._id,
      subscription: { status: 'active', currentPeriodStart: now, currentPeriodEnd: addMonths(now, 1) },
      usage: { month: currentMonth(), messagesSent: 0 },
    });
  }
  await upsertUser({ name: 'Demo Admin', email: 'admin@demo.local', password: DEMO_PASSWORD, role: 'admin', tenantId: demo._id });
  await upsertUser({ name: 'Riya (Agent)', email: 'agent1@demo.local', password: DEMO_PASSWORD, role: 'agent', tenantId: demo._id });
  await upsertUser({ name: 'Aman (Agent)', email: 'agent2@demo.local', password: DEMO_PASSWORD, role: 'agent', tenantId: demo._id });

  const contacts = [
    { name: 'Rahul Sharma', phone: '919800000001', tags: ['vip', 'jaipur'], leadStatus: 'qualified' },
    { name: 'Neha Gupta', phone: '919800000002', tags: ['jaipur'], leadStatus: 'new' },
    { name: 'Arjun Mehta', phone: '919800000003', tags: ['delhi'], leadStatus: 'contacted' },
    { name: 'Pooja Verma', phone: '919800000004', tags: ['vip', 'delhi'], leadStatus: 'converted' },
  ];
  for (const c of contacts) {
    await Contact.updateOne({ tenantId: demo._id, phone: c.phone }, { $setOnInsert: { ...c, tenantId: demo._id, source: 'manual' } }, { upsert: true });
  }

  await Template.updateOne(
    { tenantId: demo._id, name: 'welcome_offer', language: 'en' },
    {
      $setOnInsert: {
        tenantId: demo._id,
        name: 'welcome_offer',
        language: 'en',
        category: 'MARKETING',
        header: 'Special offer 🎉',
        body: 'Hi {{1}}, thanks for connecting with us! Use code {{2}} to get 20% off on your next order.',
        footer: 'Reply STOP to unsubscribe',
        status: 'approved',
      }, 
    },
    { upsert: true } 
  );

  console.log('\nSeed complete ✅');
  console.log(`  Super admin : ${SUPERADMIN_EMAIL}`);
  console.log('  Demo admin  : admin@demo.local');
  console.log('  Demo agents : agent1@demo.local, agent2@demo.local');
  console.log('  Passwords   : from SEED_SUPERADMIN_PASSWORD / SEED_DEMO_PASSWORD (see .env)\n');
  await disconnectDB();
}

main().catch(async (err) => {
  console.error(err);
  await disconnectDB();
  process.exit(1);
});
