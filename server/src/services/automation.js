/**
 * Lead automations from the Infonic playbooks (Phase 1 + 2):
 *  - status changes made by automations (with a note in the chat and drips started / stopped)
 *  - every customer message: language (English / Hinglish), course, hot-word / objection rules (A3/A4),
 *    "lead came back" rule (A8)
 *  - a worker (every minute): status time limits (A6), overdue task alerts, morning "needs attention" report (A11)
 */
import { Contact, Conversation, Course, Task, Tenant, User } from '../models/index.js';
import { getLeadStatuses, limitMs, statusLabel } from './leadStatuses.js';
import { triggerDrips, automationSettings } from './drips.js';
import { automationNote, createTask, notify } from './alerts.js';
import { runFeeReminders } from './fees.js';
import { addDays, dayKey, hhmmToMinutes, localMinutes, zonedTime } from '../utils/time.js';
import { displayName } from '../utils/contact.js';

const TICK_MS = 60 * 1000;
const BATCH = 200;

// ---------- status changes by automations ----------

/**
 * Move a lead to another status because of an automation (time limit, keyword rule, drip…).
 * Leaves a note in the chat and runs the drips of the new status. Returns true when it changed.
 */
export async function setStatusByAutomation(tenant, contact, toKey, reason, { fromDripId } = {}) {
  if (!contact || contact.leadStatus === toKey) return false;
  if (!getLeadStatuses(tenant).some((s) => s.key === toKey)) return false;
  const from = contact.leadStatus;
  const now = new Date();
  await Contact.updateOne({ _id: contact._id }, { $set: { leadStatus: toKey, statusUpdatedAt: now }, $unset: { statusUpdatedBy: '' } });
  contact.leadStatus = toKey;
  contact.statusUpdatedAt = now;
  await automationNote(tenant, contact, `Lead status changed automatically: ${statusLabel(tenant, from)} → ${statusLabel(tenant, toKey)} (${reason})`);
  await triggerDrips(tenant._id, { type: 'status_changed', contactIds: [contact._id], status: toKey, fromDripId });
  return true;
}

export const isOpenStatus = (s) => (s.stage ? !['converted', 'closed'].includes(s.stage) : !['converted', 'lost'].includes(s.key));

// ---------- reading customer messages ----------

const HINGLISH = new Set(
  'hai hain h hu hoon hun kya kaise kaisa kitna kitni kitne nahi nhi nahin mujhe muje mera meri mere aap ap apka apki chahiye chaiye karna karni krna kar karo kro batao btao bataiye bhai ji haan han ha theek thik acha accha achha kab kahan kaha kyu kyun kyon wala wali sir ji abhi baad mein me se ko ka ki ke liye fees jama paise paisa samajh lena lene dena'.split(' ')
);
const ENGLISH = new Set('the is are what how much please want would could can you your i my me about course fees details information interested when where which thanks thank'.split(' '));

