import mongoose from 'mongoose';
import { Contact, Conversation } from '../models/index.js';

/**
 * Instagram as a second channel needs two database changes:
 *  1. every chat gets channel = 'whatsapp' (older chats have no value), and
 *  2. the old unique indexes "one lead per phone" (also blocks leads without a phone) and
 *     "one chat per lead" are replaced by the new ones defined in the models
 *     (tenant_phone_unique partial, tenant_igsid_unique, tenant_contact_channel_unique).
 *
 * Runs by itself on a local database. On any other database (production) it runs only with
 * CHANNEL_MIGRATION=run in .env — take a backup first. Safe to run again: it only does what is still missing.
 */
const OLD_CONTACT_INDEX = 'tenantId_1_phone_1';
const OLD_CONVERSATION_INDEX = 'tenantId_1_contactId_1';

let done = false;
/** True once the migration has finished (Instagram leads can be saved) */
export const channelsReady = () => done;

const isLocalDb = () => /^(127\.0\.0\.1|localhost)$/.test(mongoose.connection.host || '');
const hasIndex = async (model, name) => (await model.collection.indexes()).some((i) => i.name === name);

/** What is still to do (for logs and the Super Admin) */
export async function channelMigrationStatus() {
  const [oldContact, oldConversation, untagged] = await Promise.all([
    hasIndex(Contact, OLD_CONTACT_INDEX),
    hasIndex(Conversation, OLD_CONVERSATION_INDEX),
    Conversation.countDocuments({ channel: { $exists: false } }),
  ]);
  return { oldContact, oldConversation, untagged, pending: oldContact || oldConversation || untagged > 0 };
}

export async function migrateChannels({ force = false } = {}) {
  const status = await channelMigrationStatus();
  if (!status.pending) {
    done = true;
    return { ran: false, ...status };
  }
  if (!force && !isLocalDb() && process.env.CHANNEL_MIGRATION !== 'run') {
    console.warn('[db] Instagram channel migration is pending (set CHANNEL_MIGRATION=run after a backup). WhatsApp keeps working; Instagram leads are not saved until then.');
    return { ran: false, skipped: true, ...status };
  }
  // New indexes first, so uniqueness is never lost while the old ones go
  await Promise.all([Contact.createIndexes(), Conversation.createIndexes()]);
  const tagged = (await Conversation.updateMany({ channel: { $exists: false } }, { $set: { channel: 'whatsapp' } })).modifiedCount;
  if (status.oldContact) await Contact.collection.dropIndex(OLD_CONTACT_INDEX);
  if (status.oldConversation) await Conversation.collection.dropIndex(OLD_CONVERSATION_INDEX);
  done = true;
  return { ran: true, tagged, droppedContactIndex: status.oldContact, droppedConversationIndex: status.oldConversation };
}
