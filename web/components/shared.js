"use client";

import { useState } from "react";
import { X } from "lucide-react";

export const LEAD_STATUSES = ["new", "contacted", "qualified", "converted", "lost"];

export function TagInput({ value, onChange, suggestions = [], placeholder = "Add tag + Enter" }) {
  const [text, setText] = useState("");
  const add = (t) => {
    const tag = t.trim().toLowerCase();
    if (tag && !value.includes(tag)) onChange([...value, tag]);
    setText("");
  };
  return (
    <div>
      <div className="flex flex-wrap gap-1.5 rounded-md border border-slate-300 p-1.5">
        {value.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs">
            {t}
            <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`Remove ${t}`}><X className="h-3 w-3" /></button>
          </span>
        ))}
        <input
          className="min-w-24 flex-1 px-1 text-sm outline-none"
          placeholder={placeholder}
          value={text}
          list="tag-suggestions"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add(text);
            }
          }}
          onBlur={() => text && add(text)}
        />
        <datalist id="tag-suggestions">{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
      </div>
    </div>
  );
}

export function TemplatePreview({ header, body, footer, params }) {
  const text = (body || "").replace(/\{\{(\d+)\}\}/g, (m, n) => (params?.[n - 1] ? params[n - 1] : m));
  return (
    <div className="rounded-lg bg-chat p-4">
      <div className="max-w-xs rounded-lg rounded-tl-none bg-white p-3 text-sm shadow-sm">
        {header && <p className="mb-1 font-semibold">{header}</p>}
        <p className="whitespace-pre-wrap text-slate-800">{text || "Message body…"}</p>
        {footer && <p className="mt-2 text-xs text-slate-400">{footer}</p>}
      </div>
    </div>
  );
}

