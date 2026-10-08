"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useIsCoaching } from "@/lib/business";
import { useSocketEvent } from "@/lib/socket";
import { fmtDateTime, fmtPhone, fmtRelative } from "@/lib/format";
import { useToast } from "@/components/toast";
import { QuickAddButton } from "@/components/quick-add";
import { PageContainer } from "@/components/shell";
import { LeadStatusBadge } from "@/components/shared";
import { LeadActions, NextFollowUpModal } from "@/components/actions";
import { FeesPanel, money, prettyDay } from "@/components/fees";
import { Badge, Button, Card, Modal, PageHeader, PageLoader, cx } from "@/components/ui";

const isLate = (d) => new Date(d) < new Date();

/** Everything to act on now, in order of priority, with one-tap actions */
export default function TodayPage() {
  const toast = useToast();
  const { session } = useAuth();
  const coaching = useIsCoaching();
  const [d, setD] = useState(null);
  const [next, setNext] = useState(null); // lead to set the next follow-up for
  const [feesFor, setFeesFor] = useState(null);
  const load = useCallback(() => api("/dashboard/today", { query: { tz: Intl.DateTimeFormat().resolvedOptions().timeZone } }).then(setD).catch(toast.error), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  useSocketEvent("task:update", load);

  const done = async (task) => {
    try {
      await api(`/tasks/${task._id}`, { method: "PATCH", body: { status: "done" } });
      toast.success("Done ✓");
      setNext({ contact: task.contactId, title: task.title });
      load();
    } catch (err) {
      toast.error(err);
    }
  };

  if (!d) return <PageLoader />;
  const sections = [
    { key: "call", title: "📞 Call now — new leads", hint: "Never called yet. Call within 30 minutes: the first call wins the admission.", items: d.call, tone: "red" },
    { key: "tasks", title: "⏰ Tasks due today / overdue", hint: "Calls, call-backs and follow-ups you promised.", items: d.tasks, tone: "red" },
    { key: "hot", title: "🔥 Hot leads", hint: "Ready to join — close them today.", items: d.hot, tone: "amber" },
    { key: "waiting", title: "💬 Waiting for your reply", hint: "Customer wrote more than 30 minutes ago.", items: d.waiting, tone: "amber" },
    ...(coaching ? [{ key: "fees", title: "💰 Fees due today / overdue", hint: "Collect or agree a new date.", items: d.fees, tone: "amber" }] : []),
    { key: "followUps", title: "📅 Follow-ups due", hint: "Reminders set on leads.", items: d.followUps, tone: "blue" },
  ];
  const total = sections.reduce((s, x) => s + x.items.length, 0);

  const leadLine = (c, extra) => (
    <div className="min-w-0">
      <Link href={`/app/contacts/${c._id}`} className="font-medium text-slate-900 hover:text-brand-700">{c.name || fmtPhone(c.phone)}</Link>
      <span className="ml-2 inline-flex flex-wrap items-center gap-1 align-middle">
        <LeadStatusBadge status={c.leadStatus} />
        {c.course && <Badge tone="purple">{c.course}</Badge>}
      </span>
      <p className="text-xs text-slate-500">
        {fmtPhone(c.phone)}
        {c.assignedTo?.name ? ` · ${c.assignedTo.name}` : session.user.role === "admin" ? " · not assigned" : ""}
        {extra}
      </p>
    </div>
  );

  const row = (key, item) => {
    if (key === "tasks") {
      const c = item.contactId;
      return (
        <div key={item._id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <div className="min-w-0">
            <p className="font-medium text-slate-900">{item.title}</p>
            {c && leadLine(c, <span className={cx(isLate(item.dueAt) && "font-medium text-red-600")}> · {isLate(item.dueAt) ? "overdue " : "due "}{fmtDateTime(item.dueAt)}</span>)}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {c && <LeadActions contact={c} compact onChanged={load} />}
            <Button size="sm" className="!h-7 !px-2 text-xs" onClick={() => done(item)}><CheckCircle2 className="h-3.5 w-3.5" /> Done</Button>
          </div>
        </div>
      );
    }
    if (key === "waiting") {
      const c = item.contactId;
      if (!c) return null;
      return (
        <div key={item._id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          {leadLine(c, <> · wrote {fmtRelative(item.lastInboundAt)}: “{(item.lastMessagePreview || "").slice(0, 60)}”</>)}
          <LeadActions contact={c} compact onChanged={load} />
        </div>
      );
    }
    const extra =
      key === "fees" ? <> · <b className={cx(item.fees?.nextDue < d.today && "text-red-600")}>{money(item.fees?.nextAmount)}</b> due {prettyDay(item.fees?.nextDue)}</>
      : key === "followUps" ? <> · {fmtDateTime(item.followUpAt)}{item.followUpNote ? ` · ${item.followUpNote}` : ""}</>
      : key === "call" ? <> · came {fmtRelative(item.createdAt)}</>
      : null;
    return (
      <div key={item._id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        {leadLine(item, extra)}
        <div className="flex flex-wrap items-center gap-1">
          <LeadActions contact={item} compact onChanged={load} />
          {key === "fees" && <Button size="sm" className="!h-7 !px-2 text-xs" onClick={() => setFeesFor(item)}>₹ Fees</Button>}
          {key !== "fees" && <Button size="sm" variant="ghost" className="!h-7 !px-2 text-xs" onClick={() => setNext({ contact: item, title: "Follow up" })}>📅 Next follow-up</Button>}
        </div>
      </div>
    );
  };

  return (
    <PageContainer>
      <PageHeader
        title="Today"
        description={total ? `${total} thing(s) to do — start from the top.` : "All clear 🎉 Nothing waiting right now."}
        actions={<QuickAddButton label="Walk-in / quick add" onAdded={load} />}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {sections.map((s) => (
          <a key={s.key} href={`#${s.key}`} className={cx("rounded-full border px-3 py-1 text-sm", s.items.length ? "border-slate-300 bg-white text-slate-800" : "border-slate-200 bg-slate-50 text-slate-400")}>
            {s.title.split(" — ")[0]} <b>{s.items.length}</b>
          </a>
        ))}
      </div>
      <div className="space-y-4">
        {sections.map((s) => (
          <Card key={s.key} id={s.key} className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-2.5">
              <div>
                <p className="font-medium text-slate-900">{s.title} <Badge tone={s.items.length ? s.tone : "gray"} className="ml-1">{s.items.length}</Badge></p>
                <p className="text-xs text-slate-500">{s.hint}</p>
              </div>
            </div>
            {s.items.length ? <div className="divide-y divide-slate-100">{s.items.map((it) => row(s.key, it))}</div> : <p className="px-4 py-4 text-sm text-slate-400">Nothing here 👍</p>}
          </Card>
        ))}
      </div>
      {next && <NextFollowUpModal contact={next.contact} defaultTitle={next.title} onClose={() => { setNext(null); load(); }} />}
      <Modal open={!!feesFor} onClose={() => { setFeesFor(null); load(); }} title={`Fees · ${feesFor?.name || fmtPhone(feesFor?.phone)}`} size="md">
        {feesFor && <FeesPanel contactId={feesFor._id} />}
      </Modal>
    </PageContainer>
  );
}
