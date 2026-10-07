import mongoose from 'mongoose';

/** One contact going through one drip. cycle = year for yearly date drips, '' otherwise (one run per contact). */
const dripEnrollmentSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    dripId: { type: mongoose.Schema.Types.ObjectId, ref: 'Drip', required: true },
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact', required: true },
    cycle: { type: String, default: '' },
    status: { type: String, enum: ['active', 'sending', 'completed', 'stopped'], default: 'active' },
    stepIndex: { type: Number, default: 0 }, // next step to send
    nextRunAt: Date,
    enrolledAt: { type: Date, default: Date.now },
    stoppedReason: String, // replied | status | opted_out | removed | drip_deleted | contact_deleted
    lastError: String,
    history: [
      {
        _id: false,
        step: Number,
        at: Date,
        status: String, // sent | failed | skipped
        messageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
        error: String,
      },
    ],
  },
  { timestamps: true }
);

dripEnrollmentSchema.index({ dripId: 1, contactId: 1, cycle: 1 }, { unique: true });
dripEnrollmentSchema.index({ status: 1, nextRunAt: 1 });
dripEnrollmentSchema.index({ tenantId: 1, contactId: 1, status: 1 });

export default mongoose.model('DripEnrollment', dripEnrollmentSchema);
