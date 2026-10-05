import mongoose from 'mongoose';

const recipientSchema = new mongoose.Schema(
  {
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact', required: true },
    phone: String,
    status: {
      type: String,
      enum: ['pending', 'sending', 'sent', 'delivered', 'read', 'failed', 'skipped'],
      default: 'pending',
    },
    error: String,
    waMessageId: { type: String, index: true },
    messageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
    sentAt: Date,
  },
  { timestamps: true }
);

recipientSchema.index({ campaignId: 1, status: 1 });
recipientSchema.index({ campaignId: 1, contactId: 1 }, { unique: true });

export default mongoose.model('CampaignRecipient', recipientSchema);
