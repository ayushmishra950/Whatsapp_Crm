import mongoose from 'mongoose';
import { DEFAULT_LEAD_STATUSES } from '../services/leadStatuses.js';

const tenantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    status: { type: String, enum: ['active', 'suspended'], default: 'active' },
    // general = normal CRM, coaching = coaching institute format (courses, Infonic playbook); set by the Super Admin
    businessType: { type: String, enum: ['general', 'coaching'], default: 'general' },
    // Business logo shown in the sidebar: a small image stored as a data URL (survives server restarts / redeploys)
    logo: { type: String, default: '' },

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

    // One Facebook Page per business (Facebook Login for Business): posts + comments
    facebook: {
      mode: { type: String, enum: ['mock', 'live'], default: 'mock' },
      pageId: { type: String, index: { unique: true, sparse: true } }, // webhook entry.id → this business
      pageName: String,
      pagePicture: String,
      pageTokenEnc: { type: String, select: false }, // long-lived Page token, AES-GCM encrypted
      // Pages the admin can choose from right after logging in (encrypted user token + list, 30 minutes)
      pendingPagesEnc: { type: String, select: false },
      pendingAt: Date,
      tokenError: String,
      connectedAt: Date,
    },

    // One Instagram professional account per business (Instagram API with Instagram Login)
    instagram: {
      // mock = sandbox until the account is connected; live = real DMs
      mode: { type: String, enum: ['mock', 'live'], default: 'mock' },
      igUserId: { type: String, index: { unique: true, sparse: true } }, // webhook entry.id → this business
      username: String,
      name: String,
      profilePic: String,
      accessTokenEnc: { type: String, select: false }, // long-lived token, AES-GCM encrypted
      tokenExpiresAt: Date,
      tokenRefreshedAt: Date,
      tokenError: String, // last refresh / send auth error (shown in Settings, alerts the admin)
      scopes: [String], // permissions the business allowed when connecting (posting / comments need the newer ones)
      connectedAt: Date,
    },

    settings: {
      autoAssign: { type: Boolean, default: true }, // round-robin new chats to agents
      optOutKeywords: { type: [String], default: ['STOP', 'UNSUBSCRIBE'] },
      agentsCanBroadcast: { type: Boolean, default: false }, // allow agents to run bulk campaigns
      // Custom contact fields (Settings → Contact fields), stored on contacts as customFields.<key>
      // type "date" values are stored as "YYYY-MM-DD" ("0000-MM-DD" without a year)
      contactFields: {
        type: [{ _id: false, key: String, label: String, type: { type: String, enum: ['text', 'date', 'select', 'multiselect'], default: 'text' }, options: { type: [String], default: [] } }],
        default: [],
      },
      // Drips, birthday messages and scheduled follow-ups (not bulk campaigns)
      automation: {
        quietStart: { type: String, default: '21:00' }, // no automated messages from this time...
        quietEnd: { type: String, default: '09:00' }, // ...until this time (business time zone)
        maxPerContactPerDay: { type: Number, default: 2 }, // automated messages one contact can get per day
        timezone: { type: String, default: 'Asia/Kolkata' },
        oneDripAtATime: { type: Boolean, default: true }, // starting a drip stops the lead's other drips
        alertOnReply: { type: Boolean, default: true }, // a reply during a drip alerts the lead's counsellor
        overdueAlertMinutes: { type: Number, default: 30 }, // open task this late -> alert the admins
        dailyReportTime: { type: String, default: '09:00' },
        feeReminders: { type: Boolean, default: true },
        walkInTemplateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Template', default: null }, // welcome for walk-ins (empty = approved walkin_welcome_en / _hi) // WhatsApp reminders 3 days before / on / after an instalment's due date // morning "needs attention" report to admins ('' = off)
        lastDailyReport: String, // YYYY-MM-DD
        // A8: a lead in one of these statuses messages again -> move to toStatus + alert
        returningLead: {
          enabled: { type: Boolean, default: false },
          fromStatuses: { type: [String], default: [] },
          toStatus: { type: String, default: '' },
        },
      },
      // A3/A4: words in a customer's message -> status / tags / alert / task
      automationRules: {
        type: [
          {
            name: String,
            enabled: { type: Boolean, default: true },
            keywords: { type: [String], default: [] },
            onlyIfStatusIn: { type: [String], default: [] }, // empty = any status
            setStatus: { type: String, default: '' },
            addTags: { type: [String], default: [] },
            alert: { type: Boolean, default: false },
            task: { type: String, default: '' }, // task title ('' = none)
          },
        ],
        default: [],
      },
      // WhatsApp price per template message in ₹ (Meta's rates change: edit in Settings). Replies inside 24 h are free.
      waRates: {
        marketing: { type: Number, default: 0.86 },
        utility: { type: Number, default: 0.115 },
        authentication: { type: Number, default: 0.115 },
      },
      // Business details used in template variables ({{review_link}}, {{offer_end}}…)
      messageInfo: {
        reviewLink: { type: String, default: '' },
        proofLink: { type: String, default: '' },
        offerEnd: { type: String, default: '' }, // YYYY-MM-DD
        address: { type: String, default: '' },
        mapsLink: { type: String, default: '' },
        paymentDetails: { type: String, default: '' },
        city: { type: String, default: '' },
        studentsTrained: { type: String, default: '' }, // e.g. "3,000+"
        sinceYear: { type: String, default: '' }, // e.g. "2012"
        rating: { type: String, default: '' }, // e.g. "4.9/5"
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
        type: [
          {
            _id: false,
            key: String,
            label: String,
            color: String,
            stage: { type: String, default: '' }, // new | contacted | interested | demo | admission | converted | closed
            // Time limit in this status; when it runs out: move to another status and/or create a task / alert
            timeLimit: { amount: { type: Number, default: 0 }, unit: { type: String, enum: ['minutes', 'hours', 'days'], default: 'days' } },
            onTimeout: { moveTo: { type: String, default: '' }, task: { type: String, default: '' }, alert: { type: Boolean, default: false } },
            // When this time limit was set: leads already in the status count from here (no mass action on old leads)
            limitSince: Date,
          },
        ],
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
