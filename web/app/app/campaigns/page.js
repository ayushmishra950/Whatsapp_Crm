"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Megaphone } from "lucide-react";
import { api } from "@/lib/api";
import { useSocketEvent } from "@/lib/socket";
import { fmtDateTime } from "@/lib/format";
import { useToast } from "@/components/toast";
import { PageContainer } from "@/components/shell";
import { Button, Card, EmptyState, PageHeader, PageLoader, Pagination, StatusBadge, Table } from "@/components/ui";

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

export default function CampaignsPage() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    api("/campaigns", { query: { page } }).then(setData).catch(toast.error);
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  useSocketEvent("campaign:update", (u) =>
    setData((d) => d && { ...d, items: d.items.map((c) => (c._id === u._id ? { ...c, status: u.status, stats: u.stats } : c)) })
  );

  return (
    <PageContainer>
      <PageHeader
        title="Bulk campaigns"
        description="Send an approved template to many contacts at once. Opted-out contacts are skipped automatically."
        actions={<Link href="/app/campaigns/new"><Button><Plus className="h-4 w-4" /> New campaign</Button></Link>}
      />
      <Card>
        {!data ? <PageLoader /> : (
          <>
            <Table
              columns={[
                {
                  key: "name",
                  label: "Campaign",
                  render: (c) => (
                    <Link href={`/app/campaigns/${c._id}`} className="font-medium text-slate-900 hover:text-brand-700">
                      {c.name}
                      <span className="block text-xs font-normal text-slate-500">{c.templateId?.name} · by {c.createdBy?.name}</span>
                    </Link>
                  ),
                },
                { key: "status", label: "Status", render: (c) => <StatusBadge status={c.status} /> },
                {
                  key: "progress",
                  label: "Progress",
                  render: (c) => (
                    <div className="w-32">
                      <div className="h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${pct(c.stats.sent + c.stats.failed + c.stats.skipped, c.stats.total)}%` }} /></div>
                      <p className="mt-1 text-xs text-slate-500">{c.stats.sent} / {c.stats.total} sent</p>
                    </div>
                  ),
                },
                { key: "delivered", label: "Delivered", render: (c) => `${pct(c.stats.delivered, c.stats.sent)}%` },
                { key: "read", label: "Read", render: (c) => `${pct(c.stats.read, c.stats.sent)}%` },
                { key: "failed", label: "Failed", render: (c) => c.stats.failed },
                { key: "date", label: "Created", className: "whitespace-nowrap", render: (c) => fmtDateTime(c.scheduledAt || c.createdAt) },
              ]}
              rows={data.items}
              empty={<EmptyState icon={Megaphone} title="No campaigns yet" description="Create your first bulk WhatsApp campaign." action={<Link href="/app/campaigns/new"><Button>New campaign</Button></Link>} />}
            />
            <Pagination page={data.page} limit={data.limit} total={data.total} onChange={setPage} />
          </>
        )}
      </Card>
    </PageContainer>
  );
}
