/**
 * Course flow of the chatbot (coaching institutes), built from the business's own Courses page:
 *
 *   areas list -> courses of that area -> COURSE (greeting + Fees / Details / Free demo)
 *   Fees -> "Are you interested?"  yes -> admission questions -> booking (status, call task, alert, hand-off)
 *                                  more info -> details · not now -> Nurture – Later
 *   Typed questions at any point ("emi hai?", "online hai kya", "address") -> FAQ answer, then back to where they were
 *
 * Questions and FAQ answers are editable on the Chatbot page (defaults below / from the playbook).
 * Every button / list row id names what it is for (e.g. "crs_DM", "cf_fees_DM"), so a tap on an older message
 * still works. Texts are sent in the lead's language (English / Hinglish).
 */
import { Course } from '../models/index.js';
import { getLeadStatuses } from './leadStatuses.js';
import { detectCourse } from './automation.js';
import { defaultFaqs } from './coachingContent.js';

const ROW_TITLE = 24; // WhatsApp list row title limit
const ROW_DESC = 72;
const BUTTON_TITLE = 20;
const MAX_ROWS = 10;
const BODY_LIMIT = 1024;
const FEES_WORDS = /\b(fee|fees|fess|price|pricing|cost|charges|kitn[aei]|kitne ka)\b/i;
const cut = (s, n) => (String(s || '').length > n ? `${String(s).slice(0, n - 1).trimEnd()}…` : String(s || ''));

// ---------- texts (English / Hinglish) ----------
const T = {
  areas: { en: '🎯 *What would you like to learn?*\n\nChoose an area 👇', hi: '🎯 *Aap kya seekhna chahte ho?*\n\nArea chuniye 👇' },
  whichCourse: { en: '🤔 *Which course are you asking about?*\n\nChoose an area 👇', hi: '🤔 *Kaunse course ke baare mein pooch rahe ho?*\n\nArea chuniye 👇' },
  areasButton: { en: 'Choose area', hi: 'Area chuno' },
  courses: { en: '📚 *{area}* courses\n\nTap one to see details, fees and a free demo 👇', hi: '📚 *{area}* ke courses\n\nDetails, fees aur free demo ke liye ek chuniye 👇' },
  coursesButton: { en: 'Choose course', hi: 'Course chuno' },
  more: { en: 'More courses…', hi: 'Aur courses…' },
  allAreas: { en: '⬅️ All areas', hi: '⬅️ Saare areas' },
  noCourses: { en: 'Our counsellor will share the course details with you shortly 🙂', hi: 'Humare counsellor aapko jaldi course details bhejenge 🙂' },
  fees: { en: '💰 Fees', hi: '💰 Fees' },
  details: { en: '📘 Details', hi: '📘 Details' },
  demo: { en: '✅ Free demo', hi: '✅ Free demo' },
  courseNext: { en: '👇 *What would you like to know?*', hi: '👇 *Aap kya jaanna chahoge?*' },
  interestedQ: { en: '🙂 *Are you interested in {course}?*', hi: '🙂 *Kya aap {course} mein interested ho?*' },
  yes: { en: '✅ Yes, interested', hi: '✅ Haan, interested' },
  moreInfo: { en: '📘 Need more info', hi: '📘 Aur jaankari' },
  notNow: { en: '⏳ Not now', hi: '⏳ Abhi nahi' },
  detailsNext: { en: '✅ *Shall we book your free counselling / demo?*', hi: '✅ *Aapki free counselling / demo book karein?*' },
  otherCourses: { en: '📚 Other courses', hi: '📚 Dusre courses' },
  exploreCourses: { en: '📚 Explore courses', hi: '📚 Courses dekho' },
  talk: { en: '📞 Talk to counsellor', hi: '📞 Counsellor se baat' },
  anythingElse: { en: '💬 *Anything else you would like to know?*', hi: '💬 *Aur kuch jaanna hai?*' },
  notNowReply: {
    en: 'No problem, *{name}* 🙂 Take your time.\n\n📅 We will keep you posted about new *{course}* batches.\n\n💬 Reply anytime if you have a question.',
    hi: 'Koi baat nahi, *{name}* 🙂 Aaram se sochiye.\n\n📅 Naye *{course}* batches ki info hum bhejte rahenge.\n\n💬 Koi sawaal ho to kabhi bhi reply karein.',
  },
  intro: {
    en: '🙌 *Great choice!*\n\nJust a few quick questions so our counsellor can guide you better 👇',
    hi: '🙌 *Badhiya!*\n\nBas kuch chhote sawaal, taaki counsellor aapko sahi guide kar sakein 👇',
  },
  introCall: {
    en: '🙂 *Sure!*\n\nJust a few quick questions so the right counsellor calls you 👇',
    hi: '🙂 *Zaroor!*\n\nBas kuch chhote sawaal, taaki sahi counsellor aapko call kare 👇',
  },
  typeAnswer: { en: 'Please type your answer 🙂', hi: 'Apna jawab type kariye 🙂' },
  pickOption: { en: 'Please choose one of the options below 👇', hi: 'Neeche diye options mein se ek chuniye 👇' },
  chooseButton: { en: 'Choose', hi: 'Chuniye' },
  counsellorWill: { en: 'Our counsellor will share this with you 🙂', hi: 'Ye humare counsellor aapko batayenge 🙂' },
  booked: {
    en: '🎉 *Thank you, {name}!*\n\n✅ Your free counselling for *{course}* is booked.\n\n📞 Our counsellor will call you *{time}*.\n\n🏫 Mode: *{mode}*\n\n💬 Any question till then? Just reply here.',
    hi: '🎉 *Thank you, {name}!*\n\n✅ *{course}* ke liye aapki free counselling book ho gayi hai.\n\n📞 Humare counsellor aapko *{time}* call karenge.\n\n🏫 Mode: *{mode}*\n\n💬 Tab tak koi sawaal ho to yahin reply karein.',
  },
  counsellingGeneric: { en: 'your course', hi: 'aapke course' },
  modeUnknown: { en: 'to be decided with the counsellor', hi: 'counsellor ke saath decide karenge' },
};
const t = (key, lang, vars = {}) => Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, v ?? ''), T[key][lang === 'hi' ? 'hi' : 'en']);

