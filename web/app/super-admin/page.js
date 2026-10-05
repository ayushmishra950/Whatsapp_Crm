"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Building2, CheckCircle2, Ban, IndianRupee, Send } from "lucide-react";
import { api } from "@/lib/api";
import { fmtDate, fmtMoney, fmtNum } from "@/lib/format";
import { PageContainer } from "@/components/shell";
import { Card, PageHeader, PageLoader, Stat, EmptyState } from "@/components/ui";

export default function SuperAdminDashboard() {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    api("/superadmin/stats").then(setStats).catch(() => {});
  }, []);
  if (!stats) return <PageLoader />;

  return (
    <PageContainer>
      <PageHeader title="Platform overview" description="All businesses using the CRM" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Businesses" value={fmtNum(stats.tenants)} icon={Building2} />
        <Stat label="Active subscriptions" value={fmtNum(stats.activeTenants)} icon={CheckCircle2} />
        <Stat label="Suspended" value={fmtNum(stats.suspended)} icon={Ban} />
        <Stat label="Monthly revenue (MRR)" value={fmtMoney(stats.mrr)} sub="Paid active plans" icon={IndianRupee} />
        <Stat label="Messages this month" value={fmtNum(stats.messagesThisMonth)} icon={Send} />
      </div>

      <Card className="mt-6">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="font-medium text-slate-900">Renewals due in next 7 days</h2>
        </div>
        {stats.expiringSoon.length ? (
          <ul className="divide-y divide-slate-100">
            {stats.expiringSoon.map((t) => (
              <li key={t._id} className="flex items-center justify-between px-4 py-3 text-sm">
                <Link href={`/super-admin/tenants/${t._id}`} className="font-medium text-slate-800 hover:text-brand-700">
                  {t.name}
                </Link>
                <span className="text-slate-500">Ends {fmtDate(t.subscription?.currentPeriodEnd)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No renewals due" description="Subscriptions ending within a week will show here." />
        )}
      </Card>
    </PageContainer>
  );
}
