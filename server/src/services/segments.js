import mongoose from 'mongoose';
import { z } from 'zod';
import { escapeRegex } from '../utils/http.js';
import { DEFAULT_TZ, dayKey, safeTimeZone, zonedTime } from '../utils/time.js';

/**
 * "Smart audience": one filter shape used by Contacts, bulk campaigns, drips and saved segments.
 * Every part is optional; parts are combined with AND.
 */
const range = z
  .object({
    preset: z.enum(['', '7d', '14d', '30d', '90d', '180d', '365d', 'custom']).default(''),
    from: z.string().optional(), // YYYY-MM-DD (custom)
    to: z.string().optional(),
  })
  .partial();

export const segmentFilterSchema = z
  .object({
    statuses: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    tagMatch: z.enum(['any', 'all']).default('any'),
    excludeTags: z.array(z.string()).default([]),
    adIds: z.array(z.string()).default([]),
    sources: z.array(z.enum(['whatsapp', 'ad', 'import', 'manual'])).default([]),
    joined: range.default({}), // first contact (contact created)
    lastInbound: range.default({}), // last message FROM the customer
    fields: z
      .array(z.object({ key: z.string().min(1), op: z.enum(['is', 'contains', 'empty', 'not_empty']).default('is'), value: z.string().default('') }))
      .max(10)
      .default([]),
    // Date fields (birthday / anniversary): month and day only
    dateMatch: z.object({ field: z.string().default(''), when: z.enum(['', 'today', 'tomorrow', 'this_week', 'this_month', 'next_month']).default('') }).default({}),
    referred: z.enum(['', 'yes', 'no']).default(''),
  })
  .partial();

const DAYS = { '7d': 7, '14d': 14, '30d': 30, '90d': 90, '180d': 180, '365d': 365 };

function rangeQuery(r, tz) {
  if (!r?.preset) return null;
  if (r.preset !== 'custom') return { $gte: new Date(Date.now() - DAYS[r.preset] * 864e5) };
  const q = {};
  // Whole days in the business time zone (approximation: midnight UTC offset of that zone)
  const start = (d) => zonedTime(d, '00:00', tz);
  if (r.from) q.$gte = start(r.from);
  if (r.to) q.$lt = new Date(start(r.to).getTime() + 864e5);
  return Object.keys(q).length ? q : null;
}

// MM-DD strings for "today", "this week"... in the business time zone
export function monthDays(when, tz = DEFAULT_TZ) {
  const today = dayKey(new Date(), tz); // YYYY-MM-DD
  const base = new Date(`${today}T00:00:00Z`);
  const md = (offset) => new Date(base.getTime() + offset * 864e5).toISOString().slice(5, 10);
  if (when === 'today') return [md(0)];
  if (when === 'tomorrow') return [md(1)];
  if (when === 'this_week') return Array.from({ length: 7 }, (_, i) => md(i));
  if (when === 'this_month' || when === 'next_month') {
    let y = base.getUTCFullYear();
    let m = base.getUTCMonth() + (when === 'next_month' ? 1 : 0);
    if (m > 11) { m = 0; y += 1; }
    const mm = String(m + 1).padStart(2, '0');
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return Array.from({ length: last }, (_, i) => `${mm}-${String(i + 1).padStart(2, '0')}`);
  }
  return [];
}

const fieldPath = (key) => (key.startsWith('custom.') ? `customFields.${key.slice(7)}` : key);
const ALLOWED_FIELDS = new Set(['name', 'email', 'phone']);

/** Mongo filter for a segment. Opted-out contacts are not excluded here (campaigns add that). */
export function segmentQuery(tenantId, rawFilter = {}, tz = DEFAULT_TZ) {
  const f = segmentFilterSchema.parse(rawFilter || {});
  const zone = safeTimeZone(tz);
  const and = [{ tenantId: new mongoose.Types.ObjectId(String(tenantId)) }];
  if (f.statuses?.length) and.push({ leadStatus: { $in: f.statuses } });
  if (f.tags?.length) and.push({ tags: f.tagMatch === 'all' ? { $all: f.tags } : { $in: f.tags } });
  if (f.excludeTags?.length) and.push({ tags: { $nin: f.excludeTags } });
  if (f.adIds?.length) and.push({ 'adSource.sourceId': { $in: f.adIds } });
  if (f.sources?.length) and.push({ source: { $in: f.sources } });
  const joined = rangeQuery(f.joined, zone);
  if (joined) and.push({ createdAt: joined });
  const inbound = rangeQuery(f.lastInbound, zone);
  if (inbound) and.push({ lastInboundAt: inbound });
  for (const cond of f.fields || []) {
    if (!cond.key.startsWith('custom.') && !ALLOWED_FIELDS.has(cond.key)) continue;
    const path = fieldPath(cond.key);
    if (cond.op === 'empty') and.push({ $or: [{ [path]: { $exists: false } }, { [path]: '' }] });
    else if (cond.op === 'not_empty') and.push({ [path]: { $nin: [null, ''] } });
    else if (cond.value.trim()) {
      const v = escapeRegex(cond.value.trim());
      and.push({ [path]: { $regex: cond.op === 'contains' ? v : `^${v}$`, $options: 'i' } });
    }
  }
  if (f.dateMatch?.field && f.dateMatch.when) {
    const days = monthDays(f.dateMatch.when, zone);
    and.push({ [fieldPath(f.dateMatch.field)]: { $regex: `-(${days.join('|')})$` } });
  }
  if (f.referred === 'yes') and.push({ referredBy: { $ne: null } });
  if (f.referred === 'no') and.push({ referredBy: null });
  return and.length === 1 ? and[0] : { $and: and };
}

// Readable one-line summary of a filter ("Interested · tags php · joined last 30 days")
export function describeSegment(rawFilter = {}) {
  const f = segmentFilterSchema.parse(rawFilter || {});
  const parts = [];
  if (f.statuses?.length) parts.push(`status ${f.statuses.join('/')}`);
  if (f.tags?.length) parts.push(`tags ${f.tags.join(f.tagMatch === 'all' ? ' + ' : ' / ')}`);
  if (f.excludeTags?.length) parts.push(`not ${f.excludeTags.join('/')}`);
  if (f.adIds?.length) parts.push(`${f.adIds.length} ad(s)`);
  if (f.joined?.preset) parts.push(`joined ${f.joined.preset === 'custom' ? 'custom dates' : `last ${f.joined.preset}`}`);
  if (f.lastInbound?.preset) parts.push(`messaged ${f.lastInbound.preset === 'custom' ? 'custom dates' : `last ${f.lastInbound.preset}`}`);
  return parts.join(' · ') || 'all contacts';
}
