"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useLeadStatuses } from "@/lib/lead-statuses";
import { useToast } from "./toast";
import { TagInput } from "./shared";
import { Button, Field, Input, Select, Toggle, cx } from "./ui";

const chip = (on) => cx("rounded-full border px-2 py-0.5 text-xs", on ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-300 text-slate-600 hover:bg-slate-50");
const toggleIn = (list = [], v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/** A3/A4: words in a customer's message -> status / tag / alert / task */
export function KeywordRulesEditor({ initial, onSaved }) {
  const toast = useToast();
  const { list: statuses } = useLeadStatuses();
  const [rules, setRules] = useState(() => (initial || []).map((r) => ({ ...r })));
  const [saving, setSaving] = useState(false);
  const setRule = (i, patch) => setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const save = async () => {
    setSaving(true);
    try {
      await api("/settings/automation-rules", {
        method: "PUT",
        body: { rules: rules.map(({ name, enabled, keywords, onlyIfStatusIn, setStatus, addTags, alert, task }) => ({ name, enabled: enabled !== false, keywords, onlyIfStatusIn, setStatus, addTags, alert, task })) },
      });
      toast.success("Keyword rules saved");
      await onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      {!rules.length && <p className="text-sm text-slate-500">No rules yet. Example: “join, admission, fees jama” → Interested – Hot + alert.</p>}
      {rules.map((r, i) => (
        <div key={i} className={cx("space-y-3 rounded-md border p-3", r.enabled === false ? "border-slate-200 bg-slate-50 opacity-70" : "border-slate-200")}>
          <div className="flex items-center gap-2">
            <Input className="h-9 min-w-0 flex-1 font-medium" maxLength={60} value={r.name} placeholder="Rule name, e.g. Hot words" onChange={(e) => setRule(i, { name: e.target.value })} aria-label="Rule name" />
            <label className="flex items-center gap-1 text-xs text-slate-600"><input type="checkbox" checked={r.enabled !== false} onChange={(e) => setRule(i, { enabled: e.target.checked })} /> On</label>
            <Button size="icon" variant="ghost" className="!w-7" onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))} aria-label="Delete rule"><Trash2 className="h-4 w-4 text-red-500" /></Button>
          </div>
          <Field label="When the customer writes any of" hint="Whole words or phrases, comma or Enter between them">
            <TagInput value={r.keywords || []} onChange={(keywords) => setRule(i, { keywords: keywords.map((k) => k.toLowerCase()) })} placeholder="e.g. join, fees jama" />
          </Field>
          <Field label="Only if the lead is (none = any status)">
            <div className="flex flex-wrap gap-1">
              {statuses.map((s) => <button key={s.key} type="button" className={chip(r.onlyIfStatusIn?.includes(s.key))} onClick={() => setRule(i, { onlyIfStatusIn: toggleIn(r.onlyIfStatusIn, s.key) })}>{s.label}</button>)}
            </div>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Move to status">
              <Select value={r.setStatus || ""} onChange={(e) => setRule(i, { setStatus: e.target.value })}>
                <option value="">Don&apos;t change</option>
                {statuses.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </Select>
            </Field>
            <Field label="Add tags"><TagInput value={r.addTags || []} onChange={(addTags) => setRule(i, { addTags: addTags.map((t) => t.toLowerCase()) })} placeholder="e.g. objection-price" /></Field>
            <Field label="Create a task (due in 15 min)"><Input maxLength={120} value={r.task || ""} placeholder="e.g. Hot lead – call now" onChange={(e) => setRule(i, { task: e.target.value })} /></Field>
            <label className="mt-6 flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={!!r.alert} onChange={(e) => setRule(i, { alert: e.target.checked })} /> 🔔 Alert counsellor + admins</label>
          </div>
        </div>
      ))}
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={rules.length >= 30} onClick={() => setRules((rs) => [...rs, { name: "", enabled: true, keywords: [], onlyIfStatusIn: [], setStatus: "", addTags: [], alert: false, task: "" }])}><Plus className="h-4 w-4" /> Add rule</Button>
        <Button size="sm" loading={saving} disabled={rules.some((r) => !r.name?.trim() || !r.keywords?.length)} onClick={save}>Save rules</Button>
      </div>
    </div>
  );
}

/** Drips, replies, overdue tasks, morning report, "lead came back" */
export function LeadFlowSettings({ settings, onSave, busy }) {
  const { list: statuses } = useLeadStatuses();
  const a = settings.automation || {};
  const [form, setForm] = useState({
    oneDripAtATime: a.oneDripAtATime !== false,
    alertOnReply: a.alertOnReply !== false,
    feeReminders: a.feeReminders !== false,
    overdueAlertMinutes: a.overdueAlertMinutes ?? 30,
    dailyReportTime: a.dailyReportTime ?? "09:00",
    returningLead: { enabled: !!a.returningLead?.enabled, fromStatuses: a.returningLead?.fromStatuses || [], toStatus: a.returningLead?.toStatus || "" },
  });
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const rl = form.returningLead;
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ automation: { ...form, overdueAlertMinutes: Number(form.overdueAlertMinutes) || 0 } });
      }}
    >
      <Toggle checked={form.oneDripAtATime} onChange={(v) => set({ oneDripAtATime: v })} label="One drip at a time" description="When a lead starts a status drip, their other status drips stop (birthday / refer drips keep running)." />
      <Toggle checked={form.alertOnReply} onChange={(v) => set({ alertOnReply: v })} label="Alert when a lead replies during a drip" description="The counsellor (or admins) get a 🔔 so a human answers quickly." />
      <Toggle checked={form.feeReminders} onChange={(v) => set({ feeReminders: v })} label="Fee reminders" description="WhatsApp reminder 3 days before, on the day and after a missed instalment (approved fee templates), plus a task to collect overdue fees." />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Alert when a task is late by (minutes)" hint="0 = never"><Input type="number" min={0} max={1440} value={form.overdueAlertMinutes} onChange={(e) => set({ overdueAlertMinutes: e.target.value })} /></Field>
        <Field label="Morning “needs attention” report at" hint="Empty = off. Sent to admins' 🔔"><Input type="time" value={form.dailyReportTime} onChange={(e) => set({ dailyReportTime: e.target.value })} /></Field>
      </div>
      <div className="space-y-3 rounded-md border border-slate-200 p-3">
        <Toggle checked={rl.enabled} onChange={(v) => set({ returningLead: { ...rl, enabled: v } })} label="Lead came back" description="A lead in Nurture / Lost writes again → move them and alert the team." />
        {rl.enabled && (
          <>
            <Field label="When a lead in one of these statuses writes">
              <div className="flex flex-wrap gap-1">
                {statuses.map((s) => <button key={s.key} type="button" className={chip(rl.fromStatuses.includes(s.key))} onClick={() => set({ returningLead: { ...rl, fromStatuses: toggleIn(rl.fromStatuses, s.key) } })}>{s.label}</button>)}
              </div>
            </Field>
            <Field label="Move them to">
              <Select value={rl.toStatus} onChange={(e) => set({ returningLead: { ...rl, toStatus: e.target.value } })}>
                <option value="">Choose…</option>
                {statuses.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </Select>
            </Field>
          </>
        )}
      </div>
      <div className="flex justify-end"><Button type="submit" variant="secondary" size="sm" loading={busy} disabled={rl.enabled && (!rl.toStatus || !rl.fromStatuses.length)}>Save</Button></div>
    </form>
  );
}

