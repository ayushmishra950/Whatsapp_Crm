/**
 * Drips / automations: series of WhatsApp templates sent over days, plus scheduled follow-up messages.
 * Like campaigns, everything is stored in MongoDB and a small in-process worker sends what is due,
 * so a restart resumes safely.
 *
 * Rules for automated messages (not bulk campaigns):
 *  - never during quiet hours (Settings → Automation, default 21:00-09:00), they wait until morning
 *  - at most N automated messages per contact per day (default 2), the rest wait until tomorrow
 *  - opted-out contacts are never messaged; a reply or a "stop" status ends the drip (if set)
 */
import { Contact, Drip, DripEnrollment, Message, Template, Tenant } from '../models/index.js';
import { sendOutbound, renderTemplate, getOrCreateConversation, addInternalNote } from './messaging.js';
import { resolveVariables } from './variables.js';
import { segmentQuery, monthDays } from './segments.js';
import { isSubscriptionActive, messagesUsedThisMonth } from './subscription.js';
import { emitToTenantAdmins } from './socket.js';
import { createTask, notify } from './alerts.js';
import { setStatusByAutomation } from './automation.js';
import { DEFAULT_TZ, addDays, dayKey, hhmmToMinutes, localMinutes, safeTimeZone, zonedTime } from '../utils/time.js';
import { displayName } from '../utils/contact.js';

const TICK_MS = 20 * 1000;
const BATCH = 50;
const STUCK_MS = 5 * 60 * 1000;
const DEFAULT_DATE_SEND_TIME = '10:00';

// ---------- time rules ----------

export function automationSettings(tenant) {
  const a = tenant?.settings?.automation || {};
  return {
    tz: safeTimeZone(a.timezone || DEFAULT_TZ),
    quietStart: hhmmToMinutes(a.quietStart ?? '21:00'),
    quietEnd: hhmmToMinutes(a.quietEnd ?? '09:00'),
    maxPerDay: Number.isFinite(a.maxPerContactPerDay) ? a.maxPerContactPerDay : 2,
  };
}

// Is this moment inside quiet hours? (window may cross midnight, e.g. 21:00 -> 09:00)
function inQuietHours(date, s) {
  if (s.quietStart == null || s.quietEnd == null || s.quietStart === s.quietEnd) return false;
  const m = localMinutes(date, s.tz);
  return s.quietStart < s.quietEnd ? m >= s.quietStart && m < s.quietEnd : m >= s.quietStart || m < s.quietEnd;
}

// Next moment quiet hours end (today or tomorrow)
function quietEndAfter(date, s) {
  const hh = `${String(Math.floor(s.quietEnd / 60)).padStart(2, '0')}:${String(s.quietEnd % 60).padStart(2, '0')}`;
  const today = dayKey(date, s.tz);
  const t = zonedTime(today, hh, s.tz);
  return t > date ? t : zonedTime(addDays(today, 1), hh, s.tz);
}

/** When should a step run: base + delayDays, at sendTime (local) if set. Never before "now". */
export function scheduleStep(base, step, tz) {
  const days = step?.delayDays || 0;
  const target = new Date(base.getTime() + days * 864e5 + (step?.delayMinutes || 0) * 6e4);
  if (!step?.sendTime) return target;
  const at = zonedTime(dayKey(target, tz), step.sendTime, tz);
  return at < base ? (days === 0 ? base : at) : at;
}

// ---------- enrolling ----------

/**
 * Put contacts into a drip (skips contacts already in it for this cycle, and opted-out ones).
 * Returns how many were added.
 */