// ---------- admission questions (default; editable on the Chatbot page) ----------
const opt = (value, en, hi = en) => ({ value, en, hi });
export const DEFAULT_COURSE_QUESTIONS = [
  {
    key: 'profile', field: 'custom.profile', en: 'What do you do right now?', hi: 'Aap abhi kya karte ho?',
    options: [
      opt('School / 12th pass', 'School / 12th pass'), opt('College student', 'College student'),
      opt('Graduate / job-seeker', 'Graduate, job-seeker', 'Graduate, job chahiye'), opt('Working professional', 'Working professional', 'Job karta / karti hoon'),
      opt('Business owner', 'Business owner', 'Apna business hai'), opt('Homemaker / restarting', 'Homemaker / restart'),
    ],
  },
  {
    key: 'goal', field: 'custom.goal', en: 'What is your main goal?', hi: 'Aapka main goal kya hai?',
    options: [opt('Job / career', 'Get a job', 'Job / career'), opt('Freelancing / own business', 'Freelance / business'), opt('Upgrade skills', 'Upgrade my skills', 'Skills upgrade'), opt('College / internship', 'College / internship')],
  },
  {
    key: 'mode', field: 'custom.mode', en: 'How would you like to learn?', hi: 'Aap kaise padhna chahoge?',
    options: [opt('Classroom', '🏫 Classroom'), opt('Online live', '💻 Online live'), opt('', '🤔 Not sure yet', '🤔 Abhi pata nahi')],
  },
  {
    key: 'start', field: 'custom.join_when', en: 'When would you like to start?', hi: 'Aap kab se join karna chahoge?',
    options: [opt('This month', '🚀 This month', '🚀 Is mahine'), opt('Next month', '📅 Next month', '📅 Agle mahine'), opt('Just exploring', '👀 Just exploring', '👀 Abhi dekh raha hoon')],
  },
  { key: 'name', field: 'name', en: 'What is your full name?', hi: 'Aapka poora naam kya hai?', options: [], skipIfKnown: true },
  { key: 'city', field: 'custom.city', en: 'Which city / area are you from?', hi: 'Aap kis city / area se ho?', options: [], skipIfKnown: true },
  {
    key: 'call', field: 'custom.callback_time', en: 'When should our counsellor call you?', hi: 'Counsellor aapko kab call karein?',
    options: [opt('Morning (10 am – 1 pm)', '🌅 Morning (10–1)', '🌅 Subah (10–1)'), opt('Afternoon (1 – 4 pm)', '☀️ Afternoon (1–4)', '☀️ Dopahar (1–4)'), opt('Evening (4 – 7 pm)', '🌆 Evening (4–7)', '🌆 Shaam (4–7)')],
  },
];
// A bot saved before FAQs existed uses the playbook defaults
const faqsOf = (bot) => (bot?.faqs?.length ? bot.faqs : defaultFaqs());
const questionsOf = (bot) => (bot?.courseQuestions?.length ? bot.courseQuestions : DEFAULT_COURSE_QUESTIONS).filter((q) => q.enabled !== false);

