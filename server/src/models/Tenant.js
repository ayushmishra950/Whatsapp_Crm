import mongoose from 'mongoose';

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
    },

    usage: {
      month: String, // YYYY-MM
      messagesSent: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

export default mongoose.model('Tenant', tenantSchema);
