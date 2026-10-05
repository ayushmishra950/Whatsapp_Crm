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
templateSchema.set('toJSON', { virtuals: true });

export default mongoose.model('Template', templateSchema);
