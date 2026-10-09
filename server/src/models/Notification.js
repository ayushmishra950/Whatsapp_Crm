import mongoose from 'mongoose';

/** In-app alert for one team member (bell icon): hot lead, overdue task, reply during a drip… */
const notificationSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, default: 'info' }, // hot | task | overdue | reply | status | report | info
    title: { type: String, required: true },
    body: { type: String, default: '' },
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact' },
    taskId: { type: mongoose.Schema.Types.ObjectId, ref: 'Task' },
    key: { type: String, default: '' }, // same alert at most once a day (e.g. "storage:usage")
    readAt: Date,
  },
  { timestamps: true }
);

notificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 60 }); // keep 60 days

export default mongoose.model('Notification', notificationSchema);