const getCustom = (c, k) => (c.customFields?.get ? c.customFields.get(k) : c.customFields?.[k]) || '';
const fieldValue = (c, field) => (field === 'name' ? c.name?.trim() : field.startsWith('custom.') ? getCustom(c, field.slice(7)) : '');

// ---------- catalog ----------
async function catalog(tenantId) {
  const courses = await Course.find({ tenantId, active: true }).sort({ createdAt: 1, _id: 1 }).lean();
  const areas = [];
  for (const c of courses) {
    const area = c.category || 'Courses';
    if (!areas.includes(area)) areas.push(area);
  }
  return { courses, areas };
}

const lang = (contact) => (contact.language === 'hi' ? 'hi' : 'en');
const fill = (text, contact) => String(text || '').replaceAll('{{name}}', contact.name?.trim() ? `*${contact.name.trim()}*` : '').replace(/Hi\s+👋/, 'Hi 👋').replace(/\s+,/g, ',');
// WhatsApp formatting: *bold* the course name (once) and every ₹ amount / "Best value"
const boldName = (text, name) => (name && !text.includes(`*${name}*`) ? text.replace(name, `*${name}*`) : text);
const boldMoney = (text) => String(text || '').replace(/(?<!\*)(₹\s?[\d,]+(?:\.\d+)?(?:\s?(?:\/|per)\s?\w+)?)/g, '*$1*').replace(/⭐ Best value/g, '⭐ *Best value*');

// ---------- FAQ: matching what students type ----------
// Short forms students use (playbook: "h = hai, kb = kab, kha = kahan, pr = par")
const normalize = (s) =>
  ` ${String(s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/(.)\1{2,}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()} `
    .replace(/ h /g, ' hai ')
    .replace(/ kb /g, ' kab ')
    .replace(/ kha /g, ' kahan ')
    .replace(/ pr /g, ' par ');

/** The FAQ a typed message asks (longest matching keyword wins, so "online class" beats "class") */
export function matchFaq(faqs, text) {
  const n = normalize(text);
  if (n.trim().length < 2) return null;
  let best = null;
  for (const f of faqs || []) {
    if (f.enabled === false) continue;
    for (const k of f.keywords || []) {
      const kw = normalize(k).trim();
      if (kw.length < 2) continue;
      if (n.includes(` ${kw} `) && (!best || kw.length > best.len)) best = { faq: f, len: kw.length };
    }
  }
  return best?.faq || null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const prettyDate = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || '');
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : v || '';
};

/** Fill {{placeholders}}; a line whose placeholder has no value is dropped (never send blanks) */
export function fillAnswer(text, { contact, course, tenant, L }) {
  const info = tenant?.settings?.messageInfo || {};
  const months = course?.durationDays ? Math.round(course.durationDays / 30) : 0;
  const values = {
    name: contact?.name?.trim() || '',
    course: course?.name || (L === 'hi' ? 'humare courses' : 'our courses'),
    duration: months ? `${months} ${L === 'hi' ? 'mahine' : months === 1 ? 'month' : 'months'}` : '',
    batch_date: prettyDate(course?.nextBatchDate),
    internship: course?.internshipLine || '',
    outcome: course?.outcome || '',
    per_day: course?.feeAmount && course?.durationDays ? `₹${Math.round(course.feeAmount / course.durationDays).toLocaleString('en-IN')}` : '',
    proof_link: course?.proofLink || info.proofLink || '',
    course_link: course?.pageUrl || '',
    business_name: tenant?.name || '',
    address: info.address || '',
    maps_link: info.mapsLink || '',
    city: info.city || '',
    students_trained: info.studentsTrained || '',
    since_year: info.sinceYear || '',
    rating: info.rating || '',
    review_link: info.reviewLink || '',
    offer_end: prettyDate(info.offerEnd),
  };
  const known = (part) => [...part.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)].every((m) => m[1].toLowerCase() === 'name' || (values[m[1].toLowerCase()] ?? '') !== '');
  // A sentence whose value is missing is left out (the rest of the line stays)
  const lines = String(text || '')
    .split('\n')
    .map((line) => (known(line) ? line : line.split(/(?<=[.!?])\s+/).filter(known).join(' ')))
    .filter((line, i, all) => line.trim() || (all[i - 1] ?? '').trim()) // keep paragraph breaks, drop emptied lines
    .map((line) => line.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, k) => values[k.toLowerCase()] ?? ''));
  return lines.join('\n').replace(/Hi\s+👋/, 'Hi 👋').replace(/Hi\s+,/g, 'Hi,').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Handle a message inside the course flow (or a tap on any course-flow button), or a typed question.
 * ctx = { bot, contact, state, parsed, send, sendText, now, tenant, fromMenu }
 * Returns { handled, handoff?, status?, booking?, tag? }
 */
