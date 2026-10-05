import mongoose from 'mongoose';

/**
 * One rule-based chatbot per business. Everything the bot says is written by the business admin,
 * so it speaks whatever language they type (Hindi, English, Hinglish...).
 */
const menuOptionSchema = new mongoose.Schema(
  {
    // WhatsApp list rows allow max 24 chars, reply buttons max 20
    title: { type: String, required: true, trim: true, maxlength: 24 },
    description: { type: String, trim: true, maxlength: 72, default: '' },
    // reply = send replyText; lead = ask the lead questions then hand off; handoff = straight to a human
    action: { type: String, enum: ['reply', 'lead', 'handoff'], default: 'reply' },
    replyText: { type: String, default: '' },
    tag: { type: String, trim: true, default: '' }, // optional tag added to the contact when chosen
  },
  { _id: true }
);

const keywordRuleSchema = new mongoose.Schema(
  {
    keywords: { type: [String], default: [] }, // matched case-insensitively
    match: { type: String, enum: ['contains', 'exact'], default: 'contains' },
    replyText: { type: String, default: '' },
    handoff: { type: Boolean, default: false },
  },
  { _id: true }
);

const leadQuestionSchema = new mongoose.Schema(
  {
    // name / email / custom.<key> (saved on the contact)
    field: { type: String, required: true, trim: true },
    question: { type: String, required: true },
  },
  { _id: true }
);

const daySchema = { open: { type: Boolean, default: true }, start: { type: String, default: '10:00' }, end: { type: String, default: '19:00' } };

const chatbotSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, unique: true },
    enabled: { type: Boolean, default: false },

    welcomeText: { type: String, default: 'Hello! 👋 Welcome. How can we help you today?' },
    menuButtonLabel: { type: String, default: 'View options', maxlength: 20 },
    menu: { type: [menuOptionSchema], default: [] },

    keywordRules: { type: [keywordRuleSchema], default: [] },

    leadQuestions: { type: [leadQuestionSchema], default: [] },
    leadCompleteText: { type: String, default: 'Thank you! Our team will contact you shortly. 🙏' },
    leadTag: { type: String, default: 'bot-lead' },

    fallbackText: { type: String, default: "Sorry, I didn't understand that. Please choose an option from the menu." },
    maxFallbacks: { type: Number, default: 2, min: 1, max: 5 }, // then hand off to a human
    handoffText: { type: String, default: 'Connecting you to our team. Someone will reply shortly. 🙂' },
    // Customer types one of these at any time to reach a human
    handoffKeywords: { type: [String], default: ['agent', 'human', 'talk to agent', 'executive'] },
    // Typing these shows the menu again
    menuKeywords: { type: [String], default: ['menu', 'hi', 'hello', 'start over'] },

    // Bot greets again when a resolved chat gets a new message
    restartOnResolved: { type: Boolean, default: true },

    businessHours: {
      enabled: { type: Boolean, default: false },
      timezone: { type: String, default: 'Asia/Kolkata' },
      days: {
        mon: daySchema, tue: daySchema, wed: daySchema, thu: daySchema, fri: daySchema,
        sat: daySchema,
        sun: { open: { type: Boolean, default: false }, start: { type: String, default: '10:00' }, end: { type: String, default: '19:00' } },
      },
      // Sent on handoff when the team is offline
      awayText: { type: String, default: 'Thanks for reaching out! Our team is offline right now and will reply during business hours.' },
    },
  },
  { timestamps: true }
);

export default mongoose.model('Chatbot', chatbotSchema);
