"use client";

import { useEffect, useState } from "react";
import { Plus, Save, X } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLeadStatuses } from "@/lib/lead-statuses";
import { useContactFields } from "@/lib/contact-fields";
import { useToast } from "@/components/toast";
import { Button, Input, Select, cx } from "@/components/ui";

/**
 * Smart filter ("segment"): lead status + tags + ads + source + when they joined / last messaged
 * + field conditions (Course = PHP) + birthday / anniversary + referred. Same shape as the server's
 * services/segments.js. Shows a live count and can load / save named filters.
 */
export const PRESETS = [
  ["", "Any time"],
  ["7d", "Last 7 days"],
  ["14d", "Last 14 days"],
  ["30d", "Last 1 month"],
  ["90d", "Last 3 months"],
  ["180d", "Last 6 months"],
  ["365d", "Last 12 months"],
  ["custom", "Custom dates…"],
];
const WHEN = [
  ["", "—"],
  ["today", "Today"],
  ["tomorrow", "Tomorrow"],
  ["this_week", "Next 7 days"],
  ["this_month", "This month"],
  ["next_month", "Next month"],
];
const SOURCES = [
  ["whatsapp", "WhatsApp"],
  ["ad", "Facebook / Insta ad"],
  ["import", "Sheet import"],
  ["manual", "Added by hand"],
];

