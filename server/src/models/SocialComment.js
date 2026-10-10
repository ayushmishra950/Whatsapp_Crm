import mongoose from 'mongoose';

/**
 * A comment on one of the business's Facebook Page / Instagram posts (from a webhook or fetched),
 * or a reply the team sent from the CRM (fromBusiness).
 */
const socialCommentSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    platform: { type: String, enum: ['facebook', 'instagram'], required: true },
    externalId: { type: String, required: true }, // comment id on Facebook / Instagram
    postExternalId: String, // the post / media it is on
    socialPostId: { type: mongoose.Schema.Types.ObjectId, ref: 'SocialPost' }, // when the post was made in the CRM
    parentExternalId: String, // reply to another comment
    from: { id: String, name: String, username: String },
    text: { type: String, default: '' },
    at: { type: Date, default: Date.now }, // when it was written
    fromBusiness: { type: Boolean, default: false }, // the business's own reply
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    hidden: { type: Boolean, default: false },
    deletedAt: Date,
    readAt: Date,
    privateReplyAt: Date, // a private message (DM) was sent about this comment
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact' }, // lead made from this comment
  },
  { timestamps: true }
);

socialCommentSchema.index({ tenantId: 1, platform: 1, externalId: 1 }, { unique: true });
socialCommentSchema.index({ tenantId: 1, at: -1 });
socialCommentSchema.index({ tenantId: 1, socialPostId: 1, at: 1 });
socialCommentSchema.index({ tenantId: 1, readAt: 1, fromBusiness: 1 });

export default mongoose.model('SocialComment', socialCommentSchema);
