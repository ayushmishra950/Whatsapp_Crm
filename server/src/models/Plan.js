import mongoose from 'mongoose';

const planSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    description: { type: String, default: '' },
    priceMonthly: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },
    limits: {
      agents: { type: Number, default: 3 }, // excludes the admin
      contacts: { type: Number, default: 1000 },
      monthlyMessages: { type: Number, default: 5000 }, // outbound messages per calendar month
    },
    features: { type: [String], default: [] }, // marketing bullet points shown on the plan card
    // Modules a business on this plan may use
    modules: {
      chatbot: { type: Boolean, default: true },
      instagram: { type: Boolean, default: true }, // Instagram DMs in the inbox
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model('Plan', planSchema);
