"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, MessageCircle, Phone, PhoneCall } from "lucide-react";
import { api } from "@/lib/api";
import { fmtPhone, displayName } from "@/lib/format";
import { useToast } from "./toast";
import { CallLogModal } from "./leads";
import { Button, Field, Input, Modal, cx } from "./ui";

const at = (days, hh = 11) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hh, 0, 0, 0);
  return d;
};
const QUICK = [
  ["Later today (5 pm)", () => { const d = new Date(); d.setHours(17, 0, 0, 0); return d > new Date() ? d : at(1, 11); }],
  ["Tomorrow 11 am", () => at(1)],
  ["In 3 days", () => at(3)],
  ["Next week", () => at(7)],
];
// <input type="datetime-local"> value in the user's own time zone
const toLocal = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

/** Call / WhatsApp chat / log call buttons for one lead (one tap from any list) */
export function LeadActions({ contact, onChanged, compact }) {
  const toast = useToast();
  const router = useRouter();
  const [calling, setCalling] = useState(false);
  if (!contact?._id) return null;
  const chat = async () => {
    try {
      const conv = await api("/conversations/start", { method: "POST", body: { contactId: contact._id } });
      router.push(`/app/inbox?c=${conv._id}`);
    } catch (err) {
      toast.error(err);
    }
  };
  const size = compact ? "!h-7 !px-2 text-xs" : "";
  return (
    <div className="flex flex-wrap items-center gap-1">
      {contact.phone && (
        <a href={`tel:+${contact.phone}`} title={`Call ${fmtPhone(contact.phone)}`}>
          <Button size="sm" variant="secondary" className={size}><Phone className="h-3.5 w-3.5 text-green-600" /> Call</Button>
        </a>
      )}
      <Button size="sm" variant="secondary" className={size} onClick={chat} title={contact.phone ? "Open the chat" : "Open the Instagram chat"}><MessageCircle className={`h-3.5 w-3.5 ${contact.phone ? "text-brand-600" : "text-pink-600"}`} /> Chat</Button>
      <Button size="sm" variant="ghost" className={size} onClick={() => setCalling(true)} title="Save what happened on the call"><PhoneCall className="h-3.5 w-3.5" /> Log call</Button>
      <CallLogModal open={calling} onClose={() => setCalling(false)} contact={contact} onSaved={(c) => onChanged?.(c)} />
    </div>
  );
}

/**
 * After a task is done (or a call / fee follow-up): "When is the next follow-up?" — one tap for the usual times.
 * Creates a task for the same lead. onClose(created) is called either way.
 */
export function NextFollowUpModal({ contact, defaultTitle = "Follow up", onClose }) {
  const toast = useToast();
  const [title, setTitle] = useState(defaultTitle);
  const [when, setWhen] = useState(() => toLocal(at(1)));
  const [busy, setBusy] = useState(false);
  if (!contact) return null;
  const save = async (date) => {
    setBusy(true);
    try {
      await api("/tasks", { method: "POST", body: { contactId: contact._id, title: title.trim() || "Follow up", dueAt: date.toISOString(), kind: "followup" } });
      toast.success(`Next follow-up set: ${date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`);
      onClose(true);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={() => onClose(false)} title={`✅ Done! Next follow-up for ${displayName(contact)}?`} size="sm"
      footer={<><Button variant="ghost" onClick={() => onClose(false)}>No follow-up needed</Button><Button loading={busy} onClick={() => save(new Date(when))}><CalendarClock className="h-4 w-4" /> Set follow-up</Button></>}>
      <div className="space-y-3">
        <p className="text-xs text-slate-500">Every open lead should have a next step — otherwise it shows in “No next action”.</p>
        <Field label="What to do"><Input maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-1.5">
          {QUICK.map(([label, fn]) => (
            <button key={label} type="button" disabled={busy} onClick={() => save(fn())} className={cx("rounded-md border border-slate-200 px-2 py-2 text-sm text-slate-700 hover:border-brand-400 hover:bg-brand-50")}>{label}</button>
          ))}
        </div>
        <Field label="Or pick a date & time"><Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
