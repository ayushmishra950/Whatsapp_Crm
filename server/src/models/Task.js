import mongoose from 'mongoose';

/** Something a person must do for a lead: call, call back, mark demo attendance… */
const taskSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact', required: true },
    title: { type: String, required: true, trim: true },
    kind: { type: String, enum: ['call', 'callback', 'demo', 'followup', 'other'], default: 'call' },
    dueAt: { type: Date, required: true },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // empty = admins
    status: { type: String, enum: ['open', 'done', 'cancelled'], default: 'open' },
    note: { type: String, default: '' },
    source: { type: String, enum: ['manual', 'automation'], default: 'manual' },
    sourceName: { type: String, default: '' }, // e.g. drip / rule name
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    doneAt: Date,
    doneBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    overdueAlertedAt: Date,
  },
  { timestamps: true }
);

taskSchema.index({ tenantId: 1, status: 1, dueAt: 1 });
taskSchema.index({ tenantId: 1, assignedTo: 1, status: 1 });
taskSchema.index({ contactId: 1, status: 1 });
taskSchema.index({ status: 1, dueAt: 1, overdueAlertedAt: 1 });

export default mongoose.model('Task', taskSchema);
