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
    // courses = show the course list (Courses page) -> course details, fees, admission questions, booking
    action: { type: String, enum: ['reply', 'lead', 'handoff', 'courses'], default: 'reply' },
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
    // The answer must be this kind (else the question is asked again): any | time | number | phone | email | date
    answerType: { type: String, enum: ['any', 'time', 'number', 'phone', 'email', 'date'], default: 'any' },
    errorText: { type: String, default: '' }, // shown before asking again; empty = a default hint for the type
  },
  { _id: true }
);

// Course flow (coaching): admission questions asked after "Yes, interested" / "Free demo"
const courseQuestionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true }, // profile, goal, mode, start, name, city, call, or your own
    field: { type: String, required: true, trim: true }, // where the answer is saved: name | custom.<key>
    enabled: { type: Boolean, default: true },
    en: { type: String, default: '' }, // question in English
    hi: { type: String, default: '' }, // question in Hinglish
    // Buttons / list rows (max 10). Empty = the customer types the answer.
    options: { type: [{ _id: false, value: { type: String, default: '' }, en: { type: String, default: '' }, hi: { type: String, default: '' } }], default: [] },
    skipIfKnown: { type: Boolean, default: false }, // e.g. name / city already on the lead
  },
  { _id: false }
);

// Answers to the questions students type ("emi hai?", "online hai kya", "address"), in English and Hinglish.
// Placeholders: {{name}} {{course}} {{duration}} {{batch_date}} {{internship}} {{business_name}} {{address}}
// {{maps_link}} {{city}} {{students_trained}} {{since_year}} {{rating}} {{review_link}} {{proof_link}} {{per_day}}
const faqSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true },
    title: { type: String, default: '' },
    enabled: { type: Boolean, default: true },
    keywords: { type: [String], default: [] },
    en: { type: String, default: '' },
    hi: { type: String, default: '' },
    // answer = send the text · fees / details = the course's fees / details · book = admission questions
    // courses = the course list · handoff = connect to the team (e.g. complaints)
    action: { type: String, enum: ['answer', 'fees', 'details', 'book', 'courses', 'handoff'], default: 'answer' },
  },
  { _id: false }
);

const daySchema = { open: { type: Boolean, default: true }, start: { type: String, default: '10:00' }, end: { type: String, default: '19:00' } };

const chatbotSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, unique: true },
    enabled: { type: Boolean, default: false },

    welcomeText: { type: String, default: 'Hello! 👋 Welcome. How can we help you today?' },
    menuButtonLabel: { type: String, default: 'View options', maxlength: 20 },
    // Short line sent with the options again after every answer
    menuAfterReplyText: { type: String, default: 'Aur kisi cheez me madad chahiye? 👇' },
    // What follows an answer: 'button' = one "Main Menu" button under the answer (compact),
    // 'full' = the whole numbered menu again
    afterReplyStyle: { type: String, enum: ['button', 'full'], default: 'button' },
    mainMenuButtonLabel: { type: String, default: '📋 Main Menu', maxlength: 20 },
    afterReplyHint: { type: String, default: '👉 Kuch aur jaanna hai? Neeche *Main Menu* dabaiye ya *menu* likhiye' },
    // List the options with numbers inside the menu message (1️⃣ Courses, 2️⃣ Admission...) + a "how to choose" line
    showNumberedOptions: { type: Boolean, default: true },
    menuHintText: { type: String, default: '👉 Neeche *{button}* dabaiye, ya option ka number likhiye (jaise *2*)' },
    menu: { type: [menuOptionSchema], default: [] },

    keywordRules: { type: [keywordRuleSchema], default: [] },

    courseQuestions: { type: [courseQuestionSchema], default: [] },
    faqs: { type: [faqSchema], default: [] },

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
    // ...or when the chat was quiet this many hours (0 = never). Covers chats nobody marked as resolved.
    restartAfterHours: { type: Number, default: 24, min: 0, max: 720 },

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
