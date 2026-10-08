"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, Megaphone, Upload, Users } from "lucide-react";
import { api, downloadFile } from "@/lib/api";
import { useToast } from "@/components/toast";
import { LeadStatusSelect, TagInput } from "@/components/shared";
import { Badge, Button, Field, Input, Modal, Select, Toggle, cx } from "@/components/ui";

export const CAMPAIGN_PREFILL_KEY = "crm_campaign_prefill";

const FIELDS = [
  { key: "phone", label: "Phone / WhatsApp number", required: true },
  { key: "name", label: "Name", required: true },
  { key: "email", label: "Email" },
  { key: "tags", label: "Tags", hint: "separate with , | or ;" },
  { key: "leadStatus", label: "Lead status", hint: "e.g. Interested, Converted" },
  { key: "course", label: "Course", hint: "course name or code (Courses page)" },
  { key: "counsellor", label: "Counsellor", hint: "team member's name or email" },
  { key: "followUp", label: "Follow-up date", hint: "e.g. 15/10/2026 5 pm → next action" },
  { key: "notes", label: "Notes / query" },
  { key: "enquiryDate", label: "Enquiry date", hint: "when the lead came (for date filters)" },
];


/**
 * Upload an Excel (.xlsx) or CSV sheet in 3 steps: choose file → match columns (with preview) → result,
 * then send a bulk message to exactly the uploaded people.
 */
