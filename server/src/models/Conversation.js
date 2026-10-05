import mongoose from 'mongoose';

const conversationSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact', required: true },
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
      step: { type: String, enum: ['menu', 'question'], default: 'menu' },
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

conversationSchema.index({ tenantId: 1, contactId: 1 }, { unique: true });
conversationSchema.index({ tenantId: 1, lastMessageAt: -1 });
conversationSchema.index({ tenantId: 1, assignedTo: 1, lastMessageAt: -1 });
conversationSchema.index({ tenantId: 1, 'bot.active': 1, lastMessageAt: -1 });

conversationSchema.virtual('windowOpen').get(function () {
  return !!this.lastInboundAt && Date.now() - this.lastInboundAt.getTime() < 24 * 60 * 60 * 1000;
});
conversationSchema.set('toJSON', { virtuals: true });

export default mongoose.model('Conversation', conversationSchema);
