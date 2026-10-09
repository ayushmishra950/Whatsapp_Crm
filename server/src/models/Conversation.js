import mongoose from 'mongoose';

const conversationSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact', required: true },
    // A lead has one chat per channel. Chats made before Instagram have no value = WhatsApp.
    channel: { type: String, enum: ['whatsapp', 'instagram'], default: 'whatsapp' },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    status: { type: String, enum: ['open', 'pending', 'resolved'], default: 'open' },
    lastMessageAt: { type: Date, default: Date.now },
    lastMessagePreview: { type: String, default: '' },
    // Last time the customer messaged us -> controls the 24h free-form reply window
    lastInboundAt: Date,
    unreadCount: { type: Number, default: 0 },

    // Chatbot state for this chat. active = bot is handling it (no human yet)
    bot: {
      active: { type: Boolean, default: false },
      step: { type: String, enum: ['menu', 'question', 'course_areas', 'course_list', 'course', 'course_q'], default: 'menu' },
      // Course flow (coaching): course being discussed, list position, admission question
      course: String,
      courseArea: String,
      coursePage: Number,
      flowKey: String, // admission question being asked
      flowTotal: Number,
      pendingAction: String, // "fees" / "book" asked before a course was chosen
      questionIndex: { type: Number, default: 0 },
      fallbackCount: { type: Number, default: 0 },
      // Loop guard: bot replies counted per rolling window
      repliesInWindow: { type: Number, default: 0 },
      windowStartedAt: Date,
      startedAt: Date,
      endedAt: Date,
      // handoff (customer asked / bot gave up), lead_complete, takeover (agent stepped in), loop_guard, error,
      // disabled (bot turned off / not in plan), opted_out
      endReason: String,
    },
  },
  { timestamps: true }
);

// The chat's counsellor is also the lead's owner (Contacts filters, reports, tasks use contact.assignedTo)
conversationSchema.pre('save', function () {
  this.$locals.ownerChanged = this.isNew || this.isModified('assignedTo');
});
conversationSchema.post('save', async function () {
  if (!this.$locals.ownerChanged) return;
  await mongoose.model('Contact').updateOne({ _id: this.contactId, assignedTo: { $ne: this.assignedTo } }, { $set: { assignedTo: this.assignedTo || null } });
});

/** One-time / startup backfill: copy every chat's counsellor to its lead */
export async function syncContactOwners() {
  const convs = await mongoose.model('Conversation').find({}).select('contactId assignedTo').lean();
  const ops = convs.map((c) => ({ updateOne: { filter: { _id: c.contactId, assignedTo: { $ne: c.assignedTo || null } }, update: { $set: { assignedTo: c.assignedTo || null } } } }));
  let changed = 0;
  for (let i = 0; i < ops.length; i += 1000) changed += (await mongoose.model('Contact').bulkWrite(ops.slice(i, i + 1000), { ordered: false })).modifiedCount;
  return changed;
}

// (The old unique tenantId_1_contactId_1 — one chat per lead — is dropped by the channel migration.)
conversationSchema.index({ tenantId: 1, contactId: 1, channel: 1 }, { name: 'tenant_contact_channel_unique', unique: true });
conversationSchema.index({ tenantId: 1, lastMessageAt: -1 });
conversationSchema.index({ tenantId: 1, assignedTo: 1, lastMessageAt: -1 });
conversationSchema.index({ tenantId: 1, 'bot.active': 1, lastMessageAt: -1 });

// Free-form replies: 24 h after the customer's last message on both WhatsApp and Instagram
conversationSchema.virtual('windowOpen').get(function () {
  return !!this.lastInboundAt && Date.now() - this.lastInboundAt.getTime() < 24 * 60 * 60 * 1000;
});

/** Query part for one channel; chats saved before channels existed have no value and are WhatsApp */
export const channelQuery = (channel = 'whatsapp') => (channel === 'whatsapp' ? { channel: { $ne: 'instagram' } } : { channel });
conversationSchema.set('toJSON', { virtuals: true });

export default mongoose.model('Conversation', conversationSchema);
