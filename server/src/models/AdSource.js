import mongoose from 'mongoose';

/**
 * A Facebook / Instagram "Click to WhatsApp" ad that brought leads. Created automatically from the
 * webhook "referral"; the admin gives it a friendly name and a tag that every lead from it gets.
 */
const adSourceSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    sourceId: { type: String, required: true }, // Meta ad id
    sourceType: String,
    headline: String,
    sourceUrl: String,
    name: { type: String, trim: true, default: '' }, // e.g. "Video Editing – Oct"
    tag: { type: String, trim: true, lowercase: true, default: '' }, // added to every lead from this ad
    courseCode: { type: String, trim: true, uppercase: true, default: '' }, // course this ad is for
    firstSeenAt: Date,
    lastLeadAt: Date,
  },
  { timestamps: true }
);

adSourceSchema.index({ tenantId: 1, sourceId: 1 }, { unique: true });

export default mongoose.model('AdSource', adSourceSchema);
