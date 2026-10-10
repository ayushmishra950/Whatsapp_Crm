import mongoose from 'mongoose';

const contactSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    name: { type: String, trim: true, default: '' },
    // digits only, with country code. Optional: an Instagram lead has no number until they share one.
    // Never store '' — leave it unset (the unique index only covers real numbers).
    phone: { type: String, trim: true },
    // Instagram DM identity (Instagram-scoped user id from the webhook + public profile)
    instagram: {
      igsid: String,
      username: String,
      name: String,
      profilePic: String,
      profileAt: Date, // when the profile was last fetched (the picture URL expires)
    },
    // Someone who commented on the business's Facebook Page (made into a lead from the Comments inbox)
    facebook: { userId: String, name: String },
    email: { type: String, trim: true, lowercase: true },
    tags: { type: [String], default: [] },
    customFields: { type: Map, of: String, default: {} },
    // Key from the business's own status list (Settings → Lead statuses), validated in the routes
    leadStatus: { type: String, default: 'new', trim: true },
    statusUpdatedAt: Date,
    statusUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    source: { type: String, default: 'manual' }, // manual | import | whatsapp | instagram | ad
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
    course: { type: String, trim: true, uppercase: true, default: '' }, // Course catalog code (DM, AIML…)
    // Every course the lead looked at in the chatbot and what they did there (newest last, max 20)
    // actions: viewed | fees | details | demo | interested | not_now | booked
    courseInterest: {
      type: [{ _id: false, code: String, name: String, firstAt: Date, lastAt: Date, actions: { type: [String], default: [] } }],
      default: [],
    },
    language: { type: String, enum: ['', 'en', 'hi'], default: '' }, // en = English, hi = Hinglish (auto-detected)
    languageLocked: { type: Boolean, default: false }, // set by a person: stop auto-detecting
    callAttempts: { type: Number, default: 0 },
    lastCallAt: Date,
    lastCallOutcome: String,
    nextActionAt: Date, // earliest open task or follow-up (no next action = lead can get lost)
    statusTimeoutMark: Date, // statusUpdatedAt whose time limit was already handled
    // Follow-up: "message" = also send a WhatsApp template at followUpAt (not just a reminder)
    followUpAction: { type: String, enum: ['remind', 'message'], default: 'remind' },
    followUpTemplateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Template' },
    followUpSentAt: Date,
    // Fees (students): plan + payments; the summary fields are kept up to date for lists and reminders
    fees: {
      total: { type: Number, default: 0 },
      discount: { type: Number, default: 0 },
      note: { type: String, default: '' },
      installments: {
        type: [
          {
            amount: { type: Number, required: true },
            dueDate: { type: String, required: true }, // YYYY-MM-DD
            reminded: { soon: Date, due: Date, overdue: Date },
          },
        ],
        default: [],
      },
      payments: {
        type: [
          {
            amount: { type: Number, required: true },
            date: { type: String, required: true }, // YYYY-MM-DD
            mode: { type: String, default: '' }, // Cash, UPI, Bank transfer, Card, Cheque
            receiptNo: { type: String, default: '' },
            note: { type: String, default: '' },
            by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
            at: { type: Date, default: Date.now },
          },
        ],
        default: [],
      },
      paid: { type: Number, default: 0 },
      balance: { type: Number, default: 0 },
      nextDue: { type: String, default: '' }, // YYYY-MM-DD of the next unpaid instalment ('' = none)
      nextAmount: { type: Number, default: 0 },
    },
    // Refer & earn
    referralCode: { type: String, trim: true, uppercase: true },
    referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact' },
    referredAt: Date,
    referralRewardsGiven: { type: Number, default: 0 }, // fee discounts already given to this referrer
  },
  { timestamps: true }
);

// One lead per number / per Instagram user in a business. Partial: leads without that identity are not indexed.
// (The old full unique index tenantId_1_phone_1 is dropped by the channel migration, services/channelMigration.js.)
contactSchema.index({ tenantId: 1, phone: 1 }, { name: 'tenant_phone_unique', unique: true, partialFilterExpression: { phone: { $type: 'string' } } });
contactSchema.index({ tenantId: 1, 'instagram.igsid': 1 }, { name: 'tenant_igsid_unique', unique: true, partialFilterExpression: { 'instagram.igsid': { $type: 'string' } } });
contactSchema.index({ tenantId: 1, tags: 1 });
contactSchema.index({ tenantId: 1, createdAt: -1 });
contactSchema.index({ tenantId: 1, leadStatus: 1 });
contactSchema.index({ tenantId: 1, followUpAt: 1 });
contactSchema.index({ tenantId: 1, 'adSource.sourceId': 1 });
contactSchema.index({ tenantId: 1, lastInboundAt: -1 });
contactSchema.index({ tenantId: 1, course: 1 });
contactSchema.index({ tenantId: 1, nextActionAt: 1 });
contactSchema.index({ tenantId: 1, 'fees.nextDue': 1 });
contactSchema.index({ 'fees.nextDue': 1 });
contactSchema.index({ tenantId: 1, referralCode: 1 }, { unique: true, partialFilterExpression: { referralCode: { $type: 'string' } } });
contactSchema.index({ tenantId: 1, referredBy: 1 });
contactSchema.index({ followUpAction: 1, followUpSentAt: 1, followUpAt: 1 });

export default mongoose.model('Contact', contactSchema);
