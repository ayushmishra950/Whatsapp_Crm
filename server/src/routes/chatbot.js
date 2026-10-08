import { Router } from 'express';
import { z } from 'zod';
import { Chatbot, Conversation } from '../models/index.js';
import { authorize } from '../middleware/auth.js';
import { validate, forbidden, badRequest } from '../utils/http.js';
import { audit } from '../services/audit.js';
import { chatbotAllowed, isWithinBusinessHours } from '../services/chatbot.js';
import { isCoaching } from '../services/coaching.js';
import { DEFAULT_COURSE_QUESTIONS } from '../services/courseBot.js';
import { defaultFaqs } from '../services/coachingContent.js';
import { registerContactFields } from '../services/contactFields.js';

const router = Router();
router.use(authorize('admin'));

// Starter content so a new business sees a working example instead of an empty form
const DEFAULT_BOT = {
  enabled: false,
  menu: [
    { title: 'Price / Plans', action: 'reply', replyText: 'Thanks for your interest! Choose "Talk to sales" and our team will share the best price for you.' },
    { title: 'Talk to sales', action: 'lead', replyText: 'Sure! Please answer a few quick questions.', tag: 'sales' },
    { title: 'Support', action: 'handoff', replyText: 'Connecting you to our support team. 🙂', tag: 'support' },
  ],
  keywordRules: [{ keywords: ['price', 'cost', 'rate'], match: 'contains', replyText: 'Our team will share the latest price list. Choose "Talk to sales" from the menu to get a quote.' }],
  leadQuestions: [
    { field: 'name', question: 'May I know your name?' },
    { field: 'custom.city', question: 'Which city are you from?' },
    { field: 'custom.requirement', question: 'Please tell us your requirement in a few words.' },
  ],
};

async function getOrCreate(tenantId) {
  return (await Chatbot.findOne({ tenantId })) || Chatbot.create({ tenantId, ...DEFAULT_BOT });
}

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:MM');
const day = z.object({ open: z.boolean(), start: time, end: time });
const fieldName = z
  .string()
  .trim()
  .refine((f) => ['name', 'email'].includes(f) || /^custom\.[a-z0-9_]{1,30}$/.test(f), 'Field must be name, email or custom.<key> (lowercase, numbers, _)');

const botSchema = z.object({
  enabled: z.boolean(),
  welcomeText: z.string().trim().min(1, 'Welcome message is required').max(1024),
  menuButtonLabel: z.string().trim().min(1).max(20),
  menuAfterReplyText: z.string().trim().min(1).max(1024).default('Aur kisi cheez me madad chahiye? 👇'),
  showNumberedOptions: z.boolean().default(true),
  afterReplyStyle: z.enum(['button', 'full']).default('button'),
  mainMenuButtonLabel: z.string().trim().min(1).max(20, 'Main Menu button text can be max 20 characters').default('📋 Main Menu'),
  afterReplyHint: z.string().trim().max(300).default('👉 Kuch aur jaanna hai? Neeche *Main Menu* dabaiye ya *menu* likhiye'),
  menuHintText: z.string().trim().max(300).default('👉 Neeche *{button}* dabaiye, ya option ka number likhiye (jaise *2*)'),
  menu: z
    .array(
      z.object({
        _id: z.string().optional(),
        title: z.string().trim().min(1, 'Option title is required').max(24, 'Option title can be max 24 characters'),
        description: z.string().trim().max(72).default(''),
        action: z.enum(['reply', 'lead', 'handoff', 'courses']),
        replyText: z.string().max(4096).default(''),
        tag: z.string().trim().max(40).default(''),
      })
    )
    .max(10, 'WhatsApp allows max 10 menu options'),
  keywordRules: z
    .array(
      z.object({
        _id: z.string().optional(),
        keywords: z.array(z.string().trim().min(1)).min(1, 'Add at least one keyword'),
        match: z.enum(['contains', 'exact']),
        replyText: z.string().max(4096).default(''),
        handoff: z.boolean().default(false),
      })
    )
    .max(50),
  leadQuestions: z
    .array(
      z.object({
        _id: z.string().optional(),
        field: fieldName,
        question: z.string().trim().min(1).max(1024),
        answerType: z.enum(['any', 'time', 'number', 'phone', 'email', 'date']).default('any'),
        errorText: z.string().trim().max(300).default(''),
      })
    )
    .max(10),
  // Coaching course flow: admission questions and answers to typed questions (FAQ)
  courseQuestions: z
    .array(
      z.object({
        key: z.string().trim().regex(/^[a-z0-9_]{1,30}$/, 'Question key: lowercase letters, numbers, _'),
        field: z.string().trim().refine((f) => f === 'name' || /^custom\.[a-z0-9_]{1,30}$/.test(f), 'Saved in: name or custom.<key>'),
        enabled: z.boolean().default(true),
        en: z.string().trim().max(500).default(''),
        hi: z.string().trim().max(500).default(''),
        options: z
          .array(z.object({ value: z.string().trim().max(100).default(''), en: z.string().trim().min(1, 'Option text is required').max(24, 'Option text: max 24 characters'), hi: z.string().trim().max(24).default('') }))
          .max(10, 'Max 10 options'),
        skipIfKnown: z.boolean().default(false),
      }).refine((q) => q.en || q.hi, 'Write the question')
    )
    .max(15)
    .optional(),
  faqs: z
    .array(
      z.object({
        key: z.string().trim().regex(/^[a-z0-9_]{1,40}$/, 'FAQ key: lowercase letters, numbers, _'),
        title: z.string().trim().max(60).default(''),
        enabled: z.boolean().default(true),
        keywords: z.array(z.string().trim().toLowerCase().min(2).max(60)).max(60).default([]),
        en: z.string().trim().max(1000).default(''),
        hi: z.string().trim().max(1000).default(''),
        action: z.enum(['answer', 'fees', 'details', 'book', 'courses', 'handoff']).default('answer'),
      })
    )
    .max(80)
    .optional(),
  leadCompleteText: z.string().trim().max(1024),
  leadTag: z.string().trim().max(40),
  fallbackText: z.string().trim().min(1).max(1024),
  maxFallbacks: z.coerce.number().int().min(1).max(5),
  handoffText: z.string().trim().min(1).max(1024),
  handoffKeywords: z.array(z.string().trim().min(1)).max(20),
  menuKeywords: z.array(z.string().trim().min(1)).max(20),
  restartOnResolved: z.boolean(),
  typingIndicator: z.boolean().optional(),
  restartAfterHours: z.coerce.number().int().min(0).max(720).default(24),
  businessHours: z.object({
    enabled: z.boolean(),
    timezone: z.string().refine((tz) => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, 'Invalid timezone'),
    days: z.object({ mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day }),
    awayText: z.string().trim().min(1).max(1024),
  }),
});

