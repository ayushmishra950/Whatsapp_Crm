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

const LOOP_WINDOW_MS = 10 * 60 * 1000;
const LOOP_MAX_REPLIES = 15; // bot replies per chat per 10 minutes, then hand off (protects against bot-to-bot loops)
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

// Buttons when it fits WhatsApp's limits (<= 3 options, titles <= 20 chars), otherwise a list (<= 10 rows)
export function buildMenu(bot) {
  const options = bot.menu.slice(0, 10).map((o) => ({ id: optionId(o), title: o.title, description: o.description || '' }));
  if (!options.length) return null;
  const fitsButtons = options.length <= 3 && options.every((o) => o.title.length <= 20);
  return {
    kind: fitsButtons ? 'buttons' : 'list',
    body: bot.welcomeText,
    buttonLabel: bot.menuButtonLabel || 'View options',
    options: fitsButtons ? options.map(({ id, title }) => ({ id, title })) : options,
  };
}

function findOption(bot, parsed) {
  if (parsed.interactiveReplyId) {
    const byId = bot.menu.find((o) => optionId(o) === parsed.interactiveReplyId);
    if (byId) return byId;
  }
  const text = norm(parsed.text);
  if (!text) return null;
  const index = /^\d{1,2}$/.test(text) ? Number(text) - 1 : -1; // customer typed "2"
  if (index >= 0 && bot.menu[index]) return bot.menu[index];
  return bot.menu.find((o) => norm(o.title) === text) || null;
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

const matchesAny = (list, text) => list.some((k) => norm(k) && norm(k) === norm(text));

function saveAnswer(contact, field, answer) {
  const value = answer.trim().slice(0, 500);
  if (field === 'name') contact.name = value;
  else if (field === 'email') contact.email = value.toLowerCase();
  else if (field.startsWith('custom.')) contact.customFields.set(field.slice(7), value);
}

async function emitConversation(conversationId, extra) {
  const populated = await Conversation.findById(conversationId).populate(CONVERSATION_POPULATE);
  if (populated) emitConversationEvent(populated, 'conversation:updated', populated, extra);
}

export async function runChatbot({ tenant, conversation, parsed, hadPreviousInbound, wasResolved }) {
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
    const send = async (payload) => {
      const message = await sendOutbound({ tenant: fullTenant, contact, conversation: conv, isBot: true, ...payload });
      if (message.status === 'failed') throw new Error(message.error || 'Bot message failed');
      state.repliesInWindow = (state.repliesInWindow || 0) + 1;
      return message;
    };
    const sendText = (text) => (text?.trim() ? send({ kind: 'text', text: text.trim() }) : null);
    const sendMenu = async (prefix) => {
      const menu = buildMenu(bot);
      if (prefix) await sendText(prefix);
      if (menu) return send({ kind: 'interactive', interactive: menu });
      return sendText(bot.welcomeText);
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
      if (!freshChat && !returning) return false;
      Object.assign(state, {
        active: true, step: 'menu', questionIndex: 0, fallbackCount: 0,
        repliesInWindow: 0, windowStartedAt: now, startedAt: now, endedAt: undefined, endReason: undefined,
      });
      state.justStarted = true;
    }

    // ---- loop guard ----
    if (!state.windowStartedAt || now - state.windowStartedAt > LOOP_WINDOW_MS) {
      state.windowStartedAt = now;
      state.repliesInWindow = 0;
    }

    let outcome;
    try {
      if (state.repliesInWindow >= LOOP_MAX_REPLIES) {
        outcome = await finish('loop_guard', bot.handoffText);
      } else if (matchesAny(bot.handoffKeywords, parsed.text)) {
        outcome = await finish('handoff', bot.handoffText);
      } else if (!state.justStarted && matchesAny(bot.menuKeywords, parsed.text)) {
        // "menu" at any point (also in the middle of lead questions) shows the menu again
        state.step = 'menu';
        state.questionIndex = 0;
        state.fallbackCount = 0;
        await sendMenu();
      } else if (state.step === 'question') {
        // ---- collecting lead details ----
        const q = bot.leadQuestions[state.questionIndex];
        if (!q) {
          outcome = await finish('lead_complete', bot.leadCompleteText);
        } else if (!parsed.text.trim() || (q.field === 'email' && !EMAIL_RX.test(parsed.text.trim()))) {
          state.fallbackCount += 1;
          if (state.fallbackCount > bot.maxFallbacks) outcome = await finish('handoff', bot.handoffText);
          else await sendText(q.field === 'email' ? `Please send a valid email address.\n\n${q.question}` : q.question);
        } else {
          saveAnswer(contact, q.field, parsed.text);
          state.questionIndex += 1;
          state.fallbackCount = 0;
          const nextQ = bot.leadQuestions[state.questionIndex];
          if (nextQ) {
            await sendText(nextQ.question);
          } else {
            addTag(bot.leadTag);
            if (contact.leadStatus === 'new') contact.leadStatus = 'contacted';
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
        const option = findOption(bot, parsed);
        const rule = option ? null : findKeywordRule(bot, parsed.text);
        if (option) {
          state.fallbackCount = 0;
          addTag(option.tag);
          if (option.action === 'handoff') {
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
            await sendText(option.replyText || bot.welcomeText);
          }
        } else if (rule) {
          state.fallbackCount = 0;
          if (rule.handoff) outcome = await finish('handoff', rule.replyText || bot.handoffText);
          else await sendText(rule.replyText);
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

    delete state.justStarted;
    conv.set('bot', state);
    await conv.save();
    await contact.save();

    if (outcome === 'handoff') {
      const wasUnassigned = !conv.assignedTo;
      await autoAssign(fullTenant, conv);
      await emitConversation(conv._id, { wasUnassigned });
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
