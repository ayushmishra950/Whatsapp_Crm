"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, UserPlus } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useIsCoaching } from "@/lib/business";
import { fmtPhone } from "@/lib/format";
import { useToast } from "./toast";
import { CoursePicker } from "./leads";
import { Button, Field, Input, Modal, Select, cx } from "./ui";

const SOURCES = [
  ["walkin", "🚶 Walk-in"],
  ["call", "📞 Phone call"],
  ["referral", "🤝 Referral"],
  ["website", "🌐 Website"],
];
// 98765 43210 -> 919876543210 (India); numbers with a country code stay as typed
const toPhone = (v) => {
  const d = String(v || "").replace(/\D/g, "").replace(/^0+/, "");
  return d.length === 10 ? `91${d}` : d;
};
const filled = (t, name) => (t.preview || t.body || "").replaceAll("%NAME%", name || "Rahul").replace(/\{\{\d+\}\}/g, "…");
const EMPTY = { name: "", phone: "", course: "", language: "", note: "" };

/**
 * "+ Walk-in / enquiry": name + mobile -> lead saved and the welcome message goes on WhatsApp at once.
 * Stays open for the next visitor; the last one is shown with a link to their page.
 */
export function QuickAddModal({ open, onClose, onAdded }) {
  const toast = useToast();
  const { session } = useAuth();
  const isAdmin = session?.user.role === "admin";
  const coaching = useIsCoaching();
  const [form, setForm] = useState(EMPTY);
  const [source, setSource] = useState("walkin");
  const [sendWelcome, setSendWelcome] = useState(true);
  const [welcome, setWelcome] = useState(null); // { en, hi, chosenId }
  const [templates, setTemplates] = useState(null); // admin: change the welcome template
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState(null);
  const nameRef = useRef(null);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const loadWelcome = () => api("/contacts/quick/welcome").then(setWelcome).catch(() => setWelcome({ en: null, hi: null }));
  useEffect(() => {
    if (open) loadWelcome();
  }, [open]);

  const phone = toPhone(form.phone);
  const phoneOk = /^\d{11,15}$/.test(phone);
  const template = form.language === "hi" ? welcome?.hi || welcome?.en : welcome?.en || welcome?.hi;

  const save = async (e) => {
    e?.preventDefault();
    if (!form.name.trim() || !phoneOk || busy) return;
    setBusy(true);
    try {
      const r = await api("/contacts/quick", { method: "POST", body: { ...form, phone, source, sendWelcome: sendWelcome && !!template } });
      const who = r.contact.name || fmtPhone(r.contact.phone);
      const sent = r.welcome === "sent";
      toast.success(`${r.created ? "Saved" : "Already in CRM — updated"}: ${who}${sent ? " · welcome sent ✓" : ""}`);
      setLast({ ...r, who });
      setForm(EMPTY);
      onAdded?.(r);
      nameRef.current?.focus();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const chooseTemplate = async (id) => {
    try {
      await api("/settings", { method: "PATCH", body: { settings: { automation: { walkInTemplateId: id || null } } } });
      await loadWelcome();
      toast.success("Welcome message saved");
    } catch (err) {
      toast.error(err);
    }
  };

  const close = () => {
    setLast(null);
    setForm(EMPTY);
    onClose();
  };

  return (
    <Modal open={open} onClose={close} title="New walk-in / enquiry" size="md"
      footer={<><Button variant="secondary" onClick={close}>Close</Button><Button loading={busy} disabled={!form.name.trim() || !phoneOk} onClick={save}><UserPlus className="h-4 w-4" /> Save{sendWelcome && template ? " & send welcome" : ""}</Button></>}>
      <form onSubmit={save} className="space-y-3">
        {last && (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-green-50 px-3 py-2 text-sm text-green-900">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span className="flex-1">
              <b>{last.who}</b> {last.created ? "saved" : "was already in the CRM (updated)"}.{" "}
              {last.welcome === "sent" ? "Welcome sent on WhatsApp ✓" : last.welcome === "failed" ? `Welcome NOT sent: ${last.welcomeError || "WhatsApp error"}` : last.welcome === "no_template" ? "No welcome sent (no approved template)." : last.welcome === "opted_out" ? "Not sent: this number opted out." : ""}
            </span>
            <Link href={`/app/contacts/${last.contact._id}`} className="font-medium underline" onClick={close}>Open lead</Link>
          </div>
        )}
        <div className="flex flex-wrap gap-1">
          {SOURCES.map(([v, l]) => (
            <button key={v} type="button" onClick={() => setSource(v)} className={cx("rounded-full border px-3 py-1 text-sm", source === v ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600 hover:bg-slate-50")}>{l}</button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name *"><Input ref={nameRef} autoFocus maxLength={100} value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Rahul Sharma" /></Field>
          <Field label="Mobile (WhatsApp) *" hint={form.phone && !phoneOk ? "10-digit mobile, or with country code" : phoneOk ? `WhatsApp: +${phone}` : "10-digit number gets +91"}>
            <Input inputMode="tel" maxLength={18} value={form.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="98765 43210" />
          </Field>
        </div>
        {coaching && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><span className="text-sm font-medium text-slate-700">Course (optional)</span><CoursePicker value={form.course} onChange={(course) => set({ course })} /></div>
            <Field label="Language (optional)">
              <Select value={form.language} onChange={(e) => set({ language: e.target.value })}>
                <option value="">Not sure</option>
                <option value="hi">Hinglish</option>
                <option value="en">English</option>
              </Select>
            </Field>
          </div>
        )}
        <Field label="Note (optional)"><Input maxLength={500} value={form.note} onChange={(e) => set({ note: e.target.value })} placeholder="Came with father, asked about weekend batch…" /></Field>

        <div className="rounded-md border border-slate-200 p-3 text-sm">
          <label className="flex items-center gap-2 font-medium text-slate-800">
            <input type="checkbox" checked={sendWelcome} onChange={(e) => setSendWelcome(e.target.checked)} /> Send the welcome message on WhatsApp now
          </label>
          {welcome && (template ? (
            <p className="mt-2 rounded bg-slate-50 px-2 py-1.5 text-xs whitespace-pre-line text-slate-600">{filled(template, form.name.trim().split(" ")[0])}</p>
          ) : (
            <p className="mt-2 text-xs text-amber-700">No approved welcome template yet: the lead is saved, but no message goes out. {isAdmin ? "Get “walkin_welcome” approved in Templates, or choose another approved template below." : "Ask your admin to approve one."}</p>
          ))}
          {isAdmin && (
            <details className="mt-2 text-xs" onToggle={(e) => e.currentTarget.open && !templates && api("/templates", { query: { status: "approved" } }).then(setTemplates).catch(() => setTemplates([]))}>
              <summary className="cursor-pointer text-slate-500">Change the welcome message</summary>
              <Select className="mt-2 h-8 text-xs" value={welcome?.chosenId || ""} onChange={(e) => chooseTemplate(e.target.value)}>
                <option value="">Default: walkin_welcome (English / Hinglish)</option>
                {(templates || []).map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}
              </Select>
              <p className="mt-1 text-slate-400">Choose a template without required details other than the name. Choosing a “…_en” template sends its “…_hi” twin to Hinglish leads.</p>
            </details>
          )}
        </div>
        <button type="submit" className="hidden" aria-hidden />
      </form>
    </Modal>
  );
}

/** Sidebar / page button that opens the walk-in form */
export function QuickAddButton({ className, label = "Walk-in / new enquiry", onAdded }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button className={className} onClick={() => setOpen(true)}><UserPlus className="h-4 w-4" /> {label}</Button>
      <QuickAddModal open={open} onClose={() => setOpen(false)} onAdded={onAdded} />
    </>
  );
}
