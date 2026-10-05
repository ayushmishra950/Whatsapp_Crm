import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Conversation, Contact, Message, Template, User } from '../models/index.js';
import { validate, notFound, badRequest, forbidden, escapeRegex } from '../utils/http.js';
import {
  CONVERSATION_POPULATE, MESSAGE_POPULATE, sendOutbound, addInternalNote, getOrCreateConversation, renderTemplate,
  resolveReplyTarget, emitMessageUpdate, previewOf,
} from '../services/messaging.js';
import { emitConversationEvent } from '../services/socket.js';
import { uploadMedia } from '../services/whatsapp.js';
import { audit } from '../services/audit.js';
import { setBotForConversation } from '../services/chatbot.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024 } });

// Agents only see chats assigned to them + the unassigned queue
function scope(req) {
  const filter = { tenantId: req.tenantId };
  if (req.user.role === 'agent') filter.assignedTo = { $in: [req.user._id, null] };
  return filter;
}

async function findConversation(req) {
  if (!mongoose.isValidObjectId(req.params.id)) throw notFound('Conversation not found');
  const conversation = await Conversation.findOne({ _id: req.params.id, ...scope(req) });
  if (!conversation) throw notFound('Conversation not found');
  return conversation;
}

router.get('/', async (req, res) => {
  const filter = scope(req);
  const { status = 'open', assigned = 'all', search } = req.query;
  if (status !== 'all') filter.status = status;
  if (assigned === 'me') filter.assignedTo = req.user._id;
  else if (assigned === 'unassigned') {
    filter.assignedTo = null;
    filter['bot.active'] = { $ne: true }; // chats the bot is still handling are not waiting for a human yet
  } else if (assigned === 'bot') filter['bot.active'] = true;
  else if (req.user.role === 'admin' && mongoose.isValidObjectId(assigned)) filter.assignedTo = assigned;

  if (search) {
    const rx = { $regex: escapeRegex(search), $options: 'i' };
    const contacts = await Contact.find({ tenantId: req.tenantId, $or: [{ name: rx }, { phone: rx }] }).select('_id').limit(500);
    filter.contactId = { $in: contacts.map((c) => c._id) };
  }

  const limit = Math.min(100, Number(req.query.limit) || 50);
  if (req.query.before) filter.lastMessageAt = { $lt: new Date(req.query.before) };

  const items = await Conversation.find(filter).populate(CONVERSATION_POPULATE).sort({ lastMessageAt: -1 }).limit(limit);
  res.json(items);
});

// Open (or create) the chat for a contact, e.g. from the Contacts page
router.post('/start', async (req, res) => {
  const { contactId } = validate(z.object({ contactId: z.string().refine(mongoose.isValidObjectId, 'Invalid id') }), req.body);
  const contact = await Contact.findOne({ _id: contactId, tenantId: req.tenantId });
  if (!contact) throw notFound('Contact not found');
  let conversation = await getOrCreateConversation(req.tenantId, contact._id);
  if (req.user.role === 'agent') {
    if (conversation.assignedTo && String(conversation.assignedTo) !== String(req.user._id)) {
      throw forbidden('This chat is assigned to another agent');
    }
    if (!conversation.assignedTo) {
      conversation.assignedTo = req.user._id;
      await conversation.save();
    }
  }
  conversation = await conversation.populate(CONVERSATION_POPULATE);
  res.json(conversation);
});

router.get('/:id', async (req, res) => {
  const conversation = await findConversation(req);
  await conversation.populate(CONVERSATION_POPULATE);
  const contact = await Contact.findById(conversation.contactId);
  res.json({ conversation, contact });
});

router.get('/:id/messages', async (req, res) => {
  const conversation = await findConversation(req);
  const filter = { conversationId: conversation._id };
  if (req.query.before) filter.createdAt = { $lt: new Date(req.query.before) };
  const limit = Math.min(100, Number(req.query.limit) || 50);
  const messages = await Message.find(filter).populate(MESSAGE_POPULATE).sort({ createdAt: -1 }).limit(limit);
  res.json(messages.reverse());
});

const objectId = (msg = 'Invalid id') => z.string().refine(mongoose.isValidObjectId, msg);
const replyToField = objectId('Invalid reply message').optional();

const messageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().trim().min(1).max(4096), replyToId: replyToField }),
  z.object({ type: z.literal('note'), text: z.string().trim().min(1).max(4096) }),
  z.object({
    type: z.literal('template'),
    templateId: objectId('Invalid template'),
    params: z.array(z.string()).default([]),
    replyToId: replyToField,
  }),
]);

