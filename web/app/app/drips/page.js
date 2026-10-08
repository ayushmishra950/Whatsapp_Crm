"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Workflow, Pause, Play, Trash2, Pencil, Search, ChevronDown, ChevronRight } from "lucide-react";
import { DRIP_GROUPS, IDEAS, dripNumber, groupOf, triggerSummary } from "@/components/drips";
import { api } from "@/lib/api";
import { useSocketEvent } from "@/lib/socket";
import { useLeadStatuses } from "@/lib/lead-statuses";
import { useContactFields } from "@/lib/contact-fields";
import { useToast } from "@/components/toast";
import { PageContainer } from "@/components/shell";
import { Badge, Button, Card, ConfirmModal, EmptyState, Input, PageHeader, PageLoader, Select, StatusBadge, cx } from "@/components/ui";

const SORTS = [["playbook", "Playbook order (D1, D2…)"], ["name", "Name A–Z"], ["active", "Most people in progress"], ["sent", "Most messages sent"], ["newest", "Newest first"]];

export default function DripsPage() {
  const toast = useToast();
  const { label: statusLabel } = useLeadStatuses();
  const { label: fieldLabel } = useContactFields();
  const [items, setItems] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState("");
  const [confirm, setConfirm] = useState(null); // { drip, status } waiting for "Are you sure?"
  const [q, setQ] = useState("");
  const [show, setShow] = useState("all"); // all | active | off
  const [sort, setSort] = useState("playbook");
  const [batches, setBatches] = useState(true);
  const [closed, setClosed] = useState({}); // collapsed batches

  const load = () => api("/drips").then(setItems).catch(toast.error);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useSocketEvent("drip:update", () => load());

  const setStatus = async (d, status) => {
    setConfirm(null);
    setBusy(d._id);
    try {
      await api(`/drips/${d._id}/status`, { method: "POST", body: { status } });
      toast.success(status === "active" ? "Drip is ON" : "Drip paused");
      load();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy("");
    }
  };

  const remove = async () => {
    try {
      await api(`/drips/${deleting._id}`, { method: "DELETE" });
      toast.success("Drip deleted");
      setDeleting(null);
      load();
    } catch (err) {
      toast.error(err);
    }
  };

  if (!items) return <PageLoader />;

  const term = q.trim().toLowerCase();
  const shown = items
    .filter((d) => (show === "all" ? true : show === "active" ? d.status === "active" : d.status !== "active"))
    .filter((d) => !term || d.name.toLowerCase().includes(term))
    .sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "active") return (b.stats.active || 0) - (a.stats.active || 0);
      if (sort === "sent") return (b.stats.sent || 0) - (a.stats.sent || 0);
      if (sort === "newest") return new Date(b.createdAt) - new Date(a.createdAt);
      return (dripNumber(a.name) ?? 999) - (dripNumber(b.name) ?? 999) || a.name.localeCompare(b.name);
    });
  const groups = batches
    ? [...DRIP_GROUPS, { key: "mine", label: "✍️ Your own drips" }].map((g) => ({ ...g, drips: shown.filter((d) => groupOf(d.name) === g.key) })).filter((g) => g.drips.length)
    : [{ key: "all", label: "", drips: shown }];
  const onCount = items.filter((d) => d.status === "active").length;

  const row = (d) => (
    <div key={d._id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Link href={`/app/drips/${d._id}`} className="font-medium text-slate-900 hover:text-brand-700">{d.name}</Link>
          <StatusBadge status={d.status === "draft" ? "off" : d.status} />
        </div>
        <p className="mt-0.5 text-sm text-slate-500">⚡ {triggerSummary(d.trigger, { statusLabel, fieldLabel })} · {d.steps.length} step(s)</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
          <Badge tone="blue">{d.stats.active} in progress</Badge>
          <Badge tone="green">{d.stats.sent} sent</Badge>
          <Badge tone="purple">{d.stats.replied} replied</Badge>
          <Badge>{d.stats.completed} finished</Badge>
          {d.stats.failed > 0 && <Badge tone="red">{d.stats.failed} failed / skipped</Badge>}
        </div>
      </div>
      <div className="flex items-center gap-1">
        {d.status === "active" ? (
          <Button size="sm" variant="secondary" loading={busy === d._id} onClick={() => setConfirm({ drip: d, status: "paused" })}><Pause className="h-3.5 w-3.5" /> Pause</Button>
        ) : (
          <Button size="sm" loading={busy === d._id} onClick={() => setConfirm({ drip: d, status: "active" })}><Play className="h-3.5 w-3.5" /> Turn on</Button>
        )}
        <Link href={`/app/drips/${d._id}`}><Button size="sm" variant="secondary"><Pencil className="h-3.5 w-3.5" /> Open</Button></Link>
        <Button size="icon" variant="ghost" onClick={() => setDeleting(d)} aria-label="Delete drip"><Trash2 className="h-4 w-4 text-red-500" /></Button>
      </div>
    </div>
  );

  return (
    <PageContainer>
      <PageHeader
        title="Drips & automations"
        description="Messages that go out by themselves over days: welcome series, follow-ups, birthday offers, refer & earn. Only approved templates are sent (WhatsApp rule)."
        actions={<Link href="/app/drips/new"><Button><Plus className="h-4 w-4" /> New drip</Button></Link>}
      />

      {!items.length ? (
        <Card className="p-5">
          <EmptyState icon={Workflow} title="No drips yet" description="Start from an idea below or create your own." />
        </Card>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search className="absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
              <Input className="pl-9" placeholder="Search drips" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="flex gap-1">
              {[["all", `All (${items.length})`], ["active", `On (${onCount})`], ["off", `Off (${items.length - onCount})`]].map(([v, l]) => (
                <button key={v} type="button" onClick={() => setShow(v)} className={cx("rounded-full border px-3 py-1 text-sm", show === v ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50")}>{l}</button>
              ))}
            </div>
            <Select className="sm:w-auto" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
              {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
            <label className="flex items-center gap-1.5 text-sm text-slate-600"><input type="checkbox" checked={batches} onChange={(e) => setBatches(e.target.checked)} /> Show in batches</label>
          </div>
          {!shown.length && <Card className="p-5"><p className="text-center text-sm text-slate-500">No drip matches.</p></Card>}
          <div className="space-y-4">
            {groups.map((g) => {
              const on = g.drips.filter((d) => d.status === "active").length;
              const isClosed = closed[g.key];
              return (
                <Card key={g.key} className="overflow-hidden">
                  {g.label && (
                    <button type="button" onClick={() => setClosed((c) => ({ ...c, [g.key]: !c[g.key] }))} className="flex w-full items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5 text-left">
                      {isClosed ? <ChevronRight className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                      <span className="font-medium text-slate-900">{g.label}</span>
                      <span className="text-xs text-slate-500">{g.drips.length} drip(s) · {on} on</span>
                    </button>
                  )}
                  {!isClosed && <div className="divide-y divide-slate-100">{g.drips.map(row)}</div>}
                </Card>
              );
            })}
          </div>
        </>
      )}

      <h2 className="mt-8 mb-3 font-medium text-slate-900">Start from an idea</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {IDEAS.map(({ id, icon: Icon, title, text }) => (
          <Link key={id} href={`/app/drips/new?idea=${id}`} className="rounded-lg border border-slate-200 bg-white p-4 hover:border-brand-400 hover:bg-brand-50/40">
            <p className="flex items-center gap-2 font-medium text-slate-900"><Icon className="h-4 w-4 text-brand-600" /> {title}</p>
            <p className="mt-1 text-sm text-slate-500">{text}</p>
          </Link>
        ))}
      </div>

      <ConfirmModal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => setStatus(confirm.drip, confirm.status)}
        loading={busy === confirm?.drip?._id}
        title={confirm?.status === "active" ? `Turn on "${confirm?.drip?.name}"?` : `Pause "${confirm?.drip?.name}"?`}
        confirmText={confirm?.status === "active" ? "Turn on" : "Pause"}
        danger={confirm?.status !== "active"}
        message={confirm?.status === "active"
          ? `From now on, leads that match (${triggerSummary(confirm?.drip?.trigger, { statusLabel, fieldLabel })}) start getting its ${confirm?.drip?.steps?.length} step(s) automatically — only with approved templates, never in quiet hours and within the daily limit (Settings → Automation). Open the drip first if you want to check the messages.`
          : "No new people join and no more messages go out until you turn it on again. People in it keep their place."}
      />
      <ConfirmModal open={!!deleting} onClose={() => setDeleting(null)} onConfirm={remove} danger title="Delete drip?" confirmText="Delete"
        message={`"${deleting?.name}" and its history will be deleted. People in it will not get the remaining messages.`} />
    </PageContainer>
  );
}
