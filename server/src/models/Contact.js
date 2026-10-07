import mongoose from 'mongoose';

const contactSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    name: { type: String, trim: true, default: '' },
    phone: { type: String, required: true, trim: true }, // digits only, with country code
    email: { type: String, trim: true, lowercase: true },
    tags: { type: [String], default: [] },
    customFields: { type: Map, of: String, default: {} },
    // Key from the business's own status list (Settings → Lead statuses), validated in the routes
    leadStatus: { type: String, default: 'new', trim: true },
    statusUpdatedAt: Date,
    statusUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    source: { type: String, default: 'manual' }, // manual | import | whatsapp | ad
    // First Facebook/Instagram "Click to WhatsApp" ad that brought this lead (from the webhook "referral")
    adSource: {
      sourceType: String, // ad | post
      sourceId: String, // ad id
      headline: String,
      body: String,
      sourceUrl: String,
      mediaType: String,
      ctwaClid: String,
      at: Date,
    },
    // Reminder to contact this lead again
    followUpAt: Date,
    followUpNote: { type: String, default: '' },
    followUpBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    notes: { type: String, default: '' },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    optedOut: { type: Boolean, default: false },
    optedOutAt: Date,
    lastMessageAt: Date,
    lastInboundAt: Date, // last message FROM the customer ("contacted us in the last 30 days")
    // Follow-up: "message" = also send a WhatsApp template at followUpAt (not just a reminder)
    followUpAction: { type: String, enum: ['remind', 'message'], default: 'remind' },
    followUpTemplateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Template' },
    followUpSentAt: Date,
    // Refer & earn
    referralCode: { type: String, trim: true, uppercase: true },
    referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact' },
    referredAt: Date,
    referralRewardsGiven: { type: Number, default: 0 }, // fee discounts already given to this referrer
  },
  { timestamps: true }
);

contactSchema.index({ tenantId: 1, phone: 1 }, { unique: true });
contactSchema.index({ tenantId: 1, tags: 1 });
contactSchema.index({ tenantId: 1, createdAt: -1 });
contactSchema.index({ tenantId: 1, leadStatus: 1 });
contactSchema.index({ tenantId: 1, followUpAt: 1 });
contactSchema.index({ tenantId: 1, 'adSource.sourceId': 1 });
contactSchema.index({ tenantId: 1, lastInboundAt: -1 });
contactSchema.index({ tenantId: 1, referralCode: 1 }, { unique: true, partialFilterExpression: { referralCode: { $type: 'string' } } });
contactSchema.index({ tenantId: 1, referredBy: 1 });
contactSchema.index({ followUpAction: 1, followUpSentAt: 1, followUpAt: 1 });

export default mongoose.model('Contact', contactSchema);
