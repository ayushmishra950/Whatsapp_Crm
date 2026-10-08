import { Router } from 'express';
import { z } from 'zod';
import { Template, Campaign } from '../models/index.js';
import { authorize } from '../middleware/auth.js';
import { validate, notFound, conflict, badRequest, HttpError } from '../utils/http.js';
import { submitTemplate, deleteTemplateRemote, editTemplateRemote } from '../services/whatsapp.js';
import { audit } from '../services/audit.js';
import { DEFAULT_TZ } from '../utils/time.js';

const router = Router();

const variableDefault = z.object({
  source: z.enum(['field', 'static']),
  value: z.string().trim().max(200).default(''),
  example: z.string().trim().max(200).default(''),
});

const templateButton = z
  .object({
    type: z.enum(['QUICK_REPLY', 'URL', 'PHONE_NUMBER']).default('QUICK_REPLY'),
    text: z.string().trim().min(1, 'Button text is required').max(25, 'Button text: max 25 characters'),
    url: z.string().trim().max(2000).default(''),
    phone: z.string().trim().max(20).default(''),
  })
  .superRefine((b, ctx) => {
    if (b.type === 'URL' && !/^https?:\/\/\S+$/.test(b.url)) ctx.addIssue({ code: 'custom', message: `Button "${b.text}": enter the link (https://…)` });
    if (b.type === 'PHONE_NUMBER' && !/^\+?\d{8,15}$/.test(b.phone)) ctx.addIssue({ code: 'custom', message: `Button "${b.text}": enter the phone number with country code` });
  });

// Meta: max 10 buttons, of which at most 2 links and 1 phone number
function checkButtons(buttons = []) {
  if (buttons.filter((b) => b.type === 'URL').length > 2) throw badRequest('Max 2 link buttons');
  if (buttons.filter((b) => b.type === 'PHONE_NUMBER').length > 1) throw badRequest('Max 1 call button');
}

// Keep exactly one default per {{n}} in the body
const fitDefaults = (defaults = [], body = '') => {
  const count = new Set(body.match(/\{\{(\d+)\}\}/g) || []).size;
  return Array.from({ length: count }, (_, i) => defaults[i] || (i === 0 ? { source: 'field', value: 'name', example: '' } : { source: 'static', value: '', example: '' }));
};

const templateFields = z.object({
  name: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_]{1,512}$/, 'Name can contain only lowercase letters, numbers and underscores'),
  language: z.string().min(2),
  category: z.enum(['MARKETING', 'UTILITY', 'AUTHENTICATION']),
  header: z.string().max(60),
  body: z.string().trim().min(1).max(1024),
  footer: z.string().max(60),
  variableDefaults: z.array(variableDefault).max(20),
  buttons: z.array(templateButton).max(10),
});

function checkVariables(body) {
  const nums = [...new Set((body.match(/\{\{(\d+)\}\}/g) || []).map((m) => Number(m.slice(2, -2))))].sort((a, b) => a - b);
  if (nums.some((n, i) => n !== i + 1)) throw badRequest('Variables must be sequential: {{1}}, {{2}}, {{3}} ...');
}

router.get('/', async (req, res) => {
  const filter = { tenantId: req.tenantId };
  if (req.query.status) filter.status = req.query.status;
  res.json(await Template.find(filter).sort({ createdAt: -1 }));
});

router.post('/', authorize('admin'), async (req, res) => {
  const data = validate(templateFields.partial().required({ name: true, body: true }), req.body);
  checkVariables(data.body);
  checkButtons(data.buttons);
  const language = data.language || 'en';
  if (await Template.exists({ tenantId: req.tenantId, name: data.name, language })) {
    throw conflict('A template with this name and language already exists');
  }
  const template = await Template.create({
    ...data,
    variableDefaults: fitDefaults(data.variableDefaults, data.body),
    language,
    tenantId: req.tenantId,
    createdBy: req.user._id,
  });
  await audit(req, 'template.create', { targetType: 'Template', targetId: template._id });
  res.status(201).json(template);
});

router.patch('/:id', authorize('admin'), async (req, res) => {
  const data = validate(templateFields.partial(), req.body);
  const template = await Template.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!template) throw notFound('Template not found');
  if (!['draft', 'rejected'].includes(template.status)) throw badRequest('Only draft or rejected templates can be edited');
  Object.assign(template, data);
  checkVariables(template.body);
  checkButtons(template.buttons);
  template.variableDefaults = fitDefaults(data.variableDefaults ?? template.variableDefaults, template.body);
  if (template.status === 'rejected') template.status = 'draft';
  await template.save();
  res.json(template);
});