// ---------- what the lead did with each course (history + contact.courseInterest) ----------
const ACTION_TEXT = {
  viewed: 'opened the course',
  fees: 'checked the fees',
  details: 'read the details',
  demo: 'asked for a free demo ✅',
  interested: 'said YES, interested ✅',
  not_now: 'said "not now"',
};
/**
 * Remembers on the lead that they did `action` with `course`, and adds a line for the history note
 * (ctx.activity, written once per turn by the chatbot). The same course + action is noted only once,
 * except the answers that matter for sales (interested / demo / not now).
 */
function track(ctx, course, action) {
  const { contact } = ctx;
  if (!course || !contact) return;
  const now = ctx.now || new Date();
  const list = contact.courseInterest || (contact.courseInterest = []);
  let entry = list.find((x) => x.code === course.code);
  const first = !entry;
  if (!entry) {
    list.push({ code: course.code, name: course.name, firstAt: now, lastAt: now, actions: [] });
    entry = list[list.length - 1];
    while (list.length > 20) list.shift();
  }
  const seen = (entry.actions || []).includes(action);
  entry.lastAt = now;
  // Fees / details without opening the course first still count as "opened"
  if (!seen) entry.actions = [...new Set([...(entry.actions || []), ...(first && action !== 'viewed' ? ['viewed'] : []), action])];
  contact.markModified?.('courseInterest');
  if (!ctx.activity || !ACTION_TEXT[action]) return;
  if (seen && !['interested', 'demo', 'not_now'].includes(action)) return;
  // One line per course per turn: "📘 Digital Marketing (DM): opened the course, checked the fees"
  const head = `📘 ${course.name} (${course.code}):`;
  const i = ctx.activity.findIndex((l) => l.startsWith(head));
  const what = first && action !== 'viewed' ? `${ACTION_TEXT.viewed}, ${ACTION_TEXT[action]}` : ACTION_TEXT[action];
  if (i >= 0) ctx.activity[i] += `, ${ACTION_TEXT[action]}`;
  else ctx.activity.push(`${head} ${what}`);
}

export async function handleCourseFlow(ctx) {
  const { contact, state, parsed } = ctx;
  const id = parsed.interactiveReplyId || '';
  const L = lang(contact);
  const { courses, areas } = await catalog(contact.tenantId);
  const byCode = Object.fromEntries(courses.map((c) => [c.code, c]));

  // Buttons / rows from any course-flow message (also older ones)
  if (id === 'nav_courses' || ctx.fromMenu) return showAreas(ctx, areas, L);
  if (id === 'nav_talk') return startQuestions(ctx, byCode[state.course] || byCode[contact.course] || null, L, true);
  if (id.startsWith('cat_')) {
    const [, idx, page] = id.split('_');
    return showCourses(ctx, areas[Number(idx)], Number(idx), Number(page) || 0, courses, L);
  }
  if (id.startsWith('crs_')) {
    const course = byCode[id.slice(4)];
    // A course picked after "fees?" / "free demo" without a course: continue with that
    if (course && state.pendingAction === 'fees') return showFees(ctx, course, L);
    if (course && state.pendingAction === 'book') return startQuestions(ctx, course, L);
    return showCourse(ctx, course, L);
  }
  if (id.startsWith('cf_')) {
    const [, what, ...rest] = id.split('_');
    const course = byCode[rest.join('_')];
    if (!course) return showAreas(ctx, areas, L);
    if (what === 'fees') return showFees(ctx, course, L);
    if (what === 'det') return showDetails(ctx, course, L);
    if (what === 'yes' || what === 'demo') return startQuestions(ctx, course, L, false, what === 'demo' ? 'demo' : 'interested');
    if (what === 'no') return notNow(ctx, course, L);
  }
  if (id.startsWith('aq_')) return answerQuestion(ctx, byCode, L, id);
  if (id) return { handled: false };

  const text = String(parsed.text || '').trim();
  const questions = questionsOf(ctx.bot);
  const current = state.step === 'course_q' ? questions.find((q) => q.key === state.flowKey) : null;

  // A typed answer to a "type your answer" question (name, city…), or one of the options typed ("online", "2"),
  // is an answer, not a question
  if (current && (!current.options?.length || typedOption(current, text) >= 0)) return answerQuestion(ctx, byCode, L, null);

  // A question typed anywhere ("emi hai?", "online hai kya", "address"): answer it, then continue where they were.
  // A course named in the same message ("python ki fees") wins over the one they looked at before.
  const mentioned = /^\d{1,2}$/.test(text) ? null : await detectCourse(contact.tenantId, text);
  const faq = matchFaq(faqsOf(ctx.bot), text);
  if (faq) return answerFaq(ctx, faq, (mentioned && byCode[mentioned.code]) || byCode[state.course] || byCode[contact.course] || null, L, { areas, current });

  if (current) return answerQuestion(ctx, byCode, L, null);

  // A number typed in the areas / course lists
  const n = /^\d{1,2}$/.test(text) ? Number(text) - 1 : -1;
  if (state.step === 'course_areas' && n >= 0 && areas[n]) return showCourses(ctx, areas[n], n, 0, courses, L);
  if (state.step === 'course_list' && n >= 0) {
    const listed = pageCourses(courses, state.courseArea, state.coursePage || 0).items;
    if (listed[n]) return showCourse(ctx, listed[n], L);
  }
  // A course name or its trigger words, anywhere ("python course", "digital marketing fees")
  const found = await detectCourse(contact.tenantId, text);
  if (found && byCode[found.code]) return FEES_WORDS.test(text) ? showFees(ctx, byCode[found.code], L) : showCourse(ctx, byCode[found.code], L);
  if (state.step === 'course' && byCode[state.course] && FEES_WORDS.test(text)) return showFees(ctx, byCode[state.course], L);
  return { handled: false };
}

