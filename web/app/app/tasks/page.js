"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ClipboardList, RotateCcw, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useSocketEvent } from "@/lib/socket";
import { fmtDateTime, fmtPhone } from "@/lib/format";
import { useToast } from "@/components/toast";
import { PageContainer } from "@/components/shell";
import { LeadStatusBadge } from "@/components/shared";
import { Badge, Button, Card, ConfirmModal, EmptyState, PageHeader, PageLoader, Select, Table, cx } from "@/components/ui";
import { LeadActions, NextFollowUpModal } from "@/components/actions";

const isLate = (d) => new Date(d) < new Date();

const VIEWS = [["overdue", "Overdue"], ["today", "Due in 24h"], ["open", "All open"], ["done", "Done"]];

/** Calls, call-backs and demos for leads. Agents see their own; admins see everyone's. */
export default function TasksPage() {
  const toast = useToast();
  const { session } = useAuth();
  const isAdmin = session.user.role === "admin";
  const [view, setView] = useState("open");
  const [who, setWho] = useState(isAdmin ? "" : "me");
  const [team, setTeam] = useState([]);
  const [tasks, setTasks] = useState(null);
  const [nextFor, setNextFor] = useState(null); // task just done -> next follow-up
  const [cancelling, setCancelling] = useState(null);

  const load = useCallback(() => {
    const query = { status: view === "done" ? "done" : "open", ...(view === "overdue" && { when: "overdue" }), ...(view === "today" && { when: "today" }), ...(who && { assignedTo: who }) };
    api("/tasks", { query }).then(setTasks).catch(toast.error);
  }, [view, who]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (isAdmin) api("/team").then(setTeam).catch(() => {});
  }, [isAdmin]);
  useSocketEvent("task:update", () => load());

  const setStatus = async (t, status) => {
    try {
      await api(`/tasks/${t._id}`, { method: "PATCH", body: { status } });
      toast.success(status === "done" ? "Done ✓" : status === "open" ? "Task reopened" : "Task cancelled");
      if (status === "done" && t.contactId) setNextFor(t);
      setCancelling(null);
      load();
    } catch (err) {
      toast.error(err);
    }
  };
  const reassign = async (t, assignedTo) => {
    try {
      await api(`/tasks/${t._id}`, { method: "PATCH", body: { assignedTo: assignedTo || null } });
      load();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <PageContainer>
      <PageHeader title="Tasks" description="Every lead should have a next action. Tasks come from you, from keyword rules, status time limits and drips." />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {VIEWS.map(([v, l]) => (
            <button key={v} type="button" onClick={() => setView(v)} className={cx("rounded-full border px-3 py-1.5 text-sm font-medium", view === v ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50")}>{l}</button>
          ))}
        </div>
        {isAdmin && (
          <Select className="ml-auto sm:w-48" value={who} onChange={(e) => setWho(e.target.value)} aria-label="Assigned to">
            <option value="">Everyone</option>
            <option value="me">Me</option>
            <option value="none">Not assigned</option>
            {team.filter((m) => m._id !== session.user._id).map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}
          </Select>
        )}
      </div>
      <Card>
        {!tasks ? <PageLoader /> : (
          <Table
            columns={[
              {
                key: "task",
                label: "Task",
                render: (t) => (
                  <div className="min-w-48">
                    <p className="font-medium text-slate-900">{t.title}</p>
                    <p className="text-xs text-slate-500">{t.source === "automation" ? `Auto · ${t.sourceName || "automation"}` : "Added by hand"}{t.note && ` · ${t.note}`}</p>
                  </div>
                ),
              },
              {
                key: "lead",
                label: "Lead",
                render: (t) => (t.contactId ? (
                  <Link href={`/app/contacts/${t.contactId._id}`} className="block hover:underline">
                    <p className="text-slate-800">{t.contactId.name || fmtPhone(t.contactId.phone)}</p>
                    <p className="text-xs text-slate-500">{fmtPhone(t.contactId.phone)}{t.contactId.course && ` · ${t.contactId.course}`}</p>
                  </Link>
                ) : "—"),
              },
              { key: "status", label: "Lead status", render: (t) => t.contactId && <LeadStatusBadge status={t.contactId.leadStatus} /> },
              {
                key: "due",
                label: view === "done" ? "Done" : "Due",
                className: "whitespace-nowrap",
                render: (t) => view === "done"
                  ? <span className="text-xs text-slate-500">{fmtDateTime(t.doneAt)}{t.doneBy?.name && ` · ${t.doneBy.name}`}</span>
                  : <span className={cx("text-sm", isLate(t.dueAt) && "font-medium text-red-600")}>{isLate(t.dueAt) && <Badge tone="red" className="mr-1">overdue</Badge>}{fmtDateTime(t.dueAt)}</span>,
              },
              {
                key: "who",
                label: "Assigned to",
                render: (t) => isAdmin && view !== "done" ? (
                  <Select className="h-8 w-36 text-sm" value={t.assignedTo?._id || ""} onChange={(e) => reassign(t, e.target.value)} aria-label="Assigned to">
                    <option value="">Not assigned</option>
                    {team.map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}
                  </Select>
                ) : (t.assignedTo?.name || "—"),
              },
              {
                key: "actions",
                label: "",
                className: "text-right whitespace-nowrap",
                render: (t) => view === "done" ? (
                  <Button size="sm" variant="ghost" onClick={() => setStatus(t, "open")}><RotateCcw className="h-3.5 w-3.5" /> Reopen</Button>
                ) : (
                  <div className="flex justify-end gap-1">
                    {t.contactId && <LeadActions contact={t.contactId} compact onChanged={load} />}
                    <Button size="sm" className="!h-7 !px-2 text-xs" onClick={() => setStatus(t, "done")}><CheckCircle2 className="h-3.5 w-3.5" /> Done</Button>
                    <Button size="icon" variant="ghost" onClick={() => setCancelling(t)} title="Cancel task" aria-label="Cancel task"><Trash2 className="h-4 w-4 text-red-500" /></Button>
                  </div>
                ),
              },
            ]}
            rows={tasks}
            empty={<EmptyState icon={ClipboardList} title={view === "overdue" ? "Nothing overdue 🎉" : "No tasks here"} description="Add a task from a lead (Contacts → edit, or the Inbox side panel) or log a call with a next action." />}
          />
        )}
      </Card>
      {nextFor && <NextFollowUpModal contact={nextFor.contactId} defaultTitle={nextFor.title} onClose={() => { setNextFor(null); load(); }} />}
      <ConfirmModal open={!!cancelling} onClose={() => setCancelling(null)} onConfirm={() => setStatus(cancelling, "cancelled")} danger title="Cancel this task?" confirmText="Cancel task"
        message={`“${cancelling?.title}” will be removed from the to-do list. If the lead still needs a call, set a new follow-up.`} />
    </PageContainer>
  );
}
