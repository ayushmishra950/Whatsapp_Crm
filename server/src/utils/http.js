export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new HttpError(400, msg, details);
export const unauthorized = (msg = 'Unauthorized') => new HttpError(401, msg);
export const forbidden = (msg = 'Forbidden') => new HttpError(403, msg);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);
export const conflict = (msg) => new HttpError(409, msg);

// Validate req[source] against a zod schema and return the parsed value
export function validate(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw badRequest(details[0]?.message ? `${details[0].path || 'input'}: ${details[0].message}` : 'Invalid input', details);
  }
  return result.data;
}

export function paginate(query) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  return { page, limit, skip: (page - 1) * limit };
}

export const escapeRegex = (s = '') => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Normalize to E.164 digits without "+" (WhatsApp Cloud API format), e.g. "+91 98765-43210" -> "919876543210"
export function normalizePhone(raw = '') {
  return String(raw).replace(/\D/g, '').replace(/^00/, '');
}
