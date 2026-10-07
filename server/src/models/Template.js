import mongoose from 'mongoose';

const templateSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    name: { type: String, required: true, trim: true }, // lowercase_with_underscores (Meta rule)
    language: { type: String, default: 'en' },
    category: { type: String, enum: ['MARKETING', 'UTILITY', 'AUTHENTICATION'], default: 'MARKETING' },
    header: { type: String, default: '' },
    body: { type: String, required: true }, // supports {{1}}, {{2}} ...
    footer: { type: String, default: '' },
    status: { type: String, enum: ['draft', 'pending', 'approved', 'rejected'], default: 'draft' },
    rejectionReason: String,
    metaTemplateId: String,
    // CRM-only defaults for {{1}}, {{2}} ... (never sent to Meta as template content, so they can change any time).
    // Bulk campaigns and the inbox start with these; example = sample value shown to Meta during review.
    variableDefaults: {
      type: [{ _id: false, source: { type: String, enum: ['field', 'static'], default: 'static' }, value: { type: String, default: '' }, example: { type: String, default: '' } }],
      default: [],
    },
    // Edits of an already approved template (Meta allows 1 per 24h, 10 per 30 days)
    approvedEdits: { type: [Date], default: [] },
    // Last approved text, kept when an approved template is edited (shown while the edit is in review)
    previousVersion: { header: String, body: String, footer: String },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

templateSchema.index({ tenantId: 1, name: 1, language: 1 }, { unique: true });

// Number of {{n}} placeholders in body.
// body is missing when a template is populated with only some fields (e.g. populate('templateId', 'name')).
templateSchema.virtual('variableCount').get(function () {
  if (typeof this.body !== 'string') return undefined;
  const matches = this.body.match(/\{\{(\d+)\}\}/g) || [];
  return new Set(matches).size;
});
// Can this approved template be edited right now? (Meta limits)
export const EDIT_LIMIT_DAY_MS = 24 * 60 * 60 * 1000;
export const EDIT_LIMIT_30_DAYS = 10;
templateSchema.virtual('editLimits').get(function () {
  if (!Array.isArray(this.approvedEdits)) return undefined;
  const now = Date.now();
  const last30 = this.approvedEdits.filter((d) => now - new Date(d) < 30 * EDIT_LIMIT_DAY_MS).sort((a, b) => a - b);
  const last = last30.at(-1);
  const dayWait = last && now - new Date(last) < EDIT_LIMIT_DAY_MS ? new Date(new Date(last).getTime() + EDIT_LIMIT_DAY_MS) : null;
  const monthWait = last30.length >= EDIT_LIMIT_30_DAYS ? new Date(new Date(last30[0]).getTime() + 30 * EDIT_LIMIT_DAY_MS) : null;
  const nextAllowedAt = [dayWait, monthWait].filter(Boolean).sort((a, b) => b - a)[0] || null;
  return { usedLast30Days: last30.length, remaining: Math.max(0, EDIT_LIMIT_30_DAYS - last30.length), nextAllowedAt };
});
templateSchema.set('toJSON', { virtuals: true });

export default mongoose.model('Template', templateSchema);
