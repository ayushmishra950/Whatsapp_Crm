"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Workflow, Pause, Play, Trash2, Pencil } from "lucide-react";
import { IDEAS, triggerSummary } from "@/components/drips";
import { api } from "@/lib/api";
import { useSocketEvent } from "@/lib/socket";
import { useLeadStatuses } from "@/lib/lead-statuses";
import { useContactFields } from "@/lib/contact-fields";
import { useToast } from "@/components/toast";
import { PageContainer } from "@/components/shell";
import { Badge, Button, Card, ConfirmModal, EmptyState, PageHeader, PageLoader, StatusBadge } from "@/components/ui";

export default function DripsPage() {
  const toast = useToast();
  const { label: statusLabel } = useLeadStatuses();
  const { label: fieldLabel } = useContactFields();
  const [items, setItems] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState("");

  const load = () => api("/drips").then(setItems).catch(toast.error);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useSocketEvent("drip:update", () => load());

  const setStatus = async (d, status) => {
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
        <div className="space-y-3">
          {items.map((d) => (
            <Card key={d._id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Link href={`/app/drips/${d._id}`} className="font-medium text-slate-900 hover:text-brand-700">{d.name}</Link>
                    <StatusBadge status={d.status} />
                  </div>
                  <p className="mt-0.5 text-sm text-slate-500">⚡ {triggerSummary(d.trigger, { statusLabel, fieldLabel })} · {d.steps.length} message(s)</p>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                    <Badge tone="blue">{d.stats.active} in progress</Badge>
                    <Badge tone="green">{d.stats.sent} sent</Badge>
                    <Badge tone="purple">{d.stats.replied} replied</Badge>
                    <Badge>{d.stats.completed} finished</Badge>
                    {d.stats.failed > 0 && <Badge tone="red">{d.stats.failed} failed / skipped</Badge>}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {d.status === "active" ? (
                    <Button size="sm" variant="secondary" loading={busy === d._id} onClick={() => setStatus(d, "paused")}><Pause className="h-3.5 w-3.5" /> Pause</Button>
                  ) : (
                    <Button size="sm" loading={busy === d._id} onClick={() => setStatus(d, "active")}><Play className="h-3.5 w-3.5" /> Turn on</Button>
                  )}
                  <Link href={`/app/drips/${d._id}`}><Button size="sm" variant="secondary"><Pencil className="h-3.5 w-3.5" /> Open</Button></Link>
                  <Button size="icon" variant="ghost" onClick={() => setDeleting(d)} aria-label="Delete drip"><Trash2 className="h-4 w-4 text-red-500" /></Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
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

      <ConfirmModal open={!!deleting} onClose={() => setDeleting(null)} onConfirm={remove} danger title="Delete drip?" confirmText="Delete"
        message={`"${deleting?.name}" and its history will be deleted. People in it will not get the remaining messages.`} />
    </PageContainer>
  );
}