/** Business details used by template variables ({{review link}}, {{offer end}}…) */
export function MessageInfoSettings({ settings, onSave, busy }) {
  const m = settings.messageInfo || {};
  const [form, setForm] = useState({
    reviewLink: m.reviewLink || "", proofLink: m.proofLink || "", offerEnd: m.offerEnd || "", address: m.address || "", mapsLink: m.mapsLink || "", paymentDetails: m.paymentDetails || "",
    city: m.city || "", studentsTrained: m.studentsTrained || "", sinceYear: m.sinceYear || "", rating: m.rating || "",
  });
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ messageInfo: form });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="City"><Input maxLength={60} value={form.city} placeholder="e.g. Jaipur" onChange={(e) => set({ city: e.target.value })} /></Field>
        <Field label="Rating" hint="Shown as ★ 4.9/5"><Input maxLength={20} value={form.rating} placeholder="e.g. 4.9/5" onChange={(e) => set({ rating: e.target.value })} /></Field>
        <Field label="Students trained" hint="“3,000+ students have trained with us…”"><Input maxLength={20} value={form.studentsTrained} placeholder="e.g. 3,000+" onChange={(e) => set({ studentsTrained: e.target.value })} /></Field>
        <Field label="Since (year)"><Input maxLength={10} value={form.sinceYear} placeholder="e.g. 2012" onChange={(e) => set({ sinceYear: e.target.value })} /></Field>
        <Field label="Google review link"><Input maxLength={300} value={form.reviewLink} placeholder="https://g.page/r/…" onChange={(e) => set({ reviewLink: e.target.value })} /></Field>
        <Field label="Proof / results link" hint="Placements, student work…"><Input maxLength={300} value={form.proofLink} onChange={(e) => set({ proofLink: e.target.value })} /></Field>
        <Field label="Current offer ends on"><Input type="date" value={form.offerEnd} onChange={(e) => set({ offerEnd: e.target.value })} /></Field>
        <Field label="Google Maps link"><Input maxLength={300} value={form.mapsLink} onChange={(e) => set({ mapsLink: e.target.value })} /></Field>
        <Field label="Address" className="sm:col-span-2"><Input maxLength={300} value={form.address} onChange={(e) => set({ address: e.target.value })} /></Field>
        <Field label="Payment details" hint="UPI id / bank details sent to fee-pending leads" className="sm:col-span-2"><Input maxLength={500} value={form.paymentDetails} onChange={(e) => set({ paymentDetails: e.target.value })} /></Field>
      </div>
      <div className="flex justify-end"><Button type="submit" variant="secondary" size="sm" loading={busy}>Save</Button></div>
    </form>
  );
}

/** Meta's price per template message (₹) for the dashboard's cost estimate */
export function WaRatesSettings({ settings, onSave, busy }) {
  const r = settings.waRates || {};
  const [form, setForm] = useState({ marketing: r.marketing ?? 0.86, utility: r.utility ?? 0.115, authentication: r.authentication ?? 0.115 });
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onSave({ waRates: { marketing: Number(form.marketing), utility: Number(form.utility), authentication: Number(form.authentication) } }); }}>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Marketing (₹)"><Input type="number" step="0.001" min={0} value={form.marketing} onChange={(e) => setForm({ ...form, marketing: e.target.value })} /></Field>
        <Field label="Utility (₹)"><Input type="number" step="0.001" min={0} value={form.utility} onChange={(e) => setForm({ ...form, utility: e.target.value })} /></Field>
        <Field label="Authentication (₹)"><Input type="number" step="0.001" min={0} value={form.authentication} onChange={(e) => setForm({ ...form, authentication: e.target.value })} /></Field>
      </div>
      <p className="text-xs text-slate-500">Per delivered template message, from Meta&apos;s WhatsApp pricing for India (check business.whatsapp.com/products/platform-pricing — rates change). Replies to a customer within 24 hours are free.</p>
      <div className="flex justify-end"><Button type="submit" variant="secondary" size="sm" loading={busy}>Save</Button></div>
    </form>
  );
}