router.post('/:id/messages', upload.single('file'), async (req, res) => {
  const conversation = await findConversation(req);
  const contact = await Contact.findById(conversation.contactId);
  if (!contact) throw notFound('Contact not found');
  const base = { tenant: req.tenant, contact, conversation, user: req.user };

  // Media (multipart/form-data with "file")
  if (req.file) {
    const { replyToId } = validate(z.object({ replyToId: replyToField.or(z.literal('')) }), req.body);
    if (!conversation.windowOpen) throw badRequest('The 24-hour reply window is closed. Only an approved template can be sent.');
    const replyTo = await resolveReplyTarget(conversation, replyToId || null);
    const mime = req.file.mimetype;
    const type = mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'document';
    // Keep a local copy so the UI can show what was sent
    const ext = path.extname(req.file.originalname) || '';
    const relPath = path.join(String(req.tenantId), `${crypto.randomBytes(10).toString('hex')}${ext}`);
    await fs.mkdir(path.resolve('uploads', String(req.tenantId)), { recursive: true });
    await fs.writeFile(path.resolve('uploads', relPath), req.file.buffer);

    const { id: waMediaId } = await uploadMedia(req.tenantId, { buffer: req.file.buffer, mimeType: mime, fileName: req.file.originalname });
    const message = await sendOutbound({
      ...base,
      replyTo,
      kind: 'media',
      media: { type, waMediaId, url: `/uploads/${relPath.split(path.sep).join('/')}`, mimeType: mime, fileName: req.file.originalname, caption: req.body.caption || '' },
    });
    return res.status(201).json(message);
  }

  const data = validate(messageSchema, req.body);

  if (data.type === 'note') {
    return res.status(201).json(await addInternalNote({ ...base, text: data.text }));
  }
  const replyTo = await resolveReplyTarget(conversation, data.replyToId);
  if (data.type === 'text') {
    return res.status(201).json(await sendOutbound({ ...base, replyTo, kind: 'text', text: data.text }));
  }

  const template = await Template.findOne({ _id: data.templateId, tenantId: req.tenantId });
  if (!template) throw notFound('Template not found');
  if (template.status !== 'approved') throw badRequest('Template is not approved yet');
  if (data.params.length < template.variableCount) throw badRequest(`This template needs ${template.variableCount} variable(s)`);
  const message = await sendOutbound({
    ...base,
    replyTo,
    kind: 'template',
    template: { name: template.name, language: template.language, params: data.params, renderedText: renderTemplate(template.body, data.params) },
  });
  res.status(201).json(message);
});

async function findMessage(req, conversation) {
  if (!mongoose.isValidObjectId(req.params.messageId)) throw notFound('Message not found');
  const message = await Message.findOne({ _id: req.params.messageId, conversationId: conversation._id });
  if (!message) throw notFound('Message not found');
  return message;
}

const isAuthorOrAdmin = (req, message) => req.user.role === 'admin' || String(message.sentBy) === String(req.user._id);

// Edit an internal note (author or admin). Messages sent to WhatsApp can not be edited.
router.patch('/:id/messages/:messageId', async (req, res) => {
  const { text } = validate(z.object({ text: z.string().trim().min(1).max(4096) }), req.body);
  const conversation = await findConversation(req);
  const message = await findMessage(req, conversation);
  if (message.direction !== 'internal') throw badRequest('Only internal notes can be edited. WhatsApp does not allow editing sent messages.');
  if (message.deletedAt) throw badRequest('This note was deleted');
  if (!isAuthorOrAdmin(req, message)) throw forbidden('Only the author or an admin can edit this note');
  if (message.text === text) return res.json(await message.populate(MESSAGE_POPULATE));

  const previous = message.text;
  message.text = text;
  message.editedAt = new Date();
  await message.save();
  await audit(req, 'note.edit', { targetType: 'Message', targetId: message._id, meta: { conversationId: conversation._id, previous } });
  await emitMessageUpdate(message);
  res.json(message);
});

// Senders may delete their own WhatsApp message for this long (same as WhatsApp's own "delete for everyone" window)
export const OWN_DELETE_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * Who may remove a message from the CRM. Returns the audit action name, or throws.
 * NOTE: the WhatsApp Cloud API has no unsend/"delete for everyone", so this is always a soft delete in the CRM only
 * (original kept for audit). A message that reached the customer stays on their phone.
 */
