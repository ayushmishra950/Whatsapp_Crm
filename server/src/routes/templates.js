import { Router } from 'express';
import { z } from 'zod';
import { Template, Campaign } from '../models/index.js';
import { authorize } from '../middleware/auth.js';
import { validate, notFound, conflict, badRequest } from '../utils/http.js';
import { submitTemplate, deleteTemplateRemote } from '../services/whatsapp.js';
import { audit } from '../services/audit.js';

const router = Router();

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
  const language = data.language || 'en';
  if (await Template.exists({ tenantId: req.tenantId, name: data.name, language })) {
    throw conflict('A template with this name and language already exists');
  }
  const template = await Template.create({ ...data, language, tenantId: req.tenantId, createdBy: req.user._id });
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
  if (template.status === 'rejected') template.status = 'draft';
  await template.save();
  res.json(template);
});

router.post('/:id/submit', authorize('admin'), async (req, res) => {
  const template = await Template.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!template) throw notFound('Template not found');
  if (!['draft', 'rejected'].includes(template.status)) throw badRequest('Template is already submitted');
  const result = await submitTemplate(req.tenantId, template);
  template.metaTemplateId = result.id;
  template.status = result.status === 'APPROVED' ? 'approved' : 'pending';
  template.rejectionReason = undefined;
  await template.save();
  await audit(req, 'template.submit', { targetType: 'Template', targetId: template._id });
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
