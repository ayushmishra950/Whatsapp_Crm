import mongoose from 'mongoose';

/**
 * A post the business wrote in the CRM for its Facebook Page and/or Instagram account.
 * One row per post; `targets` holds what happened on each platform.
 */
const targetSchema = new mongoose.Schema(
  {
    platform: { type: String, enum: ['facebook', 'instagram'], required: true },
    status: { type: String, enum: ['pending', 'publishing', 'posted', 'failed'], default: 'pending' },
    externalId: String, // Facebook post id / Instagram media id
    containerId: String, // Instagram: media container being processed
    permalink: String,
    error: String,
    attempts: { type: Number, default: 0 },
    postedAt: Date,
  },
  { _id: false }
);

const socialPostSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    text: { type: String, default: '' },
    link: { type: String, default: '' }, // Facebook only (link preview)
    // Photos (1–10) or one video, kept on Cloudinary / this server (public link)
    media: [{ url: String, type: { type: String, enum: ['image', 'video'] }, mimeType: String, fileName: String, _id: false }],
    targets: { type: [targetSchema], default: [] },
    // scheduled = waits for scheduledAt; publishing = the worker is on it; posted / partial / failed when done
    status: { type: String, enum: ['scheduled', 'publishing', 'posted', 'partial', 'failed', 'deleted'], default: 'scheduled' },
    scheduledAt: { type: Date, default: Date.now },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    commentCount: { type: Number, default: 0 },
    unreadComments: { type: Number, default: 0 },
  },
  { timestamps: true }
);

socialPostSchema.index({ tenantId: 1, createdAt: -1 });
socialPostSchema.index({ status: 1, scheduledAt: 1 });
socialPostSchema.index({ tenantId: 1, 'targets.externalId': 1 });

export default mongoose.model('SocialPost', socialPostSchema);