/** First message names a course (ad / trigger words) or asks a question: answer that straight away */
export async function openCourseIfKnown(ctx) {
  const { contact, parsed, state } = ctx;
  const L = lang(contact);
  const course = contact.course ? await Course.findOne({ tenantId: contact.tenantId, code: contact.course, active: true }).lean() : null;
  if (course) {
    if (FEES_WORDS.test(parsed?.text || '')) return showFees(ctx, course, L);
    const faq = matchFaq(faqsOf(ctx.bot), parsed?.text);
    if (faq && faq.action !== 'courses') return answerFaq(ctx, faq, course, L, { areas: (await catalog(contact.tenantId)).areas });
    return showCourse(ctx, course, L);
  }
  const faq = matchFaq(faqsOf(ctx.bot), parsed?.text);
  // A plain greeting / "details" gets the welcome menu instead
  if (faq && !['details', 'courses'].includes(faq.action) && faq.key !== 'greeting') {
    state.step = 'menu';
    return answerFaq(ctx, faq, null, L, { areas: (await catalog(contact.tenantId)).areas });
  }
  return { handled: false };
}

async function answerFaq(ctx, faq, course, L, { areas, current } = {}) {
  const { send, sendText, state, contact, tenant } = ctx;
  if (faq.action === 'handoff') {
    await sendText(fillAnswer((L === 'hi' ? faq.hi : faq.en) || faq.en || faq.hi, { contact, course, tenant, L }) || t('talk', L));
    return { handled: true, handoff: true, tag: faq.key };
  }
  if (faq.action === 'courses') return showAreas(ctx, areas, L);
  if (faq.action === 'fees' || faq.action === 'details' || faq.action === 'book') {
    if (!course) {
      if (faq.action === 'book') return startQuestions(ctx, null, L, true);
      state.pendingAction = faq.action === 'fees' ? 'fees' : '';
      return showAreas(ctx, areas, L, true);
    }
    if (faq.action === 'fees') return showFees(ctx, course, L);
    if (faq.action === 'details') return showDetails(ctx, course, L);
    return startQuestions(ctx, course, L);
  }
  const raw = (L === 'hi' ? faq.hi : faq.en) || faq.en || faq.hi;
  // Needs a course ("duration kitna hai?") but none chosen yet: ask which course first
  if (!course && !current && /\{\{\s*(duration|batch_date|internship|outcome|per_day)\s*\}\}/.test(raw)) {
    state.pendingAction = '';
    return showAreas(ctx, areas, L, true);
  }
  const answer = fillAnswer(raw, { contact, course, tenant, L }) || t('counsellorWill', L);
  if (!current) state.step = course ? 'course' : 'menu';
  if (current) {
    // In the middle of the admission questions: answer, then ask the same question again
    await sendText(answer);
    await askQuestion(ctx, current, L);
    return { handled: true };
  }
  const buttons = course
    ? [{ id: `cf_demo_${course.code}`, title: t('demo', L) }, { id: `cf_fees_${course.code}`, title: t('fees', L) }, { id: 'nav_courses', title: t('otherCourses', L) }]
    : [{ id: 'nav_courses', title: t('exploreCourses', L) }, { id: 'nav_talk', title: t('talk', L) }];
  const body = cut(`${answer}\n\n${t('anythingElse', L)}`, BODY_LIMIT);
  await send({ kind: 'interactive', interactive: { kind: 'buttons', body, options: buttons } });
  return { handled: true, faq: faq.key };
}

