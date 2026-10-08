/**
 * Rule-based chatbot engine.
 *
 * Runs for every inbound customer message (after opt-out handling, before auto-assignment):
 *   new chat / resolved chat comes back -> bot greets with the menu
 *   menu option -> reply text | lead questions | hand off to a human
 *   keyword rules, "menu" to restart, "agent" to reach a human at any time
 *   too many misunderstood messages, or a person replies -> bot steps back and the chat is auto-assigned
 *
 * Returns true when the bot is still handling the chat (so it must NOT be auto-assigned yet).
 */
import { Chatbot, Contact, Conversation, Message, Tenant } from '../models/index.js';
import { sendOutbound, autoAssign, CONVERSATION_POPULATE } from './messaging.js';
import { emitConversationEvent } from './socket.js';
import { getLeadStatuses } from './leadStatuses.js';
import { isDateField } from './contactFields.js';
import { checkAnswer } from './answerTypes.js';
import { handleCourseFlow, openCourseIfKnown } from './courseBot.js';
import { sendTypingIndicator } from './whatsapp.js';
import { automationNote, createTask, notify } from './alerts.js';
import { statusLabel } from './leadStatuses.js';

// Button / row ids that belong to the course flow (also taps on older messages)
const COURSE_IDS = /^(nav_courses|cat_|crs_|cf_|aq_)/;
const COURSE_STEPS = new Set(['course_areas', 'course_list', 'course', 'course_q']);

const LOOP_WINDOW_MS = 10 * 60 * 1000;
const LOOP_MAX_REPLIES = 15; // bot turns (answers to customer messages) per chat per 10 minutes, then hand off (bot-to-bot loop guard)

export const chatbotAllowed = (tenant) => tenant.plan?.modules?.chatbot !== false;

// Serialize bot runs per chat (two webhooks for the same chat can arrive together)
const locks = new Map();
function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(key, next.finally(() => locks.get(key) === next && locks.delete(key)));
  return next;
}

const norm = (s = '') => s.trim().toLowerCase();
const optionId = (option) => `opt_${option._id}`;

export function isWithinBusinessHours(hours, now = new Date()) {
  if (!hours?.enabled) return true;
  let parts;
  try {
    parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', { timeZone: hours.timezone || 'Asia/Kolkata', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .formatToParts(now)
        .map((p) => [p.type, p.value])
    );
  } catch {
    return true; // bad timezone in config: never block the bot
  }
  const day = hours.days?.[parts.weekday.toLowerCase().slice(0, 3)];
  if (!day?.open) return false;
  const current = `${parts.hour}:${parts.minute}`;
  return current >= (day.start || '00:00') && current < (day.end || '23:59');
}

// Id of the "Main Menu" button sent under answers
export const MAIN_MENU_ID = 'nav_main_menu';

const NUMBER_EMOJI = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
const WA_BODY_LIMIT = 1024; // WhatsApp max length of an interactive message body

export const DEFAULT_MENU_HINT = '👉 Neeche *{button}* dabaiye, ya option ka number likhiye (jaise *2*)';

/**
 * Message text that goes with the menu. Unless turned off, it also lists every option with its number,
 * so a customer who doesn't open the list still knows what "1", "2"... mean.
 */
export function menuBody(bot, intro, { fitsButtons } = {}) {
  if (bot.showNumberedOptions === false) return intro.slice(0, WA_BODY_LIMIT);
  const lines = bot.menu.slice(0, 10).map((o, i) => `${NUMBER_EMOJI[i]} ${o.title}`);
  const rawHint = bot.menuHintText?.trim() || DEFAULT_MENU_HINT;
  const hint = fitsButtons
    ? rawHint.replaceAll('*{button}*', 'diye button').replaceAll('{button}', 'diye button')
    : rawHint.replaceAll('{button}', bot.menuButtonLabel || 'View options');
  const full = `${intro.trim()}\n\n${lines.join('\n')}\n\n${hint}`;
  // Never break the message: drop the list if a very long intro would exceed WhatsApp's limit
  return full.length <= WA_BODY_LIMIT ? full : intro.slice(0, WA_BODY_LIMIT);
}

