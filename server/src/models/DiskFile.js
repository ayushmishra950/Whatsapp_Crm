import mongoose from 'mongoose';

/**
 * A chat file kept on this server's disk because the cloud upload (Cloudinary) failed.
 * The storage worker retries it; once uploaded, the disk copy is deleted and this record goes.
 * status "failed" = will not upload by itself (e.g. over the plan's size limit): the admin decides.
 */
const diskFileSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    messageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact' },
    path: { type: String, required: true }, // relative to server/uploads, e.g. "<tenantId>/ab12….pdf"
    fileName: { type: String, default: '' },
    mimeType: { type: String, default: '' },
    size: { type: Number, default: 0 },
    direction: { type: String, enum: ['sent', 'received'], default: 'sent' },
    status: { type: String, enum: ['pending', 'failed'], default: 'pending' },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: '' },
    nextTryAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);

diskFileSchema.index({ status: 1, nextTryAt: 1 });

export default mongoose.model('DiskFile', diskFileSchema);
