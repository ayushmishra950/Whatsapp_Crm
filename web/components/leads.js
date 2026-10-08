"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, CheckCircle2, ClipboardList, Phone, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useSocketEvent } from "@/lib/socket";
import { fmtDateTime, fmtPhone, fmtRelative, toLocalInput } from "@/lib/format";
import { useToast } from "./toast";
import { LeadStatusSelect } from "./shared";
import { Badge, Button, ConfirmModal, Field, Input, Modal, Select, Textarea, cx } from "./ui";
import { NextFollowUpModal } from "./actions";

const isLate = (d) => new Date(d) < new Date();

export const LANGUAGES = [
  { value: "", label: "Not known" },
  { value: "en", label: "English" },
  { value: "hi", label: "Hinglish" },
];

// ---------- Courses ----------
let coursesCache = null;
let coursesPromise = null;
export function loadCourses(force) {
  if (force) coursesCache = null;
  if (coursesCache) return Promise.resolve(coursesCache);
  coursesPromise ||= api("/courses")
    .then((c) => (coursesCache = c))
    .finally(() => {
      coursesPromise = null;
    });
  return coursesPromise;
}

/** The business's courses (Courses page), cached for the page */
export function useCourses(enabled = true) {
  const [list, setList] = useState(coursesCache || []);
  useEffect(() => {
    if (!enabled) return; // courses are part of the coaching format
    let alive = true;
    loadCourses().then((c) => alive && setList(c)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [enabled]);
  const byCode = Object.fromEntries(list.map((c) => [c.code, c]));
  return { list, label: (code) => (code ? byCode[code]?.name || code : "—"), byCode };
}

export function CourseSelect({ value, onChange, className, includeAll, allLabel = "All courses", ariaLabel = "Course" }) {
  const { list } = useCourses();
  return (
    <Select className={className} value={value || ""} onChange={(e) => onChange(e.target.value)} aria-label={ariaLabel}>
      <option value="">{includeAll ? allLabel : "No course"}</option>
      {includeAll && <option value="none">No course set</option>}
      {value && value !== "none" && !list.some((c) => c.code === value) && <option value={value}>{value}</option>}
      {list.filter((c) => c.active || c.code === value).map((c) => <option key={c._id} value={c.code}>{c.name} ({c.code})</option>)}
    </Select>
  );
}

/**
 * Course picker with search and a short list (max ~6 rows, scrolls): for forms where the
 * browser's own dropdown would open a very tall list. The list opens inline, so a modal never clips it.
 */
export function CoursePicker({ value, onChange, placeholder = "Search course…" }) {
  const { list, label } = useCourses();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const boxRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const away = (e) => !boxRef.current?.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  const term = q.trim().toLowerCase();
  // Best match first: name starts with the text, then name contains it, then code / category
  const rank = (c) => {
    const n = c.name.toLowerCase();
    return n.startsWith(term) ? 0 : n.includes(term) ? 1 : c.code.toLowerCase().includes(term) ? 2 : 3;
  };
  const shown = list
    .filter((c) => c.active !== false && (!term || `${c.name} ${c.code} ${c.category || ""}`.toLowerCase().includes(term)))
    .sort((a, b) => (term ? rank(a) - rank(b) : 0));
  const pick = (code) => {
    onChange(code);
    setQ("");
    setOpen(false);
  };
  return (
    <div ref={boxRef} className="relative">
      <Input
        // The chosen course shows as the placeholder (dark), so typing always starts a fresh search
        value={open ? q : ""}
        placeholder={value ? label(value) : placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.stopPropagation(); setOpen(false); }
          if (e.key === "Enter" && open) { e.preventDefault(); if (shown[0]) pick(shown[0].code); }
        }}
        aria-label="Course"
        className={cx(value && "pr-8 placeholder:text-slate-900")}
      />
      {value && (
        <button type="button" onClick={() => { onChange(""); setQ(""); }} className="absolute top-2 right-2 rounded px-1 text-xs text-slate-400 hover:bg-slate-100" aria-label="Clear course">✕</button>
      )}
      {open && (
        <div className="scroll-thin mt-1 max-h-48 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-sm">
          <button type="button" onClick={() => pick("")} className={cx("block w-full px-3 py-1.5 text-left text-sm text-slate-500 hover:bg-slate-50", !value && "font-medium")}>No course</button>
          {shown.map((c) => (
            <button key={c._id} type="button" onClick={() => pick(c.code)} className={cx("block w-full px-3 py-1.5 text-left text-sm hover:bg-brand-50", value === c.code && "bg-brand-50 font-medium text-brand-700")}>
              {c.name} <span className="text-xs text-slate-400">{c.code}</span>
            </button>
          ))}
          {!shown.length && <p className="px-3 py-2 text-sm text-slate-400">No course matches “{q}”</p>}
        </div>
      )}
    </div>
  );
}