// Buttons when it fits WhatsApp's limits (<= 3 options, titles <= 20 chars), otherwise a list (<= 10 rows)
export function buildMenu(bot, intro = bot.welcomeText) {
  const options = bot.menu.slice(0, 10).map((o) => ({ id: optionId(o), title: o.title, description: o.description || '' }));
  if (!options.length) return null;
  const fitsButtons = options.length <= 3 && options.every((o) => o.title.length <= 20);
  return {
    kind: fitsButtons ? 'buttons' : 'list',
    body: menuBody(bot, intro, { fitsButtons }),
    buttonLabel: bot.menuButtonLabel || 'View options',
    options: fitsButtons ? options.map(({ id, title }) => ({ id, title })) : options,
  };
}

// Exact pick: tapped button/list row, typed number, or full option name
function findOption(bot, parsed) {
  if (parsed.interactiveReplyId) {
    const byId = bot.menu.find((o) => optionId(o) === parsed.interactiveReplyId);
    if (byId) return byId;
  }
  const text = norm(parsed.text);
  if (!text) return null;
  const index = /^\d{1,2}$/.test(text) ? Number(text) - 1 : -1; // customer typed "2"
  if (index >= 0 && bot.menu[index]) return bot.menu[index];
  // Ignore emojis / punctuation: a template button "Explore courses" picks "📚 Explore courses"
  const bare = (v) => norm(v).replace(/[^a-z0-9\u0900-\u097f]+/g, ' ').trim();
  return bot.menu.find((o) => norm(o.title) === text) || (bare(text) && bot.menu.find((o) => bare(o.title) === bare(text))) || null;
}

// Guess from part of an option name. Used only after the admin's own keyword rules found nothing.
function findOptionByPartialName(bot, parsed) {
  const text = norm(parsed.text);
  if (!text) return null;
  // Part of an option name, e.g. "admission" -> "Admission / Counselling", "demo" -> "Free Demo Class".
  // Only when exactly one option matches, so we never guess between two options.
  const words = (s) => norm(s).split(/[^a-z0-9\u0900-\u097f]+/).filter((w) => w.length >= 4);
  const textWords = words(text);
  // "course" ~ "courses", "class" ~ "classes"
  const sameWord = (a, b) => a === b || a.startsWith(b) || b.startsWith(a);
  const matches = bot.menu.filter((o) => {
    const title = norm(o.title);
    if (text.length >= 4 && title.includes(text)) return true;
    return words(o.title).some((w) => textWords.some((t) => sameWord(w, t)));
  });
  return matches.length === 1 ? matches[0] : null;
}

function findKeywordRule(bot, text) {
  const t = norm(text);
  if (!t) return null;
  return bot.keywordRules.find((rule) =>
    rule.keywords.some((k) => {
      const kw = norm(k);
      return kw && (rule.match === 'exact' ? t === kw : t.includes(kw));
    })
  );
}

// "Hiii" == "hi", "hellooo" == "hello", "Menu!" == "menu": ignore stretched letters and trailing punctuation
const loose = (s = '') => norm(s).replace(/[!?.,\s]+$/g, '').replace(/(.)\1+/g, '$1');
const matchesAny = (list, text) => list.some((k) => loose(k) && loose(k) === loose(text));

// What kind of answer a lead question needs: the admin's choice, else email for the email field,
// date for date fields (birthday, anniversary), otherwise anything
function answerTypeOf(tenant, q) {
  if (q.answerType && q.answerType !== 'any') return q.answerType;
  if (q.field === 'email') return 'email';
  if (q.field.startsWith('custom.') && isDateField(tenant, q.field.slice(7))) return 'date';
  return 'any';
}

function saveAnswer(contact, field, answer, dateValue) {
  const value = dateValue || answer.trim().slice(0, 500);
  if (field === 'name') contact.name = value;
  else if (field === 'email') contact.email = value.toLowerCase();
  else if (field.startsWith('custom.')) contact.customFields.set(field.slice(7), value);
}

async function emitConversation(conversationId, extra) {
  const populated = await Conversation.findById(conversationId).populate(CONVERSATION_POPULATE);
  if (populated) emitConversationEvent(populated, 'conversation:updated', populated, extra);
}

