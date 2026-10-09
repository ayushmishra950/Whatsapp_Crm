/**
 * Tasks and in-app notifications (bell icon) for the team.
 * "Counsellor" = the agent the lead's chat is assigned to (or the lead's owner); with nobody assigned,
 * the business admins get it.
 */
import { Contact, Conversation, Notification, Task, User } from '../models/index.js';
import { emitToUser, emitToTenantAdmins } from './socket.js';
import { pushToUsers } from './push.js';
import { addInternalNote, getOrCreateConversation } from './messaging.js';
import { displayName } from '../utils/contact.js';

export async function counsellorOf(contact) {
  const conversation = await Conversation.findOne({ tenantId: contact.tenantId, contactId: contact._id }).sort({ lastMessageAt: -1 }).select('assignedTo').lean();
  return conversation?.assignedTo || contact.assignedTo || null;
}

async function adminIds(tenantId) {
  return (await User.find({ tenantId, role: 'admin', isActive: { $ne: false } }).select('_id').lean()).map((u) => u._id);
}

/**
 * Notify people. to = 'counsellor' (falls back to admins) | 'admins' | 'both' | [userIds]
 * Never throws.
 */
export async function notify(tenantId, { to = 'counsellor', contact, kind = 'info', title, body = '', taskId, url, key }) {
  try {
    let ids = [];
    if (Array.isArray(to)) ids = to;
    else {
      const counsellor = contact && to !== 'admins' ? await counsellorOf(contact) : null;
      if (counsellor) ids.push(counsellor);
      if (to === 'admins' || to === 'both' || !counsellor) ids.push(...(await adminIds(tenantId)));
    }
    const unique = [...new Set(ids.filter(Boolean).map(String))];
    if (!unique.length) return [];
    const docs = await Notification.insertMany(
      unique.map((userId) => ({ tenantId, userId, kind, title, body, contactId: contact?._id, taskId, ...(key && { key }) }))
    );
    for (const n of docs) emitToUser(n.userId, 'notification:new', n);
    // Phone alert (mobile app): opens the lead, or Tasks for task alerts without a lead
    pushToUsers(unique, { tenantId, title, body: body || (contact ? displayName(contact) : ''), url: url || (contact?._id ? `/lead/${contact._id}` : '/tasks') });
    return docs;
  } catch (err) {
    console.error('[alerts] notify error', err.message);
    return [];
  }
}

/** Earliest open task (or follow-up reminder) = the lead's next action */
export async function refreshNextAction(contactId) {
  const [task, contact] = await Promise.all([
    Task.findOne({ contactId, status: 'open' }).sort({ dueAt: 1 }).select('dueAt').lean(),
    Contact.findById(contactId).select('followUpAt followUpSentAt followUpAction'),
  ]);
  if (!contact) return;
  const followUp = contact.followUpAt && !(contact.followUpAction === 'message' && contact.followUpSentAt) ? contact.followUpAt : null;
  const dates = [task?.dueAt, followUp].filter(Boolean).map((d) => new Date(d));
  const next = dates.length ? new Date(Math.min(...dates)) : null;
  await Contact.updateOne({ _id: contactId }, { $set: { nextActionAt: next } });
}

/**
 * Create a task for a lead. assignedTo empty = the lead's counsellor (or admins see it as unassigned).
 * Also notifies the person and refreshes the lead's next action.
 */
export async function createTask({ tenantId, contact, title, kind = 'call', dueAt = new Date(), assignedTo, note = '', source = 'manual', sourceName = '', createdBy, silent = false }) {
  const owner = assignedTo || (await counsellorOf(contact));
  const task = await Task.create({ tenantId, contactId: contact._id, title, kind, dueAt, assignedTo: owner || undefined, note, source, sourceName, createdBy });
  await refreshNextAction(contact._id);
  const who = displayName(contact);
  if (!silent) {
    await notify(tenantId, { to: owner ? [owner] : 'admins', contact, kind: 'task', title: `New task: ${title}`, body: `${who}${sourceName ? ` · ${sourceName}` : ''}`, taskId: task._id });
  }
  emitToTenantAdmins(tenantId, 'task:update', { _id: task._id });
  if (owner) emitToUser(owner, 'task:update', { _id: task._id });
  return task;
}

/** Automation note in the lead's chat (visible to the team only) */
export async function automationNote(tenant, contact, text) {
  try {
    const conversation = await getOrCreateConversation(tenant._id, contact._id);
    await addInternalNote({ tenant, conversation, user: null, text });
  } catch (err) {
    console.error('[alerts] note error', err.message);
  }
}
