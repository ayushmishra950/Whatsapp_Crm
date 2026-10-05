import mongoose from 'mongoose';

export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'converted', 'lost'];

const contactSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    name: { type: String, trim: true, default: '' },
    phone: { type: String, required: true, trim: true }, // digits only, with country code
    email: { type: String, trim: true, lowercase: true },
    tags: { type: [String], default: [] },
    customFields: { type: Map, of: String, default: {} },
    leadStatus: { type: String, enum: LEAD_STATUSES, default: 'new' },
    source: { type: String, default: 'manual' }, // manual | import | whatsapp
    notes: { type: String, default: '' },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    optedOut: { type: Boolean, default: false },
    optedOutAt: Date,
    lastMessageAt: Date,
  },
  { timestamps: true }
);

contactSchema.index({ tenantId: 1, phone: 1 }, { unique: true });
contactSchema.index({ tenantId: 1, tags: 1 });
contactSchema.index({ tenantId: 1, createdAt: -1 });

export default mongoose.model('Contact', contactSchema);