export async function runChatbot({ tenant, conversation, parsed, hadPreviousInbound, wasResolved, previousActivityAt, waMessageId }) {
  return withLock(String(conversation._id), async () => {
    // Reload everything inside the lock: an earlier run for this chat may have just changed it
    const conv = await Conversation.findById(conversation._id);
    const contact = await Contact.findById(conv.contactId);
    const state = { ...(conv.toObject().bot || {}) }; // plain copy, written back once at the end
    const now = new Date();

    const fullTenant = await Tenant.findById(tenant._id).populate('plan');
    const bot = fullTenant && chatbotAllowed(fullTenant) ? await Chatbot.findOne({ tenantId: tenant._id, enabled: true }) : null;
    if (!bot || !contact || contact.optedOut) {
      // Bot switched off / removed from plan / customer opted out mid-flow: release the chat to the team
      if (state.active) {
        conv.set('bot', { ...state, active: false, endedAt: now, endReason: contact?.optedOut ? 'opted_out' : 'disabled' });
        await conv.save();
        await emitConversation(conv._id);
      }
      return false;
    }

    // ---- helpers ----
    let answeredThisTurn = false;
    const send = async (payload) => {
      const message = await sendOutbound({ tenant: fullTenant, contact, conversation: conv, isBot: true, ...payload });
      if (message.status === 'failed') throw new Error(message.error || 'Bot message failed');
      answeredThisTurn = true;
      return message;
    };
    const sendText = (text) => (text?.trim() ? send({ kind: 'text', text: text.trim() }) : null);
    const sendMenu = async (prefix) => {
      const menu = buildMenu(bot);
      if (prefix) await sendText(prefix);
      if (menu) return send({ kind: 'interactive', interactive: menu });
      return sendText(bot.welcomeText);
    };
    // Send an answer (fees, timing...) and what comes after it:
    //   'button' style -> the answer itself carries one "Main Menu" button (one compact message)
    //   'full' style   -> the answer, then the whole numbered menu again
    const sendAnswer = async (text) => {
      const answer = (text || bot.welcomeText || '').trim();
      if (!bot.menu.length) return sendText(answer);
      if (bot.afterReplyStyle === 'full') {
        await sendText(answer);
        const menu = buildMenu(bot, bot.menuAfterReplyText?.trim() || 'Aur kisi cheez me madad chahiye? 👇');
        if (menu) await send({ kind: 'interactive', interactive: menu });
        return;
      }
      const hint = bot.afterReplyHint?.trim();
      const body = hint ? `${answer}\n\n${hint}` : answer;
      const button = { id: MAIN_MENU_ID, title: (bot.mainMenuButtonLabel || '📋 Main Menu').slice(0, 20) };
      if (body.length <= WA_BODY_LIMIT) {
        await send({ kind: 'interactive', interactive: { kind: 'buttons', body, options: [button] } });
      } else {
        // Answer too long for a button message: send it as text, then a short line with the button
        await sendText(answer);
        await send({ kind: 'interactive', interactive: { kind: 'buttons', body: hint || '👇', options: [button] } });
      }
    };
    const addTag = (tag) => {
      if (tag && !contact.tags.includes(tag)) contact.tags.push(tag);
    };
    const finish = async (reason, text) => {
      state.active = false;
      state.endedAt = now;
      state.endReason = reason;
      const offline = !isWithinBusinessHours(bot.businessHours, now);
      try {
        if (reason === 'lead_complete') {
          await sendText(text);
          if (offline) await sendText(bot.businessHours.awayText);
        } else {
          // "someone will reply shortly" would be wrong when the team is offline
          await sendText(offline ? bot.businessHours.awayText : text);
        }
      } catch {
        // The chat still goes to a human even if the goodbye message fails
      }
      return 'handoff';
    };

    // ---- should the bot (re)start? ----
    if (!state.active) {
      // A person on the team already messaged this customer (not the bot, not a bulk campaign) -> it's their conversation
      const humanStarted = await Message.exists({
        conversationId: conv._id, direction: 'outbound', isBot: { $ne: true }, campaignId: { $exists: false },
      });
      const freshChat = !hadPreviousInbound && !conv.assignedTo && !humanStarted;
      const returning = wasResolved && bot.restartOnResolved;

      // The bot handed this chat to the team but nobody has replied yet, and the customer asks for the menu ("hi", "menu"):
      // answer instead of leaving them waiting. Once a person has replied, the chat is theirs and the bot stays out.
      const waitingAfterHandoff =
        ['handoff', 'lead_complete'].includes(state.endReason) &&
        (parsed.interactiveReplyId === MAIN_MENU_ID || matchesAny(bot.menuKeywords, parsed.text)) &&
        !(await Message.exists({
          conversationId: conv._id, direction: 'outbound', isBot: { $ne: true }, campaignId: { $exists: false },
          createdAt: { $gt: state.endedAt || new Date(0) },
        }));

      // Customer comes back after a long silence (chat never resolved): greet them like a returning customer
      const quietHours = Number(bot.restartAfterHours ?? 24);
      const backAfterSilence =
        quietHours > 0 && previousActivityAt && now - new Date(previousActivityAt) >= quietHours * 3600 * 1000;

      if (!freshChat && !returning && !waitingAfterHandoff && !backAfterSilence) return false;
      Object.assign(state, {
        active: true, step: 'menu', questionIndex: 0, fallbackCount: 0,
        repliesInWindow: 0, windowStartedAt: now, startedAt: now, endedAt: undefined, endReason: undefined,
      });
      state.justStarted = true;
    }

    // The bot answers this message: show "typing…" on the customer's phone until the reply arrives
    if (waMessageId && bot.typingIndicator !== false) await sendTypingIndicator(fullTenant._id, waMessageId);

    // ---- course flow (coaching institutes with a "Courses" menu option) ----
    const courseFlow = fullTenant.businessType === 'coaching' && bot.menu.some((o) => o.action === 'courses');
    let courseResult = null; // { status, booking } to apply after the turn
    const activity = []; // course history lines of this turn ("📘 Digital Marketing (DM): checked the fees")
    const runCourse = async (extra = {}) => {
      const r = await handleCourseFlow({ bot, contact, state, parsed, send, sendText, now, tenant: fullTenant, activity, ...extra });
      if (r.handled) courseResult = r;
      return r.handled;
    };

    // ---- loop guard ----
    if (!state.windowStartedAt || now - state.windowStartedAt > LOOP_WINDOW_MS) {
      state.windowStartedAt = now;
      state.repliesInWindow = 0;
    }

    let outcome;
    let answer; // checked answer to a lead question
    try {
      if (state.repliesInWindow >= LOOP_MAX_REPLIES) {
        outcome = await finish('loop_guard', bot.handoffText);
      } else if (matchesAny(bot.handoffKeywords, parsed.text)) {
        outcome = await finish('handoff', bot.handoffText);
      } else if (!state.justStarted && (parsed.interactiveReplyId === MAIN_MENU_ID || matchesAny(bot.menuKeywords, parsed.text))) {
        // "menu" at any point (also in the middle of lead questions) shows the menu again
        state.step = 'menu';
        state.questionIndex = 0;
        state.fallbackCount = 0;
        await sendMenu();
      } else if (courseFlow && (COURSE_IDS.test(parsed.interactiveReplyId || '') || COURSE_STEPS.has(state.step)) && (await runCourse())) {
        // handled by the course flow
        if (courseResult?.tag) addTag(courseResult.tag);
        if (courseResult?.handoff) outcome = await finish(courseResult.booking ? 'lead_complete' : 'handoff', '');
      } else if (courseFlow && state.justStarted && !findOption(bot, parsed) && (await (async () => {
        // First message names a course (from the ad, or words like "digital marketing"): open that course straight away
        const r = await openCourseIfKnown({ bot, contact, state, parsed, send, sendText, now, tenant: fullTenant, activity });
        if (r.handled) courseResult = r;
        return r.handled;
      })())) {
        state.fallbackCount = 0;
        if (courseResult?.tag) addTag(courseResult.tag);
        if (courseResult?.handoff) outcome = await finish(courseResult.booking ? 'lead_complete' : 'handoff', '');
      } else if (state.step === 'question') {
        // ---- collecting lead details ----
        const q = bot.leadQuestions[state.questionIndex];
        if (!q) {
          outcome = await finish('lead_complete', bot.leadCompleteText);
        } else if (!(answer = checkAnswer(answerTypeOf(fullTenant, q), parsed.text)).ok) {
          // Wrong kind of answer (e.g. "shaam ko" for a time question): explain and ask the same question again
          state.fallbackCount += 1;
          if (state.fallbackCount > bot.maxFallbacks) outcome = await finish('handoff', bot.handoffText);
          else {
            const hint = q.errorText?.trim() || answer.hint;
            await sendText(hint ? `${hint}\n\n${q.question}` : q.question);
          }
        } else {
          saveAnswer(contact, q.field, parsed.text, answer.value !== parsed.text.trim() ? answer.value : undefined);
          state.questionIndex += 1;
          state.fallbackCount = 0;
          const nextQ = bot.leadQuestions[state.questionIndex];
          if (nextQ) {
            await sendText(nextQ.question);
          } else {
            addTag(bot.leadTag);
            if (contact.leadStatus === 'new' && getLeadStatuses(fullTenant).some((s) => s.key === 'contacted')) {
              contact.leadStatus = 'contacted';
              contact.statusUpdatedAt = now;
            }
            outcome = await finish('lead_complete', bot.leadCompleteText);
          }
        }
      } else if (state.justStarted && !findOption(bot, parsed)) {
        // ---- greeting (a keyword like "price" in the first message gets its answer first).
        // A tap on an old menu button (customer coming back) is handled as that option instead. ----
        const rule = state.justStarted ? findKeywordRule(bot, parsed.text) : null;
        if (rule?.handoff) outcome = await finish('handoff', rule.replyText || bot.handoffText);
        else await sendMenu(rule?.replyText);
        state.fallbackCount = 0;
      } else {
        // ---- in the menu ----
        // Exact pick first, then the admin's keyword rules, then a guess from part of an option name
        const exactOption = findOption(bot, parsed);
        const rule = exactOption ? null : findKeywordRule(bot, parsed.text);
        // Coaching: a typed question ("emi hai?") or a course name is answered before guessing a menu option
        const courseFirst = !exactOption && !rule && courseFlow && !parsed.interactiveReplyId && (await runCourse());
        const option = courseFirst ? null : exactOption || (rule ? null : findOptionByPartialName(bot, parsed));
        if (courseFirst) {
          state.fallbackCount = 0;
          if (courseResult?.tag) addTag(courseResult.tag);
          if (courseResult?.handoff) outcome = await finish(courseResult.booking ? 'lead_complete' : 'handoff', '');
        } else if (option) {
          state.fallbackCount = 0;
          addTag(option.tag);
          if (option.action === 'courses' && courseFlow) {
            if (option.replyText?.trim()) await sendText(option.replyText);
            await runCourse({ fromMenu: true });
          } else if (option.action === 'handoff') {
            outcome = await finish('handoff', option.replyText || bot.handoffText);
          } else if (option.action === 'lead') {
            if (!bot.leadQuestions.length) {
              outcome = await finish('lead_complete', option.replyText || bot.leadCompleteText);
            } else {
              state.step = 'question';
              state.questionIndex = 0;
              await sendText(option.replyText);
              await sendText(bot.leadQuestions[0].question);
            }
          } else {
            await sendAnswer(option.replyText);
          }
        } else if (rule) {
          state.fallbackCount = 0;
          if (rule.handoff) outcome = await finish('handoff', rule.replyText || bot.handoffText);
          else await sendAnswer(rule.replyText);
        } else {
          state.fallbackCount += 1;
          if (state.fallbackCount > bot.maxFallbacks) outcome = await finish('handoff', bot.handoffText);
          else await sendMenu(bot.fallbackText);
        }
      }
    } catch (err) {
      // WhatsApp/plan error: never leave the customer stuck with a silent bot
      console.error('[chatbot] stopped for conversation', String(conv._id), err.message);
      state.active = false;
      state.endedAt = now;
      state.endReason = 'error';
      outcome = 'handoff';
    }

    if (answeredThisTurn) state.repliesInWindow = (state.repliesInWindow || 0) + 1;
    delete state.justStarted;
    // Course flow moved the lead on (booked a counselling call / "not now")
    let statusNote = null;
    if (courseResult?.status && courseResult.status !== contact.leadStatus) {
      statusNote = `Lead status changed by the chatbot: ${statusLabel(fullTenant, contact.leadStatus)} → ${statusLabel(fullTenant, courseResult.status)}`;
      contact.leadStatus = courseResult.status;
      contact.statusUpdatedAt = now;
      contact.statusUpdatedBy = undefined;
    }
    conv.set('bot', state);
    await conv.save();
    await contact.save();
    if (activity.length) await automationNote(fullTenant, contact, activity.join('\n'));
    if (statusNote) await automationNote(fullTenant, contact, statusNote);

    if (outcome === 'handoff') {
      const wasUnassigned = !conv.assignedTo;
      await autoAssign(fullTenant, conv);
      await emitConversation(conv._id, { wasUnassigned });
      if (courseResult?.booking) await afterBooking(fullTenant, contact, courseResult.booking, now);
      return false;
    }
    // Bot state changed (started / next question...) -> keep open Inboxes in sync
    await emitConversation(conv._id);
    return true;
  });
}