export async function enrollContacts(drip, contactIds, { cycle = '', base = new Date(), tz = DEFAULT_TZ } = {}) {
  if (!drip.steps?.length || !contactIds.length) return 0;
  // Drip steps are WhatsApp templates: leads without a WhatsApp number (Instagram-only) are not enrolled
  contactIds = (await Contact.find({ _id: { $in: contactIds }, phone: { $type: 'string' } }).select('_id').lean()).map((c) => c._id);
  if (!contactIds.length) return 0;
  const first = drip.steps[0];
  const nextRunAt = scheduleStep(base, first, tz);
  const docs = contactIds.map((contactId) => ({ tenantId: drip.tenantId, dripId: drip._id, contactId, cycle, nextRunAt, enrolledAt: new Date() }));
  if (!cycle && drip.trigger?.type === 'status_changed') {
    // A lead can come back to this status later (Warm → Hot → Warm): the old, finished run is archived so it can start again
    await DripEnrollment.updateMany(
      { dripId: drip._id, contactId: { $in: contactIds }, cycle: '', status: { $in: ['stopped', 'completed'] } },
      [{ $set: { cycle: { $concat: ['done-', { $toString: '$_id' }] } } }],
      { updatePipeline: true }
    );
  }
  let inserted = [];
  // In batches of 1000 so no single DB call runs long (see the socket timeout in config/db.js)
  for (let i = 0; i < docs.length; i += 1000) {
    try {
      inserted.push(...(await DripEnrollment.insertMany(docs.slice(i, i + 1000), { ordered: false })));
    } catch (err) {
      if (err.code !== 11000 && !err.writeErrors) throw err;
      inserted.push(...(err.insertedDocs || []));
    }
  }
  const added = inserted.length;
  if (added && drip.stopOnStatusChange !== false) {
    // "One drip at a time": a lead in this drip leaves its other status drips
    const tenant = await Tenant.findById(drip.tenantId).select('settings.automation');
    if (tenant?.settings?.automation?.oneDripAtATime !== false) {
      const others = await Drip.find({ tenantId: drip.tenantId, _id: { $ne: drip._id }, stopOnStatusChange: { $ne: false } }).select('_id').lean();
      if (others.length) {
        await DripEnrollment.updateMany(
          { dripId: { $in: others.map((o) => o._id) }, contactId: { $in: inserted.map((e) => e.contactId) }, status: { $in: ['active', 'sending'] } },
          { $set: { status: 'stopped', stoppedReason: 'other_drip', nextRunAt: null } }
        );
      }
    }
  }
  if (added) emitToTenantAdmins(drip.tenantId, 'drip:update', { _id: drip._id });
  return added;
}

/** Contacts matching the drip's extra condition (and not opted out) among the given ids */
async function eligible(drip, contactIds, tz) {
  const query = { $and: [segmentQuery(drip.tenantId, drip.condition || {}, tz), { _id: { $in: contactIds }, optedOut: false }] };
  return (await Contact.find(query).select('_id').lean()).map((c) => c._id);
}

/**
 * Something happened to contacts: start matching drips (and stop drips that end on a status).
 * event = { type: 'new_lead', contactIds, source, adId } | { type: 'tag_added', contactIds, tags }
 *       | { type: 'status_changed', contactIds, status }
 * Never throws (automations must not break the action that triggered them).
 */
export async function triggerDrips(tenantId, event) {
  try {
    const ids = (event.contactIds || []).filter(Boolean);
    if (!ids.length) return;
    if (event.type === 'status_changed') await stopOnStatus(tenantId, ids, event.status, event.fromDripId);

    const drips = await Drip.find({ tenantId, status: 'active' });
    if (!drips.length) return;
    const tenant = await Tenant.findById(tenantId).select('settings.automation');
    const { tz } = automationSettings(tenant);
    for (const drip of drips) {
      const t = drip.trigger || {};
      let match = false;
      if (event.type === 'new_lead') {
        if (t.type === 'new_lead') match = !t.sources?.length || t.sources.includes(event.source);
        if (t.type === 'ad_lead') match = event.source === 'ad' && (!t.adIds?.length || t.adIds.includes(event.adId));
      } else if (event.type === 'tag_added' && t.type === 'tag_added') {
        match = (event.tags || []).some((tag) => t.tags.includes(tag));
      } else if (event.type === 'status_changed' && t.type === 'status_changed') {
        match = t.statuses.includes(event.status);
      }
      if (!match) continue;
      const okIds = await eligible(drip, ids, tz);
      await enrollContacts(drip, okIds, { tz });
    }
  } catch (err) {
    console.error('[drips] trigger error', err.message);
  }
}

async function stopOnStatus(tenantId, contactIds, status, fromDripId) {
  const drips = await Drip.find({ tenantId, stopStatuses: status }).select('_id');
  if (drips.length) {
    await DripEnrollment.updateMany(
      { dripId: { $in: drips.map((d) => d._id) }, contactId: { $in: contactIds }, status: 'active' },
      { $set: { status: 'stopped', stoppedReason: 'status', nextRunAt: null } }
    );
  }
  // "One status = one drip": the lead moved on, so the drip of the old status ends
  // (except the drip that changed the status itself, and birthday / manual drips)
  const flow = await Drip.find({ tenantId, stopOnStatusChange: { $ne: false }, ...(fromDripId && { _id: { $ne: fromDripId } }) }).select('_id');
  if (flow.length) {
    await DripEnrollment.updateMany(
      { dripId: { $in: flow.map((d) => d._id) }, contactId: { $in: contactIds }, status: 'active' },
      { $set: { status: 'stopped', stoppedReason: 'status_changed', nextRunAt: null } }
    );
  }
}