function deletePermission(req, message) {
  const isAdmin = req.user.role === 'admin';
  const own = String(message.sentBy) === String(req.user._id);

  if (message.direction === 'internal') {
    if (own || isAdmin) return 'note.delete';
    throw forbidden('Only the author or an admin can delete this note');
  }
  if (message.direction === 'outbound' && own) {
    const neverDelivered = message.status === 'failed';
    if (isAdmin || neverDelivered || Date.now() - message.createdAt.getTime() <= OWN_DELETE_WINDOW_MS) return 'message.delete_own';
    throw forbidden('You can delete your own messages only within 48 hours of sending. Ask an admin to hide it.');
  }
  if (isAdmin) return 'message.hide';
  throw forbidden('You can only delete messages you sent. Ask an admin to hide this message.');
}

router.delete('/:id/messages/:messageId', async (req, res) => {
  const conversation = await findConversation(req);
  const message = await findMessage(req, conversation);
  if (message.deletedAt) throw badRequest('This message is already deleted');
  const isNote = message.direction === 'internal';
  const action = deletePermission(req, message);

  message.deletedAt = new Date();
  message.deletedBy = req.user._id;
  await message.save();
  await audit(req, action, {
    targetType: 'Message',
    targetId: message._id,
    meta: { conversationId: conversation._id, direction: message.direction, type: message.type, status: message.status },
  });

  // If it was the latest customer-visible message, don't keep its text in the chat list preview
  if (!isNote) {
    const latest = await Message.findOne({ conversationId: conversation._id, direction: { $ne: 'internal' } }).sort({ createdAt: -1 }).select('_id');
    if (String(latest?._id) === String(message._id)) {
      conversation.lastMessagePreview = previewOf(message);
      await conversation.save();
      await conversation.populate(CONVERSATION_POPULATE);
      emitConversationEvent(conversation, 'conversation:updated', conversation);
    }
  }
  await emitMessageUpdate(message);
  res.json(message);
});

router.patch('/:id', async (req, res) => {
  const data = validate(
    z.object({
      status: z.enum(['open', 'pending', 'resolved']).optional(),
      assignedTo: z.string().refine(mongoose.isValidObjectId, 'Invalid user').nullable().optional(),
    }),
    req.body
  );
  const conversation = await findConversation(req);
  const previousAssignee = conversation.assignedTo;

  if (data.assignedTo !== undefined) {
    if (data.assignedTo) {
      const assignee = await User.findOne({ _id: data.assignedTo, tenantId: req.tenantId, isActive: true });
      if (!assignee) throw badRequest('User not found or disabled');
      // A person now owns the chat -> bot steps back
      if (conversation.bot?.active) conversation.set('bot', { ...conversation.toObject().bot, active: false, endedAt: new Date(), endReason: 'takeover' });
    }
    conversation.assignedTo = data.assignedTo;
  }
  if (data.status) conversation.status = data.status;
  await conversation.save();
  await conversation.populate(CONVERSATION_POPULATE);

  if (data.assignedTo !== undefined && String(previousAssignee) !== String(data.assignedTo)) {
    await audit(req, 'conversation.assign', { targetType: 'Conversation', targetId: conversation._id, meta: { from: previousAssignee, to: data.assignedTo } });
  }
  emitConversationEvent(conversation, 'conversation:updated', conversation, { previousAssignee, wasUnassigned: !previousAssignee });
  res.json(conversation);
});

// Take the chat over from the bot, or hand it back to the bot (sends the menu again)
router.post('/:id/bot', async (req, res) => {
  const { action } = validate(z.object({ action: z.enum(['stop', 'restart']) }), req.body);
  const conversation = await findConversation(req);
  const contact = await Contact.findById(conversation.contactId);
  await setBotForConversation({ tenant: req.tenant, conversation, contact, action });
  await audit(req, `chatbot.${action === 'stop' ? 'takeover' : 'restart'}`, { targetType: 'Conversation', targetId: conversation._id });
  const fresh = await Conversation.findById(conversation._id).populate(CONVERSATION_POPULATE);
  emitConversationEvent(fresh, 'conversation:updated', fresh);
  res.json(fresh);
});

router.post('/:id/read', async (req, res) => {
  const conversation = await findConversation(req);
  conversation.unreadCount = 0;
  await conversation.save();
  res.json({ ok: true });
});

export default router;
