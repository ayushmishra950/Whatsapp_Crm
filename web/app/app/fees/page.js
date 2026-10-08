"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { IndianRupee, Search } from "lucide-react";
import { api } from "@/lib/api";
import { fmtPhone } from "@/lib/format";
import { useToast } from "@/components/toast";
import { PageContainer } from "@/components/shell";
import { LeadActions } from "@/components/actions";
import { FeesPanel, money, prettyDay } from "@/components/fees";
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, PageLoader, Stat, Table, cx } from "@/components/ui";

const VIEWS = [["overdue", "Overdue"], ["today", "Due today"], ["week", "Due in 7 days"], ["month", "Due in 30 days"], ["all", "All with balance"]];

/** Students' fees: totals, who has to pay and when, record payments */
export default function FeesPage() {
  const toast = useToast();
  const [when, setWhen] = useState("week");
  const [search, setSearch] = useState("");
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(null);
  const load = useCallback(() => {
    api("/fees", { query: { when, search } }).then(setData).catch(toast.error);
  }, [when, search]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  if (!data) return <PageLoader />;
  const t = data.totals;
  return (
    <PageContainer>
      <PageHeader title="Fees" description="Set a fee plan on each student (Contacts → edit, or the inbox side panel). Reminders go out on WhatsApp 3 days before, on the day and after a missed due date; overdue fees also create a task." />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Collected this month" value={money(t.collectedThisMonth)} sub={`${t.paymentsThisMonth} payment(s)`} icon={IndianRupee} />
        <Stat label="Pending (all students)" value={money(t.balance)} sub={`of ${money(t.billed)} billed · ${t.students} student(s)`} />
        <Stat label="Due in next 7 days" value={money(t.dueWeek)} />
        <Stat label="Students overdue" value={t.overdue} sub={t.overdue ? "Call them today" : "None 🎉"} />
      </div>
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
          <div className="flex flex-wrap gap-1">
            {VIEWS.map(([v, l]) => (
              <button key={v} type="button" onClick={() => setWhen(v)} className={cx("rounded-full border px-3 py-1 text-sm", when === v ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50")}>{l}</button>
            ))}
          </div>
          <div className="relative ml-auto w-full sm:w-60">
            <Search className="absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
            <Input className="pl-9" placeholder="Search student" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <Table
          columns={[
            { key: "s", label: "Student", render: (c) => <div><Link href={`/app/contacts/${c._id}`} className="font-medium text-slate-900 hover:text-brand-700">{c.name || fmtPhone(c.phone)}</Link><p className="text-xs text-slate-500">{fmtPhone(c.phone)}{c.course ? ` · ${c.course}` : ""}{c.assignedTo?.name ? ` · ${c.assignedTo.name}` : ""}</p></div> },
            { key: "next", label: "Next due", className: "whitespace-nowrap", render: (c) => <span className={cx(c.fees.nextDue < data.today && "font-medium text-red-600")}>{c.fees.nextDue < data.today && <Badge tone="red" className="mr-1">overdue</Badge>}<b>{money(c.fees.nextAmount)}</b> · {prettyDay(c.fees.nextDue)}</span> },
            { key: "paid", label: "Paid / fee", render: (c) => <span>{money(c.fees.paid)} <span className="text-xs text-slate-400">/ {money((c.fees.total || 0) - (c.fees.discount || 0))}</span></span> },
            { key: "bal", label: "Balance", render: (c) => <b className="text-amber-700">{money(c.fees.balance)}</b> },
            { key: "a", label: "", className: "text-right", render: (c) => <div className="flex flex-wrap justify-end gap-1"><LeadActions contact={c} compact onChanged={load} /><Button size="sm" className="!h-7 !px-2 text-xs" onClick={() => setOpen(c)}>₹ Payment / plan</Button></div> },
          ]}
          rows={data.items}
          empty={<EmptyState icon={IndianRupee} title="Nothing due here" description="Students with a fee plan and a balance show here. Set a plan from the student's contact." />}
        />
      </Card>
      <Modal open={!!open} onClose={() => { setOpen(null); load(); }} title={`Fees · ${open?.name || fmtPhone(open?.phone)}`} size="md">
        {open && <FeesPanel contactId={open._id} />}
      </Modal>
    </PageContainer>
  );
}
