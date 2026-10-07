"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Users, Tag, ListChecks, Search, CircleDot, Megaphone, X, Pencil, SlidersHorizontal } from "lucide-react";
import { SegmentBuilder } from "@/components/segment-builder";
import { api } from "@/lib/api";
import { fmtDateTime, fmtPhone, toLocalInput } from "@/lib/format";
import { useToast } from "@/components/toast";
import { PageContainer } from "@/components/shell";
import { ContactFieldSelect, TemplatePreview, campaignVariablesFrom, variableExample } from "@/components/shared";
import { CAMPAIGN_PREFILL_KEY } from "@/components/contacts/import-wizard";
import { useLeadStatuses } from "@/lib/lead-statuses";

// Audience handed over from the Contacts page or a sheet upload (read once)
function readPrefill() {
  try {
    return JSON.parse(sessionStorage.getItem(CAMPAIGN_PREFILL_KEY) || "null");
  } catch {
    return null;
  }
}
import { Button, Card, Field, Input, PageHeader, PageLoader, Select, cx } from "@/components/ui";


// useSearchParams needs a Suspense boundary; key = edit id so switching campaigns starts fresh
export default function NewCampaignRoute() {
  return (
    <Suspense fallback={<PageLoader />}>
      <EditKeyed />
    </Suspense>
  );
}

function EditKeyed() {
  const editId = useSearchParams().get("edit");
  return <NewCampaignPage key={editId || "new"} editId={editId} />;
}