async function showAreas(ctx, areas, L, askingWhich = false) {
  const { state, send, sendText } = ctx;
  if (!areas.length) {
    await sendText(t('noCourses', L));
    return { handled: true };
  }
  if (areas.length === 1) return showCourses(ctx, areas[0], 0, 0, (await catalog(ctx.contact.tenantId)).courses, L);
  state.step = 'course_areas';
  if (!askingWhich) state.pendingAction = '';
  const rows = areas.slice(0, MAX_ROWS).map((a, i) => ({ id: `cat_${i}_0`, title: cut(a, ROW_TITLE), description: '' }));
  await send({ kind: 'interactive', interactive: { kind: 'list', body: t(askingWhich ? 'whichCourse' : 'areas', L), buttonLabel: t('areasButton', L), options: rows } });
  return { handled: true };
}

function pageCourses(courses, area, page) {
  const all = courses.filter((c) => (c.category || 'Courses') === area);
  // 9 courses + "All areas" per page; with more courses: 8 + "More…" + "All areas"
  if (all.length <= MAX_ROWS - 1) return { items: all, more: false };
  const size = MAX_ROWS - 2;
  const items = all.slice(page * size, page * size + size);
  return { items, more: (page + 1) * size < all.length };
}

async function showCourses(ctx, area, areaIndex, page, courses, L) {
  const { state, send } = ctx;
  if (!area) return showAreas(ctx, (await catalog(ctx.contact.tenantId)).areas, L);
  const { items, more } = pageCourses(courses, area, page);
  state.step = 'course_list';
  state.courseArea = area;
  state.coursePage = page;
  const rows = items.map((c) => ({ id: `crs_${c.code}`, title: cut(c.name, ROW_TITLE), description: cut(c.name.length > ROW_TITLE ? c.name : c.outcome, ROW_DESC) }));
  if (more) rows.push({ id: `cat_${areaIndex}_${page + 1}`, title: t('more', L), description: '' });
  rows.push({ id: 'nav_courses', title: t('allAreas', L), description: '' });
  await send({ kind: 'interactive', interactive: { kind: 'list', body: t('courses', L, { area }), buttonLabel: t('coursesButton', L), options: rows } });
  return { handled: true };
}

async function showCourse(ctx, course, L) {
  const { state, send, contact } = ctx;
  if (!course) return showAreas(ctx, (await catalog(contact.tenantId)).areas, L);
  state.step = 'course';
  state.course = course.code;
  state.pendingAction = '';
  if (!contact.course) contact.course = course.code; // first course they look at = their course
  track(ctx, course, 'viewed');
  const greeting = boldName(fill((L === 'hi' ? course.greetingHi : course.greetingEn) || course.greetingEn || course.greetingHi || `${course.name}`, contact), course.name);
  const body = cut(`${greeting}\n\n${t('courseNext', L)}`, BODY_LIMIT);
  await send({
    kind: 'interactive',
    interactive: {
      kind: 'buttons',
      body,
      options: [
        { id: `cf_fees_${course.code}`, title: t('fees', L) },
        { id: `cf_det_${course.code}`, title: t('details', L) },
        { id: `cf_demo_${course.code}`, title: t('demo', L) },
      ],
    },
  });
  return { handled: true };
}

async function showFees(ctx, course, L) {
  const { state, send, sendText } = ctx;
  state.step = 'course';
  state.course = course.code;
  state.pendingAction = '';
  track(ctx, course, 'fees');
  const fees = (L === 'hi' ? course.feesHi : course.feesEn) || course.feesEn || course.feesHi ||
    (L === 'hi' ? 'Exact fees, EMI options aur chal raha offer humare counsellor batayenge.' : 'Our counsellor will share the exact fee, EMI options and any running offer.');
  const ask = t('interestedQ', L, { course: course.name });
  const buttons = [
    { id: `cf_yes_${course.code}`, title: t('yes', L) },
    { id: `cf_det_${course.code}`, title: t('moreInfo', L) },
    { id: `cf_no_${course.code}`, title: t('notNow', L) },
  ];
  const link = course.pageUrl ? `\n\n🔗 *${L === 'hi' ? 'Poori jaankari' : 'Full details'}:* ${course.pageUrl}` : '';
  const feesText = boldName(boldMoney(fees.trim()), course.name) + link;
  const full = `${feesText}\n\n${ask}`;
  if (full.length <= BODY_LIMIT) await send({ kind: 'interactive', interactive: { kind: 'buttons', body: full, options: buttons } });
  else {
    await sendText(feesText);
    await send({ kind: 'interactive', interactive: { kind: 'buttons', body: ask, options: buttons } });
  }
  return { handled: true };
}

