/** Template helpers (same rules as the web) */
export type VariableDefault = { source: 'field' | 'static'; value: string; example?: string };
export type Template = {
  _id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  header?: string;
  body: string;
  footer?: string;
  buttons?: { type: string; text: string; url?: string; phone?: string }[];
  variableDefaults?: VariableDefault[];
  rejectionReason?: string;
};

export const countVariables = (body = '') => new Set(body.match(/\{\{(\d+)\}\}/g) || []).size;

/** One default per {{n}} (first = contact name, others = text filled per message) */
export function fitVariableDefaults(defaults: VariableDefault[] = [], body = ''): VariableDefault[] {
  return Array.from({ length: countVariables(body) }, (_, i) => defaults[i] || (i === 0 ? { source: 'field', value: 'name' } : { source: 'static', value: '' }));
}

export const contactFieldValue = (contact: any, field: string) => {
  if (!contact || !field) return '';
  if (field.startsWith('custom.')) return contact.customFields?.[field.slice(7)] || '';
  return contact[field] || '';
};

/** Values for one contact (chat): contact fields filled in, fixed text from the template */
export const paramsForContact = (t: Template | undefined, contact: any) =>
  fitVariableDefaults(t?.variableDefaults, t?.body).map((d) => (d.source === 'field' ? String(contactFieldValue(contact, d.value) || '') : d.value || ''));

export const renderBody = (body = '', params: string[] = []) => body.replace(/\{\{(\d+)\}\}/g, (m, n) => params[Number(n) - 1] || m);

export const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  phone: 'Phone',
  email: 'Email',
  'course.name': 'Course name',
  'business.name': 'Business name',
};
