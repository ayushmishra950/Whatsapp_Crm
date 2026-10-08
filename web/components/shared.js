"use client";

import { useEffect, useState } from "react";
import { BellRing, X } from "lucide-react";
import { api } from "@/lib/api";
import { useLeadStatuses } from "@/lib/lead-statuses";
import { contactFieldValue, fmtFieldDate, useContactFields } from "@/lib/contact-fields";
import { fmtDateTime } from "@/lib/format";
import { useIsCoaching } from "@/lib/business";
import { Badge, Input, Select, cx } from "./ui";

export function TagInput({ value, onChange, suggestions = [], placeholder = "Add tags (comma or Enter)" }) {
  const [text, setText] = useState("");
  // "php, mern" (typed or pasted) adds two tags
  const add = (t) => {
    const tags = t.split(",").map((x) => x.trim().toLowerCase()).filter((x) => x && !value.includes(x));
    if (tags.length) onChange([...value, ...new Set(tags)]);
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
          onChange={(e) => (e.target.value.includes(",") && e.target.value.trim() !== "," ? add(e.target.value) : setText(e.target.value))}
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

export function TemplatePreview({ header, body, footer, params, buttons }) {
  const text = (body || "").replace(/\{\{(\d+)\}\}/g, (m, n) => (params?.[n - 1] ? params[n - 1] : m));
  return (
    <div className="rounded-lg bg-chat p-4">
      <div className="max-w-xs rounded-lg rounded-tl-none bg-white p-3 text-sm shadow-sm">
        {header && <p className="mb-1 font-semibold">{header}</p>}
        <p className="whitespace-pre-wrap text-slate-800">{text || "Message body…"}</p>
        {footer && <p className="mt-2 text-xs text-slate-400">{footer}</p>}
        {buttons?.length > 0 && (
          <div className="-mx-3 -mb-3 mt-2 divide-y divide-slate-100 border-t border-slate-100">
            {buttons.map((b, i) => (
              <p key={i} className="py-2 text-center text-sm font-medium text-sky-600">
                {b.type === "URL" ? "🔗 " : b.type === "PHONE_NUMBER" ? "📞 " : "↩ "}
                {b.text || "Button"}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


// ---------- Lead status ----------

export function LeadStatusBadge({ status }) {
  const { label, color } = useLeadStatuses();
  return <Badge tone={color(status)}>{label(status)}</Badge>;
}

const selectTones = {
  gray: "border-slate-300 bg-slate-50 text-slate-700",
  blue: "border-sky-200 bg-sky-50 text-sky-800",
  green: "border-brand-200 bg-brand-50 text-brand-800",
  yellow: "border-amber-200 bg-amber-50 text-amber-800",
  red: "border-red-200 bg-red-50 text-red-700",
  purple: "border-violet-200 bg-violet-50 text-violet-800",
};

/** Colored dropdown to change a lead's status in one click */
export function LeadStatusSelect({ value, onChange, className, disabled, includeAll, allLabel = "All statuses", title }) {
  const { list, color } = useLeadStatuses();
  return (
    <select
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={cx("h-8 rounded-md border px-2 pr-7 text-xs font-medium focus:ring-2 focus:ring-brand-500/20 focus:outline-none", value ? selectTones[color(value)] : selectTones.gray, className)}
      aria-label="Lead status"
      title={title}
    >
      {includeAll && <option value="">{allLabel}</option>}
      {list.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
    </select>
  );
}

// ---------- Follow-up ----------
export function FollowUpChip({ at }) {
  if (!at) return null;
  const overdue = new Date(at) < new Date();
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap", overdue ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800")} title={overdue ? "Follow-up overdue" : "Follow-up"}>
      <BellRing className="h-3 w-3" /> {fmtDateTime(at)}
    </span>
  );
}


// ---------- Template variables ({{1}}, {{2}} ...) ----------
const FIELD_EXAMPLES = {
  name: "Rahul", phone: "919876543210", email: "rahul@example.com", referral_code: "RAHUL7K2", referral_link: "https://wa.me/91…?text=…RAHUL7K2",
  "course.name": "Digital Marketing", "course.outcome": "run ads and get your first client", "course.next_batch": "15 Nov", "course.per_day": "₹300",
  "course.fees": "₹27,000 (EMI available)", "course.greeting": "Great choice!", "course.duration": "90 days", "course.internship": "3-month live internship",
  "course.proof_link": "https://example.com/results", "course.link": "https://yourwebsite.com/course", counsellor: "Riya", "business.name": "ABC Institute", "business.review_link": "https://g.page/r/…",
  "business.proof_link": "https://example.com/results", "business.offer_end": "31 Oct", "business.address": "Jaipur", "business.maps_link": "https://maps.app.goo.gl/…",
  "business.payment_details": "UPI: institute@upi", "business.city": "Jaipur", "business.students_trained": "3,000+", "business.since_year": "2012", "business.rating": "4.9/5",
};

export const countVariables = (body = "") => new Set(body.match(/\{\{(\d+)\}\}/g) || []).size;

// One default per {{n}} in the body (first one = contact name, others = text filled per campaign)
export function fitVariableDefaults(defaults = [], body = "") {
  return Array.from({ length: countVariables(body) }, (_, i) => defaults[i] || (i === 0 ? { source: "field", value: "name", example: "" } : { source: "static", value: "", example: "" }));
}

// What a template's defaults put into a bulk campaign's variable list
export const campaignVariablesFrom = (template) =>
  fitVariableDefaults(template?.variableDefaults, template?.body).map(({ source, value }) => ({ source, value }));

// Values for a single contact (inbox): fields come from the contact, text from the default
export const paramsForContact = (template, contact) =>
  fitVariableDefaults(template?.variableDefaults, template?.body).map((d) => (d.source === "field" ? contactFieldValue(contact, d.value) : d.value));

// Sample text Meta sees during review (and our preview)
export const variableExample = (d, i) =>
  d.example || (d.source === "static" ? d.value : FIELD_EXAMPLES[d.value] || (d.value?.startsWith("custom.") && d.value.slice(7).replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()))) || `sample${i + 1}`;

/** Dropdown of contact fields: built-in + custom (Settings → Contact fields) */
export function ContactFieldSelect({ value, onChange, className, ariaLabel }) {
  const { options, label } = useContactFields();
  const coaching = useIsCoaching();
  const known = options.some((o) => o.value === value);
  return (
    <Select className={className} value={value} onChange={(e) => onChange(e.target.value)} aria-label={ariaLabel}>
      {!known && value && <option value={value}>{label(value)} (not in field list)</option>}
      <optgroup label="Built-in">
        {options.filter((o) => !/^(custom\.|referral_|course\.|business\.|counsellor$)/.test(o.value)).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </optgroup>
      {options.some((o) => o.value.startsWith("custom.")) && (
        <optgroup label="Custom fields">
          {options.filter((o) => o.value.startsWith("custom.")).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </optgroup>
      )}
      <optgroup label="Refer & earn">
        {options.filter((o) => o.value.startsWith("referral_")).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </optgroup>
      {coaching && (
        <optgroup label="Lead's course">
          {options.filter((o) => o.value.startsWith("course.")).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </optgroup>
      )}
      <optgroup label="Counsellor & business">
        {options.filter((o) => o.value === "counsellor" || o.value.startsWith("business.")).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </optgroup>
    </Select>
  );
}

/** Editor for a template's variable defaults (Templates page) */
export function VariableDefaultsEditor({ value, body, onChange }) {
  const rows = fitVariableDefaults(value, body);
  if (!rows.length) return null;
  const set = (i, patch) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-2 rounded-md border border-slate-200 p-3">
      <div>
        <p className="text-sm font-medium text-slate-700">Variables</p>
        <p className="text-xs text-slate-500">What each {"{{n}}"} is filled with. Bulk campaigns and chats start with these values (you can still change them there). Saved only in this CRM, so changing them never needs WhatsApp approval.</p>
      </div>
      <div className="hidden gap-2 text-[11px] font-medium text-slate-500 uppercase sm:grid sm:grid-cols-[2.75rem_11rem_1fr_1fr]">
        <span />
        <span>Fill with</span>
        <span>Value</span>
        <span>Example for WhatsApp review</span>
      </div>
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[2.5rem_1fr] items-center gap-2 sm:grid-cols-[2.75rem_11rem_1fr_1fr]">
          <span className="font-mono text-sm text-slate-600">{`{{${i + 1}}}`}</span>
          <Select className="h-9 text-sm" value={r.source} aria-label={`Variable ${i + 1} type`}
            onChange={(e) => set(i, e.target.value === "field" ? { source: "field", value: "name" } : { source: "static", value: "" })}>
            <option value="field">Contact field</option>
            <option value="static">Same text for all</option>
          </Select>
          {r.source === "field" ? (
            <ContactFieldSelect className="col-start-2 h-9 text-sm sm:col-start-auto" value={r.value} onChange={(v) => set(i, { value: v })} ariaLabel={`Variable ${i + 1} field`} />
          ) : (
            <Input className="col-start-2 text-sm sm:col-start-auto" maxLength={200} value={r.value} onChange={(e) => set(i, { value: e.target.value })} placeholder="e.g. 15 October" title="Leave empty to fill it in each campaign" aria-label={`Variable ${i + 1} text`} />
          )}
          <Input className="col-start-2 text-sm sm:col-start-auto" maxLength={200} title="Sample value shown to WhatsApp when the template is reviewed" value={r.example} onChange={(e) => set(i, { example: e.target.value })}
            placeholder={`e.g. ${variableExample({ ...r, example: "" }, i)}`} aria-label={`Variable ${i + 1} example`} />
        </div>
      ))}
    </div>
  );
}

/**
 * Inputs for a contact's custom fields (Settings → Contact fields), plus any other values saved on the
 * contact (e.g. from an old import). Clearing a box deletes that value.
 */
export function CustomFieldInputs({ value, onChange, onBlurField, compact }) {
  const { custom, label } = useContactFields();
  const typeOf = (k) => custom.find((f) => f.key === k)?.type || "text";
  const optionsOf = (k) => custom.find((f) => f.key === k)?.options || [];
  const keys = [...custom.map((f) => f.key), ...Object.keys(value).filter((k) => !custom.some((f) => f.key === k))];
  if (!keys.length) {
    return compact ? null : <p className="text-xs text-slate-500">No custom fields yet. Add fields like Course or City in Settings → Contact fields.</p>;
  }
  return (
    <div className={cx("space-y-2", !compact && "rounded-md border border-slate-200 p-3")}>
      {!compact && <p className="text-xs font-medium text-slate-500">Custom fields</p>}
      <div className={cx("grid gap-2", !compact && "sm:grid-cols-2")}>
        {keys.map((k) => (
          <label key={k} className="block space-y-1">
            <span className="text-xs text-slate-600">{label(`custom.${k}`)}</span>
            {typeOf(k) === "date" ? (
              <>
                <Input
                  type="date"
                  className="h-8 text-sm"
                  value={/^\d{4}-\d{2}-\d{2}$/.test(value[k] || "") && !String(value[k]).startsWith("0000") ? value[k] : ""}
                  onChange={(e) => onChange({ ...value, [k]: e.target.value })}
                  onBlur={onBlurField ? () => onBlurField(k) : undefined}
                />
                {String(value[k] || "").startsWith("0000") && <span className="block text-[11px] text-slate-500">Saved without year: {fmtFieldDate(value[k])}</span>}
              </>
            ) : typeOf(k) === "select" ? (
              <Select className="h-8 text-sm" value={value[k] ?? ""} onChange={(e) => { onChange({ ...value, [k]: e.target.value }); onBlurField?.(k, e.target.value); }}>
                <option value="">—</option>
                {value[k] && !optionsOf(k).includes(value[k]) && <option value={value[k]}>{value[k]}</option>}
                {optionsOf(k).map((o) => <option key={o} value={o}>{o}</option>)}
              </Select>
            ) : typeOf(k) === "multiselect" ? (
              <MultiPick options={optionsOf(k)} value={value[k] || ""} onChange={(v) => { onChange({ ...value, [k]: v }); onBlurField?.(k, v); }} />
            ) : (
              <Input
                className="h-8 text-sm"
                maxLength={500}
                value={value[k] ?? ""}
                onChange={(e) => onChange({ ...value, [k]: e.target.value })}
                onBlur={onBlurField ? () => onBlurField(k) : undefined}
              />
            )}
          </label>
        ))}
      </div>
    </div>
  );
}

// Chips for a multi-select field, stored as "A, B"
function MultiPick({ options, value, onChange }) {
  const picked = value.split(",").map((v) => v.trim()).filter(Boolean);
  const toggle = (o) => onChange((picked.includes(o) ? picked.filter((p) => p !== o) : [...picked, o]).join(", "));
  return (
    <div className="flex flex-wrap gap-1">
      {[...options, ...picked.filter((p) => !options.includes(p))].map((o) => (
        <button key={o} type="button" onClick={() => toggle(o)}
          className={cx("rounded-full border px-2 py-0.5 text-xs", picked.includes(o) ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600 hover:bg-slate-50")}>
          {o}
        </button>
      ))}
    </div>
  );
}

// ---------- Follow-up that also sends a WhatsApp message ----------
let approvedTemplatesCache = null; // shared by all forms on the page
function useApprovedTemplates() {
  const [list, setList] = useState(approvedTemplatesCache);
  useEffect(() => {
    if (approvedTemplatesCache) return;
    api("/templates", { query: { status: "approved" } })
      .then((t) => {
        approvedTemplatesCache = t;
        setList(t);
      })
      .catch(() => setList([]));
  }, []);
  return list || [];
}

/**
 * "Remind me" vs "Also send this WhatsApp template to the customer at the follow-up time".
 * value = { followUpAction, followUpTemplateId, followUpSentAt }
 */
export function FollowUpMessage({ value, onChange, disabled }) {
  const templates = useApprovedTemplates();
  const on = value.followUpAction === "message";
  return (
    <div className="space-y-2 rounded-md border border-slate-200 p-2.5">
      <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" className="mt-0.5" disabled={disabled} checked={on} onChange={(e) => onChange({ followUpAction: e.target.checked ? "message" : "remind", ...(!e.target.checked && { followUpTemplateId: null }) })} />
        <span>Also send a WhatsApp message to the customer at this time</span>
      </label>
      {on && (
        <>
          <Select className="h-9 text-sm" value={value.followUpTemplateId || ""} onChange={(e) => onChange({ followUpTemplateId: e.target.value || null })} aria-label="Follow-up template">
            <option value="">Choose an approved template…</option>
            {templates.map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}
          </Select>
          <p className="text-[11px] text-slate-500">
            {value.followUpSentAt ? `✅ Sent ${fmtDateTime(value.followUpSentAt)}. Change the time to send again.` : "Sent automatically at the follow-up time (variables use the template's defaults)."}
          </p>
        </>
      )}
    </div>
  );
}

// ---------- Refer & earn box on a contact ----------
export function ReferralBox({ contactId, compact }) {
  const [info, setInfo] = useState(null);
  const [copied, setCopied] = useState("");
  useEffect(() => {
    if (!contactId) return;
    let alive = true;
    api(`/referrals/contact/${contactId}`).then((r) => alive && setInfo(r)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [contactId]);
  if (!info) return null;
  const copy = async (text, what) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(""), 1500);
    } catch {}
  };
  return (
    <div className={cx("rounded-md bg-amber-50 p-3 text-sm text-amber-950", compact && "text-xs")}>
      <p className="mb-1 text-xs font-medium text-amber-800">🎁 Refer &amp; earn</p>
      <div className="flex flex-wrap items-center gap-2">
        <span>Code: <code className="rounded bg-white px-1.5 py-0.5 font-semibold">{info.code}</code></span>
        <button type="button" className="text-xs text-amber-800 underline" onClick={() => copy(info.code, "code")}>{copied === "code" ? "Copied" : "Copy code"}</button>
        <button type="button" className="text-xs text-amber-800 underline disabled:opacity-50" disabled={!info.hasNumber} title={info.hasNumber ? info.link : "Set the WhatsApp number in Settings → Refer & earn"} onClick={() => copy(info.link, "link")}>{copied === "link" ? "Copied" : "Copy share link"}</button>
      </div>
      <p className="mt-1 text-xs">
        Referred {info.referred} · joined {info.converted} · discounts given {info.rewardsGiven}
        {info.referredBy && <> · <b>referred by {info.referredBy.name || info.referredBy.phone}</b></>}
      </p>
    </div>
  );
}