// Manually stop the bot in a chat (agent takes over) or start it again (send the menu)
export async function setBotForConversation({ tenant, conversation, contact, action }) {
  const fullTenant = await Tenant.findById(tenant._id).populate('plan');
  const now = new Date();
  if (action === 'stop') {
    conversation.set('bot', { ...(conversation.toObject().bot || {}), active: false, endedAt: now, endReason: 'takeover' });
    await conversation.save();
    return conversation;
  }
  // restart
  if (!chatbotAllowed(fullTenant)) throw Object.assign(new Error('Chatbot is not included in your plan'), { status: 403 });
  const bot = await Chatbot.findOne({ tenantId: tenant._id, enabled: true });
  if (!bot) throw Object.assign(new Error('Turn the chatbot on first (Chatbot page)'), { status: 400 });
  if (!conversation.windowOpen) throw Object.assign(new Error('The 24-hour window is closed, the bot can not message this customer'), { status: 400 });

  conversation.set('bot', { active: true, step: 'menu', questionIndex: 0, fallbackCount: 0, repliesInWindow: 0, windowStartedAt: now, startedAt: now });
  await conversation.save();
  const menu = buildMenu(bot);
  const message = await sendOutbound({
    tenant: fullTenant,
    contact,
    conversation,
    isBot: true,
    ...(menu ? { kind: 'interactive', interactive: menu } : { kind: 'text', text: bot.welcomeText }),
  });
  if (message.status === 'failed') {
    conversation.bot.active = false;
    conversation.bot.endReason = 'error';
    await conversation.save();
    throw Object.assign(new Error(message.error || 'Could not send the bot menu'), { status: 502 });
  }
  return conversation;
}

