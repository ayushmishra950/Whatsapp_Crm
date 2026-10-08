"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Plus, Trash2, ArrowUp, ArrowDown, Play, Pause, UserPlus, Save, X } from "lucide-react";
import { api } from "@/lib/api";
import { useSocketEvent } from "@/lib/socket";
import { fmtDateTime, fmtPhone } from "@/lib/format";
import { useLeadStatuses } from "@/lib/lead-statuses";
import { LEAD_SOURCES, useContactFields } from "@/lib/contact-fields";
import { useIsCoaching } from "@/lib/business";
import { useToast } from "@/components/toast";
import { PageContainer } from "@/components/shell";
import { ContactFieldSelect, TagInput, TemplatePreview, campaignVariablesFrom, variableExample } from "@/components/shared";
import { SegmentBuilder } from "@/components/segment-builder";
import { draftFromIdea, newStep, triggerSummary } from "@/components/drips";
import { Badge, Button, Card, ConfirmModal, Field, Input, Modal, PageHeader, PageLoader, Pagination, Select, StatusBadge, Table, Toggle, cx } from "@/components/ui";

const TRIGGERS = [
  ["new_lead", "A new lead arrives"],
  ["ad_lead", "A new lead comes from a Facebook / Instagram ad"],
  ["tag_added", "A tag is added to a contact"],
  ["status_changed", "Lead status changes to…"],
  ["date", "Birthday / anniversary (every year)"],
  ["manual", "I add people myself (from Contacts or a filter)"],
];
const OFFSETS = [[0, "On the day"], [-1, "1 day before"], [-2, "2 days before"], [-3, "3 days before"], [-7, "7 days before"], [1, "1 day after"]];
const SOURCES = LEAD_SOURCES;
const STEP_KINDS = [["message", "💬 Send a WhatsApp template"], ["task", "📝 Create a task for the counsellor"], ["alert", "🔔 Alert the counsellor"], ["status", "🔀 Change the lead status"]];
const STOP_REASONS = { replied: "Replied", status: "Status changed", status_changed: "Moved to another status", other_drip: "Started another drip", opted_out: "Opted out", removed: "Removed", contact_deleted: "Contact deleted", drip_deleted: "Drip deleted" };