// ---------- Call log ----------
const OUTCOMES = [
  { value: "connected", label: "Connected – spoke" },
  { value: "no_answer", label: "No answer" },
  { value: "busy", label: "Busy" },
  { value: "switched_off", label: "Switched off" },
  { value: "call_back", label: "Asked to call back" },
  { value: "wrong_number", label: "Wrong number" },
];

/** "Log call": outcome, note, new status, next call. Returns the updated contact via onSaved. */
export function CallLogModal({ open, onClose, contact, onSaved }) {
  const toast = useToast();
  const [outcome, setOutcome] = useState("connected");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState(contact?.leadStatus || "");
  const [nextAt, setNextAt] = useState("");
  const [nextTitle, setNextTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [lastContact, setLastContact] = useState(contact?._id);
  if (contact?._id !== lastContact) {
    setLastContact(contact?._id);
    setStatus(contact?.leadStatus || "");
  }

  const save = async () => {
    setSaving(true);
    try {
      const updated = await api(`/contacts/${contact._id}/calls`, {
        method: "POST",
        body: {
          outcome, note, leadStatus: status || undefined,
          nextAt: nextAt ? new Date(nextAt).toISOString() : null,
          nextTitle: nextTitle || undefined,
        },
      });
      toast.success("Call saved");
      onSaved?.(updated);
      setNote("");
      setNextAt("");
      setNextTitle("");
      setOutcome("connected");
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Log call · ${contact?.name || fmtPhone(contact?.phone)}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={saving}>Save call</Button></>}>
      <div className="space-y-4">
        <p className="text-xs text-slate-500">Calls so far: {contact?.callAttempts || 0}{contact?.lastCallAt && ` · last ${fmtRelative(contact.lastCallAt)}`}</p>
        <Field label="What happened?">
          <div className="grid grid-cols-2 gap-1.5">
            {OUTCOMES.map((o) => (
              <button key={o.value} type="button" onClick={() => setOutcome(o.value)}
                className={cx("rounded-md border px-2 py-1.5 text-left text-sm", outcome === o.value ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600 hover:bg-slate-50")}>
                {o.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Note" hint="Course suggested, doubts, fee discussed…">
          <Textarea rows={3} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Field label="Lead status after the call">
          <LeadStatusSelect value={status} onChange={setStatus} className="h-9 w-full text-sm" />
        </Field>
        <Field label="Next action" hint="Never end a call without a date: call-back, demo or visit">
          <div className="grid gap-2 sm:grid-cols-2">
            <Input type="datetime-local" value={nextAt} onChange={(e) => setNextAt(e.target.value)} aria-label="Next action time" />
            <Input placeholder="e.g. Call back about EMI" value={nextTitle} maxLength={120} onChange={(e) => setNextTitle(e.target.value)} aria-label="Next action" />
          </div>
        </Field>
      </div>
    </Modal>
  );
}

// ---------- Tasks of one lead ----------
export function LeadTasks({ contact, onChange }) {
  const toast = useToast();
  const { session } = useAuth();
  const [tasks, setTasks] = useState(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [nextFor, setNextFor] = useState(null); // task just done -> ask for the next follow-up
  const [cancelling, setCancelling] = useState(null);
  const contactId = contact._id;

  const load = useCallback(() => api("/tasks", { query: { contactId, status: "open" } }).then(setTasks).catch(() => setTasks([])), [contactId]);
  useEffect(() => {
    load();
  }, [load]);
  useSocketEvent("task:update", () => load());

  const add = async () => {
    if (!title.trim() || !dueAt) return toast.error("Write the task and pick a time");
    try {
      await api("/tasks", { method: "POST", body: { contactId, title: title.trim(), dueAt: new Date(dueAt).toISOString() } });
      setTitle("");
      setDueAt("");
      setAdding(false);
      load();
      onChange?.();
    } catch (err) {
      toast.error(err);
    }
  };
  const setStatus = async (task, status) => {
    try {
      await api(`/tasks/${task._id}`, { method: "PATCH", body: { status } });
      if (status === "done") setNextFor(task);
      setCancelling(null);
      load();
      onChange?.();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <div className="space-y-2 rounded-md border border-slate-200 p-3">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-medium text-slate-600"><ClipboardList className="h-3.5 w-3.5" /> Tasks / next action</p>
        <button type="button" onClick={() => setAdding((a) => !a)} className="flex items-center gap-0.5 text-xs text-brand-700 hover:underline"><Plus className="h-3 w-3" /> Add</button>
      </div>
      {adding && (
        <div className="space-y-1.5">
          <Input className="h-8 text-sm" placeholder="e.g. Call about demo" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} aria-label="Task" />
          <div className="flex gap-1.5">
            <Input className="h-8 text-sm" type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} aria-label="Due" />
            <Button size="sm" onClick={add}>Save</Button>
          </div>
        </div>
      )}
      {tasks === null ? null : !tasks.length ? (
        <p className={cx("text-xs", contact.leadStatus && !contact.nextActionAt ? "text-amber-700" : "text-slate-400")}>
          {contact.nextActionAt ? `Follow-up ${fmtDateTime(contact.nextActionAt)}` : "⚠️ No next action – add a task or follow-up so this lead is not lost."}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {tasks.map((t) => {
            const late = isLate(t.dueAt);
            return (
              <li key={t._id} className="flex items-start gap-2 text-sm">
                <button type="button" onClick={() => setStatus(t, "done")} title="Mark done" aria-label="Mark done" className="mt-0.5 text-slate-300 hover:text-green-600"><CheckCircle2 className="h-4 w-4" /></button>
                <div className="min-w-0 flex-1">
                  <p className="text-slate-800">{t.title}</p>
                  <p className={cx("text-xs", late ? "font-medium text-red-600" : "text-slate-500")}>
                    {late ? "Overdue · " : ""}{fmtDateTime(t.dueAt)}{t.assignedTo?.name && ` · ${t.assignedTo.name}`}{t.source === "automation" && " · auto"}
                  </p>
                </div>
                {(session?.user.role === "admin" || String(t.createdBy) === String(session?.user._id)) && (
                  <button type="button" onClick={() => setCancelling(t)} title="Cancel task" aria-label="Cancel task" className="mt-0.5 text-slate-300 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {nextFor && <NextFollowUpModal contact={contact} defaultTitle={nextFor.title} onClose={() => { setNextFor(null); load(); onChange?.(); }} />}
      <ConfirmModal open={!!cancelling} onClose={() => setCancelling(null)} onConfirm={() => setStatus(cancelling, "cancelled")} danger title="Cancel this task?" confirmText="Cancel task"
        message={`“${cancelling?.title}” will be removed from the to-do list. If the lead still needs a call, set a new follow-up.`} />
    </div>
  );
}

// ---------- Bell ----------
const KIND_ICON = { hot: "🔥", task: "📝", overdue: "⏰", reply: "💬", status: "⌛", report: "📊", alert: "🔔" };

/** Bell with the person's alerts (hot lead, overdue task, reply during a drip, morning report) */
export function NotificationBell({ className }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ items: [], unread: 0 });
  const ref = useRef(null);
  const load = useCallback(() => api("/notifications").then(setData).catch(() => {}), []);
  useEffect(() => {
    load();
  }, [load]);
  useSocketEvent("notification:new", (n) => setData((d) => ({ items: [n, ...d.items].slice(0, 30), unread: d.unread + 1 })));
  useEffect(() => {
    if (!open) return;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const markAll = async () => {
    await api("/notifications/read", { method: "POST", body: { all: true } }).catch(() => {});
    setData((d) => ({ items: d.items.map((n) => ({ ...n, readAt: n.readAt || new Date().toISOString() })), unread: 0 }));
  };
  const markOne = (n) => {
    if (n.readAt) return;
    api("/notifications/read", { method: "POST", body: { ids: [n._id] } }).catch(() => {});
    setData((d) => ({ items: d.items.map((x) => (x._id === n._id ? { ...x, readAt: new Date().toISOString() } : x)), unread: Math.max(0, d.unread - 1) }));
  };

  return (
    <div ref={ref} className={cx("relative", className)}>
      <button type="button" onClick={() => { setOpen((o) => !o); if (!open) load(); }} className="relative rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800" aria-label={`Alerts (${data.unread} unread)`} title="Alerts">
        <Bell className="h-4.5 w-4.5" />
        {data.unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-red-600 px-1 text-center text-[10px] leading-4 font-semibold text-white">{data.unread > 99 ? "99+" : data.unread}</span>
        )}
      </button>
      {open && (
        <div className="fixed top-14 left-2 z-50 w-[22rem] max-w-[calc(100vw-1rem)] rounded-lg border border-slate-200 bg-white shadow-xl lg:left-[15.5rem]">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <p className="text-sm font-semibold text-slate-900">Alerts</p>
            <div className="flex items-center gap-3 text-xs">
              <Link href="/app/tasks" onClick={() => setOpen(false)} className="text-brand-700 hover:underline">My tasks</Link>
              {data.unread > 0 && <button type="button" onClick={markAll} className="text-slate-500 hover:underline">Mark all read</button>}
            </div>
          </div>
          <ul className="scroll-thin max-h-[60vh] divide-y divide-slate-100 overflow-y-auto">
            {!data.items.length && <li className="p-4 text-center text-sm text-slate-500">No alerts yet</li>}
            {data.items.map((n) => {
              const contactId = n.contactId?._id || n.contactId;
              const body = (
                <div className={cx("flex gap-2 px-3 py-2.5 text-sm", !n.readAt && "bg-brand-50/50")}>
                  <span>{KIND_ICON[n.kind] || "🔔"}</span>
                  <div className="min-w-0 flex-1">
                    <p className={cx("text-slate-900", !n.readAt && "font-medium")}>{n.title}</p>
                    {n.body && <p className="text-xs text-slate-500">{n.body}</p>}
                    <p className="text-[11px] text-slate-400">{fmtRelative(n.createdAt)}</p>
                  </div>
                </div>
              );
              return (
                <li key={n._id}>
                  {contactId ? (
                    <Link href={`/app/contacts/${contactId}`} onClick={() => { markOne(n); setOpen(false); }} className="block hover:bg-slate-50">{body}</Link>
                  ) : (
                    <button type="button" className="block w-full text-left hover:bg-slate-50" onClick={() => markOne(n)}>{body}</button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

export const TaskKindBadge = ({ kind }) => <Badge tone={kind === "demo" ? "purple" : kind === "callback" ? "yellow" : "blue"}>{kind}</Badge>;
export { Phone as CallIcon };
