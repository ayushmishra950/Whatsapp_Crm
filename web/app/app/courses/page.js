"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Download, GraduationCap, Pencil, Plus, Trash2, Upload, Users } from "lucide-react";
import { api, downloadFile } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtFieldDate } from "@/lib/contact-fields";
import { useToast } from "@/components/toast";
import { PageContainer } from "@/components/shell";
import { loadCourses } from "@/components/leads";
import { useIsCoaching } from "@/lib/business";
import { TagInput } from "@/components/shared";
import { Badge, Button, Card, ConfirmModal, EmptyState, Field, Input, Modal, PageHeader, PageLoader, Table, Textarea, Toggle } from "@/components/ui";

const EMPTY = {
  code: "", name: "", category: "", triggerWords: [], outcome: "", who: "", learn: "", internshipLine: "", greetingEn: "", greetingHi: "",
  feesEn: "", feesHi: "", feeAmount: 0, durationDays: 0, nextBatchDate: "", proofLink: "", pageUrl: "", packageCode: "", active: true,
};
const FIELDS = Object.keys(EMPTY);

/** Course catalog: used by the chatbot, course variables in drips / templates, ad → course and reports */
export default function CoursesPage() {
  const toast = useToast();
  const { session } = useAuth();
  const isAdmin = session.user.role === "admin";
  const [items, setItems] = useState(null);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState("");
  const fileRef = useRef(null);

  const coaching = useIsCoaching();
  const load = () => loadCourses(true).then(setItems).catch(toast.error);
  useEffect(() => { if (coaching) load(); }, [coaching]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (e) => {
    e.preventDefault();
    setBusy("save");
    try {
      const body = Object.fromEntries(FIELDS.map((k) => [k, editing[k]]));
      body.feeAmount = Number(body.feeAmount) || 0;
      body.durationDays = Number(body.durationDays) || 0;
      await api(editing._id ? `/courses/${editing._id}` : "/courses", { method: editing._id ? "PATCH" : "POST", body });
      toast.success("Course saved");
      setEditing(null);
      load();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy("");
    }
  };

  const remove = async () => {
    try {
      await api(`/courses/${deleting._id}`, { method: "DELETE", query: deleting.leads ? { force: 1 } : undefined });
      toast.success("Course deleted");
      setDeleting(null);
      load();
    } catch (err) {
      toast.error(err);
    }
  };

  const importFile = async (file) => {
    if (!file) return;
    setBusy("import");
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await api("/courses/import", { method: "POST", form });
      toast.success(`${r.added} added, ${r.updated} updated${r.errors.length ? `, ${r.errors.length} row(s) skipped (row ${r.errors[0].row}: ${r.errors[0].error})` : ""}`);
      load();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy("");
    }
  };

  if (!coaching) {
    return (
      <PageContainer>
        <EmptyState icon={GraduationCap} title="Courses are for coaching institutes" description="Ask your platform admin to set your business type to “Coaching institute”." />
      </PageContainer>
    );
  }
  if (!items) return <PageLoader />;
  const set = (patch) => setEditing((c) => ({ ...c, ...patch }));

  return (
    <PageContainer>
      <PageHeader
        title="Courses"
        description="Your course catalog. Leads get a course from the ad they clicked or the words they write (trigger words); drips and templates can then use its name, fees, next batch and more."
        actions={
          isAdmin && (
            <>
              <Button variant="secondary" onClick={() => downloadFile("/courses/import/sample", {}, "courses-sample.xlsx").catch(toast.error)}><Download className="h-4 w-4" /> Sample Excel</Button>
              <input ref={fileRef} type="file" accept=".xlsx,.csv" className="hidden" onChange={(e) => { importFile(e.target.files?.[0]); e.target.value = ""; }} />
              <Button variant="secondary" loading={busy === "import"} onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" /> Import Excel</Button>
              <Button onClick={() => setEditing({ ...EMPTY })}><Plus className="h-4 w-4" /> Add course</Button>
            </>
          )
        }
      />
      <Card>
        <Table
          columns={[
            {
              key: "name",
              label: "Course",
              render: (c) => (
                <div className="min-w-48">
                  <p className="font-medium text-slate-900">{c.name} <Badge tone="purple" className="ml-1">{c.code}</Badge> {!c.active && <Badge className="ml-1">inactive</Badge>}</p>
                  {c.outcome && <p className="text-xs text-slate-500">{c.outcome}</p>}
                  {c.triggerWords?.length > 0 && <p className="mt-0.5 text-[11px] text-slate-400">Words: {c.triggerWords.join(", ")}</p>}
                </div>
              ),
            },
            { key: "fees", label: "Fees", render: (c) => <div>{c.feeAmount ? `₹${c.feeAmount.toLocaleString("en-IN")}` : "—"}{c.perDay && <p className="text-xs text-slate-500">{c.perDay}/day</p>}</div> },
            { key: "duration", label: "Duration", render: (c) => (c.durationDays ? `${c.durationDays} days` : "—") },
            { key: "batch", label: "Next batch", className: "whitespace-nowrap", render: (c) => (c.nextBatchDate ? fmtFieldDate(c.nextBatchDate) : "—") },
            { key: "leads", label: "Leads", render: (c) => <Link className="text-brand-700 hover:underline" href={`/app/contacts?course=${c.code}`}><Users className="mr-1 inline h-3.5 w-3.5" />{c.leads}</Link> },
            {
              key: "actions",
              label: "",
              className: "text-right whitespace-nowrap",
              render: (c) =>
                isAdmin && (
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" onClick={() => setEditing({ ...EMPTY, ...c })} aria-label="Edit"><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => setDeleting(c)} aria-label="Delete"><Trash2 className="h-4 w-4 text-red-500" /></Button>
                  </div>
                ),
            },
          ]}
          rows={items}
          empty={<EmptyState icon={GraduationCap} title="No courses yet" description="Add your courses one by one or import them from Excel (download the sample first)." />}
        />
      </Card>

      <Modal open={!!editing} onClose={() => setEditing(null)} size="lg" title={editing?._id ? `Edit ${editing.name}` : "Add course"}
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" form="course-form" loading={busy === "save"}>Save</Button></>}>
        {editing && (
          <form id="course-form" onSubmit={save} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-[8rem_1fr_12rem]">
              <Field label="Code" hint="Short, e.g. DM"><Input required maxLength={20} value={editing.code} onChange={(e) => set({ code: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, "") })} /></Field>
              <Field label="Course name"><Input required maxLength={100} value={editing.name} onChange={(e) => set({ name: e.target.value })} /></Field>
              <Field label="Category"><Input maxLength={60} value={editing.category} onChange={(e) => set({ category: e.target.value })} /></Field>
            </div>
            <Field label="Trigger words" hint="When a lead writes one of these, this becomes their course (e.g. digital marketing, seo)">
              <TagInput value={editing.triggerWords} onChange={(triggerWords) => set({ triggerWords: triggerWords.map((w) => w.toLowerCase()) })} placeholder="Add words (comma or Enter)" />
            </Field>
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Fee (₹)"><Input type="number" min={0} value={editing.feeAmount} onChange={(e) => set({ feeAmount: e.target.value })} /></Field>
              <Field label="Duration (days)"><Input type="number" min={0} value={editing.durationDays} onChange={(e) => set({ durationDays: e.target.value })} /></Field>
              <Field label="Next batch"><Input type="date" value={editing.nextBatchDate} onChange={(e) => set({ nextBatchDate: e.target.value })} /></Field>
              <Field label="Bigger package code" hint="Suggest instead"><Input maxLength={20} value={editing.packageCode} onChange={(e) => set({ packageCode: e.target.value.toUpperCase() })} /></Field>
            </div>
            <Field label="Outcome (one line)" hint="What they will be able to do, e.g. run ads and get your first client"><Input maxLength={300} value={editing.outcome} onChange={(e) => set({ outcome: e.target.value })} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Who it is for"><Textarea rows={2} value={editing.who} onChange={(e) => set({ who: e.target.value })} /></Field>
              <Field label="What they learn"><Textarea rows={2} value={editing.learn} onChange={(e) => set({ learn: e.target.value })} /></Field>
              <Field label="Greeting (English)"><Textarea rows={2} value={editing.greetingEn} onChange={(e) => set({ greetingEn: e.target.value })} /></Field>
              <Field label="Greeting (Hinglish)"><Textarea rows={2} value={editing.greetingHi} onChange={(e) => set({ greetingHi: e.target.value })} /></Field>
              <Field label="Fees text (English)"><Input value={editing.feesEn} onChange={(e) => set({ feesEn: e.target.value })} placeholder="₹27,000 (EMI available)" /></Field>
              <Field label="Fees text (Hinglish)"><Input value={editing.feesHi} onChange={(e) => set({ feesHi: e.target.value })} placeholder="₹27,000 (EMI bhi hai)" /></Field>
              <Field label="Internship line"><Input value={editing.internshipLine} onChange={(e) => set({ internshipLine: e.target.value })} /></Field>
              <Field label="Proof link" hint="Student work / placements"><Input maxLength={300} value={editing.proofLink} onChange={(e) => set({ proofLink: e.target.value })} /></Field>
              <Field label="Website page" hint="The chatbot sends it with the course details / fees" className="sm:col-span-2"><Input maxLength={300} value={editing.pageUrl} placeholder="https://yourwebsite.com/course-page" onChange={(e) => set({ pageUrl: e.target.value })} /></Field>
            </div>
            <Toggle checked={editing.active} onChange={(active) => set({ active })} label="Active" description="Inactive courses are not detected in messages and not offered in dropdowns." />
          </form>
        )}
      </Modal>

      <ConfirmModal open={!!deleting} onClose={() => setDeleting(null)} onConfirm={remove} danger title="Delete course?" confirmText="Delete"
        message={deleting?.leads ? `${deleting.leads} lead(s) have ${deleting.name}; their course will be cleared. You can mark it inactive instead.` : `Delete ${deleting?.name}?`} />
    </PageContainer>
  );
}
