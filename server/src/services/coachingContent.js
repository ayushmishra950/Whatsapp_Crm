/**
 * Coaching industry pack (built from the Infonic playbooks), the same for every coaching institute:
 * contact fields, WhatsApp templates (English + Hinglish drafts) and the drips (drafts). Anything about one
 * institute (its name, address, students trained, since year, rating) is a template variable filled from
 * Settings → Message info, so each client only fills those once.
 * The 51-course catalog is a separate, optional sample (loadSampleCourses) for IT / skill-training institutes.
 * Source JSON: src/presets/coaching/. Loading is idempotent: what the business already has (same course code,
 * template name or drip name) is kept as it is.
 *
 * Where the playbooks have no fact (e.g. exact fees of some courses), the text says the counsellor will share it.
 */
import fs from 'node:fs';
import { Chatbot, Course, Drip, Template, Tenant } from '../models/index.js';
import { getContactFields } from './contactFields.js';
import { DEFAULT_COURSE_QUESTIONS } from './courseBot.js';

const dir = new URL('../presets/coaching/', import.meta.url);
const readJson = (name) => JSON.parse(fs.readFileSync(new URL(name, dir), 'utf8'));

// ---------- contact fields the drips / bot use ----------
export const COACHING_FIELDS = [
  { key: 'mode', label: 'Mode', type: 'select', options: ['Classroom', 'Online live'] },
  { key: 'city', label: 'City', type: 'text' },
  {
    key: 'profile',
    label: 'Profile',
    type: 'select',
    options: ['School / 12th pass', 'College student', 'Graduate / job-seeker', 'Working professional', 'Business owner', 'Homemaker / restarting'],
  },
  { key: 'goal', label: 'Goal', type: 'text' },
  { key: 'track', label: 'Suggested track', type: 'text' },
  { key: 'callback_time', label: 'Call-back time', type: 'text' },
  { key: 'demo_time', label: 'Demo date & time', type: 'text' },
  { key: 'batch_month', label: 'Batch month', type: 'text' },
  { key: 'join_when', label: 'Wants to start', type: 'select', options: ['This month', 'Next month', 'Just exploring'] },
  { key: 'dob', label: 'Date of birth', type: 'date' },
  { key: 'joining_date', label: 'Joining date', type: 'date' },
];

// ---------- template variables: playbook name -> CRM field + example for Meta review ----------
const VARIABLES = {
  name: { source: 'field', value: 'name', example: 'Rahul' },
  course: { source: 'field', value: 'course.name', example: 'Digital Marketing' },
  outcome: { source: 'field', value: 'course.outcome', example: 'run ads and get your first client' },
  batch_date: { source: 'field', value: 'course.next_batch', example: '15 Nov' },
  per_day: { source: 'field', value: 'course.per_day', example: '₹150' },
  proof_link: { source: 'field', value: 'course.proof_link', example: 'https://youtube.com/@yourinstitute' },
  counsellor: { source: 'field', value: 'counsellor', example: 'Riya' },
  review_link: { source: 'field', value: 'business.review_link', example: 'https://g.page/r/your-institute/review' },
  offer_end: { source: 'field', value: 'business.offer_end', example: '31 Oct' },
  track: { source: 'field', value: 'custom.track', example: 'Career track' },
  mode: { source: 'field', value: 'custom.mode', example: 'Classroom' },
  callback_time: { source: 'field', value: 'custom.callback_time', example: '5 pm today' },
  demo_time: { source: 'field', value: 'custom.demo_time', example: 'Sat 11 am' },
  ref_code: { source: 'field', value: 'referral_code', example: 'RAHUL7K2' },
  ref_link: { source: 'field', value: 'referral_link', example: 'https://wa.me/91XXXXXXXXXX?text=RAHUL7K2' },
  referral_code: { source: 'field', value: 'referral_code', example: 'RAHUL7K2' },
  referral_link: { source: 'field', value: 'referral_link', example: 'https://wa.me/91XXXXXXXXXX?text=RAHUL7K2' },
  address: { source: 'field', value: 'business.address', example: 'Ajmer Road, Jaipur' },
  location: { source: 'field', value: 'business.address', example: 'Ajmer Road, Jaipur' },
  maps_link: { source: 'field', value: 'business.maps_link', example: 'https://maps.app.goo.gl/your-institute' },
  amount: { source: 'field', value: 'fee.next_amount', example: '₹8,000' },
  due_date: { source: 'field', value: 'fee.next_due', example: '5 Nov 2026' },
  next_due: { source: 'field', value: 'fee.next_due', example: '5 Dec 2026' },
  balance: { source: 'field', value: 'fee.balance', example: '₹16,000' },
  paid_date: { source: 'field', value: 'fee.last_paid_date', example: '2 Nov 2026' },
  receipt_link: { source: 'field', value: 'fee.last_receipt', example: 'R-1042' },
  payment_details: { source: 'field', value: 'business.payment_details', example: 'UPI: institute@upi' },
  business_name: { source: 'field', value: 'business.name', example: 'ABC Institute' },
  city: { source: 'field', value: 'business.city', example: 'Jaipur' },
  students_trained: { source: 'field', value: 'business.students_trained', example: '3,000+' },
  since_year: { source: 'field', value: 'business.since_year', example: '2012' },
  rating: { source: 'field', value: 'business.rating', example: '4.9/5' },
};