/** Booked through the chatbot: a call task for the counsellor (after assignment), an alert and a summary note */
async function afterBooking(tenant, contact, b, now) {
  try {
    const who = contact.name?.trim() || `+${contact.phone}`;
    const details = [b.course, b.mode, b.start, b.call && `call ${b.call}`].filter(Boolean).join(' · ');
    await automationNote(tenant, contact, `🤖 Booked free counselling via chatbot\n📘 ${b.course}\n👤 ${[b.profile, b.goal].filter(Boolean).join(' · ') || '—'}\n🏫 ${b.mode || 'mode not decided'} · 🗓 ${b.start || '—'}${b.city ? ` · 📍 ${b.city}` : ''}\n📞 Call: ${b.call || 'any time'}`);
    await createTask({
      tenantId: tenant._id,
      contact,
      title: `Call ${who} – ${b.course}${b.call ? ` (${b.call})` : ''}`,
      kind: 'call',
      dueAt: new Date(now.getTime() + 30 * 60 * 1000),
      source: 'automation',
      sourceName: 'Chatbot booking',
      silent: true,
    });
    await notify(tenant._id, { to: 'counsellor', contact, kind: b.start === 'This month' ? 'hot' : 'task', title: `${b.start === 'This month' ? '🔥 ' : ''}${who} booked counselling: ${b.course}`, body: details });
  } catch (err) {
    console.error('[chatbot] booking follow-up error', err.message);
  }
}
