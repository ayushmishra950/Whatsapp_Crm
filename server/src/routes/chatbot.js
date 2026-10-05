import { Router } from 'express';
import { z } from 'zod';
import { Chatbot, Conversation } from '../models/index.js';
import { authorize } from '../middleware/auth.js';
import { validate, forbidden, badRequest } from '../utils/http.js';
import { audit } from '../services/audit.js';
import { chatbotAllowed, isWithinBusinessHours } from '../services/chatbot.js';

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
  menu: z
    .array(
      z.object({
        _id: z.string().optional(),
        title: z.string().trim().min(1, 'Option title is required').max(24, 'Option title can be max 24 characters'),
        description: z.string().trim().max(72).default(''),
        action: z.enum(['reply', 'lead', 'handoff']),
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
    .array(z.object({ _id: z.string().optional(), field: fieldName, question: z.string().trim().min(1).max(1024) }))
    .max(10),
  leadCompleteText: z.string().trim().max(1024),
  leadTag: z.string().trim().max(40),
  fallbackText: z.string().trim().min(1).max(1024),
  maxFallbacks: z.coerce.number().int().min(1).max(5),
  handoffText: z.string().trim().min(1).max(1024),
  handoffKeywords: z.array(z.string().trim().min(1)).max(20),
  menuKeywords: z.array(z.string().trim().min(1)).max(20),
  restartOnResolved: z.boolean(),
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
    planAllows: chatbotAllowed(req.tenant),
    openNow: isWithinBusinessHours(bot.businessHours),
    whatsappMode: req.tenant.whatsapp?.mode || 'mock',
  });
});

router.put('/', async (req, res) => {
  if (!chatbotAllowed(req.tenant)) throw forbidden('Chatbot is not included in your plan. Ask your provider to upgrade.');
  const data = validate(botSchema, req.body);
  if (data.enabled && !data.menu.length && !data.keywordRules.length) {
    throw badRequest('Add at least one menu option or keyword reply before turning the bot on');
  }
  const bot = await getOrCreate(req.tenantId);
  const wasEnabled = bot.enabled;
  bot.set(data);
  await bot.save();
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