router.get('/', async (req, res) => {
  const bot = await getOrCreate(req.tenantId);
  res.json({
    bot,
    // Defaults the Chatbot page shows / can restore (coaching)
    defaults: isCoaching(req.tenant) ? { courseQuestions: DEFAULT_COURSE_QUESTIONS, faqs: defaultFaqs() } : null,
    planAllows: chatbotAllowed(req.tenant),
    openNow: isWithinBusinessHours(bot.businessHours),
    whatsappMode: req.tenant.whatsapp?.mode || 'mock',
  });
});

router.put('/', async (req, res) => {
  if (!chatbotAllowed(req.tenant)) throw forbidden('Chatbot is not included in your plan. Ask your provider to upgrade.');
  const data = validate(botSchema, req.body);
  const keys = (data.courseQuestions || []).map((q) => q.key);
  if (new Set(keys).size !== keys.length) throw badRequest('Two admission questions have the same key');
  if (data.menu.some((o) => o.action === 'courses') && !isCoaching(req.tenant)) {
    throw badRequest('"Show course list" is for coaching institutes');
  }
  if (data.enabled && !data.menu.length && !data.keywordRules.length) {
    throw badRequest('Add at least one menu option or keyword reply before turning the bot on');
  }
  const bot = await getOrCreate(req.tenantId);
  const wasEnabled = bot.enabled;
  bot.set(data);
  await bot.save();
  // Lead questions that save to a custom field: add it to Settings → Contact fields
  await registerContactFields(
    req.tenantId,
    Object.fromEntries(
      [...(data.leadQuestions || []), ...(data.courseQuestions || [])].filter((q) => q.field?.startsWith('custom.')).map((q) => [q.field.slice(7), null])
    )
  );
  if (wasEnabled && !data.enabled) {
    // Bot turned off: chats it was handling go back to the team's unassigned queue
    await Conversation.updateMany(
      { tenantId: req.tenantId, 'bot.active': true },
      { $set: { 'bot.active': false, 'bot.endedAt': new Date(), 'bot.endReason': 'disabled' } }
    );
  }
  await audit(req, wasEnabled !== data.enabled ? `chatbot.${data.enabled ? 'enable' : 'disable'}` : 'chatbot.update', {
    targetType: 'Chatbot',
    targetId: bot._id,
  });
  res.json({ bot, planAllows: true, openNow: isWithinBusinessHours(bot.businessHours) });
});

export default router;