/**
 * The playbook was written for one institute: turn its own facts into variables so the template fits any
 * coaching business (name, address, students trained, since year, rating come from Settings → Message info).
 */
export function generalize(text) {
  return String(text || '')
    .split('\n')
    .map((line) => (/Krishna Tower|Heera Nagar/i.test(line) ? '📍 {{address}}' : line))
    .join('\n')
    .replace(/Infonic Training(?:,\s*Ajmer Road)?(?:,\s*Jaipur)?/g, '{{business_name}}')
    .replace(/\bInfonic\b/g, '{{business_name}}')
    .replace(/3,000\+/g, '{{students_trained}}')
    .replace(/\b2012\b/g, '{{since_year}}')
    .replace(/4\.9\s*\/\s*5/g, '{{rating}}');
}

// Business details a template needs (Settings → Message info) -> label, for "fill these first" messages
export const BUSINESS_INFO_LABELS = {
  'business.review_link': ['reviewLink', 'Google review link'],
  'business.proof_link': ['proofLink', 'Proof / results link'],
  'business.offer_end': ['offerEnd', 'Offer end date'],
  'business.address': ['address', 'Address'],
  'business.maps_link': ['mapsLink', 'Google Maps link'],
  'business.payment_details': ['paymentDetails', 'Payment details'],
  'business.city': ['city', 'City'],
  'business.students_trained': ['studentsTrained', 'Students trained'],
  'business.since_year': ['sinceYear', 'Since (year)'],
  'business.rating': ['rating', 'Rating'],
};
const exampleFor = (key) => key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** "Hi {{name}}, {{course}}" -> body "Hi {{1}}, {{2}}" + variable defaults (fixed text when not a CRM field) */
// Same placeholder, different meaning in one template
const TEMPLATE_VARIABLES = { payment_receipt: { amount: { source: 'field', value: 'fee.last_amount', example: '₹8,000' } } };

export function numberVariables(text, templateKey = '') {
  const order = [];
  const body = text.replace(/\{\{\s*([a-zA-Z0-9_ ]+?)\s*\}\}/g, (_, raw) => {
    const key = raw.trim().toLowerCase().replace(/\s+/g, '_');
    let i = order.indexOf(key);
    if (i === -1) i = order.push(key) - 1;
    return `{{${i + 1}}}`;
  });
  const variableDefaults = order.map((key) => TEMPLATE_VARIABLES[templateKey]?.[key] || VARIABLES[key] || { source: 'static', value: '', example: exampleFor(key) });
  return { body: tidyForMeta(body), variableDefaults, keys: order };
}

// Meta rejects a body that starts or ends with a variable
function tidyForMeta(body) {
  let b = body.trim();
  if (/^\{\{\d+\}\}/.test(b)) b = `Hi, ${b}`;
  if (/\{\{\d+\}\}$/.test(b)) b = `${b} 🙂`;
  return b.slice(0, 1024);
}