/**
 * Customer replied: leave every drip that stops on reply.
 * Returns the names of the drips the lead was in (so the counsellor can be told a human is needed).
 */
export async function stopDripsOnReply(tenantId, contactId) {
  try {
    const active = await DripEnrollment.find({ tenantId, contactId, status: { $in: ['active', 'sending'] } }).select('dripId').lean();
    if (!active.length) return [];
    const drips = await Drip.find({ _id: { $in: active.map((e) => e.dripId) } }).select('name stopOnReply').lean();
    const stopping = drips.filter((d) => d.stopOnReply).map((d) => d._id);
    if (stopping.length) {
      await DripEnrollment.updateMany(
        { dripId: { $in: stopping }, contactId, status: 'active' },
        { $set: { status: 'stopped', stoppedReason: 'replied', nextRunAt: null } }
      );
    }
    return drips.map((d) => d.name);
  } catch (err) {
    console.error('[drips] stop on reply error', err.message);
    return [];
  }
}

// ---------- birthday / anniversary scan (once a day per drip) ----------

async function scanDateDrips(now) {
  const drips = await Drip.find({ status: 'active', 'trigger.type': 'date', 'trigger.field': { $ne: '' } });
  for (const drip of drips) {
    const tenant = await Tenant.findById(drip.tenantId).select('settings.automation');
    const { tz } = automationSettings(tenant);
    const today = dayKey(now, tz);
    if (drip.lastDateScan === today) continue;
    // offset -3 = three days BEFORE the date: today we message people whose date is in 3 days
    const eventDay = addDays(today, -(drip.trigger.offsetDays || 0));
    const md = eventDay.slice(5);
    const path = `customFields.${drip.trigger.field.replace(/^custom\./, '')}`;
    const contacts = await Contact.find({
      $and: [segmentQuery(drip.tenantId, drip.condition || {}, tz), { optedOut: false, [path]: { $regex: `-${md}$` } }],
    })
      .select('_id')
      .lean();
    const first = drip.steps[0];
    const base = first?.sendTime ? now : zonedTime(today, DEFAULT_DATE_SEND_TIME, tz) < now ? now : zonedTime(today, DEFAULT_DATE_SEND_TIME, tz);
    await enrollContacts(drip, contacts.map((c) => c._id), { cycle: eventDay.slice(0, 4) === '0000' ? today.slice(0, 4) : eventDay.slice(0, 4), base, tz });
    await Drip.updateOne({ _id: drip._id }, { $set: { lastDateScan: today } });
  }
}

// ---------- sending ----------

const tenantCache = new Map(); // per tick
async function loadTenant(id) {
  const key = String(id);
  if (!tenantCache.has(key)) tenantCache.set(key, await Tenant.findById(id).populate('plan'));
  return tenantCache.get(key);
}

function canSendNow(tenant) {
  if (!tenant || tenant.status === 'suspended' || !isSubscriptionActive(tenant)) return 'Subscription inactive';
  const limit = tenant.plan?.limits?.monthlyMessages;
  if (limit != null && messagesUsedThisMonth(tenant) >= limit) return 'Monthly message limit reached';
  return null;
}

async function automatedToday(contactId, tz) {
  const start = zonedTime(dayKey(new Date(), tz), '00:00', tz);
  return Message.countDocuments({ contactId, 'automation.kind': { $in: ['drip', 'followup'] }, createdAt: { $gte: start } });
}

/** Sends one template to one contact as an automation. Returns the message (status sent / failed). */
export async function sendAutomatedTemplate({ tenant, contact, template, variables, automation }) {
  const params = await resolveVariables(variables || [], contact, tenant);
  return sendOutbound({
    tenant,
    contact,
    kind: 'template',
    template: { name: template.name, language: template.language, params, renderedText: renderTemplate(template.body, params) },
    automation,
  });
}

