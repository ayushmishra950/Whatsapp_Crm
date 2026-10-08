import mongoose from 'mongoose';

const variableSchema = { _id: false, source: { type: String, enum: ['field', 'static'], default: 'static' }, value: { type: String, default: '' } };

const stepSchema = new mongoose.Schema(
  {
    // message = send a template · task = create a task for the lead's counsellor · alert = notify them · status = change status
    kind: { type: String, enum: ['message', 'task', 'alert', 'status'], default: 'message' },
    templateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Template' },
    // Optional Hinglish version: sent to leads whose language is Hinglish
    templateIdHi: { type: mongoose.Schema.Types.ObjectId, ref: 'Template' },
    variablesHi: { type: [variableSchema], default: [] },
    text: { type: String, default: '' }, // task title / alert text
    dueMinutes: { type: Number, default: 30 }, // task: due this long after the step runs
    setStatus: { type: String, default: '' }, // status step
    delayMinutes: { type: Number, default: 0 }, // extra wait on top of delayDays, e.g. +2 hours = 120
    variables: { type: [variableSchema], default: [] },
    delayDays: { type: Number, default: 0, min: 0, max: 365 }, // after the previous step (first step: after joining)
    sendTime: { type: String, default: '' }, // "HH:MM" in the business time zone, empty = as soon as due
  },
  { _id: true }
);

/**
 * Drip / automation: a series of WhatsApp templates sent over days to contacts who enter it.
 * trigger.type:
 *   new_lead       a new contact is created (optionally only from some sources)
 *   ad_lead        a new lead from Click-to-WhatsApp ads (optionally only some ads)
 *   tag_added      one of trigger.tags is added to a contact
 *   status_changed the lead status changes to one of trigger.statuses
 *   date           every year on a date field (birthday / anniversary), offsetDays before (-) or after (+)
 *   manual         contacts are added by the admin (from Contacts or a filter)
 */
const dripSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    name: { type: String, required: true, trim: true },
    status: { type: String, enum: ['draft', 'active', 'paused'], default: 'draft' },
    trigger: {
      type: { type: String, enum: ['new_lead', 'ad_lead', 'tag_added', 'status_changed', 'date', 'manual'], required: true },
      sources: { type: [String], default: [] }, // new_lead: whatsapp | ad | import | manual (empty = all)
      adIds: { type: [String], default: [] }, // ad_lead (empty = any ad)
      tags: { type: [String], default: [] }, // tag_added
      statuses: { type: [String], default: [] }, // status_changed
      field: { type: String, default: '' }, // date: "custom.<key>" of a date field
      offsetDays: { type: Number, default: 0, min: -30, max: 30 },
    },
    // Extra condition a contact must meet to enter (same shape as a segment filter), optional
    condition: { type: mongoose.Schema.Types.Mixed, default: {} },
    steps: { type: [stepSchema], default: [] },
    // When a contact leaves the drip early
    stopOnReply: { type: Boolean, default: true },
    stopStatuses: { type: [String], default: [] }, // e.g. converted, lost
    // "One status = one drip": any status change ends this drip (default on, off for birthday / manual drips)
    stopOnStatusChange: { type: Boolean, default: true },
    // When the last step is done: move the lead on / tag them (e.g. Day 10 -> Nurture – Later)
    onComplete: { setStatus: { type: String, default: '' }, addTag: { type: String, default: '' } },
    activatedAt: Date,
    lastDateScan: String, // YYYY-MM-DD of the last birthday/anniversary scan
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, minimize: false }
);

export default mongoose.model('Drip', dripSchema);
