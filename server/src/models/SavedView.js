import mongoose from 'mongoose';

/** A named set of filters on a list page ("My hot leads today"). Private to its owner, or shared with the team by an admin. */
const savedViewSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    page: { type: String, enum: ['contacts'], default: 'contacts' },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    query: { type: mongoose.Schema.Types.Mixed, default: {} }, // the page's filter values
    shared: { type: Boolean, default: false },
  },
  { timestamps: true }
);

savedViewSchema.index({ tenantId: 1, page: 1, userId: 1 });

export default mongoose.model('SavedView', savedViewSchema);