async function processEnrollment(enrollment, now) {
  const drip = await Drip.findById(enrollment.dripId);
  const fail = (patch) => DripEnrollment.updateOne({ _id: enrollment._id }, { $set: { status: 'active', ...patch } });
  if (!drip) return DripEnrollment.updateOne({ _id: enrollment._id }, { $set: { status: 'stopped', stoppedReason: 'drip_deleted', nextRunAt: null } });
  if (drip.status !== 'active') return fail({ nextRunAt: new Date(now.getTime() + 60 * 60 * 1000) }); // paused: look again later

  const tenant = await loadTenant(drip.tenantId);
  const s = automationSettings(tenant);
  const contact = await Contact.findById(enrollment.contactId);
  const stop = (reason) => DripEnrollment.updateOne({ _id: enrollment._id }, { $set: { status: 'stopped', stoppedReason: reason, nextRunAt: null } });
  if (!contact) return stop('contact_deleted');
  if (contact.optedOut) return stop('opted_out');
  if (drip.stopStatuses?.includes(contact.leadStatus)) return stop('status');

  const step = drip.steps[enrollment.stepIndex];
  if (!step) {
    await DripEnrollment.updateOne({ _id: enrollment._id }, { $set: { status: 'completed', nextRunAt: null } });
    return finishDrip(drip, tenant, contact);
  }

  // Task / alert / status steps do not message the customer: no quiet hours or daily limit
  if (step.kind && step.kind !== 'message') {
    let entry = { step: enrollment.stepIndex, at: now, status: 'sent' };
    try {
      await runActionStep(drip, step, tenant, contact, now);
    } catch (err) {
      entry = { ...entry, status: 'failed', error: err.message };
    }
    return advance(drip, enrollment, entry, now, s, tenant, contact);
  }

  if (inQuietHours(now, s)) return fail({ nextRunAt: quietEndAfter(now, s) });
  const blocked = canSendNow(tenant);
  if (blocked) return fail({ nextRunAt: new Date(now.getTime() + 60 * 60 * 1000), lastError: blocked });
  if (s.maxPerDay > 0 && (await automatedToday(contact._id, s.tz)) >= s.maxPerDay) {
    const tomorrow = zonedTime(addDays(dayKey(now, s.tz), 1), '00:00', s.tz);
    return fail({ nextRunAt: inQuietHours(tomorrow, s) ? quietEndAfter(tomorrow, s) : tomorrow, lastError: 'Daily limit for this contact reached' });
  }

  // Hinglish leads get the Hinglish version of the message when the step has one
  const hindi = contact.language === 'hi' && step.templateIdHi;
  const template = await Template.findOne({ _id: hindi ? step.templateIdHi : step.templateId, tenantId: drip.tenantId });
  const variables = hindi ? step.variablesHi : step.variables;
  let entry;
  if (!template || template.status !== 'approved') {
    entry = { step: enrollment.stepIndex, at: now, status: 'skipped', error: template ? 'Template is not approved' : 'Template deleted' };
  } else {
    try {
      const message = await sendAutomatedTemplate({ tenant, contact, template, variables, automation: { kind: 'drip', name: drip.name, dripId: drip._id } });
      entry = { step: enrollment.stepIndex, at: now, status: message.status === 'failed' ? 'failed' : 'sent', messageId: message._id, error: message.error };
    } catch (err) {
      entry = { step: enrollment.stepIndex, at: now, status: 'failed', error: err.message };
    }
  }

  return advance(drip, enrollment, entry, now, s, tenant, contact);
}

async function advance(drip, enrollment, entry, now, s, tenant, contact) {
  const nextIndex = enrollment.stepIndex + 1;
  const next = drip.steps[nextIndex];
  const res = await DripEnrollment.updateOne(
    { _id: enrollment._id, status: 'sending' }, // a status step may have stopped this enrollment meanwhile
    {
      $set: next
        ? { status: 'active', stepIndex: nextIndex, nextRunAt: scheduleStep(now, next, s.tz), lastError: entry.error || null }
        : { status: 'completed', stepIndex: nextIndex, nextRunAt: null, lastError: entry.error || null },
      $push: { history: entry },
    }
  );
  if (!res.modifiedCount) await DripEnrollment.updateOne({ _id: enrollment._id }, { $push: { history: entry } });
  else if (!next) await finishDrip(drip, tenant, contact);
  emitToTenantAdmins(drip.tenantId, 'drip:update', { _id: drip._id });
}

const stepText = (text, contact) => String(text || '').replace(/\{name\}/gi, displayName(contact));

/** Task / alert / status step */
async function runActionStep(drip, step, tenant, contact, now) {
  const who = displayName(contact);
  if (step.kind === 'task') {
    await createTask({
      tenantId: tenant._id, contact, title: stepText(step.text, contact) || 'Call this lead', kind: 'call',
      dueAt: new Date(now.getTime() + (step.dueMinutes || 0) * 6e4), source: 'automation', sourceName: drip.name,
    });
  } else if (step.kind === 'alert') {
    await notify(tenant._id, { to: 'counsellor', contact, kind: 'alert', title: stepText(step.text, contact) || `Check ${who}`, body: `${who} · ${drip.name}` });
  } else if (step.kind === 'status') {
    if (!step.setStatus) throw new Error('No status chosen');
    await setStatusByAutomation(tenant, contact, step.setStatus, `drip "${drip.name}"`, { fromDripId: drip._id });
  }
}