const chip = (on) => cx("rounded-full border px-2.5 py-0.5 text-xs", on ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-300 text-slate-600 hover:bg-slate-50");
const toggleIn = (list = [], v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

function Row({ label, children }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[9.5rem_1fr] sm:items-start">
      <span className="pt-1 text-xs font-medium text-slate-600">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function RangePicker({ value = {}, onChange }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select className="h-8 w-44 text-xs" value={value.preset || ""} onChange={(e) => onChange({ preset: e.target.value })}>
        {PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </Select>
      {value.preset === "custom" && (
        <>
          <Input type="date" className="h-8 w-38 text-xs" value={value.from || ""} onChange={(e) => onChange({ ...value, from: e.target.value })} aria-label="From" />
          <span className="text-xs text-slate-400">to</span>
          <Input type="date" className="h-8 w-38 text-xs" value={value.to || ""} onChange={(e) => onChange({ ...value, to: e.target.value })} aria-label="To" />
        </>
      )}
    </div>
  );
}

export function SegmentBuilder({ value, onChange, onCount, showSaved = true }) {
  const toast = useToast();
  const { session } = useAuth();
  const isAdmin = session.user.role === "admin";
  const { list: statuses } = useLeadStatuses();
  const { custom, dateFields } = useContactFields();
  const [tags, setTags] = useState([]);
  const [ads, setAds] = useState([]);
  const [saved, setSaved] = useState([]);
  const [count, setCount] = useState(null);
  const [saveName, setSaveName] = useState(null); // null = closed
  const [more, setMore] = useState(() => !!(value.excludeTags?.length || value.sources?.length || value.fields?.length || value.dateMatch?.when || value.referred));
  const f = value || {};
  const set = (patch) => onChange({ ...f, ...patch });

  useEffect(() => {
    api("/contacts/tags").then(setTags).catch(() => {});
    api("/contacts/ad-sources").then(setAds).catch(() => {});
    if (showSaved) api("/segments").then(setSaved).catch(() => {});
  }, [showSaved]);

  // Live count (debounced)
  const key = JSON.stringify(f);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      api("/segments/count", { method: "POST", body: { filter: JSON.parse(key) } })
        .then((r) => {
          if (!alive) return;
          setCount(r);
          onCount?.(r);
        })
        .catch(() => {});
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const fieldOptions = [
    { value: "name", label: "Name" },
    { value: "email", label: "Email" },
    ...custom.filter((c) => c.type !== "date").map((c) => ({ value: `custom.${c.key}`, label: c.label })),
  ];

  const saveSegment = async () => {
    try {
      const s = await api("/segments", { method: "POST", body: { name: saveName, filter: f } });
      setSaved((l) => [...l, s].sort((a, b) => a.name.localeCompare(b.name)));
      setSaveName(null);
      toast.success(`Filter "${s.name}" saved`);
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-3">
      {showSaved && (saved.length > 0 || isAdmin) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 pb-2">
          {saved.length > 0 && (
            <Select className="h-8 w-56 text-xs" value="" onChange={(e) => { const s = saved.find((x) => x._id === e.target.value); if (s) { onChange(s.filter); setMore(true); } }} aria-label="Load a saved filter">
              <option value="">Load a saved filter…</option>
              {saved.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
            </Select>
          )}
          {isAdmin && saveName === null && (
            <Button size="sm" variant="ghost" onClick={() => setSaveName("")}><Save className="h-3.5 w-3.5" /> Save this filter</Button>
          )}
          {saveName !== null && (
            <div className="flex items-center gap-1.5">
              <Input className="h-8 w-48 text-xs" autoFocus maxLength={80} placeholder="Name, e.g. Hot PHP leads" value={saveName} onChange={(e) => setSaveName(e.target.value)} />
              <Button size="sm" disabled={saveName.trim().length < 2} onClick={saveSegment}>Save</Button>
              <button type="button" className="rounded p-1 text-slate-400 hover:bg-slate-100" onClick={() => setSaveName(null)} aria-label="Cancel"><X className="h-4 w-4" /></button>
            </div>
          )}
        </div>
      )}

      <Row label="Lead status">
        <div className="flex flex-wrap gap-1.5">
          {statuses.map((s) => <button key={s.key} type="button" className={chip(f.statuses?.includes(s.key))} onClick={() => set({ statuses: toggleIn(f.statuses, s.key) })}>{s.label}</button>)}
        </div>
      </Row>
      <Row label="Tags">
        <div className="flex flex-wrap items-center gap-1.5">
          {!tags.length && <span className="text-xs text-slate-400">No tags yet</span>}
          {tags.map((t) => <button key={t} type="button" className={chip(f.tags?.includes(t))} onClick={() => set({ tags: toggleIn(f.tags, t) })}>{t}</button>)}
          {f.tags?.length > 1 && (
            <Select className="h-7 w-36 text-xs" value={f.tagMatch || "any"} onChange={(e) => set({ tagMatch: e.target.value })} aria-label="Tag match">
              <option value="any">Any of these</option>
              <option value="all">All of these</option>
            </Select>
          )}
        </div>
      </Row>
      {ads.length > 0 && (
        <Row label="From ad">
          <div className="flex flex-wrap gap-1.5">
            {ads.map((a) => <button key={a.adId} type="button" className={chip(f.adIds?.includes(a.adId))} onClick={() => set({ adIds: toggleIn(f.adIds, a.adId) })}>📣 {a.name || a.headline || a.adId} <span className="text-slate-400">({a.leads})</span></button>)}
          </div>
        </Row>
      )}
      <Row label="First contacted us">
        <RangePicker value={f.joined} onChange={(joined) => set({ joined })} />
      </Row>
      <Row label="Last message from them">
        <RangePicker value={f.lastInbound} onChange={(lastInbound) => set({ lastInbound })} />
      </Row>

      {!more ? (
        <button type="button" className="text-xs font-medium text-brand-700 hover:underline" onClick={() => setMore(true)}>+ More filters (course / city, birthday, exclude tags, source, referred)</button>
      ) : (
        <>
          <Row label="Details (Course, City…)">
            <div className="space-y-1.5">
              {(f.fields || []).map((c, i) => (
                <div key={i} className="flex flex-wrap items-center gap-1.5">
                  <Select className="h-8 w-40 text-xs" value={c.key} onChange={(e) => set({ fields: f.fields.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)) })} aria-label="Field">
                    {fieldOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Select>
                  <Select className="h-8 w-32 text-xs" value={c.op} onChange={(e) => set({ fields: f.fields.map((x, j) => (j === i ? { ...x, op: e.target.value } : x)) })} aria-label="Condition">
                    <option value="is">is</option>
                    <option value="contains">contains</option>
                    <option value="not_empty">is filled</option>
                    <option value="empty">is empty</option>
                  </Select>
                  {["is", "contains"].includes(c.op) && (
                    <Input className="h-8 w-40 text-xs" value={c.value} placeholder="e.g. PHP" onChange={(e) => set({ fields: f.fields.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} aria-label="Value" />
                  )}
                  <button type="button" className="rounded p-1 text-slate-400 hover:bg-slate-100" onClick={() => set({ fields: f.fields.filter((_, j) => j !== i) })} aria-label="Remove condition"><X className="h-4 w-4" /></button>
                </div>
              ))}
              <Button size="sm" variant="ghost" onClick={() => set({ fields: [...(f.fields || []), { key: fieldOptions[2]?.value || "name", op: "is", value: "" }] })}><Plus className="h-3.5 w-3.5" /> Add condition</Button>
            </div>
          </Row>
          {dateFields.length > 0 && (
            <Row label="Birthday / anniversary">
              <div className="flex flex-wrap gap-1.5">
                <Select className="h-8 w-40 text-xs" value={f.dateMatch?.field || ""} onChange={(e) => set({ dateMatch: { ...f.dateMatch, field: e.target.value } })} aria-label="Date field">
                  <option value="">Choose field…</option>
                  {dateFields.map((d) => <option key={d.key} value={`custom.${d.key}`}>{d.label}</option>)}
                </Select>
                <Select className="h-8 w-36 text-xs" value={f.dateMatch?.when || ""} onChange={(e) => set({ dateMatch: { field: f.dateMatch?.field || `custom.${dateFields[0].key}`, when: e.target.value } })} aria-label="When">
                  {WHEN.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
              </div>
            </Row>
          )}
          <Row label="Without tags">
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => <button key={t} type="button" className={chip(f.excludeTags?.includes(t))} onClick={() => set({ excludeTags: toggleIn(f.excludeTags, t) })}>{t}</button>)}
            </div>
          </Row>
          <Row label="Source">
            <div className="flex flex-wrap gap-1.5">
              {SOURCES.map(([v, l]) => <button key={v} type="button" className={chip(f.sources?.includes(v))} onClick={() => set({ sources: toggleIn(f.sources, v) })}>{l}</button>)}
            </div>
          </Row>
          <Row label="Referred by a friend">
            <Select className="h-8 w-40 text-xs" value={f.referred || ""} onChange={(e) => set({ referred: e.target.value })} aria-label="Referred">
              <option value="">Doesn&apos;t matter</option>
              <option value="yes">Yes, referred</option>
              <option value="no">No</option>
            </Select>
          </Row>
        </>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm">
        <span>
          <b>{count ? count.reachable : "…"}</b> contacts match
          {count?.optedOut > 0 && <span className="text-slate-500"> (+{count.optedOut} opted out, skipped)</span>}
        </span>
        <button type="button" className="text-xs text-slate-500 hover:text-slate-800" onClick={() => onChange({})}>Clear filter</button>
      </div>
    </div>
  );
}
