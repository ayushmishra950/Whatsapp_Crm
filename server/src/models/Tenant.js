import mongoose from 'mongoose';
import { DEFAULT_LEAD_STATUSES } from '../services/leadStatuses.js';

const tenantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    status: { type: String, enum: ['active', 'suspended'], default: 'active' },

    plan: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan' },
    subscription: {
      status: { type: String, enum: ['trial', 'active', 'expired', 'cancelled'], default: 'trial' },
      currentPeriodStart: Date,
      currentPeriodEnd: Date,
    },

    // One WhatsApp number per business
    whatsapp: {
      // mock = sandbox mode until real Cloud API credentials are added
      mode: { type: String, enum: ['mock', 'live'], default: 'mock' },
      phoneNumberId: { type: String, index: { unique: true, sparse: true } },
      wabaId: String,
      displayPhoneNumber: String,
      accessTokenEnc: { type: String, select: false }, // AES-GCM encrypted
      connectedAt: Date,
    },

    settings: {
      autoAssign: { type: Boolean, default: true }, // round-robin new chats to agents
      optOutKeywords: { type: [String], default: ['STOP', 'UNSUBSCRIBE'] },
      agentsCanBroadcast: { type: Boolean, default: false }, // allow agents to run bulk campaigns
      // Custom contact fields (Settings → Contact fields), stored on contacts as customFields.<key>
      // type "date" values are stored as "YYYY-MM-DD" ("0000-MM-DD" without a year)
      contactFields: { type: [{ _id: false, key: String, label: String, type: { type: String, enum: ['text', 'date'], default: 'text' } }], default: [] },
      // Drips, birthday messages and scheduled follow-ups (not bulk campaigns)
      automation: {
        quietStart: { type: String, default: '21:00' }, // no automated messages from this time...
        quietEnd: { type: String, default: '09:00' }, // ...until this time (business time zone)
        maxPerContactPerDay: { type: Number, default: 2 }, // automated messages one contact can get per day
        timezone: { type: String, default: 'Asia/Kolkata' },
      },
      // Refer & earn: old students share a code, the business gives a fee discount for each joined referral
      referral: {
        enabled: { type: Boolean, default: true },
        rewardText: { type: String, default: 'Fee discount on your next course' },
        rewardAmount: { type: Number, default: 500 }, // per referred lead who converts (₹, fee discount)
        linkNumber: { type: String, default: '' }, // WhatsApp number for referral links (defaults to the connected number)
        messageText: { type: String, default: 'Hi! {name} ne mujhe refer kiya hai. Referral code: {code}' },
      },
      autoLeadStatus: { type: Boolean, default: true }, // customer writes "interested" / "not interested" -> lead status changes
      // The business's own lead statuses (see services/leadStatuses.js)
      leadStatuses: {
        type: [{ _id: false, key: String, label: String, color: String }],
        default: () => DEFAULT_LEAD_STATUSES.map((s) => ({ ...s })),
      },
    },

    usage: {
      month: String, // YYYY-MM
      messagesSent: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

export default mongoose.model('Tenant', tenantSchema);
