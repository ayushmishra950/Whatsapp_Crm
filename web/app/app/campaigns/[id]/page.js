"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Pause, Play, XCircle, Trash2, Rocket, Pencil } from "lucide-react";
import { api } from "@/lib/api";
import { useSocketEvent } from "@/lib/socket";
import { fmtDateTime, fmtPhone } from "@/lib/format";
import { useToast } from "@/components/toast";
import { PageContainer } from "@/components/shell";
import { TemplatePreview } from "@/components/shared";
import { Button, Card, ConfirmModal, PageHeader, PageLoader, Pagination, StatusBadge, Stat, Table, cx } from "@/components/ui";

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const FILTERS = ["", "sent", "delivered", "read", "failed", "skipped", "pending"];

export default function CampaignDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const toast = useToast();
  const [c, setC] = useState(null);
  const [recipients, setRecipients] = useState(null);
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api(`/campaigns/${id}`).then(setC).catch(toast.error), [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const loadRecipients = useCallback(
    () => api(`/campaigns/${id}/recipients`, { query: { status: filter, page } }).then(setRecipients),
    [id, filter, page]
  );

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadRecipients(); }, [loadRecipients]);

  useSocketEvent("campaign:update", (u) => {
    if (u._id !== id) return;
    setC((prev) => prev && { ...prev, status: u.status, stats: u.stats });
    loadRecipients();
  });

  const act = async (action) => {
    setBusy(true);
    try {
      if (action === "delete") {
        await api(`/campaigns/${id}`, { method: "DELETE" });
        toast.success("Campaign deleted");
        return router.replace("/app/campaigns");
      }
      await api(`/campaigns/${id}/${action}`, { method: "POST", body: {} });
      toast.success(`Campaign ${action === "launch" ? "started" : action + "d"}`);
      setConfirm(null);
      load();
      loadRecipients();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  if (!c) return <PageLoader />;
  const s = c.stats;
  const processed = s.sent + s.failed + s.skipped;

  return (
    <PageContainer>
      <Link href="/app/campaigns" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" /> Campaigns</Link>
      <PageHeader
        title={<span className="flex items-center gap-3">{c.name} <StatusBadge status={c.status} /></span>}
        description={`Template ${c.templateId?.name} · created by ${c.createdBy?.name} on ${fmtDateTime(c.createdAt)}${c.status === "scheduled" ? ` · 📅 sends ${fmtDateTime(c.scheduledAt)}` : c.startedAt ? ` · sent ${fmtDateTime(c.startedAt)}` : ""}`}
        actions={
          <>
            {["draft", "scheduled"].includes(c.status) && (
              <Link href={`/app/campaigns/new?edit=${c._id}`}><Button variant="secondary"><Pencil className="h-4 w-4" /> Edit</Button></Link>
            )}
            {c.status === "draft" && <Button onClick={() => act("launch")} loading={busy}><Rocket className="h-4 w-4" /> Launch now</Button>}
            {["running", "scheduled"].includes(c.status) && <Button variant="secondary" onClick={() => act("pause")} loading={busy}><Pause className="h-4 w-4" /> Pause</Button>}
            {c.status === "paused" && <Button onClick={() => act("resume")} loading={busy}><Play className="h-4 w-4" /> Resume</Button>}
            {["running", "scheduled", "paused"].includes(c.status) && <Button variant="secondary" onClick={() => setConfirm("cancel")}><XCircle className="h-4 w-4" /> Cancel</Button>}
            {["draft", "completed", "cancelled", "failed", "paused"].includes(c.status) && <Button variant="ghost" onClick={() => setConfirm("delete")} aria-label="Delete campaign"><Trash2 className="h-4 w-4 text-red-500" /></Button>}
          </>
        }
      />
      {c.status === "paused" && c.pauseReason && <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">Paused automatically: {c.pauseReason}</p>}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Stat label="Recipients" value={s.total} />
        <Stat label="Sent" value={s.sent} sub={`${pct(processed, s.total)}% processed`} />
        <Stat label="Delivered" value={s.delivered} sub={`${pct(s.delivered, s.sent)}% of sent`} />
        <Stat label="Read" value={s.read} sub={`${pct(s.read, s.sent)}% of sent`} />
        <Stat label="Failed / skipped" value={`${s.failed} / ${s.skipped}`} />
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-2 bg-brand-500 transition-all" style={{ width: `${pct(processed, s.total)}%` }} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="scroll-thin flex gap-1 overflow-x-auto border-b border-slate-200 p-2">
            {FILTERS.map((f) => (
              <button key={f} onClick={() => { setFilter(f); setPage(1); }} className={cx("rounded-md px-3 py-1.5 text-sm whitespace-nowrap capitalize", filter === f ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")}>
                {f || "All"}
              </button>
            ))}
          </div>
          {!recipients ? <PageLoader /> : (
            <>
              <Table
                columns={[
                  { key: "contact", label: "Contact", render: (r) => <span>{r.contactId?.name || "—"} <span className="block text-xs text-slate-500">{fmtPhone(r.phone)}</span></span> },
                  { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
                  { key: "error", label: "Note", render: (r) => <span className="text-xs text-red-600">{r.error}</span> },
                  { key: "time", label: "Sent at", className: "whitespace-nowrap", render: (r) => fmtDateTime(r.sentAt) },
                ]}
                rows={recipients.items}
                empty={<p className="p-6 text-center text-sm text-slate-500">{c.status === "draft" ? "Recipients are added when the campaign is launched." : "No recipients in this filter."}</p>}
              />
              <Pagination page={recipients.page} limit={recipients.limit} total={recipients.total} onChange={setPage} />
            </>
          )}
        </Card>
        <Card className="p-5">
          <h2 className="mb-3 font-medium text-slate-900">Message</h2>
          {c.templateId && <TemplatePreview {...c.templateId} />}
        </Card>
      </div>

      <ConfirmModal open={confirm === "cancel"} onClose={() => setConfirm(null)} onConfirm={() => act("cancel")} loading={busy} danger title="Cancel campaign?" confirmText="Cancel campaign" message="Messages not yet sent will be skipped. This can not be undone." />
      <ConfirmModal open={confirm === "delete"} onClose={() => setConfirm(null)} onConfirm={() => act("delete")} loading={busy} danger title="Delete campaign?" confirmText="Delete" message="The campaign and its report will be deleted. Messages already sent stay in the chats." />
    </PageContainer>
  );
}
