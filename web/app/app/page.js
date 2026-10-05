"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MessageCircle, Clock, Inbox, UserPlus, ArrowDownLeft, ArrowUpRight, Contact } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtNum } from "@/lib/format";
import { useToast } from "@/components/toast";
import { PageContainer } from "@/components/shell";
import { Card, PageHeader, PageLoader, Stat, StatusBadge } from "@/components/ui";

const FUNNEL = ["new", "contacted", "qualified", "converted", "lost"];

export default function Dashboard() {
  const { session } = useAuth();
  const toast = useToast();
  const [d, setD] = useState(null);

  useEffect(() => {
    api("/dashboard", { query: { tz: Intl.DateTimeFormat().resolvedOptions().timeZone } }).then(setD).catch(toast.error);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!d) return <PageLoader />;
  const isAdmin = session.user.role === "admin";
  const maxDay = Math.max(1, ...d.daily.map((x) => Math.max(x.inbound, x.outbound)));
  const totalLeads = Math.max(1, Object.values(d.leadFunnel).reduce((a, b) => a + b, 0));
  const usagePct = d.monthlyLimit ? Math.min(100, Math.round((d.messagesThisMonth / d.monthlyLimit) * 100)) : 0;

  return (
    <PageContainer>
      <PageHeader title={`Hello, ${session.user.name.split(" ")[0]} 👋`} description={isAdmin ? "Here is how your business is doing today" : "Your chats at a glance"} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label={isAdmin ? "Open chats" : "My open chats"} value={fmtNum(d.openChats)} icon={MessageCircle} />
        <Stat label={isAdmin ? "Pending chats" : "My pending chats"} value={fmtNum(d.pendingChats)} icon={Clock} />
        <Stat label="Unassigned" value={fmtNum(d.unassigned)} sub={d.botActive ? `Waiting for an agent · 🤖 ${d.botActive} with bot` : "Waiting for an agent"} icon={Inbox} />
        <Stat label="New leads today" value={fmtNum(d.newLeadsToday)} sub={`${fmtNum(d.contacts)} total contacts`} icon={UserPlus} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium text-slate-900">Messages – last 7 days</h2>
            <div className="flex items-center gap-4 text-xs text-slate-500">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-sky-500" /> Received</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-brand-600" /> Sent</span>
            </div>
          </div>
          <div className="flex h-48 items-end gap-2 sm:gap-4">
            {d.daily.map((x) => (
              <div key={x.day} className="flex flex-1 flex-col items-center gap-2">
                <div className="flex h-40 w-full items-end justify-center gap-1">
                  <div className="w-1/3 max-w-5 rounded-t bg-sky-500" style={{ height: `${(x.inbound / maxDay) * 100}%` }} title={`${x.inbound} received`} />
                  <div className="w-1/3 max-w-5 rounded-t bg-brand-600" style={{ height: `${(x.outbound / maxDay) * 100}%` }} title={`${x.outbound} sent`} />
                </div>
                <span className="text-xs text-slate-500">{new Date(`${x.day}T12:00:00`).toLocaleDateString("en-IN", { weekday: "short" })}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex gap-6 border-t border-slate-100 pt-4 text-sm">
            <span className="flex items-center gap-1.5 text-slate-600"><ArrowDownLeft className="h-4 w-4 text-sky-500" /> {fmtNum(d.todayIn)} received today</span>
            <span className="flex items-center gap-1.5 text-slate-600"><ArrowUpRight className="h-4 w-4 text-brand-600" /> {fmtNum(d.todayOut)} sent today</span>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="mb-4 font-medium text-slate-900">Lead pipeline</h2>
          <div className="space-y-3">
            {FUNNEL.map((s) => (
              <div key={s}>
                <div className="mb-1 flex justify-between text-sm"><span className="text-slate-600 capitalize">{s}</span><span className="font-medium tabular-nums">{d.leadFunnel[s] || 0}</span></div>
                <div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-brand-500" style={{ width: `${((d.leadFunnel[s] || 0) / totalLeads) * 100}%` }} /></div>
              </div>
            ))}
          </div>
          <Link href="/app/contacts" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"><Contact className="h-4 w-4" /> View contacts</Link>
        </Card>
      </div>

      {isAdmin && (
        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <Card className="p-5">
            <h2 className="font-medium text-slate-900">Plan usage this month</h2>
            <p className="mt-3 text-2xl font-semibold tabular-nums">{fmtNum(d.messagesThisMonth)} <span className="text-sm font-normal text-slate-500">/ {d.monthlyLimit ? fmtNum(d.monthlyLimit) : "∞"} messages</span></p>
            <div className="mt-3 h-2 rounded-full bg-slate-100"><div className={`h-2 rounded-full ${usagePct > 85 ? "bg-red-500" : "bg-brand-500"}`} style={{ width: `${usagePct}%` }} /></div>
            <p className="mt-2 text-xs text-slate-500">{session.tenant.plan?.name} plan</p>
          </Card>
          <Card className="lg:col-span-2">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <h2 className="font-medium text-slate-900">Recent campaigns</h2>
              <Link href="/app/campaigns" className="text-sm text-brand-700 hover:underline">View all</Link>
            </div>
            {d.recentCampaigns.length ? (
              <ul className="divide-y divide-slate-100">
                {d.recentCampaigns.map((c) => (
                  <li key={c._id}>
                    <Link href={`/app/campaigns/${c._id}`} className="flex items-center justify-between gap-4 px-5 py-3 text-sm hover:bg-slate-50">
                      <span className="font-medium text-slate-800">{c.name}</span>
                      <span className="flex items-center gap-3 text-slate-500">
                        <span className="hidden sm:inline">{c.stats.sent}/{c.stats.total} sent · {c.stats.read} read</span>
                        <StatusBadge status={c.status} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-8 text-center text-sm text-slate-500">No campaigns yet</p>
            )}
          </Card>
        </div>
      )}
    </PageContainer>
  );
}