function NewCampaignPage({ editId }) {
  const toast = useToast();
  const router = useRouter();
  const [templates, setTemplates] = useState(null);
  const [tags, setTags] = useState([]);
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const { list: statuses } = useLeadStatuses();
  const [prefill] = useState(readPrefill);
  const [prefillLabel, setPrefillLabel] = useState(prefill?.label || "");
  const [audienceType, setAudienceType] = useState(prefill?.audience?.type || "all");
  const [selectedTags, setSelectedTags] = useState(prefill?.audience?.tags || []);
  const [selectedStatuses, setSelectedStatuses] = useState(prefill?.audience?.leadStatuses || []);
  const [selectedAds, setSelectedAds] = useState(prefill?.audience?.adIds || []);
  const [smartFilter, setSmartFilter] = useState(prefill?.audience?.filter || {});
  const [smartCount, setSmartCount] = useState(null);
  const [ads, setAds] = useState([]);
  const [contactIds, setContactIds] = useState(prefill?.audience?.contactIds || []);
  const [contactSearch, setContactSearch] = useState("");
  const [contactResults, setContactResults] = useState([]);
  const [variables, setVariables] = useState([]);
  const [fetchedCount, setFetchedCount] = useState(null);
  const [when, setWhen] = useState("now");
  const [scheduledAt, setScheduledAt] = useState("");
  const [saving, setSaving] = useState(false);
  // ?edit=<id>: edit a draft or scheduled campaign on this same page
  const [editing, setEditing] = useState(null); // the campaign being edited (once loaded)

  useEffect(() => {
    if (!editId) return;
    api(`/campaigns/${editId}`)
      .then((c) => {
        if (!["draft", "scheduled"].includes(c.status)) {
          toast.error(`A ${c.status} campaign can not be edited`);
          router.replace(`/app/campaigns/${c._id}`);
          return;
        }
        const a = c.audience || {};
        setName(c.name);
        setTemplateId(c.templateId?._id || c.templateId || "");
        setVariables((c.variables || []).map(({ source, value }) => ({ source, value })));
        setAudienceType(a.type || "all");
        setSelectedTags(a.tags || []);
        setSelectedStatuses(a.leadStatuses || []);
        setSelectedAds(a.adIds || []);
        setSmartFilter(a.filter || {});
        setContactIds(a.contactIds || []);
        if (a.type === "contacts" && a.contactIds?.length > 20) setPrefillLabel(`${a.contactIds.length} picked contacts`);
        if (c.status === "scheduled" && c.scheduledAt) {
          setWhen("later");
          setScheduledAt(toLocalInput(c.scheduledAt));
        }
        setEditing(c);
      })
      .catch((err) => {
        toast.error(err);
        router.replace("/app/campaigns");
      });
  }, [editId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api("/templates", { query: { status: "approved" } }).then(setTemplates).catch(toast.error);
    api("/contacts/tags").then(setTags);
    api("/contacts/ad-sources").then(setAds).catch(() => {});
    try {
      sessionStorage.removeItem(CAMPAIGN_PREFILL_KEY);
    } catch {}
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const template = useMemo(() => templates?.find((t) => t._id === templateId), [templates, templateId]);

  const chooseTemplate = (id) => {
    setTemplateId(id);
    const t = templates.find((x) => x._id === id);
    // Start with the template's own variable defaults (set on the Templates page)
    setVariables(t ? campaignVariablesFrom(t) : []);
  };

  const needsCountFetch =
    audienceType === "all" ||
    (audienceType === "tags" && selectedTags.length > 0) ||
    (audienceType === "status" && selectedStatuses.length > 0) ||
    (audienceType === "ads" && selectedAds.length > 0);
  useEffect(() => {
    if (!needsCountFetch) return;
    let active = true;
    const body = {
      tags: audienceType === "tags" ? selectedTags : [],
      leadStatuses: audienceType === "status" ? selectedStatuses : [],
      adIds: audienceType === "ads" ? selectedAds : [],
    };
    api("/contacts/count", { method: "POST", body }).then((r) => active && setFetchedCount(r.count));
    return () => {
      active = false;
    };
  }, [needsCountFetch, audienceType, selectedTags, selectedStatuses, selectedAds]);
  const count = audienceType === "contacts" ? contactIds.length : audienceType === "filter" ? smartCount?.reachable ?? null : needsCountFetch ? fetchedCount : 0;

  useEffect(() => {
    if (audienceType !== "contacts") return;
    const t = setTimeout(() => api("/contacts", { query: { search: contactSearch, limit: 20 } }).then((r) => setContactResults(r.items.filter((c) => !c.optedOut))), 250);
    return () => clearTimeout(t);
  }, [contactSearch, audienceType]);

  const sampleParams = variables.map((v, i) => (v.source === "static" ? v.value : variableExample({ ...v, example: "" }, i)));

  const submit = async (launch) => {
    setSaving(true);
    try {
      const body = {
        name,
        templateId,
        audience: { type: audienceType, tags: selectedTags, leadStatuses: selectedStatuses, adIds: selectedAds, contactIds, ...(audienceType === "filter" && { filter: smartFilter }) },
        variables,
        launch: launch && when === "now",
        scheduledAt: launch && when === "later" && scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
      };
      const c = editId ? await api(`/campaigns/${editId}`, { method: "PUT", body }) : await api("/campaigns", { method: "POST", body });
      toast.success(launch ? (when === "later" ? (editId ? "Changes saved. Campaign is scheduled." : "Campaign scheduled") : "Campaign started") : "Draft saved");
      router.push(`/app/campaigns/${c._id}`);
    } catch (err) {
      toast.error(err);
      if (!editId && err.details?.campaignId) router.push(`/app/campaigns/${err.details.campaignId}`);
    } finally {
      setSaving(false);
    }
  };

  if (!templates || (editId && !editing)) return <PageLoader />;
  const valid = name.trim().length >= 2 && template && count > 0 && variables.every((v) => v.value) && (when === "now" || scheduledAt);

  const audienceOptions = [
    { id: "all", label: "All contacts", icon: Users },
    { id: "filter", label: "Smart filter", icon: SlidersHorizontal },
    { id: "status", label: "By lead status", icon: CircleDot },
    { id: "tags", label: "By tags", icon: Tag },
    { id: "ads", label: "From an ad", icon: Megaphone },
    { id: "contacts", label: "Pick contacts", icon: ListChecks },
  ];
  const toggle = (setter) => (v) => setter((s) => (s.includes(v) ? s.filter((x) => x !== v) : [...s, v]));
  const chip = (on) => cx("rounded-full border px-3 py-1 text-sm", on ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-300 text-slate-600");

  return (
    <PageContainer>
      <Link href={editId ? `/app/campaigns/${editId}` : "/app/campaigns"} className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" /> {editId ? "Back to campaign" : "Campaigns"}</Link>
      <PageHeader
        title={editing ? (editing.status === "scheduled" ? "Edit scheduled campaign" : "Edit draft campaign") : "New bulk campaign"}
        description={editing?.status === "scheduled" ? `Currently scheduled for ${fmtDateTime(editing.scheduledAt)}. Changes can be made until 1 minute before it starts.` : undefined}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card className="space-y-4 p-5">
            <h2 className="font-medium text-slate-900">1. Campaign details</h2>
            <Field label="Campaign name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Diwali offer 2026" /></Field>
            <Field label="Approved template" hint={!templates.length ? "No approved templates yet — create one in Templates first." : undefined}>
              <Select value={templateId} onChange={(e) => chooseTemplate(e.target.value)}>
                <option value="">Select a template</option>
                {templates.map((t) => <option key={t._id} value={t._id}>{t.name} ({t.language})</option>)}
              </Select>
            </Field>
          </Card>

          <Card className="space-y-4 p-5">
            <h2 className="font-medium text-slate-900">2. Audience</h2>
            {prefillLabel && (
              <div className="flex items-center gap-2 rounded-md bg-brand-50 px-3 py-2 text-sm text-brand-800">
                <span className="flex-1">Audience: <b>{prefillLabel}</b></span>
                <button type="button" onClick={() => { setPrefillLabel(""); setAudienceType("all"); setContactIds([]); setSelectedTags([]); }} className="rounded p-1 hover:bg-brand-100" aria-label="Choose a different audience"><X className="h-4 w-4" /></button>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
              {audienceOptions.map(({ id, label, icon: Icon }) => (
                <button key={id} type="button" onClick={() => { setAudienceType(id); setPrefillLabel(""); }}
                  className={cx("flex flex-col items-center gap-1.5 rounded-lg border p-3 text-sm font-medium", audienceType === id ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600 hover:bg-slate-50")}>
                  <Icon className="h-5 w-5" />{label}
                </button>
              ))}
            </div>
            {audienceType === "status" && (
              <div className="flex flex-wrap gap-2">
                {statuses.map((st) => (
                  <button key={st.key} type="button" onClick={() => toggle(setSelectedStatuses)(st.key)} className={chip(selectedStatuses.includes(st.key))}>{st.label}</button>
                ))}
              </div>
            )}
            {audienceType === "ads" && (
              <div className="flex flex-wrap gap-2">
                {!ads.length && <p className="text-sm text-slate-500">No leads from Facebook / Instagram ads yet. They appear here when someone messages you from a Click-to-WhatsApp ad.</p>}
                {ads.map((a) => (
                  <button key={a.adId} type="button" onClick={() => toggle(setSelectedAds)(a.adId)} className={chip(selectedAds.includes(a.adId))}>
                    📣 {a.name || a.headline || a.adId} <span className="text-xs text-slate-400">({a.leads})</span>
                  </button>
                ))}
              </div>
            )}
            {audienceType === "filter" && (
              <>
                <p className="text-xs text-slate-500">Combine everything: e.g. <b>Interested</b> + tag <b>php</b> + contacted us in the <b>last 30 days</b>, or birthdays this month.</p>
                <SegmentBuilder value={smartFilter} onChange={setSmartFilter} onCount={setSmartCount} />
              </>
            )}
            {audienceType === "contacts" && contactIds.length > 20 && prefillLabel ? (
              <p className="text-sm text-slate-600">{contactIds.length} contacts picked on the Contacts page.</p>
            ) : null}
            {audienceType === "tags" && (
              <div className="flex flex-wrap gap-2">
                {!tags.length && <p className="text-sm text-slate-500">No tags yet. Add tags to contacts first.</p>}
                {tags.map((t) => (
                  <button key={t} type="button" onClick={() => setSelectedTags((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]))}
                    className={cx("rounded-full border px-3 py-1 text-sm", selectedTags.includes(t) ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-300 text-slate-600")}>
                    {t}
                  </button>
                ))}
              </div>
            )}
            {audienceType === "contacts" && !(contactIds.length > 20 && prefillLabel) && (
              <div>
                <div className="relative mb-2">
                  <Search className="absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
                  <Input className="pl-9" placeholder="Search contacts" value={contactSearch} onChange={(e) => setContactSearch(e.target.value)} />
                </div>
                <div className="scroll-thin max-h-60 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200">
                  {contactResults.map((c) => (
                    <label key={c._id} className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50">
                      <input type="checkbox" checked={contactIds.includes(c._id)} onChange={() => setContactIds((s) => (s.includes(c._id) ? s.filter((x) => x !== c._id) : [...s, c._id]))} />
                      <span className="flex-1">{c.name || "Unknown"}</span>
                      <span className="text-xs text-slate-500">{fmtPhone(c.phone)}</span>
                    </label>
                  ))}
                  {!contactResults.length && <p className="p-3 text-sm text-slate-500">No contacts found</p>}
                </div>
              </div>
            )}
            <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <b>{count ?? "…"}</b> contacts will receive this message <span className="text-slate-500">(opted-out contacts excluded)</span>
            </p>
          </Card>

          {template && variables.length > 0 && (
            <Card className="space-y-4 p-5">
              <h2 className="font-medium text-slate-900">3. Personalise variables</h2>
              <p className="-mt-2 text-xs text-slate-500">Filled from the template&apos;s default variables. Change them here for this campaign only.</p>
              {variables.map((v, i) => (
                <div key={i} className="grid items-end gap-2 sm:grid-cols-[3.5rem_12rem_1fr]">
                  <span className="pb-2 font-mono text-sm text-slate-600">{`{{${i + 1}}}`}</span>
                  <Select value={v.source} onChange={(e) => setVariables((vs) => vs.map((x, j) => (j === i ? { source: e.target.value, value: e.target.value === "field" ? "name" : "" } : x)))}>
                    <option value="field">Contact field</option>
                    <option value="static">Same text for all</option>
                  </Select>
                  {v.source === "field" ? (
                    <ContactFieldSelect value={v.value} onChange={(val) => setVariables((vs) => vs.map((x, j) => (j === i ? { ...x, value: val } : x)))} ariaLabel={`Variable ${i + 1} field`} />
                  ) : (
                    <Input placeholder="Text" value={v.value} onChange={(e) => setVariables((vs) => vs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                  )}
                </div>
              ))}
            </Card>
          )}

          <Card className="space-y-4 p-5">
            <h2 className="font-medium text-slate-900">{template && variables.length ? "4" : "3"}. When to send</h2>
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-2"><input type="radio" checked={when === "now"} onChange={() => setWhen("now")} /> Send now</label>
              <label className="flex items-center gap-2"><input type="radio" checked={when === "later"} onChange={() => setWhen("later")} /> Schedule</label>
            </div>
            {when === "later" && <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className="max-w-xs" />}
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-5 lg:sticky lg:top-4">
            <h2 className="mb-3 font-medium text-slate-900">Preview</h2>
            {template ? <TemplatePreview {...template} params={sampleParams} /> : <p className="text-sm text-slate-500">Select a template to preview.</p>}
            <div className="mt-5 flex flex-col gap-2">
              <Button className="justify-center" disabled={!valid} loading={saving} onClick={() => submit(true)}>
                {editId && <Pencil className="h-4 w-4" />}
                {when === "later" ? (editId ? "Save changes" : "Schedule campaign") : `Send to ${count ?? 0} contacts`}
              </Button>
              <Button variant="secondary" className="justify-center" disabled={!name || !templateId || saving} onClick={() => submit(false)}>
                {editing?.status === "scheduled" ? "Unschedule (save as draft)" : "Save as draft"}
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </PageContainer>
  );
}
