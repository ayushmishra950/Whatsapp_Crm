import mongoose from 'mongoose';

const campaignSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    name: { type: String, required: true, trim: true },
    templateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Template', required: true },
    audience: {
      // all | tags | status (lead status) | ads (leads from Facebook/Instagram ads) | contacts (picked)
      type: { type: String, enum: ['all', 'tags', 'status', 'ads', 'contacts', 'filter'], required: true },
      tags: [String],
      leadStatuses: [String],
      adIds: [String],
      contactIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Contact' }],
      // type 'filter': smart filter (see services/segments.js); segmentName = saved segment it came from
      filter: { type: mongoose.Schema.Types.Mixed },
      segmentName: String,
    },
    // One entry per {{n}}: either a contact field ("name", "phone", "email", "custom.<key>") or static text
    variables: [
      {
        source: { type: String, enum: ['field', 'static'], default: 'static' },
        value: { type: String, default: '' },
      },
    ],
    status: {
      type: String,
      enum: ['draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled', 'failed'],
      default: 'draft',
    },
    scheduledAt: Date,
    pauseReason: String,
    startedAt: Date,
    completedAt: Date,
    stats: {
      total: { type: Number, default: 0 },
      sent: { type: Number, default: 0 },
      delivered: { type: Number, default: 0 },
      read: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      skipped: { type: Number, default: 0 },
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

campaignSchema.index({ status: 1, scheduledAt: 1 });

export default mongoose.model('Campaign', campaignSchema);
