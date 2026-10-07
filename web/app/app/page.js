"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MessageCircle, Clock, Inbox, UserPlus, ArrowDownLeft, ArrowUpRight, Contact, BellRing, Megaphone, Users, Cake } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDateTime, fmtNum, fmtPhone } from "@/lib/format";
import { useLeadStatuses } from "@/lib/lead-statuses";
import { useContactFields } from "@/lib/contact-fields";
import { LeadStatusBadge } from "@/components/shared";
import { useToast } from "@/components/toast";
import { PageContainer } from "@/components/shell";
import { Card, PageHeader, PageLoader, Stat, StatusBadge, cx } from "@/components/ui";

const BAR = { gray: "bg-slate-400", blue: "bg-sky-500", green: "bg-brand-500", yellow: "bg-amber-400", red: "bg-red-500", purple: "bg-violet-500" };

export default function Dashboard() {
  const { session } = useAuth();
  const toast = useToast();
  const [d, setD] = useState(null);
  const { list: statuses } = useLeadStatuses();

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
            {statuses.map((s) => (
              <Link key={s.key} href={`/app/contacts?leadStatus=${s.key}`} className="block rounded hover:bg-slate-50">
                <div className="mb-1 flex justify-between text-sm"><span className="text-slate-600">{s.label}</span><span className="font-medium tabular-nums">{d.leadFunnel[s.key] || 0}</span></div>
                <div className="h-2 rounded-full bg-slate-100"><div className={cx("h-2 rounded-full", BAR[s.color] || "bg-brand-500")} style={{ width: `${((d.leadFunnel[s.key] || 0) / totalLeads) * 100}%` }} /></div>
              </Link>
            ))}
          </div>
          <Link href="/app/contacts" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"><Contact className="h-4 w-4" /> View contacts</Link>
        </Card>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
            <h2 className="flex items-center gap-2 font-medium text-slate-900"><BellRing className="h-4 w-4 text-amber-500" /> Follow-ups due today {d.followUpsDue > 0 && <span className="rounded-full bg-amber-100 px-2 text-xs text-amber-800">{d.followUpsDue}</span>}</h2>
            <Link href="/app/contacts?followUp=due" className="text-sm text-brand-700 hover:underline">View all</Link>
          </div>
          {d.followUps.length ? (
            <ul className="divide-y divide-slate-100">
              {d.followUps.map((f) => {
                const overdue = new Date(f.followUpAt) < new Date();
                return (
                  <li key={f._id} className="flex items-start justify-between gap-3 px-5 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-800">{f.name || fmtPhone(f.phone)} <LeadStatusBadge status={f.leadStatus} /></p>
                      <p className="truncate text-xs text-slate-500">
                        {f.followUpAction === "message" && <span className="mr-1 font-medium text-amber-700">{f.followUpSentAt ? "⏰ WhatsApp sent ·" : "⏰ WhatsApp at this time ·"}</span>}
                        {f.followUpNote || "No note"}{!isAdmin ? "" : f.followUpBy?.name ? ` · by ${f.followUpBy.name}` : ""}
                      </p>
                    </div>
                    <span className={cx("shrink-0 text-xs font-medium", overdue ? "text-red-600" : "text-amber-700")}>{overdue ? "Overdue · " : ""}{fmtDateTime(f.followUpAt)}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-5 py-8 text-center text-sm text-slate-500">No follow-ups due. Set one from a contact (Inbox → contact info, or Contacts → edit).</p>
          )}
        </Card>

        <Card>
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
            <h2 className="flex items-center gap-2 font-medium text-slate-900"><Megaphone className="h-4 w-4 text-violet-500" /> Leads from ads (30 days)</h2>
            <Link href="/app/contacts?source=ad" className="text-sm text-brand-700 hover:underline">View leads</Link>
          </div>
          {d.adLeads.length ? (
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-500"><tr><th className="px-5 py-2 text-left font-medium">Ad</th><th className="px-3 py-2 text-right font-medium">Leads</th><th className="px-5 py-2 text-right font-medium">Converted</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {d.adLeads.map((a) => (
                  <tr key={a.adId}>
                    <td className="max-w-0 truncate px-5 py-2.5 text-slate-800" title={a.headline}>{a.name || a.headline || a.adId}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{a.leads}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums">{a.converted} <span className="text-xs text-slate-400">({Math.round((a.converted / a.leads) * 100)}%)</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="px-5 py-8 text-center text-sm text-slate-500">No leads from Click-to-WhatsApp ads yet. When someone messages you from a Facebook / Instagram ad, it shows here.</p>
          )}
        </Card>
      </div>

      <Celebrations isAdmin={isAdmin} />
      {isAdmin && <TeamPerformance />}

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

// Per team member: chats, messages, conversions and how fast they reply
/** Birthdays / anniversaries today and in the next 7 days (date contact fields) */
function Celebrations({ isAdmin }) {
  const { dateFields } = useContactFields();
  const [counts, setCounts] = useState(null);
  const key = dateFields.map((f) => f.key).join(",");
  useEffect(() => {
    if (!key) return;
    let alive = true;
    const fields = key.split(",");
    Promise.all(
      fields.flatMap((k) => ["today", "this_week"].map((when) => api("/segments/count", { method: "POST", body: { filter: { dateMatch: { field: `custom.${k}`, when } } } }).then((r) => [k, when, r.reachable])))
    )
      .then((rows) => alive && setCounts(rows))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [key]);
  if (!dateFields.length || !counts) return null;
  return (
    <Card className="mt-6 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-medium text-slate-900"><Cake className="h-4 w-4 text-pink-500" /> Birthdays &amp; anniversaries</h2>
        {isAdmin && <Link href="/app/drips" className="text-sm text-brand-700 hover:underline">Automate wishes</Link>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {dateFields.map((f) => (
          <div key={f.key} className="rounded-md bg-pink-50/60 px-3 py-2 text-sm">
            <p className="font-medium text-slate-800">{f.label}</p>
            <p className="text-slate-600"><b>{counts.find(([k, w]) => k === f.key && w === "today")?.[2] ?? 0}</b> today · <b>{counts.find(([k, w]) => k === f.key && w === "this_week")?.[2] ?? 0}</b> in next 7 days</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

function TeamPerformance() {
  const [days, setDays] = useState(7);
  const [t, setT] = useState(null);
  useEffect(() => {
    let active = true;
    api("/dashboard/team", { query: { days } }).then((r) => active && setT(r)).catch(() => {});
    return () => {
      active = false;
    };
  }, [days]);

  const fmtMins = (m) => (m == null ? "—" : m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`);
  const ended = t?.bot?.ended || {};

  return (
    <Card className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3">
        <h2 className="flex items-center gap-2 font-medium text-slate-900"><Users className="h-4 w-4 text-sky-500" /> Team performance</h2>
        <div className="flex gap-1">
          {[7, 30].map((n) => (
            <button key={n} onClick={() => setDays(n)} className={cx("rounded-md px-3 py-1 text-xs font-medium", days === n ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")}>Last {n} days</button>
          ))}
        </div>
      </div>
      {!t ? (
        <p className="px-5 py-8 text-center text-sm text-slate-500">Loading…</p>
      ) : (
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500">
              <tr>
                <th className="px-5 py-2 text-left font-medium">Member</th>
                <th className="px-3 py-2 text-right font-medium">Chats handled</th>
                <th className="px-3 py-2 text-right font-medium">Open now</th>
                <th className="px-3 py-2 text-right font-medium">Messages sent</th>
                <th className="px-3 py-2 text-right font-medium">Converted</th>
                <th className="px-5 py-2 text-right font-medium" title="Typical time from a customer message to this person's reply">Reply time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {t.members.map((m) => (
                <tr key={m._id} className={cx(!m.isActive && "text-slate-400")}>
                  <td className="px-5 py-2.5"><span className="font-medium">{m.name}</span> <span className="text-xs text-slate-400">{m.role}</span></td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{m.chatsHandled}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{m.openChats}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{m.messagesSent}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{m.converted}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums">{fmtMins(m.medianReplyMinutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
            🤖 Chatbot: {t.bot.chatsStarted} chats started · {ended.lead_complete || 0} leads collected · {(ended.handoff || 0) + (ended.loop_guard || 0)} handed to the team
          </p>
        </div>
      )}
    </Card>
  );
}