async function showDetails(ctx, course, L) {
  const { state, send, sendText } = ctx;
  state.step = 'course';
  state.course = course.code;
  track(ctx, course, 'details');
  const lines = [
    `📘 *${course.name}*`,
    course.who && `👤 *${L === 'hi' ? 'Kiske liye' : "Who it's for"}:* ${course.who.replace(/^Best for:\s*/i, '')}`,
    course.learn && `📚 *${L === 'hi' ? 'Kya seekhoge' : "What you'll learn"}:* ${course.learn}`,
    course.internshipLine && `💼 ${course.internshipLine.replace(/^Internship:/i, '*Internship:*')}`,
    course.durationDays && `⏱ *${L === 'hi' ? 'Duration' : 'Duration'}:* ${Math.round(course.durationDays / 30)} ${L === 'hi' ? 'mahine' : 'months'}`,
    course.nextBatchDate && `📅 *${L === 'hi' ? 'Agla batch' : 'Next batch'}:* ${prettyDate(course.nextBatchDate)}`,
    course.pageUrl && `🔗 *${L === 'hi' ? 'Poori jaankari' : 'Full details'}:* ${course.pageUrl}`,
  ].filter(Boolean);
  const buttons = [
    { id: `cf_yes_${course.code}`, title: t('yes', L) },
    { id: `cf_fees_${course.code}`, title: t('fees', L) },
    { id: 'nav_courses', title: t('otherCourses', L) },
  ];
  const full = `${lines.join('\n\n')}\n\n${t('detailsNext', L)}`;
  if (full.length <= BODY_LIMIT) await send({ kind: 'interactive', interactive: { kind: 'buttons', body: full, options: buttons } });
  else {
    await sendText(lines.join('\n\n'));
    await send({ kind: 'interactive', interactive: { kind: 'buttons', body: t('detailsNext', L), options: buttons } });
  }
  return { handled: true };
}

async function notNow(ctx, course, L) {
  const { state, send, contact, tenant } = ctx;
  state.step = 'menu';
  track(ctx, course, 'not_now');
  const name = contact.name?.trim() || (L === 'hi' ? 'ji' : 'there');
  const body = t('notNowReply', L, { name, course: course.name });
  await send({ kind: 'interactive', interactive: { kind: 'buttons', body, options: [{ id: 'nav_courses', title: t('otherCourses', L) }, { id: 'nav_main_menu', title: '📋 Main Menu' }] } });
  if (!contact.tags.includes('bot-not-now')) contact.tags.push('bot-not-now');
  // Only a fresh lead moves to "later"; a lead the team is already working stays where it is
  const has = (k) => getLeadStatuses(tenant).some((s) => s.key === k);
  if (contact.leadStatus === 'new' && has('nurture_later')) return { handled: true, status: 'nurture_later' };
  return { handled: true };
}

// ---------- admission questions ----------
const isKnown = (contact, q) => q.skipIfKnown && !!fieldValue(contact, q.field);
function nextQuestion(ctx, afterKey) {
  const qs = questionsOf(ctx.bot);
  const start = afterKey ? qs.findIndex((q) => q.key === afterKey) + 1 : 0;
  return qs.slice(start).find((q) => !isKnown(ctx.contact, q)) || null;
}

async function askQuestion(ctx, q, L) {
  const { state, send, sendText, contact } = ctx;
  state.step = 'course_q';
  state.flowKey = q.key;
  const qs = questionsOf(ctx.bot);
  if (!state.flowTotal) state.flowTotal = qs.filter((x) => !isKnown(contact, x)).length;
  const index = qs.findIndex((x) => x.key === q.key);
  const remaining = qs.slice(index).filter((x) => !isKnown(contact, x)).length;
  const n = `${Math.max(1, state.flowTotal - remaining + 1)}/${state.flowTotal}`;
  const text = (L === 'hi' ? q.hi : q.en) || q.en || q.hi;
  const label = (o) => (L === 'hi' ? o.hi || o.en : o.en || o.hi) || o.value;
  if (!q.options?.length) {
    await sendText(`📝 *${n}*  ${text}`);
    return;
  }
  const body = `📝 *${n}*  ${text}`;
  if (q.options.length <= 3 && q.options.every((o) => label(o).length <= BUTTON_TITLE)) {
    await send({ kind: 'interactive', interactive: { kind: 'buttons', body, options: q.options.map((o, i) => ({ id: `aq_${q.key}_${i}`, title: label(o) })) } });
  } else {
    await send({ kind: 'interactive', interactive: { kind: 'list', body, buttonLabel: t('chooseButton', L), options: q.options.slice(0, MAX_ROWS).map((o, i) => ({ id: `aq_${q.key}_${i}`, title: cut(label(o), ROW_TITLE), description: '' })) } });
  }
}