router.post('/:id/submit', authorize('admin'), async (req, res) => {
  const template = await Template.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!template) throw notFound('Template not found');
  if (!['draft', 'rejected'].includes(template.status)) throw badRequest('Template is already submitted');
  if (template.metaTemplateId) {
    // Already exists on Meta (it was rejected): resubmit as an edit, creating it again would fail on the same name
    await editTemplateRemote(req.tenantId, template, { includeCategory: true });
    template.status = 'pending';
  } else {
    const result = await submitTemplate(req.tenantId, template);
    template.metaTemplateId = result.id;
    template.status = result.status === 'APPROVED' ? 'approved' : 'pending';
  }
  template.rejectionReason = undefined;
  await template.save();
  await audit(req, 'template.submit', { targetType: 'Template', targetId: template._id });
  res.json(template);
});

/**
 * Edit an APPROVED template. Only header, body and footer can change (Meta never allows name / language,
 * and not the category once approved). The template goes back to "pending" until Meta approves the edit.
 */
const approvedEditFields = z.object({
  header: z.string().max(60).default(''),
  body: z.string().trim().min(1).max(1024),
  footer: z.string().max(60).default(''),
  variableDefaults: z.array(variableDefault).max(20).optional(),
  buttons: z.array(templateButton).max(10).optional(),
});

router.post('/:id/edit-approved', authorize('admin'), async (req, res) => {
  const data = validate(approvedEditFields, req.body);
  const template = await Template.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!template) throw notFound('Template not found');
  if (template.status !== 'approved' || !template.metaTemplateId) throw badRequest('Only approved templates can be edited this way');
  checkVariables(data.body);
  if (data.buttons) checkButtons(data.buttons);
  const sameButtons = !data.buttons || JSON.stringify(data.buttons) === JSON.stringify((template.buttons || []).map(({ type, text, url, phone }) => ({ type, text, url, phone })));
  if (data.header === template.header && data.body === template.body && data.footer === template.footer && sameButtons) {
    throw badRequest('Nothing changed');
  }
  if (await Campaign.exists({ templateId: template._id, status: { $in: ['scheduled', 'running', 'paused'] } })) {
    throw conflict('This template is used by a scheduled or running campaign. Finish or cancel it before editing, because the template can not be sent while WhatsApp reviews the edit.');
  }
  const { nextAllowedAt, usedLast30Days } = template.editLimits;
  if (nextAllowedAt) {
    const when = nextAllowedAt.toLocaleString('en-IN', { timeZone: DEFAULT_TZ, dateStyle: 'medium', timeStyle: 'short' });
    throw new HttpError(429, usedLast30Days >= 10
      ? `WhatsApp allows only 10 edits in 30 days. You can edit this template again after ${when}.`
      : `WhatsApp allows only 1 edit of an approved template per 24 hours. You can edit it again after ${when}.`);
  }

  const before = { header: template.header, body: template.body, footer: template.footer };
  const { variableDefaults, ...text } = data;
  Object.assign(template, text);
  template.variableDefaults = fitDefaults(variableDefaults ?? template.variableDefaults, template.body);
  await editTemplateRemote(req.tenantId, template);
  template.previousVersion = before;
  template.approvedEdits.push(new Date());
  template.status = 'pending';
  template.rejectionReason = undefined;
  await template.save();
  await audit(req, 'template.edit_approved', { targetType: 'Template', targetId: template._id, meta: { before } });
  res.json(template);
});

// Change only the variable defaults. CRM-only data: no WhatsApp review, works for any status (also approved / pending).
router.put('/:id/variables', authorize('admin'), async (req, res) => {
  const { variableDefaults } = validate(z.object({ variableDefaults: z.array(variableDefault).max(20) }), req.body);
  const template = await Template.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!template) throw notFound('Template not found');
  template.variableDefaults = fitDefaults(variableDefaults, template.body);
  await template.save();
  res.json(template);
});

router.delete('/:id', authorize('admin'), async (req, res) => {
  const template = await Template.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!template) throw notFound('Template not found');
  if (await Campaign.exists({ templateId: template._id, status: { $in: ['scheduled', 'running', 'paused'] } })) {
    throw conflict('Template is used by an active campaign');
  }
  if (template.metaTemplateId) await deleteTemplateRemote(req.tenantId, template.name);
  await template.deleteOne();
  await audit(req, 'template.delete', { targetType: 'Template', targetId: template._id, meta: { name: template.name } });
  res.json({ ok: true });
});

export default router;
