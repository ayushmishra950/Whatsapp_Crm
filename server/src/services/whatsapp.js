/**
 * WhatsApp Cloud API wrapper.
 * Each tenant is either:
 *  - "live": real Meta Cloud API calls with the tenant's phoneNumberId + access token
 *  - "mock": sandbox that fakes Meta responses and fires fake delivered/read webhooks,
 *            so the whole CRM works before real credentials are available.
 */
import crypto from 'node:crypto';
import axios from 'axios';
import { env } from '../config/env.js';
import { Tenant } from '../models/index.js';
import { decrypt } from '../utils/crypto.js';
import { HttpError } from '../utils/http.js';

const graphUrl = (path) => `https://graph.facebook.com/${env.whatsapp.graphVersion}/${path}`;

export async function loadTenantCredentials(tenantId) {
  const tenant = await Tenant.findById(tenantId).select('+whatsapp.accessTokenEnc');
  if (!tenant) throw new HttpError(404, 'Business not found');
  const wa = tenant.whatsapp || {};
  return {
    mode: wa.mode || 'mock',
    phoneNumberId: wa.phoneNumberId,
    wabaId: wa.wabaId,
    accessToken: wa.accessTokenEnc ? decrypt(wa.accessTokenEnc) : '',
  };
}

function toHttpError(err) {
  const meta = err.response?.data?.error;
  const message = meta?.error_user_msg || meta?.message || err.message;
  return new HttpError(502, `WhatsApp API error: ${message}`, meta);
}

async function graph(creds, method, path, data, extra = {}) {
  try {
    const res = await axios({
      method,
      url: graphUrl(path),
      data,
      headers: { Authorization: `Bearer ${creds.accessToken}`, ...(extra.headers || {}) },
      responseType: extra.responseType,
      timeout: 20000,
    });
    return res.data;
  } catch (err) {
    throw toHttpError(err);
  }
}

// ---------- Mock helpers ----------

const mockId = () => `wamid.MOCK.${crypto.randomBytes(12).toString('hex')}`;

function simulateStatuses(tenantId, waMessageId) {
  const fire = (status, delay) =>
    setTimeout(async () => {
      const { processStatus } = await import('./webhookProcessor.js');
      processStatus(tenantId, { id: waMessageId, status }).catch((e) => console.error('[mock] status error', e.message));
    }, delay);
  fire('delivered', 1500);
  fire('read', 4000);
}

function mockSend(tenantId, to) {
  if (!/^\d{8,15}$/.test(to)) throw new HttpError(400, 'Invalid phone number (use country code, e.g. 919876543210)');
  const id = mockId();
  simulateStatuses(tenantId, id);
  return { id };
}

// ---------- Sending ----------

