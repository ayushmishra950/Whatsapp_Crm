"use client";

import { useState } from "react";
import Link from "next/link";
import { Bot, Hand, X } from "lucide-react";
import { fmtPhone, fmtRelative, toLocalInput } from "@/lib/format";
import { instagramUrl } from "@/components/channel";
import { useIsCoaching } from "@/lib/business";
import { CustomFieldInputs, FollowUpChip, FollowUpMessage, LeadStatusSelect, ReferralBox, TagInput } from "@/components/shared";
import { Avatar, Badge, Button, Field, Input, Select, Textarea, cx } from "@/components/ui";
import { CallLogModal, CourseSelect, LANGUAGES, LeadTasks } from "@/components/leads";
import { FeesPanel } from "@/components/fees";

// ---------------- Contact panel ----------------

// <input type="datetime-local"> value in the user's own time zone
export function ContactPanel({ contact, conversation, team, me, tags, onClose, onUpdateContact, onContactReplaced, onUpdateConversation, onBotAction, botBusy }) {
  // Parent remounts this panel per contact (key), so initial state is enough
  const [notes, setNotes] = useState(contact.notes || "");
  const [name, setName] = useState(contact.name || "");
  const [customFields, setCustomFields] = useState(contact.customFields || {});
  const [fuAction, setFuAction] = useState(null); // "message" picked, template not chosen yet
  const [calling, setCalling] = useState(false);
  const coaching = useIsCoaching();

  return (
    <div className="p-4">
      {onClose && (
        <>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-medium text-slate-900">Contact details</h3>
            <div className="flex items-center gap-1">
              <Link href={`/app/contacts/${contact._id}`} className="rounded px-1.5 py-0.5 text-xs font-medium text-brand-700 hover:bg-brand-50" title="Lead page: details, full history and chat">Full page ↗</Link>
              <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="Close"><X className="h-4 w-4" /></button>
            </div>
          </div>
          <div className="mb-5 flex flex-col items-center text-center">
            <Avatar name={contact.name || contact.phone} className="mb-2 h-14 w-14 text-base" />
            {contact.phone && <p className="text-sm text-slate-500">{fmtPhone(contact.phone)}</p>}
            {contact.instagram?.username && (
              <a href={instagramUrl(contact)} target="_blank" rel="noreferrer" className="text-sm text-pink-700 hover:underline">@{contact.instagram.username}</a>
            )}
            <p className="text-xs text-slate-400">Source: {contact.source === "ad" ? "Facebook / Instagram ad" : contact.source === "instagram" ? "Instagram DM" : contact.source}</p>
          </div>
        </>
      )}
      {contact.adSource?.sourceId && (
        <div className="mb-4 rounded-md bg-violet-50 p-3 text-sm text-violet-900">
          <p className="text-xs font-medium text-violet-700">📣 Came from an ad</p>
          <p className="font-medium">{contact.adSource.headline || "Ad"}</p>
          <p className="text-xs break-all">Ad ID: {contact.adSource.sourceId}{contact.adSource.sourceUrl && <> · <a href={contact.adSource.sourceUrl} target="_blank" rel="noreferrer" className="underline">open ad</a></>}</p>
        </div>
      )}
      <div className="space-y-4">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== contact.name && onUpdateContact({ name })} />
        </Field>
        <CustomFieldInputs
          compact
          value={customFields}
          onChange={setCustomFields}
          onBlurField={(k, picked) => {
            // Save one field when leaving its box (dropdowns save right away; empty = delete the value)
            const before = contact.customFields?.[k] || "";
            const now = String(picked ?? customFields[k] ?? "").trim();
            if (now === before) return;
            const next = Object.fromEntries(Object.entries({ ...contact.customFields, [k]: now }).filter(([, v]) => v));
            onUpdateContact({ customFields: next });
          }}
        />
        <Field label="Lead status">
          <LeadStatusSelect value={contact.leadStatus} onChange={(v) => onUpdateContact({ leadStatus: v })} className="h-9 w-full text-sm" />
        </Field>
        {coaching && contact.courseInterest?.length > 0 && <CourseInterest list={contact.courseInterest} current={contact.course} />}
        {coaching && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Course">
            <CourseSelect className="h-9 w-full text-sm" value={contact.course} onChange={(v) => onUpdateContact({ course: v })} />
          </Field>
          <Field label="Language">
            <Select className="h-9 text-sm" value={contact.language || ""} onChange={(e) => onUpdateContact({ language: e.target.value })} title={contact.languageLocked ? "Set by your team" : "Detected from their messages"}>
              {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </Select>
          </Field>
        </div>
        )}
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-slate-500">Calls: {contact.callAttempts || 0}{contact.lastCallOutcome && ` · last: ${contact.lastCallOutcome.replace(/_/g, " ")}`}</span>
          <Button size="sm" variant="secondary" onClick={() => setCalling(true)}>📞 Log call</Button>
        </div>
        <LeadTasks contact={contact} />
        {coaching && <FeesPanel contactId={contact._id} compact />}
        <CallLogModal open={calling} onClose={() => setCalling(false)} contact={contact} onSaved={(c) => onContactReplaced?.(c)} />
        <Field label="Follow-up" hint="Reminder shows on the dashboard when it is due">
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input type="datetime-local" value={toLocalInput(contact.followUpAt)} onChange={(e) => onUpdateContact({ followUpAt: e.target.value ? new Date(e.target.value).toISOString() : null })} />
              {contact.followUpAt && <Button size="icon" variant="ghost" onClick={() => onUpdateContact({ followUpAt: null })} aria-label="Clear follow-up"><X className="h-4 w-4" /></Button>}
            </div>
            {contact.followUpAt && (
              <>
                <FollowUpMessage
                  value={{ ...contact, followUpAction: fuAction ?? contact.followUpAction }}
                  onChange={(patch) => {
                    // Turning "send message" on waits for a template before saving
                    if (patch.followUpAction === "message" && !contact.followUpTemplateId) return setFuAction("message");
                    setFuAction(null);
                    onUpdateContact(patch.followUpTemplateId ? { followUpAction: "message", followUpTemplateId: patch.followUpTemplateId } : patch);
                  }}
                />
                <FollowUpChip at={contact.followUpAt} />
                <Input placeholder="What to do? e.g. call about fees" defaultValue={contact.followUpNote || ""} onBlur={(e) => e.target.value !== (contact.followUpNote || "") && onUpdateContact({ followUpNote: e.target.value })} />
              </>
            )}
          </div>
        </Field>
        <Field label="Tags">
          <TagInput value={contact.tags} onChange={(t) => onUpdateContact({ tags: t })} suggestions={tags} />
        </Field>
        <ReferralBox contactId={contact._id} compact />
        <Field label="Notes" hint="Saved when you click outside">
          <Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== contact.notes && onUpdateContact({ notes })} />
        </Field>
        {conversation && (<>
        <Field label="Assigned to">
          <Select value={conversation.assignedTo?._id || ""} onChange={(e) => onUpdateConversation({ assignedTo: e.target.value || null })}>
            <option value="">Unassigned</option>
            {team.filter((t) => t.isActive).map((t) => <option key={t._id} value={t._id}>{t._id === me._id ? `${t.name} (me)` : t.name}</option>)}
          </Select>
        </Field>
        <Field label="Chat status">
          <div className="flex gap-1">
            {["open", "pending", "resolved"].map((s) => (
              <button key={s} onClick={() => onUpdateConversation({ status: s })} className={cx("flex-1 rounded-md border px-2 py-1.5 text-xs font-medium capitalize", conversation.status === s ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50")}>
                {s}
              </button>
            ))}
          </div>
        </Field>
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-slate-500">Chatbot</span>
          {conversation.bot?.active ? (
            <Button size="sm" variant="secondary" onClick={() => onBotAction("stop")} loading={botBusy}><Hand className="h-3.5 w-3.5" /> Take over</Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => onBotAction("restart")} loading={botBusy} disabled={!conversation.windowOpen} title={conversation.windowOpen ? "Send the bot menu again" : "24-hour window closed"}>
              <Bot className="h-3.5 w-3.5" /> Hand to bot
            </Button>
          )}
        </div>
        </>)}
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500">Bulk messages</span>
          {contact.optedOut ? <Badge tone="red">opted out</Badge> : <Badge tone="green">subscribed</Badge>}
        </div>
      </div>
    </div>
  );
}

// What the lead did with each course in the chatbot (newest first)
const DID = { viewed: "opened", fees: "fees", details: "details", demo: "asked demo", interested: "interested ✅", not_now: "not now", booked: "booked ✅" };
function CourseInterest({ list, current }) {
  const items = [...list].sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));
  return (
    <div className="rounded-md border border-indigo-100 bg-indigo-50/50 p-2.5 text-xs">
      <p className="mb-1 font-medium text-indigo-900">📘 Courses looked at in the chatbot</p>
      <ul className="space-y-1">
        {items.map((c) => (
          <li key={c.code} className="text-slate-700">
            <b className={cx(c.code === current && "text-indigo-800")}>{c.name}</b>
            {c.code === current && <Badge tone="purple" className="ml-1">current</Badge>}
            <span className="block text-[11px] text-slate-500">{(c.actions || []).map((a) => DID[a] || a).join(" · ")} · {fmtRelative(c.lastAt)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
