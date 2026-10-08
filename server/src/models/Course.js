import mongoose from 'mongoose';

/**
 * A course the business sells (Course catalog). Drives the chatbot, drip variables
 * ({{course}}, {{outcome}}, {{batch_date}}…) and reports by course.
 */
const courseSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    code: { type: String, required: true, trim: true, uppercase: true }, // short id, e.g. DM, AIML
    name: { type: String, required: true, trim: true },
    category: { type: String, trim: true, default: '' },
    triggerWords: { type: [String], default: [] }, // words in a message that mean this course
    outcome: { type: String, default: '' }, // one line: what they'll be able to do
    who: { type: String, default: '' }, // who it's for
    learn: { type: String, default: '' }, // what they learn
    internshipLine: { type: String, default: '' },
    greetingEn: { type: String, default: '' },
    greetingHi: { type: String, default: '' },
    feesEn: { type: String, default: '' },
    feesHi: { type: String, default: '' },
    feeAmount: { type: Number, default: 0 }, // ₹ (for per-day fee)
    durationDays: { type: Number, default: 0 },
    nextBatchDate: { type: String, default: '' }, // YYYY-MM-DD
    proofLink: { type: String, default: '' },
    pageUrl: { type: String, default: '' }, // course page on the website (sent by the chatbot / {{course.link}})
    packageCode: { type: String, default: '' }, // bigger course to suggest (package nudge)
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

courseSchema.index({ tenantId: 1, code: 1 }, { unique: true });

// Fee per day of the course, e.g. "₹150" (empty when unknown)
courseSchema.virtual('perDay').get(function () {
  return this.feeAmount > 0 && this.durationDays > 0 ? `₹${Math.round(this.feeAmount / this.durationDays).toLocaleString('en-IN')}` : '';
});
courseSchema.set('toJSON', { virtuals: true });

export default mongoose.model('Course', courseSchema);
