"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Users, Tag, ListChecks, Search } from "lucide-react";
import { api } from "@/lib/api";
import { fmtPhone } from "@/lib/format";
import { useToast } from "@/components/toast";
import { PageContainer } from "@/components/shell";
import { TemplatePreview } from "@/components/shared";
import { Button, Card, Field, Input, PageHeader, PageLoader, Select, cx } from "@/components/ui";

const FIELD_OPTIONS = [["name", "Contact name"], ["phone", "Phone"], ["email", "Email"]];

export default function NewCampaignPage() {
  const toast = useToast();
  const router = useRouter();
  const [templates, setTemplates] = useState(null);
  const [tags, setTags] = useState([]);
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [audienceType, setAudienceType] = useState("all");
  const [selectedTags, setSelectedTags] = useState([]);
  const [contactIds, setContactIds] = useState([]);
  const [contactSearch, setContactSearch] = useState("");
  const [contactResults, setContactResults] = useState([]);
  const [variables, setVariables] = useState([]);
  const [fetchedCount, setFetchedCount] = useState(null);
  const [when, setWhen] = useState("now");
  const [scheduledAt, setScheduledAt] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api("/templates", { query: { status: "approved" } }).then(setTemplates).catch(toast.error);
    api("/contacts/tags").then(setTags);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const template = useMemo(() => templates?.find((t) => t._id === templateId), [templates, templateId]);

  const chooseTemplate = (id) => {
    setTemplateId(id);
    const t = templates.find((x) => x._id === id);
    setVariables(t ? Array.from({ length: t.variableCount }, (_, i) => (i === 0 ? { source: "field", value: "name" } : { source: "static", value: "" })) : []);
  };

  const needsCountFetch = audienceType === "all" || (audienceType === "tags" && selectedTags.length > 0);
  useEffect(() => {
    if (!needsCountFetch) return;
    let active = true;
    api("/contacts/count", { method: "POST", body: { tags: audienceType === "tags" ? selectedTags : [] } }).then((r) => active && setFetchedCount(r.count));
    return () => {
      active = false;
    };
  }, [needsCountFetch, audienceType, selectedTags]);
  const count = audienceType === "contacts" ? contactIds.length : needsCountFetch ? fetchedCount : 0;

  useEffect(() => {
    if (audienceType !== "contacts") return;
    const t = setTimeout(() => api("/contacts", { query: { search: contactSearch, limit: 20 } }).then((r) => setContactResults(r.items.filter((c) => !c.optedOut))), 250);
    return () => clearTimeout(t);
  }, [contactSearch, audienceType]);

  const sampleParams = variables.map((v) => (v.source === "static" ? v.value : { name: "Rahul", phone: "919876543210", email: "rahul@example.com" }[v.value] || `[${v.value}]`));

  const submit = async (launch) => {
    setSaving(true);
    try {
      const body = {
        name,
        templateId,
        audience: { type: audienceType, tags: selectedTags, contactIds },
        variables,
        launch: launch && when === "now",
        scheduledAt: launch && when === "later" && scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
      };
      const c = await api("/campaigns", { method: "POST", body });
      toast.success(launch ? (when === "later" ? "Campaign scheduled" : "Campaign started") : "Draft saved");
      router.push(`/app/campaigns/${c._id}`);
    } catch (err) {
      toast.error(err);
      if (err.details?.campaignId) router.push(`/app/campaigns/${err.details.campaignId}`);
    } finally {
      setSaving(false);
    }
  };

  if (!templates) return <PageLoader />;
  const valid = name.trim().length >= 2 && template && count > 0 && variables.every((v) => v.value) && (when === "now" || scheduledAt);

  const audienceOptions = [
    { id: "all", label: "All contacts", icon: Users },
    { id: "tags", label: "By tags", icon: Tag },
    { id: "contacts", label: "Pick contacts", icon: ListChecks },
  ];

  return (
    <PageContainer>
      <Link href="/app/campaigns" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" /> Campaigns</Link>
      <PageHeader title="New bulk campaign" />

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
            <div className="grid grid-cols-3 gap-2">
              {audienceOptions.map(({ id, label, icon: Icon }) => (
                <button key={id} type="button" onClick={() => setAudienceType(id)}
                  className={cx("flex flex-col items-center gap-1.5 rounded-lg border p-3 text-sm font-medium", audienceType === id ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600 hover:bg-slate-50")}>
                  <Icon className="h-5 w-5" />{label}
                </button>
              ))}
            </div>
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
            {audienceType === "contacts" && (
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
              {variables.map((v, i) => (
                <div key={i} className="grid items-end gap-2 sm:grid-cols-[3.5rem_12rem_1fr]">
                  <span className="pb-2 font-mono text-sm text-slate-600">{`{{${i + 1}}}`}</span>
                  <Select value={v.source} onChange={(e) => setVariables((vs) => vs.map((x, j) => (j === i ? { source: e.target.value, value: e.target.value === "field" ? "name" : "" } : x)))}>
                    <option value="field">Contact field</option>
                    <option value="static">Same text for all</option>
                  </Select>
                  {v.source === "field" ? (
                    <Select value={v.value} onChange={(e) => setVariables((vs) => vs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}>
                      {FIELD_OPTIONS.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
                    </Select>
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
                {when === "later" ? "Schedule campaign" : `Send to ${count ?? 0} contacts`}
              </Button>
              <Button variant="secondary" className="justify-center" disabled={!name || !templateId || saving} onClick={() => submit(false)}>Save as draft</Button>
            </div>
          </Card>
        </div>
      </div>
    </PageContainer>
  );
}