/** Last step done: drip's "when finished" action (e.g. move to Nurture – Later) */
async function finishDrip(drip, tenant, contact) {
  const oc = drip.onComplete || {};
  try {
    if (oc.addTag && !contact.tags.includes(oc.addTag)) {
      await Contact.updateOne({ _id: contact._id }, { $addToSet: { tags: oc.addTag } });
      triggerDrips(tenant._id, { type: 'tag_added', contactIds: [contact._id], tags: [oc.addTag] });
    }
    if (oc.setStatus) await setStatusByAutomation(tenant, await Contact.findById(contact._id), oc.setStatus, `drip "${drip.name}" finished`, { fromDripId: drip._id });
  } catch (err) {
    console.error('[drips] on complete error', err.message);
  }
}

/** Follow-ups set to "send a WhatsApp message" that are due */
async function processFollowUps(now) {
  for (let i = 0; i < BATCH; i += 1) {
    // Claim atomically so two workers never send the same follow-up
    const contact = await Contact.findOneAndUpdate(
      { followUpAction: 'message', followUpSentAt: null, followUpAt: { $lte: now }, followUpTemplateId: { $ne: null } },
      { $set: { followUpSentAt: now } },
      { returnDocument: 'after' }
    );
    if (!contact) break;
    const tenant = await loadTenant(contact.tenantId);
    const conversation = await getOrCreateConversation(contact.tenantId, contact._id, contact.phone ? 'whatsapp' : undefined);
    const note = (text) => addInternalNote({ tenant, conversation, user: { _id: contact.followUpBy }, text }).catch(() => {});
    const blocked = canSendNow(tenant);
    const template = await Template.findOne({ _id: contact.followUpTemplateId, tenantId: contact.tenantId });
    if (contact.optedOut || blocked || !template || template.status !== 'approved') {
      await note(`⚠️ Follow-up message not sent: ${contact.optedOut ? 'contact opted out' : blocked || (template ? 'template is not approved' : 'template was deleted')}.`);
      continue;
    }
    const variables = (template.variableDefaults?.length ? template.variableDefaults : []).map(({ source, value }) => ({ source, value }));
    try {
      const message = await sendAutomatedTemplate({ tenant, contact, template, variables, automation: { kind: 'followup', name: 'Follow-up' } });
      if (message.status === 'failed') await note(`⚠️ Follow-up message failed: ${message.error}`);
    } catch (err) {
      await note(`⚠️ Follow-up message failed: ${err.message}`);
    }
  }
}

let running = false;
async function tick() {
  if (running) return;
  running = true;
  tenantCache.clear();
  const now = new Date();
  try {
    // Recover enrollments stuck in "sending" after a crash
    await DripEnrollment.updateMany({ status: 'sending', updatedAt: { $lt: new Date(now.getTime() - STUCK_MS) } }, { $set: { status: 'active' } });
    await scanDateDrips(now);
    await processFollowUps(now);
    const activeDrips = await Drip.find({ status: 'active' }).select('_id').lean();
    if (activeDrips.length) {
      for (let i = 0; i < BATCH; i += 1) {
        const enrollment = await DripEnrollment.findOneAndUpdate(
          { status: 'active', nextRunAt: { $lte: now }, dripId: { $in: activeDrips.map((d) => d._id) } },
          { $set: { status: 'sending' } },
          { sort: { nextRunAt: 1 }, returnDocument: 'after' }
        );
        if (!enrollment) break;
        try {
          await processEnrollment(enrollment, now);
        } catch (err) {
          console.error('[drips] enrollment error', err.message);
          await DripEnrollment.updateOne({ _id: enrollment._id }, { $set: { status: 'active', lastError: err.message, nextRunAt: new Date(now.getTime() + 10 * 60 * 1000) } });
        }
      }
    }
  } catch (err) {
    console.error('[drips] worker error', err);
  } finally {
    running = false;
  }
}

export function startDripWorker() {
  setInterval(tick, TICK_MS);
  console.log('[drips] worker started');
}

// For tests / "run now" button
export const runDripTick = tick;

// MM-DD list re-exported for the routes (preview "who has a birthday this week")
export { monthDays };