const waitText = (s) => [s.delayDays ? `${s.delayDays} day(s)` : "", s.delayMinutes ? (s.delayMinutes % 60 ? `${s.delayMinutes} min` : `${s.delayMinutes / 60} hour(s)`) : ""].filter(Boolean).join(" + ") || "0 days";
const chip = (on) => cx("rounded-full border px-2.5 py-0.5 text-xs", on ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-300 text-slate-600 hover:bg-slate-50");
const toggleIn = (list = [], v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

export default function DripRoute() {
  return (
    <Suspense fallback={<PageLoader />}>
      <DripEditor />
    </Suspense>
  );
}

function DripEditor() {
  const { id } = useParams();
  const isNew = id === "new";
  const idea = useSearchParams().get("idea");
  const router = useRouter();
  const toast = useToast();
  const { list: statuses, label: statusLabel } = useLeadStatuses();
  const { dateFields, label: fieldLabel } = useContactFields();
  const coaching = useIsCoaching();
  const [drip, setDrip] = useState(null); // saved drip (existing)
  const [form, setForm] = useState(() => (isNew ? draftFromIdea(idea, { dateFields, statuses }) : null));
  const [templates, setTemplates] = useState(null);
  const [ads, setAds] = useState([]);
  const [saving, setSaving] = useState(false);
  const [showCondition, setShowCondition] = useState(false);
  const [activateAsk, setActivateAsk] = useState(false);
  const [enrollOpen, setEnrollOpen] = useState(false);

  const load = useCallback(() => {
    if (isNew) return;
    api(`/drips/${id}`)
      .then((d) => {
        setDrip(d);
        setForm((f) => f || {
          name: d.name, trigger: d.trigger, condition: d.condition || {}, stopOnReply: d.stopOnReply, stopStatuses: d.stopStatuses,
          stopOnStatusChange: d.stopOnStatusChange !== false, onComplete: { setStatus: d.onComplete?.setStatus || "", addTag: d.onComplete?.addTag || "" },
          steps: d.steps.map((s) => ({ ...newStep(), ...s, kind: s.kind || "message", templateId: s.templateId?._id || s.templateId || "", templateIdHi: s.templateIdHi?._id || s.templateIdHi || "", variablesHi: s.variablesHi || [] })),
        });
        setShowCondition((s) => s || Object.keys(d.condition || {}).some((k) => JSON.stringify(d.condition[k]) !== JSON.stringify(k === "tagMatch" ? "any" : Array.isArray(d.condition[k]) ? [] : {})));
      })
      .catch((err) => {
        toast.error(err);
        router.replace("/app/drips");
      });
  }, [id, isNew]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
    api("/templates").then(setTemplates).catch(toast.error);
    api("/contacts/ad-sources").then(setAds).catch(() => {});
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  useSocketEvent("drip:update", (u) => u._id === id && api(`/drips/${id}`).then(setDrip).catch(() => {}));

  const approved = useMemo(() => (templates || []).filter((t) => t.status === "approved"), [templates]);
  if (!form || !templates) return <PageLoader />;

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setTrigger = (patch) => setForm((f) => ({ ...f, trigger: { ...f.trigger, ...patch } }));
  const setStep = (i, patch) => setForm((f) => ({ ...f, steps: f.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const moveStep = (i, d) =>
    setForm((f) => {
      const steps = [...f.steps];
      const j = i + d;
      if (j < 0 || j >= steps.length) return f;
      [steps[i], steps[j]] = [steps[j], steps[i]];
      return { ...f, steps };
    });
  const t = form.trigger;

  const save = async () => {
    setSaving(true);
    try {
      const body = {
        ...form,
        condition: showCondition ? form.condition : {},
        steps: form.steps.map((s) => ({ ...s, templateId: s.templateId || null, templateIdHi: s.templateIdHi || null })),
      };
      const saved = await api(isNew ? "/drips" : `/drips/${id}`, { method: isNew ? "POST" : "PUT", body });
      toast.success(isNew ? "Drip saved. Turn it on when you are ready." : "Drip saved");
      if (isNew) router.replace(`/app/drips/${saved._id}`);
      else load();
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (status, includeExisting = false) => {
    try {
      const r = await api(`/drips/${id}/status`, { method: "POST", body: { status, includeExisting } });
      toast.success(status === "active" ? `Drip is ON${r.added ? `, ${r.added} contact(s) added` : ""}` : "Drip paused");
      setActivateAsk(false);
      load();
    } catch (err) {
      toast.error(err);
    }
  };
  const canIncludeExisting = ["tag_added", "status_changed", "ad_lead"].includes(drip?.trigger?.type);

  return (
    <PageContainer>
      <Link href="/app/drips" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" /> Drips</Link>
      <PageHeader
        title={<span className="flex items-center gap-3">{isNew ? "New drip" : drip?.name}{drip && <StatusBadge status={drip.status} />}</span>}
        description={drip ? `⚡ ${triggerSummary(drip.trigger, { statusLabel, fieldLabel })}` : "Messages that go out automatically, one after another."}
        actions={
          drip && (
            <>
              {drip.trigger.type !== "date" && <Button variant="secondary" onClick={() => setEnrollOpen(true)}><UserPlus className="h-4 w-4" /> Add people</Button>}
              {drip.status === "active" ? (
                <Button variant="secondary" onClick={() => setStatus("paused")}><Pause className="h-4 w-4" /> Pause</Button>
              ) : (
                <Button onClick={() => (canIncludeExisting ? setActivateAsk(true) : setStatus("active"))}><Play className="h-4 w-4" /> Turn on</Button>
              )}
            </>
          )
        }
      />

      {drip && (
        <div className="mb-5 flex flex-wrap gap-2 text-sm">
          <Badge tone="blue">{drip.stats?.active || 0} in progress</Badge>
          <Badge tone="green">{drip.stats?.sent || 0} messages sent</Badge>
          <Badge tone="purple">{drip.stats?.replied || 0} replied</Badge>
          <Badge>{drip.stats?.completed || 0} finished</Badge>
          {drip.stats?.failed > 0 && <Badge tone="red">{drip.stats.failed} failed / skipped</Badge>}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card className="space-y-4 p-5">
            <h2 className="font-medium text-slate-900">1. Name &amp; when it starts</h2>
            <Field label="Drip name"><Input maxLength={80} value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. PHP course nurture" /></Field>
            <Field label="Start when…">
              <Select value={t.type} onChange={(e) => setTrigger({ type: e.target.value })}>
                {TRIGGERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </Field>
            {t.type === "new_lead" && (
              <Field label="Only leads from (none selected = all)">
                <div className="flex flex-wrap gap-1.5">{SOURCES.map(([v, l]) => <button key={v} type="button" className={chip(t.sources?.includes(v))} onClick={() => setTrigger({ sources: toggleIn(t.sources, v) })}>{l}</button>)}</div>
              </Field>
            )}
            {t.type === "ad_lead" && (
              <Field label="Only these ads (none selected = any ad)" hint="Give ads names on the Ads page.">
                <div className="flex flex-wrap gap-1.5">
                  {!ads.length && <span className="text-sm text-slate-500">No ad leads yet.</span>}
                  {ads.map((a) => <button key={a.adId} type="button" className={chip(t.adIds?.includes(a.adId))} onClick={() => setTrigger({ adIds: toggleIn(t.adIds, a.adId) })}>📣 {a.name || a.headline || a.adId}</button>)}
                </div>
              </Field>
            )}
            {t.type === "tag_added" && (
              <Field label="When one of these tags is added"><TagInput value={t.tags || []} onChange={(tags) => setTrigger({ tags })} placeholder="e.g. php, mern" /></Field>
            )}
            {t.type === "status_changed" && (
              <Field label="When status becomes">
                <div className="flex flex-wrap gap-1.5">{statuses.map((s) => <button key={s.key} type="button" className={chip(t.statuses?.includes(s.key))} onClick={() => setTrigger({ statuses: toggleIn(t.statuses, s.key) })}>{s.label}</button>)}</div>
              </Field>
            )}
            {t.type === "date" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Date field" hint={!dateFields.length ? "Add a Date field (e.g. DOB) in Settings → Contact fields first." : "Filled by the student (chatbot question, Excel import or contact form)."}>
                  <Select value={t.field} onChange={(e) => setTrigger({ field: e.target.value })}>
                    <option value="">Choose…</option>
                    {dateFields.map((f) => <option key={f.key} value={`custom.${f.key}`}>{f.label}</option>)}
                  </Select>
                </Field>
                <Field label="Send">
                  <Select value={t.offsetDays || 0} onChange={(e) => setTrigger({ offsetDays: Number(e.target.value) })}>
                    {OFFSETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </Select>
                </Field>
              </div>
            )}
            {t.type === "manual" && <p className="text-sm text-slate-500">After saving, use <b>Add people</b> (by filter, e.g. all Converted students), or <b>Contacts → select → Add to drip</b>.</p>}

            <Toggle
              checked={showCondition}
              onChange={setShowCondition}
              label="Only for some contacts"
              description="Extra condition, e.g. only tag php, or only Interested leads from the last 30 days."
            />
            {showCondition && <SegmentBuilder value={form.condition || {}} onChange={(condition) => set({ condition })} showSaved />}
          </Card>

          <Card className="space-y-4 p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-medium text-slate-900">2. Steps</h2>
              <Button size="sm" variant="secondary" disabled={form.steps.length >= 30} onClick={() => set({ steps: [...form.steps, newStep(2, "11:00")] })}><Plus className="h-4 w-4" /> Add step</Button>
            </div>
            {!approved.length && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">No approved templates yet. Create one in Templates and get it approved first.</p>}
            {form.steps.map((s, i) => {
              const tpl = templates.find((x) => x._id === s.templateId);
              const tplHi = templates.find((x) => x._id === s.templateIdHi);
              const kind = s.kind || "message";
              const pickTemplate = (key, varsKey) => (e) => {
                const nt = templates.find((x) => x._id === e.target.value);
                setStep(i, { [key]: e.target.value, [varsKey]: nt ? campaignVariablesFrom(nt) : [] });
              };
              return (
                <div key={i} className="rounded-lg border border-slate-200 p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="shrink-0 text-sm font-medium text-slate-700">Step {i + 1}</span>
                      <Select className="h-8 max-w-72 text-sm" value={kind} onChange={(e) => setStep(i, { kind: e.target.value })} aria-label={`Step ${i + 1} type`}>
                        {STEP_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </Select>
                    </div>
                    <div className="flex items-center gap-0.5">
                      <Button size="icon" variant="ghost" className="!w-7" disabled={i === 0} onClick={() => moveStep(i, -1)} aria-label="Move up"><ArrowUp className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" className="!w-7" disabled={i === form.steps.length - 1} onClick={() => moveStep(i, 1)} aria-label="Move down"><ArrowDown className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" className="!w-7" disabled={form.steps.length === 1} onClick={() => set({ steps: form.steps.filter((_, j) => j !== i) })} aria-label="Remove step"><Trash2 className="h-4 w-4 text-red-500" /></Button>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {kind === "message" && (
                      <Field label="Template" className="sm:col-span-2">
                        <Select value={s.templateId} onChange={pickTemplate("templateId", "variables")}>
                          <option value="">Choose an approved template…</option>
                          {approved.map((x) => <option key={x._id} value={x._id}>{x.name} ({x.language})</option>)}
                          {tpl && tpl.status !== "approved" && <option value={tpl._id}>{tpl.name} (not approved)</option>}
                        </Select>
                      </Field>
                    )}
                    {kind === "task" && (
                      <>
                        <Field label="Task" hint="{name} = the lead's name">
                          <Input maxLength={200} value={s.text} placeholder="e.g. Call {name} – hot lead" onChange={(e) => setStep(i, { text: e.target.value })} />
                        </Field>
                        <Field label="Due in (minutes)">
                          <Input type="number" min={0} value={s.dueMinutes} onChange={(e) => setStep(i, { dueMinutes: Math.max(0, Number(e.target.value) || 0) })} />
                        </Field>
                      </>
                    )}
                    {kind === "alert" && (
                      <Field label="Alert text" hint="Shown in the counsellor's 🔔 (admins if nobody is assigned)" className="sm:col-span-2">
                        <Input maxLength={200} value={s.text} placeholder="e.g. {name} did not reply for 2 days – call now" onChange={(e) => setStep(i, { text: e.target.value })} />
                      </Field>
                    )}
                    {kind === "status" && (
                      <Field label="Move the lead to" className="sm:col-span-2" hint="This drip keeps going; the new status may start its own drip.">
                        <Select value={s.setStatus} onChange={(e) => setStep(i, { setStatus: e.target.value })}>
                          <option value="">Choose…</option>
                          {statuses.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                        </Select>
                      </Field>
                    )}
                    <Field label={i === 0 ? (t.type === "date" ? "Days after the date" : "Wait (days + hours)") : "Wait after previous (days + hours)"}>
                      <div className="flex gap-2">
                        <Input type="number" min={0} max={365} value={s.delayDays} onChange={(e) => setStep(i, { delayDays: Math.max(0, Math.min(365, Number(e.target.value) || 0)) })} aria-label="Days" title="Days" />
                        <Select value={s.delayMinutes || 0} onChange={(e) => setStep(i, { delayMinutes: Number(e.target.value) })} aria-label="Extra hours / minutes">
                          {[[0, "+0"], [10, "+10 min"], [30, "+30 min"], [60, "+1 hour"], [120, "+2 hours"], [240, "+4 hours"], [360, "+6 hours"], [720, "+12 hours"]]
                            .concat(![0, 10, 30, 60, 120, 240, 360, 720].includes(s.delayMinutes || 0) ? [[s.delayMinutes, `+${s.delayMinutes} min`]] : [])
                            .map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </Select>
                      </div>
                    </Field>
                    <Field label="At time">
                      <Input type="time" value={s.sendTime} onChange={(e) => setStep(i, { sendTime: e.target.value })} title="Leave empty to run as soon as it is due" />
                    </Field>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {i === 0 && t.type === "date"
                      ? `Runs ${s.delayDays ? `${s.delayDays} day(s) after the date` : "on the date"} at ${s.sendTime || "10:00"}.`
                      : i === 0
                      ? s.delayDays || s.delayMinutes ? `Runs ${waitText(s)} after the contact enters${s.sendTime ? `, at ${s.sendTime}` : ""}.` : `Runs right away${s.sendTime ? ` (at ${s.sendTime} if that time has not passed today)` : ""}.`
                      : `Runs ${waitText(s)} after step ${i}${s.sendTime ? `, at ${s.sendTime}` : ""}.`}
                    {kind !== "message" && " No quiet hours or daily limit (nothing is sent to the customer)."}
                  </p>
                  {kind === "message" && tpl && <VariableRows vars={s.variables} onChange={(variables) => setStep(i, { variables })} />}
                  {kind === "message" && tpl && <div className="mt-3 max-w-sm"><TemplatePreview {...tpl} params={s.variables.map((v, k) => variableExample({ ...v, example: "" }, k))} /></div>}
                  {kind === "message" && coaching && (
                    <div className="mt-3 rounded-md bg-slate-50 p-3">
                      <Field label="Hinglish version (optional)" hint="Leads whose language is Hinglish get this template instead">
                        <Select value={s.templateIdHi || ""} onChange={pickTemplate("templateIdHi", "variablesHi")}>
                          <option value="">Same template for everyone</option>
                          {approved.map((x) => <option key={x._id} value={x._id}>{x.name} ({x.language})</option>)}
                          {tplHi && tplHi.status !== "approved" && <option value={tplHi._id}>{tplHi.name} (not approved)</option>}
                        </Select>
                      </Field>
                      {tplHi && <VariableRows vars={s.variablesHi} onChange={(variablesHi) => setStep(i, { variablesHi })} />}
                    </div>
                  )}
                </div>
              );
            })}
          </Card>

          <Card className="space-y-4 p-5">
            <h2 className="font-medium text-slate-900">3. When to stop</h2>
            <Toggle checked={form.stopOnReply} onChange={(v) => set({ stopOnReply: v })} label="Stop when the customer replies" description="Your team takes over the conversation instead of more automatic messages." />
            <Field label="Stop when the lead status becomes">
              <div className="flex flex-wrap gap-1.5">{statuses.map((s) => <button key={s.key} type="button" className={chip(form.stopStatuses?.includes(s.key))} onClick={() => set({ stopStatuses: toggleIn(form.stopStatuses, s.key) })}>{s.label}</button>)}</div>
            </Field>
            <Toggle checked={form.stopOnStatusChange ?? !["date", "manual"].includes(t.type)} onChange={(v) => set({ stopOnStatusChange: v })} label="One status = one drip"
              description="Stop when the lead moves to any other status, and stop the lead's other drips when this one starts. Turn off for birthday / refer drips that run beside the others." />
            <Field label="When the last step is done" hint="e.g. move to Nurture – Later after the 10-day Warm series">
              <div className="grid gap-2 sm:grid-cols-2">
                <Select value={form.onComplete?.setStatus || ""} onChange={(e) => set({ onComplete: { ...form.onComplete, setStatus: e.target.value } })} aria-label="Status when finished">
                  <option value="">Keep the status</option>
                  {statuses.map((x) => <option key={x.key} value={x.key}>Move to {x.label}</option>)}
                </Select>
                <Input maxLength={40} placeholder="Add tag (optional)" value={form.onComplete?.addTag || ""} onChange={(e) => set({ onComplete: { ...form.onComplete, addTag: e.target.value.toLowerCase() } })} aria-label="Tag when finished" />
              </div>
            </Field>
            <p className="text-xs text-slate-500">Always: opted-out contacts are never messaged, nothing is sent during quiet hours, and each contact gets at most the daily limit of automatic messages (Settings → Automation).</p>
          </Card>

          <div className="flex justify-end">
            <Button onClick={save} loading={saving} disabled={form.name.trim().length < 2 || form.steps.some((s) => (s.kind || "message") === "message" && !s.templateId)}><Save className="h-4 w-4" /> {isNew ? "Save drip" : "Save changes"}</Button>
          </div>
        </div>

        <div className="space-y-4">
          <Card className="p-5 text-sm text-slate-600 lg:sticky lg:top-4">
            <h2 className="mb-2 font-medium text-slate-900">How it works</h2>
            <ol className="list-decimal space-y-1.5 pl-4">
              <li>A contact enters when the start condition happens (or you add them).</li>
              <li>Each message waits its days, then goes out at its time (outside quiet hours).</li>
              <li>It stops early on a reply or a stop status, if set.</li>
              <li>Messages use approved templates, so they work even after the 24-hour window. WhatsApp charges per template message.</li>
            </ol>
          </Card>
        </div>
      </div>

      {drip && <Enrollments dripId={id} />}

      <Modal open={activateAsk} onClose={() => setActivateAsk(false)} title="Turn on drip" size="sm"
        footer={<><Button variant="secondary" onClick={() => setStatus("active", false)}>Only new ones</Button><Button onClick={() => setStatus("active", true)}>Also add existing</Button></>}>
        <p className="text-sm text-slate-700">Contacts who <b>already</b> match the start condition ({triggerSummary(drip?.trigger, { statusLabel, fieldLabel })}): add them to the drip now too, or only contacts from now on?</p>
      </Modal>
      {enrollOpen && <EnrollModal dripId={id} onClose={() => setEnrollOpen(false)} onDone={load} />}
    </PageContainer>
  );
}

function EnrollModal({ dripId, onClose, onDone }) {
  const toast = useToast();
  const [filter, setFilter] = useState({});
  const [count, setCount] = useState(null);
  const [busy, setBusy] = useState(false);
  const enroll = async () => {
    setBusy(true);
    try {
      const r = await api(`/drips/${dripId}/enroll`, { method: "POST", body: { filter } });
      toast.success(`${r.added} contact(s) added${r.alreadyIn ? ` (${r.alreadyIn} were already in it)` : ""}`);
      onDone();
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="Add people to this drip" size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={enroll} loading={busy} disabled={!count?.reachable}><UserPlus className="h-4 w-4" /> Add {count?.reachable ?? ""} contacts</Button></>}>
      <p className="mb-3 text-sm text-slate-600">Choose who to add, e.g. lead status <b>Converted</b> for old students (refer &amp; earn).</p>
      <SegmentBuilder value={filter} onChange={setFilter} onCount={setCount} />
    </Modal>
  );
}

function Enrollments({ dripId }) {
  const toast = useToast();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [removing, setRemoving] = useState(null);
  const load = useCallback(() => api(`/drips/${dripId}/enrollments`, { query: { status, page } }).then(setData).catch(() => {}), [dripId, status, page]);
  useEffect(() => { load(); }, [load]);
  useSocketEvent("drip:update", (u) => u._id === dripId && load());

  const remove = async () => {
    try {
      await api(`/drips/${dripId}/enrollments/${removing._id}`, { method: "DELETE" });
      toast.success("Removed from the drip");
      setRemoving(null);
      load();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <Card className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-4">
        <h2 className="font-medium text-slate-900">People in this drip</h2>
        <div className="flex gap-1">
          {[["", "All"], ["active", "In progress"], ["completed", "Finished"], ["stopped", "Stopped"]].map(([v, l]) => (
            <button key={v} type="button" onClick={() => { setStatus(v); setPage(1); }} className={cx("rounded-md px-2.5 py-1 text-xs font-medium", status === v ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")}>{l}</button>
          ))}
        </div>
      </div>
      <Table
        columns={[
          { key: "contact", label: "Contact", render: (e) => <div><p className="font-medium text-slate-900">{e.contactId?.name || "Unknown"}</p><p className="text-xs text-slate-500">{fmtPhone(e.contactId?.phone)}</p></div> },
          { key: "status", label: "Status", render: (e) => <div className="space-y-0.5"><StatusBadge status={e.status === "sending" ? "active" : e.status} />{e.stoppedReason && <p className="text-xs text-slate-500">{STOP_REASONS[e.stoppedReason] || e.stoppedReason}</p>}</div> },
          { key: "progress", label: "Steps done", render: (e) => `${e.history.filter((h) => h.status === "sent").length}` },
          { key: "next", label: "Next step", className: "whitespace-nowrap", render: (e) => (["active", "sending"].includes(e.status) && e.nextRunAt ? fmtDateTime(e.nextRunAt) : "—") },
          { key: "note", label: "Note", render: (e) => <span className="text-xs text-slate-500">{e.lastError || (e.history.at(-1)?.status === "skipped" ? e.history.at(-1).error : "")}</span> },
          { key: "x", label: "", render: (e) => ["active", "sending"].includes(e.status) && <button type="button" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600" onClick={() => setRemoving(e)} aria-label="Remove from drip"><X className="h-4 w-4" /></button> },
        ]}
        rows={data?.items || []}
        empty={<p className="p-6 text-center text-sm text-slate-500">{data ? "Nobody here yet." : "Loading…"}</p>}
      />
      {data && <Pagination page={data.page} limit={data.limit} total={data.total} onChange={setPage} />}
      <ConfirmModal open={!!removing} onClose={() => setRemoving(null)} onConfirm={remove} title="Remove from drip?" confirmText="Remove"
        message={`${removing?.contactId?.name || "This contact"} will not get the remaining messages.`} />
    </Card>
  );
}

/** {{1}}, {{2}}… of a template step: contact / course / business field or fixed text */
function VariableRows({ vars, onChange }) {
  if (!vars?.length) return null;
  const setVar = (k, patch) => onChange(vars.map((x, j) => (j === k ? { ...x, ...patch } : x)));
  return (
    <div className="mt-3 space-y-2">
      {vars.map((v, k) => (
        <div key={k} className="grid items-center gap-2 sm:grid-cols-[2.5rem_11rem_1fr]">
          <span className="font-mono text-sm text-slate-600">{`{{${k + 1}}}`}</span>
          <Select className="h-9 text-sm" value={v.source} onChange={(e) => setVar(k, { source: e.target.value, value: e.target.value === "field" ? "name" : "" })}>
            <option value="field">Contact field</option>
            <option value="static">Same text for all</option>
          </Select>
          {v.source === "field" ? (
            <ContactFieldSelect className="h-9 text-sm" value={v.value} onChange={(val) => setVar(k, { value: val })} ariaLabel={`Variable ${k + 1}`} />
          ) : (
            <Input className="text-sm" value={v.value} placeholder="Text" onChange={(e) => setVar(k, { value: e.target.value })} />
          )}
        </div>
      ))}
    </div>
  );
}