/** 'hi' (Hinglish / Hindi), 'en' or '' (not sure) */
export function detectLanguage(text) {
  const t = String(text || '').toLowerCase();
  if (/[ऀ-ॿ]/.test(t)) return 'hi';
  const words = t.match(/[a-z]+/g) || [];
  if (words.length < 2) return '';
  const hi = words.filter((w) => HINGLISH.has(w)).length;
  const en = words.filter((w) => ENGLISH.has(w)).length;
  if (hi >= 2 || (hi >= 1 && hi >= en)) return 'hi';
  if (en >= 2) return 'en';
  return '';
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasWord = (text, word) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(word.toLowerCase())}($|[^\\p{L}\\p{N}])`, 'u').test(text);

/** Course mentioned in a message (trigger words, code or name) */
export async function detectCourse(tenantId, text) {
  const t = String(text || '').toLowerCase();
  if (!t.trim()) return null;
  const courses = await Course.find({ tenantId, active: true }).select('code name triggerWords').lean();
  return (
    courses.find((c) => [...(c.triggerWords || []), c.name].filter(Boolean).some((w) => hasWord(t, w))) ||
    courses.find((c) => c.code.length >= 3 && hasWord(t, c.code)) ||
    null
  );
}

/**
 * Runs on every customer message, BEFORE the contact is saved (changes the contact in memory).
 * Returns follow-up work (chat notes, alerts, tasks) for afterInbound().
 */
export async function beforeInbound({ tenant, contact, text, isNewContact, statusBefore, adCourseCode, isButtonReply }) {
  const effects = { notes: [], alerts: [], tasks: [], statusReason: null };
  const lower = String(text || '').toLowerCase();

  const coaching = tenant.businessType === 'coaching';
  // Language: Hinglish wins once seen; a person can lock it on the contact (coaching format only)
  if (coaching && !contact.languageLocked) {
    const lang = detectLanguage(text);
    if (lang && (!contact.language || (lang === 'hi' && contact.language !== 'hi'))) contact.language = lang;
  }

  // Course: from the ad they clicked, else from their words (only while not set)
  if (coaching && !contact.course) {
    const code = adCourseCode || (await detectCourse(tenant._id, text))?.code;
    if (code) {
      contact.course = code;
      effects.notes.push(`Course set to ${code} (${adCourseCode ? 'from the ad' : `customer wrote "${String(text).trim().slice(0, 60)}"`})`);
    }
  }

  const statuses = getLeadStatuses(tenant);
  const has = (k) => statuses.some((s) => s.key === k);
  const setStatus = (to, reason) => {
    if (!to || contact.leadStatus === to || !has(to)) return false;
    effects.notes.push(`Lead status changed automatically: ${statusLabel(tenant, contact.leadStatus)} → ${statusLabel(tenant, to)} (${reason})`);
    contact.leadStatus = to;
    contact.statusUpdatedAt = new Date();
    contact.statusUpdatedBy = undefined;
    effects.statusReason = reason;
    return true;
  };

  // A8: a Nurture / Lost lead writes again -> back to Hot + alert
  const rl = tenant.settings?.automation?.returningLead;
  if (!isNewContact && rl?.enabled && rl.fromStatuses?.includes(statusBefore) && setStatus(rl.toStatus, 'lead came back')) {
    const who = displayName(contact);
    effects.alerts.push({ to: 'both', kind: 'hot', title: `${who} came back`, body: `Was "${statusLabel(tenant, statusBefore)}" – wrote: ${String(text).slice(0, 80)}` });
  }

  // Fee reminders: "Need more time" / "Already paid" (button or typed) -> a task for the accounts follow-up
  if ((contact.fees?.balance || 0) > 0) {
    const who = displayName(contact);
    if (/\b(need more time|more time|time chahiye|thoda time|baad mein dunga|next week)\b/i.test(lower)) {
      effects.tasks.push({ title: `Agree a new fee date with ${who} (asked for more time)`, sourceName: 'Fee reminder reply' });
    } else if (/^(paid|already paid|paid ✅|pay kar diya|de diya|jama kar diya|payment done)\b/i.test(lower.trim())) {
      effects.tasks.push({ title: `Check payment from ${who} (says paid) and record it`, sourceName: 'Fee reminder reply' });
    }
  }

  // A3/A4: keyword rules (hot words, objections…) – only on typed messages, not on chatbot menu taps
  for (const rule of isButtonReply ? [] : tenant.settings?.automationRules || []) {
    if (rule.enabled === false || !rule.keywords?.length) continue;
    if (rule.onlyIfStatusIn?.length && !rule.onlyIfStatusIn.includes(contact.leadStatus)) continue;
    const word = rule.keywords.find((k) => hasWord(lower, k));
    if (!word) continue;
    const reason = `rule "${rule.name}": customer wrote "${word}"`;
    setStatus(rule.setStatus, reason);
    const newTags = (rule.addTags || []).filter((tag) => !contact.tags.includes(tag));
    if (newTags.length) {
      contact.tags.push(...newTags);
      effects.notes.push(`Tag ${newTags.join(', ')} added (${reason})`);
    }
    const who = displayName(contact);
    if (rule.alert) effects.alerts.push({ to: 'both', kind: 'hot', title: `${rule.name}: ${who}`, body: `Wrote: ${String(text).slice(0, 100)}` });
    if (rule.task) effects.tasks.push({ title: rule.task, sourceName: rule.name });
  }
  return effects;
}

/** After the message is saved: notes in the chat, alerts and tasks */
export async function afterInbound({ tenant, contact, effects, dripsInterrupted = [] }) {
  for (const text of effects.notes) await automationNote(tenant, contact, text);
  for (const a of effects.alerts) await notify(tenant._id, { ...a, contact });
  for (const t of effects.tasks) await createTask({ tenantId: tenant._id, contact, title: t.title, kind: 'call', dueAt: new Date(Date.now() + 15 * 6e4), source: 'automation', sourceName: t.sourceName });
  // A reply while a drip was running: a human should take over now
  if (dripsInterrupted.length && tenant.settings?.automation?.alertOnReply !== false) {
    const who = displayName(contact);
    await notify(tenant._id, { to: 'counsellor', contact, kind: 'reply', title: `${who} replied`, body: `During drip "${dripsInterrupted.join(', ')}" – please answer` });
  }
}

// ---------- worker ----------

/** A6: lead stayed too long in a status -> move it / create a task / alert */
async function statusTimeouts(now) {
  const tenants = await Tenant.find({ 'settings.leadStatuses.timeLimit.amount': { $gt: 0 }, status: { $ne: 'suspended' } });
  for (const tenant of tenants) {
    for (const s of getLeadStatuses(tenant)) {
      const ms = limitMs(s.timeLimit);
      if (!ms) continue;
      const cutoff = new Date(now.getTime() - ms);
      if (s.limitSince && new Date(s.limitSince) > cutoff) continue; // limit set recently: nobody is over it yet
      const due = {
        tenantId: tenant._id,
        leadStatus: s.key,
        optedOut: false,
        $or: [{ statusUpdatedAt: { $lte: cutoff } }, { statusUpdatedAt: null, createdAt: { $lte: cutoff } }],
        $expr: { $ne: ['$statusTimeoutMark', { $ifNull: ['$statusUpdatedAt', '$createdAt'] }] },
      };
      const contacts = await Contact.find(due).limit(BATCH);
      for (const contact of contacts) {
        const mark = contact.statusUpdatedAt || contact.createdAt;
        // Claim it so two workers never handle the same time-out
        const claimed = await Contact.updateOne({ _id: contact._id, leadStatus: s.key, statusTimeoutMark: { $ne: mark } }, { $set: { statusTimeoutMark: mark } });
        if (!claimed.modifiedCount) continue;
        const who = displayName(contact);
        const limitText = `${s.timeLimit.amount} ${s.timeLimit.unit}`;
        try {
          if (s.onTimeout.task) {
            await createTask({ tenantId: tenant._id, contact, title: s.onTimeout.task, kind: 'call', dueAt: now, source: 'automation', sourceName: `Time limit: ${s.label}` });
          }
          if (s.onTimeout.alert) {
            await notify(tenant._id, { to: 'both', contact, kind: 'status', title: `${who} is still "${s.label}"`, body: `Time limit of ${limitText} is over – please act now` });
          }
          if (s.onTimeout.moveTo) await setStatusByAutomation(tenant, contact, s.onTimeout.moveTo, `${limitText} in "${s.label}"`);
        } catch (err) {
          console.error('[automation] timeout error', err.message);
        }
      }
    }
  }
}

/** Open task late by N minutes -> alert its owner and the admins (once) */
async function overdueTasks(now) {
  const tasks = await Task.find({ status: 'open', overdueAlertedAt: null, dueAt: { $lte: now } }).sort({ dueAt: 1 }).limit(BATCH);
  const tenants = new Map();
  for (const task of tasks) {
    const key = String(task.tenantId);
    if (!tenants.has(key)) tenants.set(key, await Tenant.findById(task.tenantId).select('settings.automation status'));
    const tenant = tenants.get(key);
    if (!tenant || tenant.status === 'suspended') continue;
    const mins = tenant.settings?.automation?.overdueAlertMinutes ?? 30;
    if (!mins || task.dueAt.getTime() > now.getTime() - mins * 6e4) continue;
    const claimed = await Task.updateOne({ _id: task._id, overdueAlertedAt: null }, { $set: { overdueAlertedAt: now } });
    if (!claimed.modifiedCount) continue;
    const contact = await Contact.findById(task.contactId).select('name phone tenantId');
    if (!contact) continue;
    await notify(task.tenantId, {
      to: task.assignedTo ? [...(await adminIdsOf(task.tenantId)), task.assignedTo] : 'admins',
      contact,
      kind: 'overdue',
      title: `Overdue: ${task.title}`,
      body: `${displayName(contact)} · was due ${Math.round((now - task.dueAt) / 6e4)} min ago`,
      taskId: task._id,
    });
  }
}

async function adminIdsOf(tenantId) {
  return (await User.find({ tenantId, role: 'admin', isActive: { $ne: false } }).select('_id').lean()).map((u) => u._id);
}

/**
 * A11 "Needs attention": overdue tasks, tasks due today, open leads without a next action, customers
 * waiting for a reply. userId = only that agent's leads / tasks.
 */
export async function needsAttention(tenant, { userId, listLimit = 20 } = {}) {
  const now = new Date();
  const { tz } = automationSettings(tenant);
  const endOfDay = zonedTime(addDays(dayKey(now, tz), 1), '00:00', tz);
  const taskScope = { tenantId: tenant._id, status: 'open', ...(userId && { assignedTo: userId }) };
  const openKeys = getLeadStatuses(tenant).filter(isOpenStatus).map((s) => s.key);
  let contactScope = { tenantId: tenant._id };
  if (userId) {
    const mine = await Conversation.find({ tenantId: tenant._id, assignedTo: userId }).select('contactId').lean();
    contactScope = { tenantId: tenant._id, $or: [{ assignedTo: userId }, { _id: { $in: mine.map((c) => c.contactId) } }] };
  }
  const noNext = { ...contactScope, leadStatus: { $in: openKeys }, optedOut: false, nextActionAt: null };
  const waitingSince = new Date(now.getTime() - 30 * 6e4);
  const waitingQuery = {
    tenantId: tenant._id,
    status: { $ne: 'resolved' },
    lastInboundAt: { $lte: waitingSince },
    $expr: { $gte: ['$lastInboundAt', '$lastMessageAt'] },
    ...(userId && { assignedTo: userId }),
  };
  const populateContact = { path: 'contactId', select: 'name phone leadStatus course' };
  const [overdue, overdueCount, dueTodayCount, noNextCount, noNextList, waitingCount, waitingList] = await Promise.all([
    Task.find({ ...taskScope, dueAt: { $lt: now } }).sort({ dueAt: 1 }).limit(listLimit).populate(populateContact).populate('assignedTo', 'name').lean(),
    Task.countDocuments({ ...taskScope, dueAt: { $lt: now } }),
    Task.countDocuments({ ...taskScope, dueAt: { $gte: now, $lt: endOfDay } }),
    Contact.countDocuments(noNext),
    Contact.find(noNext).sort({ lastInboundAt: -1, createdAt: -1 }).limit(listLimit).select('name phone leadStatus course lastInboundAt createdAt').lean(),
    Conversation.countDocuments(waitingQuery),
    Conversation.find(waitingQuery).sort({ lastInboundAt: 1 }).limit(listLimit).populate('contactId', 'name phone leadStatus').populate('assignedTo', 'name').select('contactId assignedTo lastInboundAt lastMessagePreview').lean(),
  ]);
  return {
    overdueTasks: { count: overdueCount, items: overdue },
    dueToday: { count: dueTodayCount },
    noNextAction: { count: noNextCount, items: noNextList },
    waitingReply: { count: waitingCount, items: waitingList },
  };
}

/** Morning report to the admins (Settings → Automation → daily report time) */
async function dailyReports(now) {
  const tenants = await Tenant.find({ status: { $ne: 'suspended' }, 'settings.automation.dailyReportTime': { $ne: '' } });
  for (const tenant of tenants) {
    const { tz } = automationSettings(tenant);
    const at = hhmmToMinutes(tenant.settings.automation.dailyReportTime);
    const today = dayKey(now, tz);
    if (at == null || localMinutes(now, tz) < at || tenant.settings.automation.lastDailyReport === today) continue;
    const claimed = await Tenant.updateOne({ _id: tenant._id, 'settings.automation.lastDailyReport': { $ne: today } }, { $set: { 'settings.automation.lastDailyReport': today } });
    if (!claimed.modifiedCount) continue;
    const r = await needsAttention(tenant, { listLimit: 0 });
    const total = r.overdueTasks.count + r.noNextAction.count + r.waitingReply.count;
    if (!total && !r.dueToday.count) continue;
    await notify(tenant._id, {
      to: 'admins',
      kind: 'report',
      title: `Today: ${total} lead(s) need attention`,
      body: `${r.overdueTasks.count} overdue task(s) · ${r.dueToday.count} task(s) due today · ${r.noNextAction.count} lead(s) without a next action · ${r.waitingReply.count} customer(s) waiting for a reply`,
    });
  }
}

let running = false;
export async function runAutomationTick(now = new Date()) {
  if (running) return;
  running = true;
  try {
    await statusTimeouts(now);
    await overdueTasks(now);
    await dailyReports(now);
    await runFeeReminders(now);
  } catch (err) {
    console.error('[automation] worker error', err);
  } finally {
    running = false;
  }
}

export function startAutomationWorker() {
  setInterval(() => runAutomationTick(), TICK_MS);
  console.log('[automation] worker started');
}