async function startQuestions(ctx, course, L, wantsCall = false, action = 'interested') {
  const { state, sendText, contact } = ctx;
  state.course = course?.code || '';
  state.pendingAction = '';
  if (course) {
    // They chose this course to join: it becomes their course (the history says if it changed)
    if (contact.course && contact.course !== course.code && ctx.activity) ctx.activity.push(`📘 Course changed: ${contact.course} → ${course.code} (chose it in the chatbot)`);
    contact.course = course.code;
    track(ctx, course, wantsCall ? 'interested' : action);
  }
  state.flowTotal = 0;
  await sendText(t(wantsCall || !course ? 'introCall' : 'intro', L));
  const first = nextQuestion(ctx, null);
  if (!first) return finishBooking(ctx, course, L);
  await askQuestion(ctx, first, L);
  return { handled: true };
}

/** Index of the option a typed answer means ("2", "online", "evening"), or -1 */
function typedOption(q, raw) {
  const clean = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
  const text = clean(raw);
  if (/^\d{1,2}$/.test(text)) return q.options[Number(text) - 1] ? Number(text) - 1 : -1;
  if (text.length < 3) return -1;
  return q.options.findIndex((o) => [o.value, o.en, o.hi].some((l) => clean(l) && clean(l).includes(text)));
}

function setField(contact, field, value) {
  if (field === 'name') {
    if (value) contact.name = value;
  } else if (field.startsWith('custom.')) {
    if (value) contact.customFields.set(field.slice(7), value);
    else contact.customFields.delete?.(field.slice(7));
  }
}

async function answerQuestion(ctx, byCode, L, tappedId) {
  const { state, contact, parsed, sendText } = ctx;
  const course = byCode[state.course] || null;
  const qs = questionsOf(ctx.bot);
  let q = qs.find((x) => x.key === state.flowKey);
  if (tappedId) {
    // aq_<key>_<option>: may be a tap on an earlier question's buttons
    const m = /^aq_(.+)_(\d+)$/.exec(tappedId);
    const tq = m && qs.find((x) => x.key === m[1]);
    const option = tq?.options?.[Number(m[2])];
    if (!option) return { handled: false };
    q = tq;
    setField(contact, q.field, option.value);
  } else if (q && !q.options?.length) {
    const value = String(parsed.text || '').trim().replace(/\s+/g, ' ').slice(0, 100);
    if (value.length < 2) {
      await sendText(t('typeAnswer', L));
      return { handled: true };
    }
    setField(contact, q.field, value);
  } else if (q) {
    // Typed instead of tapping: a number or the option's words
    const n = typedOption(q, parsed.text);
    if (n < 0) {
      state.fallbackCount = (state.fallbackCount || 0) + 1;
      await sendText(t('pickOption', L));
      await askQuestion(ctx, q, L);
      return { handled: true };
    }
    setField(contact, q.field, q.options[n].value);
  } else {
    return { handled: false };
  }
  state.fallbackCount = 0;
  const next = nextQuestion(ctx, q.key);
  if (!next) return finishBooking(ctx, course, L);
  await askQuestion(ctx, next, L);
  return { handled: true };
}

async function finishBooking(ctx, course, L) {
  const { state, contact, sendText, tenant } = ctx;
  const mode = getCustom(contact, 'mode');
  const call = getCustom(contact, 'callback_time');
  const start = getCustom(contact, 'join_when');
  const timeText = call ? (L === 'hi' ? `${call} mein` : `in the ${call.toLowerCase()}`) : L === 'hi' ? 'jaldi' : 'shortly';
  const courseName = course?.name || t('counsellingGeneric', L);
  await sendText(t('booked', L, { name: contact.name?.trim() || '', course: courseName, time: timeText, mode: mode || t('modeUnknown', L) }).replace('Thank you, !', 'Thank you!'));
  if (!contact.tags.includes('bot-booked')) contact.tags.push('bot-booked');
  if (course) track({ contact, now: ctx.now }, course, 'booked'); // the booking note says the rest
  state.step = 'menu';
  state.flowKey = '';
  const has = (k) => getLeadStatuses(tenant).some((s) => s.key === k);
  // Wants to join this month = hot lead; otherwise the lead asked for a call
  const status = start === 'This month' && has('hot') ? 'hot' : has('call_pending') ? 'call_pending' : has('contacted') ? 'contacted' : null;
  return {
    handled: true,
    handoff: true,
    status,
    booking: { course: course?.name || 'Counselling (course not chosen)', mode, call, start, profile: getCustom(contact, 'profile'), goal: getCustom(contact, 'goal'), city: getCustom(contact, 'city') },
  };
}