/** Template buttons for the CRM (link buttons need a real link; without one they are left out) */
function buttonsFor(list = [], info = {}) {
  const out = [];
  for (const b of list) {
    const text = String(b.text || '').trim().slice(0, 25);
    if (!text) continue;
    if (b.type === 'URL') {
      const url = b.url || (/direction|map|location/i.test(text) ? info.mapsLink : '') || '';
      if (/^https?:\/\//.test(url)) out.push({ type: 'URL', text, url, phone: '' });
      continue;
    }
    out.push({ type: 'QUICK_REPLY', text, url: '', phone: '' });
  }
  return out.slice(0, 10);
}

// ---------- drips: playbook trigger -> CRM trigger ----------
// Old enquiries imported from Excel do not get the welcome series
const LEAD_SOURCES_NOT_AD = ['whatsapp', 'manual', 'website', 'walkin', 'referral', 'call', 'other'];
const DRIP_SETUP = {
  D1: { trigger: { type: 'new_lead', sources: LEAD_SOURCES_NOT_AD }, onComplete: { setStatus: 'nurture_later' } },
  D2: { trigger: { type: 'ad_lead' }, onComplete: { setStatus: 'nurture_later' } },
  D3: { trigger: { type: 'status_changed', statuses: ['contacted'] }, onComplete: { setStatus: 'lost' } },
  D4: { trigger: { type: 'status_changed', statuses: ['call_back'] } },
  D5: { trigger: { type: 'status_changed', statuses: ['counselled'] }, onComplete: { setStatus: 'qualified' } },
  D6: { trigger: { type: 'status_changed', statuses: ['qualified'] }, onComplete: { setStatus: 'nurture_later' } },
  D7: { trigger: { type: 'status_changed', statuses: ['family_approval'] }, onComplete: { setStatus: 'qualified' } },
  D8: { trigger: { type: 'status_changed', statuses: ['price_concern'] }, onComplete: { setStatus: 'qualified' } },
  D9: { trigger: { type: 'status_changed', statuses: ['demo_booked'] } },
  D10: { trigger: { type: 'status_changed', statuses: ['demo_no_show'] }, onComplete: { setStatus: 'qualified' } },
  D11: { trigger: { type: 'status_changed', statuses: ['demo_attended'] }, onComplete: { setStatus: 'qualified' } },
  D12: { trigger: { type: 'status_changed', statuses: ['fee_pending'] } },
  D13: { trigger: { type: 'status_changed', statuses: ['converted'] } },
  D14: { trigger: { type: 'status_changed', statuses: ['completed'] } },
  // Refer & earn runs beside the student's other drips: 30 days after joining, or when they complete
  D15: { trigger: { type: 'status_changed', statuses: ['converted', 'completed'] }, stopOnStatusChange: false, stopOnReply: false, firstDelayDays: 30 },
  D16: { trigger: { type: 'status_changed', statuses: ['nurture_later'] } },
  D17: { trigger: { type: 'status_changed', statuses: ['joined_elsewhere'] } },
  D18: { trigger: { type: 'date', field: 'custom.dob', offsetDays: 0 }, stopOnStatusChange: false, stopOnReply: false },
  D19: { trigger: { type: 'date', field: 'custom.joining_date', offsetDays: 0 }, stopOnStatusChange: false, stopOnReply: false },
};
// D20–D28 run the institute (fees, attendance, classes, placements, events): added by hand / by filter
const manualDrip = { trigger: { type: 'manual' }, stopOnStatusChange: false, stopOnReply: false };

const RELATIVE_NOTE = /relative to|event-triggered|recurring|before the holiday|day after the previous/i;
export function isTimedFromStart(s) {
  if (/^next day/i.test(s.when || '')) return true;
  if ((Number(s.delayFromStartMinutes) || 0) < 0 || (Number(s.dayFromStart) || 0) < 0) return false;
  return !RELATIVE_NOTE.test(s.notes || '');
}

// D18 has one message for leads and one for students: two drips, each for its own people
const STUDENT_STATUSES = ['converted', 'completed'];
const LEAD_STATUSES = ['new', 'call_pending', 'contacted', 'call_back', 'counselled', 'hot', 'qualified', 'family_approval', 'price_concern', 'demo_booked', 'demo_attended', 'demo_no_show', 'fee_pending', 'nurture_later'];
function splitDrip(d) {
  if (d.id !== 'D18') return [d];
  const pick = (re) => d.steps.filter((s) => re.test(`${s.when} ${s.template}`));
  return [
    { ...d, name: `${d.name} (leads)`, steps: pick(/lead/i), condition: { statuses: LEAD_STATUSES } },
    { ...d, name: `${d.name} (students)`, steps: pick(/student/i), condition: { statuses: STUDENT_STATUSES } },
  ];
}

const hhmm = (s) => (/^\d{2}:\d{2}$/.test(s || '') ? s : '');

/** Playbook steps (absolute "Day N, 11 am" / "+2 hours") -> CRM steps (each waits after the previous one) */
export function dripSteps(steps, templateIds, setup = {}) {
  const out = [];
  let prevDay = 0;
  let prevMinutes = 0;
  let i = -1;
  for (const s of steps) {
    // Steps timed from a demo / call-back / due date or fired by an event (payment, absence, new job…) can not run
    // from the drip's start; their templates are still created, for the team to send from the inbox or a campaign.
    if (!isTimedFromStart(s)) continue;
    i += 1;
    const kind = s.kind === 'task' || s.kind === 'alert' ? s.kind : 'message';
    let delayDays = 0;
    let delayMinutes = 0;
    let sendTime = '';
    if (/^next day/i.test(s.when || '')) {
      delayDays = 1; // the day after the previous step
      sendTime = hhmm(s.sendTime);
      prevDay += 1;
      prevMinutes = 0;
    } else if (Number.isFinite(s.dayFromStart)) {
      delayDays = Math.max(0, s.dayFromStart - prevDay);
      sendTime = hhmm(s.sendTime);
      prevDay = s.dayFromStart;
      prevMinutes = 0;
    } else {
      const m = Number(s.delayFromStartMinutes) || 0;
      delayMinutes = Math.max(0, m - prevMinutes);
      prevMinutes = m;
    }
    if (i === 0 && setup.firstDelayDays) delayDays += setup.firstDelayDays;
    const base = { kind, delayDays, delayMinutes, sendTime, variables: [], variablesHi: [], text: '', dueMinutes: 30, setStatus: '' };
    if (kind === 'message') {
      const ids = templateIds(s.template);
      if (!ids) continue; // template not in the library (e.g. OTP)
      out.push({ ...base, templateId: ids.en._id, variables: ids.en.variableDefaults.map(({ source, value }) => ({ source, value })), ...(ids.hi && { templateIdHi: ids.hi._id, variablesHi: ids.hi.variableDefaults.map(({ source, value }) => ({ source, value })) }) });
    } else {
      out.push({ ...base, text: String(s.text || (kind === 'task' ? 'Call this lead' : 'Check this lead')).replace(/^Automation:\s*/i, '').slice(0, 200) });
    }
  }
  return out;
}

/**
 * Create the playbook content for a coaching business. Returns what was added.
 * Templates and drips are created as drafts: the admin submits templates to WhatsApp, then turns drips on.
 */
export async function loadCoachingContent(tenantId, { sampleCourses = false } = {}) {
  const tenant = await Tenant.findById(tenantId);
  const added = { fields: 0, courses: 0, templates: 0, drips: 0 };
  if (sampleCourses) added.courses = await loadSampleCourses(tenantId);
  added.chatbot = await ensureCoachingChatbot(tenantId);

  // Contact fields
  const fields = getContactFields(tenant);
  const missing = COACHING_FIELDS.filter((f) => !fields.some((x) => x.key === f.key));
  if (missing.length) {
    await Tenant.updateOne({ _id: tenantId }, { $push: { 'settings.contactFields': { $each: missing.map((f) => ({ ...f, options: f.options || [] })) } } });
    added.fields = missing.length;
  }

  // Business details the messages use (only empty ones), and the playbook's sending rules
  const info = tenant.settings?.messageInfo || {};
  const set = {};
  const a = tenant.settings?.automation || {};
  if ((a.quietStart ?? '21:00') === '21:00' && (a.quietEnd ?? '09:00') === '09:00') {
    // "Between 10 am and 7 pm, max one message a day"
    Object.assign(set, { 'settings.automation.quietStart': '19:00', 'settings.automation.quietEnd': '10:00', 'settings.automation.maxPerContactPerDay': 1 });
  }
  if (Object.keys(set).length) await Tenant.updateOne({ _id: tenantId }, { $set: set });

  // Templates (English "<name>_en" + Hinglish "<name>_hi"), drafts
  const library = readJson('templates.json').filter((t) => t.category !== 'AUTHENTICATION' && (t.en || '').trim());
  const existing = new Map((await Template.find({ tenantId }).lean()).map((t) => [t.name, t]));
  for (const t of library) {
    for (const lang of ['en', 'hi']) {
      const text = (t[lang] || '').trim();
      const name = `${t.name}_${lang}`;
      if (!text || existing.has(name)) continue;
      const { body, variableDefaults } = numberVariables(generalize(text), t.name);
      const doc = await Template.create({
        tenantId,
        name,
        language: 'en', // Hinglish is written in Latin letters, so it is submitted as English
        category: t.category === 'UTILITY' ? 'UTILITY' : 'MARKETING',
        body,
        buttons: buttonsFor(t.buttons, info),
        variableDefaults,
        status: 'draft',
      });
      existing.set(name, doc.toObject());
      added.templates += 1;
    }
  }
  const templateIds = (key) => {
    const en = existing.get(`${key}_en`);
    if (!en) return null;
    return { en, hi: existing.get(`${key}_hi`) || null };
  };

  // Drips (drafts)
  // Created last-to-first so the Drips page (newest first) lists D1 at the top
  const drips = readJson('drips.json').flatMap(splitDrip).reverse();
  const haveDrips = new Set((await Drip.find({ tenantId }).select('name').lean()).map((d) => d.name));
  for (const d of drips) {
    const name = `${d.id} ${d.name}`.slice(0, 80);
    if (haveDrips.has(name)) continue;
    const setup = DRIP_SETUP[d.id] || manualDrip;
    const steps = dripSteps(d.steps || [], templateIds, setup);
    if (!steps.length) continue;
    await Drip.create({
      tenantId,
      name,
      status: 'draft',
      trigger: { sources: [], adIds: [], tags: [], statuses: [], field: '', offsetDays: 0, ...setup.trigger },
      condition: d.condition || {},
      steps,
      stopOnReply: setup.stopOnReply ?? true,
      stopStatuses: [],
      stopOnStatusChange: setup.stopOnStatusChange ?? true,
      onComplete: { setStatus: setup.onComplete?.setStatus || '', addTag: '' },
    });
    added.drips += 1;
  }
  return added;
}

/**
 * Optional sample catalog: 51 IT / skill courses (with greetings, fees answers, trigger words) for institutes that
 * teach similar courses. Courses the business already has (same code) are kept. Returns how many were added.
 */
export async function loadSampleCourses(tenantId) {
  const tenant = await Tenant.findById(tenantId).select('settings.messageInfo');
  const city = tenant?.settings?.messageInfo?.city || '';
  // The sample was written for a Jaipur institute
  const place = (t) => String(t || '').replace(/ in Jaipur/g, city ? ` in ${city}` : '').replace(/Jaipur mein/g, city ? `${city} mein` : '').replace(/Jaipur/g, city || 'our city');
  const courses = readJson('sample-courses.json');
  const haveCodes = new Set((await Course.find({ tenantId }).select('code').lean()).map((c) => c.code));
  const docs = courses
    .filter((c) => c.code && !haveCodes.has(c.code.toUpperCase()))
    .map((c) => ({
      tenantId,
      code: c.code.toUpperCase(),
      name: c.name,
      category: c.category || '',
      triggerWords: (c.triggerWords || []).map((w) => w.toLowerCase()),
      outcome: c.outcome || '',
      who: place(c.who),
      learn: c.learn || '',
      internshipLine: c.internshipLine || '',
      greetingEn: place(generalize(c.greetingEn)).replace(/\{\{business_name\}\}/g, 'us'),
      greetingHi: place(generalize(c.greetingHi)).replace(/\{\{business_name\}\}/g, 'humare'),
      feesEn: c.feesEn || 'Our counsellor will share the exact fee, EMI options and any running offer.',
      feesHi: c.feesHi || 'Exact fees, EMI options aur chal raha offer humare counsellor batayenge.',
      feeAmount: c.feeAmount || 0,
      durationDays: c.durationDays || 0,
      proofLink: '',
      pageUrl: c.url ? (/^https?:\/\//.test(c.url) ? c.url : `https://${c.url}`) : '',
      packageCode: (c.packageCode || '').toUpperCase(),
      active: true,
    }));
  if (!docs.length) return 0;
  await Course.insertMany(docs, { ordered: false }).catch((err) => {
    if (err.code !== 11000 && !err.writeErrors) throw err;
  });
  return docs.length;
}

/** Business details (Settings → Message info) that these templates need but the business has not filled */
export function missingBusinessInfo(tenant, templates) {
  const info = tenant?.settings?.messageInfo || {};
  const need = new Set();
  for (const t of templates) for (const v of t.variableDefaults || []) if (v.source === 'field' && BUSINESS_INFO_LABELS[v.value]) need.add(v.value);
  return [...need].filter((k) => !String(info[BUSINESS_INFO_LABELS[k][0]] || '').trim()).map((k) => BUSINESS_INFO_LABELS[k][1]);
}

// The sample menu every new chatbot starts with (it is replaced by the coaching menu, not kept)
const SAMPLE_MENU_TITLES = ['Price / Plans', 'Talk to sales', 'Support'];

/**
 * Coaching chatbot: welcome message with the institute's facts and a menu whose first option opens the course
 * list (course details, fees, "interested?", admission questions, booking). A chatbot that is already customised
 * keeps its options and gets "Explore courses" added at the top. On / off is never changed here.
 */
export async function ensureCoachingChatbot(tenantId) {
  const tenant = await Tenant.findById(tenantId);
  const info = tenant.settings?.messageInfo || {};
  const trust = [info.studentsTrained && `${info.studentsTrained} students trained${info.sinceYear ? ` since ${info.sinceYear}` : ''}`, info.rating && `★ ${info.rating}`].filter(Boolean).join(' · ');
  const welcomeText = [`Hi 👋 Welcome to ${tenant.name}!`, trust, 'Learn in our classroom or online live.'].filter(Boolean).join('\n') + '\n\nWhat would you like to do?';
  const coursesOption = { title: '📚 Explore courses', description: 'Courses, fees and a free demo', action: 'courses', replyText: '', tag: '' };
  const menu = [
    coursesOption,
    { title: 'Talk to counsellor', description: 'A counsellor will reply here', action: 'handoff', replyText: 'Sure! Connecting you to our counsellor. 🙂', tag: 'asked-counsellor' },
    {
      title: '📍 Address & timing',
      description: 'Where we are, batch timings',
      action: 'reply',
      replyText: [info.address && `📍 ${info.address}`, info.mapsLink && `🗺 ${info.mapsLink}`, '🕘 Weekday and weekend batches, classroom or online live. Our counsellor will share the exact timings for your course.'].filter(Boolean).join('\n'),
      tag: '',
    },
  ];
  let bot = await Chatbot.findOne({ tenantId });
  if (!bot) {
    await Chatbot.create({ tenantId, enabled: false, welcomeText, menu, courseQuestions: DEFAULT_COURSE_QUESTIONS, faqs: defaultFaqs() });
    return 'created';
  }
  // Admission questions and FAQ answers: filled once, then they are the business's to edit
  let filled = false;
  if (!bot.courseQuestions?.length) {
    bot.courseQuestions = DEFAULT_COURSE_QUESTIONS;
    filled = true;
  }
  if (!bot.faqs?.length) {
    bot.faqs = defaultFaqs();
    filled = true;
  }
  if (bot.menu.some((o) => o.action === 'courses')) {
    if (filled) await bot.save();
    return filled ? 'added questions / FAQs' : 'kept';
  }
  const isSample = !bot.menu.length || (bot.menu.length === SAMPLE_MENU_TITLES.length && bot.menu.every((o, i) => o.title === SAMPLE_MENU_TITLES[i]));
  if (isSample) {
    bot.menu = menu;
    if (/^Hello! 👋 Welcome\. How can we help you today\?$/.test(bot.welcomeText || '')) bot.welcomeText = welcomeText;
  } else {
    bot.menu = [coursesOption, ...bot.menu].slice(0, 10);
  }
  await bot.save();
  return isSample ? 'replaced sample menu' : 'added courses option';
}

// ---------- chatbot FAQ answers (from the playbook, made general) ----------
// Intents that do something instead of sending a text
const FAQ_ACTIONS = { details: 'details', fees: 'fees', demo: 'book', talk_human: 'book', complaint: 'handoff', refund: 'handoff', which_course: 'courses' };
// Handled elsewhere (welcome menu, fallback, opt-out keywords, media)
const FAQ_SKIP = new Set(['greeting', 'fallback', 'media', 'stop']);
// The playbook has no text for these; a short answer from the course's own data
const FAQ_TEXT = {
  duration: {
    en: '{{course}} runs for {{duration}}. Fast-track and regular options are available — our counsellor will help you pick the right one.',
    hi: '{{course}} {{duration}} ka course hai. Fast-track aur regular dono options hain — sahi option chunne mein counsellor madad karenge.',
  },
  location: {
    en: '📍 {{business_name}}\n{{address}}\nGoogle Maps: {{maps_link}}\n\nCome and sit in a free demo class!',
    hi: '📍 {{business_name}}\n{{address}}\nGoogle Maps: {{maps_link}}\n\nAaiye, ek free demo class baith kar dekhiye!',
  },
};

/** Turn the playbook's institute facts into placeholders / neutral words (FAQ answers) */
function generalizeFaq(text) {
  return generalize(
    String(text || '')
      .split('\n')
      .filter((l) => !/youtube\.com\/@infonic|instagram\.com\/infonic/i.test(l))
      .join('\n')
  )
    .replace(/\{\{\s*google_reviews_link\s*\}\}/g, '{{review_link}}')
    .replace(/\{\{\s*student_work_link\s*\}\}/g, '{{proof_link}}')
    .replace(/\{\{\s*next_batch\s*\}\}/g, '{{batch_date}}')
    .replace(/(Real centre|Asli centre): .*$/gm, '$1: {{address}}')
    .replace(/2nd Floor, Krishna Tower[^\n]*/g, '{{address}}')
    .replace(/(?:Open )?Mon–Fri, 9 am – 6 pm(?: khula hai)?\.\s*/g, '')
    .replace(/Our office is open Monday to Friday, 9 am – 6 pm\.\s*/g, '')
    .replace(/Humara office Monday se Friday, subah 9 se shaam 6 baje tak khula hai\.\s*/g, '')
    .replace(/, all working under the guidance of [^,]+, who monitors every batch so quality stays consistent and the syllabus stays up to date\./g, ' who keep the syllabus up to date.')
    .replace(/, sab [A-Z][a-z]+ [A-Z][a-z]+ ke guidance mein, jo har batch monitor karte hain taaki quality same rahe aur syllabus up to date rahe\./g, ', jo syllabus up to date rakhte hain.')
    .replace(/ a quick call on [\d-]+ first makes sure a counsellor is free\./g, ' a quick call first makes sure a counsellor is free.')
    .replace(/ pehle [\d-]+ par call kar lo to counsellor free mil jayenge\./g, ' pehle call kar lo to counsellor free mil jayenge.')
    .replace(/Many students from [^.]+ learn with us this way\./g, 'Many students from other cities learn with us this way.')
    .replace(/[A-Z][a-z]+(?:, [A-Z][a-z]+)+ aur bahar ke bahut students aise hi padhte hain\./g, 'Dusre shehron ke bahut students aise hi padhte hain.')
    .replace(/students from [A-Z][a-z]+(?:, [A-Z][a-z]+)+ and [A-Z][a-z]+ already learn with us this way\./g, 'students from other cities already learn with us this way.')
    .replace(/[A-Z][a-z]+(?:, [A-Z][a-z]+)+ aur [A-Z][a-z]+ ke students aise hi padh rahe hain\./g, 'dusre shehron ke students aise hi padh rahe hain.')
    .replace(/no-cost EMI is available on fees above ₹[\d,]+/g, 'EMI options are available')
    .replace(/₹[\d,]+ se upar ki fees par no-cost EMI hai/g, 'EMI options available hain')
    .replace(/₹[\d,]+ se upar ki fees par no-cost EMI/g, 'EMI options')
    .replace(/ \(Back Office also has an afternoon batch\)| \(Back Office mein dopahar ka batch bhi\)/g, '')
    .replace(/No-cost EMI is available on fees above ₹[\d,]+/g, 'EMI options are available')
    .replace(/, and EMI is available above ₹[\d,]+/g, ', and EMI options are available')
    .replace(/, aur ₹[\d,]+ se upar EMI bhi hai/g, ', aur EMI options bhi hain')
    .replace(/No-cost EMI on fees above ₹[\d,]+/g, 'EMI options available')
    .replace(/₹[\d,]+ se upar no-cost EMI/g, 'EMI options available')
    .replace(/ \(Ajmer Road\)/g, '')
    .replace(/ at Ajmer Road/g, ' at our centre')
    .replace(/Ajmer Road classroom/g, 'Humara classroom')
    .replace(/(classroom|Classroom) at Ajmer Road/g, '$1')
    .replace(/Jaipur ya paas/g, '{{city}} ya paas')
    .replace(/outside Jaipur/g, 'outside {{city}}')
    .replace(/near Jaipur/g, 'near {{city}}')
    .replace(/Jaipur ke bahar/g, '{{city}} ke bahar')
    .replace(/in Jaipur since/g, 'in {{city}} since')
    .replace(/se Jaipur mein/g, 'se {{city}} mein')
    .replace(/\{\{business_name\}\}, Jaipur/g, '{{business_name}}, {{city}}');
}
let faqCache = null;
/** Default FAQ answers for coaching chatbots (English + Hinglish, institute facts as placeholders) */
export function defaultFaqs() {
  if (faqCache) return faqCache;
  let list = [];
  try {
    list = readJson('faqs.json');
  } catch {
    list = [];
  }
  faqCache = list
    .map((f) => {
      const action = FAQ_ACTIONS[f.key] || 'answer';
      const en = FAQ_TEXT[f.key]?.en || generalizeFaq(f.en);
      const hi = FAQ_TEXT[f.key]?.hi || generalizeFaq(f.hi);
      return {
        key: String(f.key).toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40),
        title: f.title || f.key,
        enabled: true,
        keywords: [...new Set((f.keywords || []).map((k) => String(k).toLowerCase().trim()).filter((k) => k.length >= 2))].slice(0, 60),
        en: en.slice(0, 1000),
        hi: hi.slice(0, 1000),
        action,
      };
    })
    // A text answer needs text; routed intents (fees, demo…) do not
    .filter((f) => !FAQ_SKIP.has(f.key) && f.keywords.length && (f.action !== 'answer' || f.en || f.hi));
  return faqCache;
}

/**
 * Re-map the variables of the pack's templates that are still drafts (e.g. after new CRM fields like fees were
 * added). Text is not changed; templates already sent to WhatsApp are left alone. Returns how many were updated.
 */
export async function refreshPackVariables(tenantId) {
  const library = readJson('templates.json');
  let updated = 0;
  for (const t of library) {
    for (const lang of ['en', 'hi']) {
      const text = (t[lang] || '').trim();
      if (!text) continue;
      const doc = await Template.findOne({ tenantId, name: `${t.name}_${lang}`, status: 'draft' });
      if (!doc) continue;
      const { body, variableDefaults } = numberVariables(generalize(text), t.name);
      if (body !== doc.body) continue; // edited by the business: keep theirs
      if (JSON.stringify(variableDefaults) === JSON.stringify(doc.variableDefaults.map(({ source, value, example }) => ({ source, value, example })))) continue;
      doc.variableDefaults = variableDefaults;
      await doc.save();
      updated += 1;
    }
  }
  return updated;
}
