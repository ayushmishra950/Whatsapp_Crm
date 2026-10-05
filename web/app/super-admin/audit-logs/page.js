"use client";

import { useEffect, useState } from "react";
import { ScrollText } from "lucide-react";
import { api } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { useToast } from "@/components/toast";
import { PageContainer } from "@/components/shell";
import { Badge, Card, EmptyState, PageHeader, PageLoader, Pagination, Table } from "@/components/ui";

export default function AuditLogsPage() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    api("/superadmin/audit-logs", { query: { page, limit: 30 } }).then(setData).catch(toast.error);
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <PageContainer>
      <PageHeader title="Audit logs" description="Who did what, across all businesses" />
      <Card>
        {!data ? <PageLoader /> : (
          <>
            <Table
              columns={[
                { key: "time", label: "Time", className: "whitespace-nowrap", render: (l) => fmtDateTime(l.createdAt) },
                { key: "action", label: "Action", render: (l) => <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{l.action}</code> },
                {
                  key: "actor",
                  label: "By",
                  render: (l) => (
                    <span>
                      {l.actorId?.name || "—"} <span className="text-xs text-slate-500">({l.actorRole})</span>
                      {l.impersonatedBy && <Badge tone="yellow" className="ml-2">via {l.impersonatedBy.name}</Badge>}
                    </span>
                  ),
                },
                { key: "tenant", label: "Business", render: (l) => l.tenantId?.name || "Platform" },
                { key: "ip", label: "IP", render: (l) => <span className="text-xs text-slate-500">{l.ip}</span> },
              ]}
              rows={data.items}
              empty={<EmptyState icon={ScrollText} title="No activity yet" />}
            />
            <Pagination page={data.page} limit={data.limit} total={data.total} onChange={setPage} />
          </>
        )}
      </Card>
    </PageContainer>
  );
}