export function ImportWizard({ open, onClose, onImported, tagSuggestions = [] }) {
  const toast = useToast();
  const router = useRouter();
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null); // { headers, sample, totalRows, mapping }
  const [mapping, setMapping] = useState({});
  const [customColumns, setCustomColumns] = useState([]);
  const [countryCode, setCountryCode] = useState("91");
  const [addTags, setAddTags] = useState([]);
  const [setLeadStatus, setSetLeadStatus] = useState("");
  const [batchTag, setBatchTag] = useState(true);
  const [startDrips, setStartDrips] = useState(false);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setFile(null);
    setPreview(null);
    setMapping({});
    setCustomColumns([]);
    setAddTags([]);
    setSetLeadStatus("");
    setBatchTag(true);
    setStartDrips(false);
    setResult(null);
  };
  const close = () => {
    reset();
    onClose();
  };

  const readFile = async (f) => {
    setFile(f);
    if (!f) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", f);
      const p = await api("/contacts/import/preview", { method: "POST", form });
      setPreview(p);
      setMapping(p.mapping);
      const mapped = new Set(Object.values(p.mapping));
      setCustomColumns(p.headers.filter((h) => !mapped.has(h)));
    } catch (err) {
      toast.error(err);
      setFile(null);
    } finally {
      setBusy(false);
    }
  };

  const setField = (field, header) => {
    setMapping((m) => {
      const next = { ...m };
      if (header) next[field] = header;
      else delete next[field];
      return next;
    });
    // A column used for a field is no longer a custom field
    if (header) setCustomColumns((c) => c.filter((h) => h !== header));
  };

  const runImport = async () => {
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append(
        "options",
        JSON.stringify({
          mapping,
          customColumns,
          defaultCountryCode: countryCode,
          addTags,
          ...(setLeadStatus && { setLeadStatus }),
          batchTag,
          startDrips,
        })
      );
      const r = await api("/contacts/import", { method: "POST", form });
      setResult(r);
      onImported?.(r);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const sendCampaign = () => {
    const tags = result.batchTag ? [result.batchTag] : addTags;
    try {
      sessionStorage.setItem(CAMPAIGN_PREFILL_KEY, JSON.stringify({ audience: { type: "tags", tags }, label: `${file?.name} (${result.imported} contacts)` }));
    } catch {}
    close();
    router.push("/app/campaigns/new");
  };

  const mappedHeaders = new Set(Object.values(mapping));
  const otherHeaders = preview?.headers.filter((h) => !mappedHeaders.has(h)) || [];
  const step = result ? 3 : preview ? 2 : 1;

  const footer =
    step === 1 ? (
      <Button variant="secondary" onClick={close}>Cancel</Button>
    ) : step === 2 ? (
      <>
        <Button variant="secondary" onClick={reset}>Choose another file</Button>
        <Button onClick={runImport} loading={busy} disabled={!mapping.phone || !mapping.name}>
          <Upload className="h-4 w-4" /> Import {preview.totalRows} rows
        </Button>
      </>
    ) : (
      <Button variant="secondary" onClick={close}>Done</Button>
    );

  return (
    <Modal open={open} onClose={close} title="Import contacts from a sheet" size="lg" footer={footer}>
      <ol className="mb-5 flex items-center gap-2 text-xs font-medium">
        {["Choose file", "Match columns", "Done"].map((s, i) => (
          <li key={s} className={cx("flex items-center gap-2", step === i + 1 ? "text-brand-700" : "text-slate-400")}>
            <span className={cx("flex h-5 w-5 items-center justify-center rounded-full", step === i + 1 ? "bg-brand-600 text-white" : step > i + 1 ? "bg-brand-100 text-brand-700" : "bg-slate-100")}>{i + 1}</span>
            {s}
            {i < 2 && <span className="mx-1 text-slate-300">—</span>}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <div className="space-y-4 text-sm">
          <label className={cx("flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 px-4 py-10 text-center hover:border-brand-500 hover:bg-brand-50/40", busy && "pointer-events-none opacity-60")}>
            <FileSpreadsheet className="h-8 w-8 text-brand-600" />
            <span className="font-medium text-slate-800">{busy ? "Reading file…" : "Click to choose an Excel (.xlsx) or CSV file"}</span>
            <span className="text-xs text-slate-500">Max 10 MB, up to 50,000 rows. The first row must have the column names.</span>
            <input type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(e) => readFile(e.target.files?.[0] || null)} />
          </label>
          <p className="text-slate-500">
            Any column names work: you will match them in the next step. Indian 10-digit numbers get +91 automatically.
            Several tags in one cell: separate them with commas (<code>php, jaipur</code>). DOB / Anniversary columns are saved as dates.{" "}
            <button type="button" onClick={() => downloadFile("/contacts/import/sample", {}, "leads-sample.xlsx").catch(() => {})} className="font-medium text-brand-700 underline">Download sample Excel sheet</button>
          </p>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-5 text-sm">
          <p className="text-slate-600">
            <b>{file?.name}</b> · {preview.totalRows} rows. Tell us which column is what:
          </p>
          <p className="rounded-md bg-sky-50 px-3 py-2 text-xs text-sky-900">
            Only <b>Phone</b> and <b>Name</b> are needed. Everything else is optional: choose a column only if your sheet has it. Empty cells are skipped and never wipe details already in the CRM, so a sheet with half the details is fine.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {FIELDS.map((f) => (
              <Field key={f.key} label={`${f.label}${f.required ? " *" : ""}`} hint={f.hint}>
                <Select value={mapping[f.key] || ""} onChange={(e) => setField(f.key, e.target.value)}>
                  <option value="">{f.required ? "Choose column…" : "— Not in sheet —"}</option>
                  {preview.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </Select>
              </Field>
            ))}
          </div>

          {otherHeaders.length > 0 && (
            <Field label="Also save these columns on the contact" hint="Saved as extra details (shown in the contact and in exports)">
              <div className="flex flex-wrap gap-2">
                {otherHeaders.map((h) => (
                  <label key={h} className={cx("flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs", customColumns.includes(h) ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-300 text-slate-500")}>
                    <input type="checkbox" className="hidden" checked={customColumns.includes(h)} onChange={() => setCustomColumns((c) => (c.includes(h) ? c.filter((x) => x !== h) : [...c, h]))} />
                    {h}
                  </label>
                ))}
              </div>
            </Field>
          )}

          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  {preview.headers.map((h) => {
                    const field = Object.entries(mapping).find(([, v]) => v === h)?.[0];
                    return (
                      <th key={h} className="px-3 py-2 font-medium whitespace-nowrap">
                        {h}
                        {field && <Badge tone="green" className="ml-1">{FIELDS.find((f) => f.key === field)?.label.split(" ")[0]}</Badge>}
                        {!field && customColumns.includes(h) && <Badge tone="blue" className="ml-1">extra</Badge>}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {preview.sample.map((row, i) => (
                  <tr key={i}>
                    {preview.headers.map((h) => <td key={h} className="px-3 py-1.5 whitespace-nowrap text-slate-700">{row[h]}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Country code for 10-digit numbers" hint="98765 43210 → 91 98765 43210. Leave empty if numbers already have it.">
              <Input value={countryCode} maxLength={4} onChange={(e) => setCountryCode(e.target.value.replace(/\D/g, ""))} />
            </Field>
            <Field label="Lead status for rows without one">
              <LeadStatusSelect value={setLeadStatus} onChange={setSetLeadStatus} includeAll allLabel="Keep as is (new leads = New)" className="h-9 w-full text-sm" />
            </Field>
          </div>
          <Field label="Add these tags to everyone in this sheet (optional)">
            <TagInput value={addTags} onChange={setAddTags} suggestions={tagSuggestions} placeholder="e.g. expo-2026, php (comma or Enter)" />
          </Field>
          <Toggle checked={batchTag} onChange={setBatchTag} label="Tag this upload (e.g. sheet-061026-1530)" description="Lets you send a bulk message to exactly these people right after the import." />
          <Toggle checked={startDrips} onChange={setStartDrips} label="Start drips for these leads" description="Off for old enquiries: they are saved without getting welcome / follow-up series. Turn on for a fresh list that should start the drips set to “new lead” / status." />
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <ResultStat label="New contacts" value={result.created} tone="text-brand-700" />
            <ResultStat label="Updated" value={result.updated} tone="text-sky-700" />
            <ResultStat label="Invalid numbers" value={result.invalid} tone={result.invalid ? "text-amber-700" : "text-slate-400"} />
            {(result.unmatched?.course?.length > 0 || result.unmatched?.counsellor?.length > 0) && (
              <p className="col-span-full rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {result.unmatched.course?.length > 0 && <>Courses not found (add them on the Courses page and import again): <b>{result.unmatched.course.join(", ")}</b>. </>}
                {result.unmatched.counsellor?.length > 0 && <>Counsellors not found in the team: <b>{result.unmatched.counsellor.join(", ")}</b>.</>}
              </p>
            )}
            <ResultStat label="Duplicates merged" value={result.duplicatesInSheet} tone="text-slate-500" />
            {result.noName > 0 && <p className="col-span-full text-xs text-slate-500">{result.noName} row(s) had no name: they are saved with the number only. The chatbot asks the name when they write.</p>}
          </div>
          {result.skippedLimit > 0 && <p className="rounded-md bg-red-50 px-3 py-2 text-red-700">⛔ {result.skippedLimit} rows skipped — your plan&apos;s contact limit was reached.</p>}
          {result.errors.length > 0 && (
            <details className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <summary className="cursor-pointer font-medium">Rows that were skipped ({result.invalid})</summary>
              <ul className="mt-2 list-inside list-disc">{result.errors.map((e) => <li key={e}>{e}</li>)}</ul>
            </details>
          )}
          {result.imported > 0 && (
            <div className="rounded-lg border border-brand-200 bg-brand-50 p-4">
              <p className="font-medium text-brand-800">Next: message these {result.imported} people</p>
              <p className="mt-1 text-xs text-brand-800/80">
                {result.batchTag ? <>They are tagged <code className="rounded bg-white px-1">{result.batchTag}</code>.</> : "Use the tags you added to find them."}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {(result.batchTag || addTags.length > 0) && (
                  <Button size="sm" onClick={sendCampaign}><Megaphone className="h-4 w-4" /> Send bulk WhatsApp message</Button>
                )}
                {result.batchTag && (
                  <Button size="sm" variant="secondary" onClick={() => { onImported?.(result, { showTag: result.batchTag }); close(); }}>
                    <Users className="h-4 w-4" /> View these contacts
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function ResultStat({ label, value, tone }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 text-center">
      <p className={cx("text-2xl font-semibold tabular-nums", tone)}>{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}
