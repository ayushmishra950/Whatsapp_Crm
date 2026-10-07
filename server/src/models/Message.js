import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact', required: true },
    // internal = private note visible only to team
    direction: { type: String, enum: ['inbound', 'outbound', 'internal'], required: true },
    type: { type: String, enum: ['text', 'template', 'image', 'document', 'video', 'audio', 'note', 'interactive', 'other'], default: 'text' },
    text: { type: String, default: '' },
    media: {
      url: String,
      mimeType: String,
      fileName: String,
      caption: String,
      waMediaId: String,
    },
    template: {
      name: String,
      language: String,
      params: [String],
    },
    status: {
      type: String,
      enum: ['queued', 'sent', 'delivered', 'read', 'failed', 'received'],
      default: 'queued',
    },
    error: String,
    waMessageId: { type: String, index: true },
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign' },
    // Sent automatically by the chatbot
    isBot: { type: Boolean, default: false },
    // Sent by an automation (drip / birthday / scheduled follow-up), shown with its name in the chat
    automation: { kind: { type: String, enum: ['drip', 'followup'] }, name: String, dripId: { type: mongoose.Schema.Types.ObjectId, ref: 'Drip' } },
    // Customer came from a "Click to WhatsApp" ad / post (shown as a card in the chat)
    referral: {
      sourceType: String,
      sourceId: String,
      headline: String,
      body: String,
      sourceUrl: String,
      mediaType: String,
      imageUrl: String,
      ctwaClid: String,
    },
    // Outbound: buttons / list menu we sent. Inbound: replyId = which option the customer tapped
    interactive: {
      kind: { type: String, enum: ['buttons', 'list'] },
      buttonLabel: String,
      options: [{ _id: false, id: String, title: String, description: String }],
      replyId: String,
    },

    // Quoted reply: the message this one answers (both directions)
    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
    // Customer's latest reaction to this message (WhatsApp keeps one reaction per person)
    customerReaction: { emoji: String, at: Date },
    // Internal notes can be edited by their author or an admin
    editedAt: Date,
    // Soft delete: hidden from the CRM, original kept in DB for audit/compliance.
    // WhatsApp has no "delete for everyone" for business messages, so the customer still has it.
    deletedAt: Date,
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

messageSchema.index({ conversationId: 1, createdAt: -1 });

// Never send the content of a hidden message to any client (API responses and socket events)
messageSchema.set('toJSON', {
  transform: (_doc, ret) => {
    if (ret.deletedAt) {
      ret.text = '';
      delete ret.media;
      delete ret.template;
      delete ret.replyTo;
      delete ret.customerReaction;
    }
    return ret;
  },
});

export default mongoose.model('Message', messageSchema);
