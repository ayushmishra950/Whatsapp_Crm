"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Plus, RotateCcw, Search, Trash2 } from "lucide-react";
import { TagInput } from "./shared";
import { Badge, Button, Field, Input, Select, Textarea, cx } from "./ui";

const FAQ_ACTIONS = [
  ["answer", "Send this answer"],
  ["fees", "Show the course fees"],
  ["details", "Show the course details"],
  ["book", "Start booking (admission questions)"],
  ["courses", "Show the course list"],
  ["handoff", "Send this, then connect to the team"],
];
const PLACEHOLDERS = "{{name}} {{course}} {{duration}} {{batch_date}} {{internship}} {{business_name}} {{address}} {{maps_link}} {{city}} {{students_trained}} {{since_year}} {{rating}} {{review_link}} {{proof_link}} {{per_day}}";
const move = (list, i, d) => {
  const next = [...list];
  const j = i + d;
  if (j < 0 || j >= next.length) return next;
  [next[i], next[j]] = [next[j], next[i]];
  return next;
};
const keyFrom = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30);

/** Admission questions of the course flow (asked after "Yes, interested" / "Free demo") */
export function CourseQuestionsEditor({ value, onChange, onReset }) {
  const set = (i, patch) => onChange(value.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const setOpt = (i, k, patch) => set(i, { options: value[i].options.map((o, j) => (j === k ? { ...o, ...patch } : o)) });
  return (
    <div className="space-y-3">
      {value.map((q, i) => (
        <div key={q.key || i} className={cx("rounded-lg border p-3", q.enabled === false ? "border-slate-200 bg-slate-50 opacity-70" : "border-slate-200")}>
          <div className="mb-2 flex items-center gap-2">
            <Badge tone="purple">{i + 1}</Badge>
            <span className="text-xs text-slate-500">Saved in: <code>{q.field}</code></span>
            <label className="ml-auto flex items-center gap-1 text-xs text-slate-600"><input type="checkbox" checked={q.enabled !== false} onChange={(e) => set(i, { enabled: e.target.checked })} /> Ask</label>
            <label className="flex items-center gap-1 text-xs text-slate-600" title="Skip when the lead already has a value (e.g. name from WhatsApp)"><input type="checkbox" checked={!!q.skipIfKnown} onChange={(e) => set(i, { skipIfKnown: e.target.checked })} /> Skip if known</label>
            <Button size="icon" variant="ghost" className="!w-7" disabled={i === 0} onClick={() => onChange(move(value, i, -1))} aria-label="Move up"><ArrowUp className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" className="!w-7" disabled={i === value.length - 1} onClick={() => onChange(move(value, i, 1))} aria-label="Move down"><ArrowDown className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" className="!w-7" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Delete question"><Trash2 className="h-4 w-4 text-red-500" /></Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Question (English)"><Input maxLength={500} value={q.en} onChange={(e) => set(i, { en: e.target.value })} /></Field>
            <Field label="Question (Hinglish)"><Input maxLength={500} value={q.hi} onChange={(e) => set(i, { hi: e.target.value })} /></Field>
          </div>
          <div className="mt-2 space-y-1.5">
            <p className="text-xs text-slate-500">{q.options.length ? "Buttons (3 short ones) or a list (more): the customer taps one" : "No options: the customer types the answer"}</p>
            {q.options.map((o, k) => (
              <div key={k} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1.5">
                <Input className="h-8 text-sm" maxLength={24} value={o.en} placeholder="Option (English)" onChange={(e) => setOpt(i, k, { en: e.target.value })} aria-label="Option English" />
                <Input className="h-8 text-sm" maxLength={24} value={o.hi} placeholder="Option (Hinglish)" onChange={(e) => setOpt(i, k, { hi: e.target.value })} aria-label="Option Hinglish" />
                <Input className="h-8 text-sm" maxLength={100} value={o.value} placeholder="Saved as" title="What is saved on the lead" onChange={(e) => setOpt(i, k, { value: e.target.value })} aria-label="Saved value" />
                <Button size="icon" variant="ghost" className="!h-8 !w-7" onClick={() => set(i, { options: q.options.filter((_, j) => j !== k) })} aria-label="Remove option"><Trash2 className="h-3.5 w-3.5 text-red-500" /></Button>
              </div>
            ))}
            <Button size="sm" variant="ghost" disabled={q.options.length >= 10} onClick={() => set(i, { options: [...q.options, { value: "", en: "", hi: "" }] })}><Plus className="h-3.5 w-3.5" /> Add option</Button>
          </div>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={value.length >= 15} onClick={() => {
          const key = `q${value.length + 1}`;
          onChange([...value, { key, field: `custom.${key}`, enabled: true, en: "", hi: "", options: [], skipIfKnown: false }]);
        }}><Plus className="h-4 w-4" /> Add question</Button>
        {onReset && <Button size="sm" variant="ghost" onClick={onReset}><RotateCcw className="h-3.5 w-3.5" /> Restore default questions</Button>}
      </div>
    </div>
  );
}

/** Answers to questions students type ("emi hai?", "online hai kya", "address"), English + Hinglish */
export function FaqEditor({ value, onChange, onReset }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(null);
  const set = (i, patch) => onChange(value.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const term = q.trim().toLowerCase();
  const shown = value.map((f, i) => [f, i]).filter(([f]) => !term || [f.title, f.key, ...(f.keywords || [])].some((s) => String(s || "").toLowerCase().includes(term)));
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        When a customer types a question, the bot finds the answer whose keywords are in the message (the longest match wins) and replies in their language. A sentence whose value is not filled yet is left out; with nothing left, the bot says the counsellor will share it. Placeholders: <code className="break-all">{PLACEHOLDERS}</code>
      </p>
      <div className="relative">
        <Search className="absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
        <Input className="pl-9" placeholder={`Search ${value.length} answers (e.g. emi, online, address)`} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {shown.map(([f, i]) => (
          <div key={`${f.key}-${i}`} className={cx(f.enabled === false && "bg-slate-50 opacity-70")}>
            <button type="button" onClick={() => setOpen(open === i ? null : i)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm">
              {open === i ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
              <span className="font-medium text-slate-800">{f.title || f.key}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-slate-400">{(f.keywords || []).slice(0, 6).join(", ")}</span>
              {f.action !== "answer" && <Badge tone="blue">{FAQ_ACTIONS.find(([v]) => v === f.action)?.[0]}</Badge>}
              {f.enabled === false && <Badge>off</Badge>}
            </button>
            {open === i && (
              <div className="space-y-2 px-3 pb-3">
                <div className="grid gap-2 sm:grid-cols-[1fr_14rem_auto]">
                  <Input maxLength={60} value={f.title} placeholder="Title" onChange={(e) => set(i, { title: e.target.value })} aria-label="Title" />
                  <Select value={f.action} onChange={(e) => set(i, { action: e.target.value })} aria-label="What the bot does">
                    {FAQ_ACTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </Select>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1 text-xs text-slate-600"><input type="checkbox" checked={f.enabled !== false} onChange={(e) => set(i, { enabled: e.target.checked })} /> On</label>
                    <Button size="icon" variant="ghost" className="!w-7" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Delete answer"><Trash2 className="h-4 w-4 text-red-500" /></Button>
                  </div>
                </div>
                <Field label="When the message contains" hint="Words / phrases the way students type them: fees kitni hai, emi, online hai kya…">
                  <TagInput value={f.keywords || []} onChange={(keywords) => set(i, { keywords: keywords.map((k) => k.toLowerCase()) })} placeholder="Add words (comma or Enter)" />
                </Field>
                {["answer", "handoff"].includes(f.action) && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Field label="Answer (English)"><Textarea rows={5} maxLength={1000} value={f.en} onChange={(e) => set(i, { en: e.target.value })} /></Field>
                    <Field label="Answer (Hinglish)"><Textarea rows={5} maxLength={1000} value={f.hi} onChange={(e) => set(i, { hi: e.target.value })} /></Field>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {!shown.length && <p className="p-4 text-center text-sm text-slate-500">No answer matches “{q}”.</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={value.length >= 80} onClick={() => {
          const n = value.length + 1;
          onChange([...value, { key: keyFrom(`faq_${n}`), title: "New answer", enabled: true, keywords: [], en: "", hi: "", action: "answer" }]);
          setOpen(value.length);
          setQ("");
        }}><Plus className="h-4 w-4" /> Add answer</Button>
        {onReset && <Button size="sm" variant="ghost" onClick={onReset}><RotateCcw className="h-3.5 w-3.5" /> Restore default answers</Button>}
      </div>
    </div>
  );
}