// contextId = WhatsApp id of the message being quoted (reply)
async function sendPayload(tenantId, to, payload, contextId) {
  const creds = await loadTenantCredentials(tenantId);
  if (creds.mode === 'mock') return mockSend(tenantId, to);
  const data = await graph(creds, 'post', `${creds.phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    ...(contextId && { context: { message_id: contextId } }),
    ...payload,
  });
  return { id: data.messages?.[0]?.id };
}

export const sendText = (tenantId, to, text, { contextId } = {}) =>
  sendPayload(tenantId, to, { type: 'text', text: { body: text, preview_url: true } }, contextId);

export function sendTemplate(tenantId, to, { name, language, params = [] }, { contextId } = {}) {
  const components = params.length
    ? [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: String(p ?? '') })) }]
    : [];
  return sendPayload(tenantId, to, { type: 'template', template: { name, language: { code: language }, components } }, contextId);
}

/**
 * Menu message. kind "buttons": up to 3 reply buttons (title <= 20 chars).
 * kind "list": up to 10 rows (title <= 24, description <= 72) behind a button (label <= 20).
 */
export function sendInteractive(tenantId, to, { kind, body, buttonLabel, options }, { contextId } = {}) {
  const interactive =
    kind === 'buttons'
      ? {
          type: 'button',
          body: { text: body },
          action: { buttons: options.map((o) => ({ type: 'reply', reply: { id: o.id, title: o.title } })) },
        }
      : {
          type: 'list',
          body: { text: body },
          action: {
            button: buttonLabel || 'View options',
            sections: [{ title: 'Options', rows: options.map((o) => ({ id: o.id, title: o.title, ...(o.description && { description: o.description }) })) }],
          },
        };
  return sendPayload(tenantId, to, { type: 'interactive', interactive }, contextId);
}

// type: image | document | video | audio
export function sendMedia(tenantId, to, { type, waMediaId, caption, fileName }, { contextId } = {}) {
  const media = { id: waMediaId };
  if (caption && type !== 'audio') media.caption = caption;
  if (fileName && type === 'document') media.filename = fileName;
  return sendPayload(tenantId, to, { type, [type]: media }, contextId);
}

export async function uploadMedia(tenantId, { buffer, mimeType, fileName }) {
  const creds = await loadTenantCredentials(tenantId);
  if (creds.mode === 'mock') return { id: `MOCK_MEDIA_${crypto.randomBytes(6).toString('hex')}` };
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mimeType);
  form.append('file', new Blob([buffer], { type: mimeType }), fileName);
  const data = await graph(creds, 'post', `${creds.phoneNumberId}/media`, form);
  return { id: data.id };
}

// Downloads inbound media (live mode). Returns { buffer, mimeType }
export async function downloadMedia(tenantId, waMediaId) {
  const creds = await loadTenantCredentials(tenantId);
  if (creds.mode === 'mock') throw new HttpError(404, 'Media not available in mock mode');
  const info = await graph(creds, 'get', waMediaId);
  try {
    const res = await axios.get(info.url, {
      headers: { Authorization: `Bearer ${creds.accessToken}` },
      responseType: 'arraybuffer',
      timeout: 30000,
    });
    return { buffer: Buffer.from(res.data), mimeType: info.mime_type };
  } catch (err) {
    throw toHttpError(err);
  }
}

// ---------- Templates ----------

// Realistic sample values help Meta approve the template ("sample1" looks like a test)
const FIELD_EXAMPLES = { name: 'Rahul', phone: '919876543210', email: 'rahul@example.com' };
function exampleFor(def, i) {
  if (def?.example) return def.example;
  if (def?.source === 'static' && def.value) return def.value;
  if (def?.source === 'field' && def.value?.startsWith('custom.')) {
    const words = def.value.slice(7).replace(/_/g, ' ');
    return words.charAt(0).toUpperCase() + words.slice(1); // "custom.course_name" -> "Course name"
  }
  if (def?.source === 'field') return FIELD_EXAMPLES[def.value] || `sample${i + 1}`;
  return `sample${i + 1}`;
}

function templateComponents(template) {
  const variableCount = new Set(template.body.match(/\{\{(\d+)\}\}/g) || []).size;
  const components = [];
  if (template.header) components.push({ type: 'HEADER', format: 'TEXT', text: template.header });
  components.push({
    type: 'BODY',
    text: template.body,
    ...(variableCount && {
      example: { body_text: [Array.from({ length: variableCount }, (_, i) => exampleFor(template.variableDefaults?.[i], i))] },
    }),
  });
  if (template.footer) components.push({ type: 'FOOTER', text: template.footer });
  return components;
}

// Fake Meta review in sandbox mode: approve a few seconds later
function mockReview(id) {
  setTimeout(async () => {
    const { processTemplateStatus } = await import('./webhookProcessor.js');
    processTemplateStatus({ message_template_id: id, event: 'APPROVED' }).catch(() => {});
  }, 3000);
}

export async function submitTemplate(tenantId, template) {
  const creds = await loadTenantCredentials(tenantId);

  if (creds.mode === 'mock') {
    const id = `MOCK_TPL_${crypto.randomBytes(6).toString('hex')}`;
    mockReview(id);
    return { id, status: 'PENDING' };
  }

  const components = templateComponents(template);

  const data = await graph(creds, 'post', `${creds.wabaId}/message_templates`, {
    name: template.name,
    language: template.language,
    category: template.category,
    components,
  });
  return { id: data.id, status: data.status };
}

/**
 * Edit a template that already exists on Meta (approved or rejected). Name and language can never change;
 * category only while the template is rejected. Meta puts the template back into review.
 * Meta limits for approved templates: 1 edit per 24 hours, 10 per 30 days.
 */
export async function editTemplateRemote(tenantId, template, { includeCategory = false } = {}) {
  const creds = await loadTenantCredentials(tenantId);
  if (creds.mode === 'mock') {
    mockReview(template.metaTemplateId);
    return { success: true };
  }
  return graph(creds, 'post', template.metaTemplateId, {
    ...(includeCategory && { category: template.category }),
    components: templateComponents(template),
  });
}

export async function deleteTemplateRemote(tenantId, name) {
  const creds = await loadTenantCredentials(tenantId);
  if (creds.mode === 'mock') return;
  await graph(creds, 'delete', `${creds.wabaId}/message_templates?name=${encodeURIComponent(name)}`);
}

// Used when admin connects a live number: validates the credentials
export async function verifyCredentials({ phoneNumberId, accessToken }) {
  const data = await graph(
    { accessToken },
    'get',
    `${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`
  );
  return data;
}
