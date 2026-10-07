"use client";

import { useEffect, useState } from "react";
import { Plus, Send, Pencil, Trash2, FileText, Lock, Info, Braces } from "lucide-react";
import { api } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { useSocketEvent } from "@/lib/socket";
import { useToast } from "@/components/toast";
import { PageContainer } from "@/components/shell";
import { TemplatePreview, VariableDefaultsEditor, fitVariableDefaults, variableExample } from "@/components/shared";
import { Badge, Button, Card, ConfirmModal, EmptyState, Field, Input, Modal, PageHeader, PageLoader, Select, StatusBadge, Textarea } from "@/components/ui";

const empty = { name: "", language: "en", category: "MARKETING", header: "", body: "", footer: "", variableDefaults: [] };
const LANGS = [["en", "English"], ["en_US", "English (US)"], ["hi", "Hindi"], ["gu", "Gujarati"], ["mr", "Marathi"], ["ta", "Tamil"], ["te", "Telugu"], ["bn", "Bengali"]];

export default function TemplatesPage() {
  const toast = useToast();
  const { session } = useAuth();
  const isAdmin = session.user.role === "admin";
  const [items, setItems] = useState(null);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState("");

  const load = () => api("/templates").then(setItems).catch(toast.error);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useSocketEvent("template:update", (t) => setItems((list) => list?.map((x) => (x._id === t._id ? { ...x, ...t } : x))));

  const save = async (e) => {
    e.preventDefault();
    setBusy("save");
    const { _id, name, language, category, header, body, footer } = editing;
    const variableDefaults = fitVariableDefaults(editing.variableDefaults, body);
    try {
      if (onlyVariables) {
        // Variables are CRM-only: saved straight away, no WhatsApp review
        await api(`/templates/${_id}/variables`, { method: "PUT", body: { variableDefaults } });
        toast.success("Variables saved. New campaigns and chats will use them.");
      } else if (approvedEdit) {
        await api(`/templates/${_id}/edit-approved`, { method: "POST", body: { header, body, footer, variableDefaults } });
        toast.success("Edit sent to WhatsApp for review. The template can be used again once it is approved.");
      } else {
        await api(_id ? `/templates/${_id}` : "/templates", { method: _id ? "PATCH" : "POST", body: { name, language, category, header, body, footer, variableDefaults } });
        toast.success("Template saved as draft. Submit it for WhatsApp approval.");
      }
      setEditing(null);
      load();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy("");
    }
  };

  const submit = async (t) => {
    setBusy(t._id);
    try {
      await api(`/templates/${t._id}/submit`, { method: "POST" });
      toast.success("Submitted to WhatsApp for approval");
      load();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy("");
    }
  };

  const remove = async () => {
    try {
      await api(`/templates/${deleting._id}`, { method: "DELETE" });
      toast.success("Template deleted");
      setDeleting(null);
      load();
    } catch (err) {
      toast.error(err);
    }
  };

  if (!items) return <PageLoader />;

  // Editing an already approved template: only header / body / footer, re-reviewed by WhatsApp
  const approvedEdit = editing?.status === "approved";
  const original = editing?._id ? items.find((x) => x._id === editing._id) : null;
  // Text can't change while WhatsApp reviews it, or when the approved-edit limit is used up; variables always can
  const textLocked = editing?.status === "pending" || (approvedEdit && !!original?.editLimits?.nextAllowedAt);
  const textChanged = !!original && ["header", "body", "footer"].some((k) => (editing[k] || "") !== (original[k] || ""));
  const onlyVariables = !!original && ["approved", "pending"].includes(editing.status) && !textChanged;
  const previewParams = editing ? fitVariableDefaults(editing.variableDefaults, editing.body).map(variableExample) : [];
  const lockedHint = "WhatsApp does not allow changing this after the template is approved";

  return (
    <PageContainer>
      <PageHeader
        title="Message templates"
        description="WhatsApp only allows pre-approved templates for the first message to a customer and for bulk campaigns."
        actions={isAdmin && <Button onClick={() => setEditing({ ...empty })}><Plus className="h-4 w-4" /> New template</Button>}
      />
      {!items.length && <Card><EmptyState icon={FileText} title="No templates yet" description="Create a template, submit it, and once approved you can use it in chats and campaigns." /></Card>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((t) => (
          <Card key={t._id} className="flex flex-col p-4">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-mono text-sm font-medium text-slate-900">{t.name}</p>
                <p className="text-xs text-slate-500">{t.category} · {t.language}</p>
              </div>
              <StatusBadge status={t.status} />
            </div>
            <TemplatePreview {...t} />
            {t.status === "rejected" && t.rejectionReason && <p className="mt-2 text-xs text-red-600">Rejected: {t.rejectionReason}</p>}
            {t.status === "pending" && t.previousVersion?.body && (
              <p className="mt-2 text-xs text-amber-700">✏️ Your edit is in WhatsApp review. The template can be used again once it is approved.</p>
            )}
            {t.status === "approved" && t.editLimits?.usedLast30Days > 0 && (
              <p className="mt-2 text-xs text-slate-500">
                Edited {t.editLimits.usedLast30Days}× in the last 30 days · {t.editLimits.remaining} edit(s) left
                {t.editLimits.nextAllowedAt && <> · next edit after {fmtDateTime(t.editLimits.nextAllowedAt)}</>}
              </p>
            )}
            {isAdmin && (
              <div className="mt-auto flex items-center justify-end gap-1 pt-3">
                {t.status === "approved" && (
                  <Button
                    size="sm"
                    variant="secondary"
                    title={t.editLimits?.nextAllowedAt ? `Text: WhatsApp allows 1 edit per 24 hours (next after ${fmtDateTime(t.editLimits.nextAllowedAt)}). Variables can be changed any time.` : "Change the text (WhatsApp reviews it again) or the variables (no review)."}
                    onClick={() => setEditing(t)}
                  >
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </Button>
                )}
                {t.status === "pending" && t.variableCount > 0 && (
                  <Button size="sm" variant="secondary" onClick={() => setEditing(t)} title="Set what {{1}}, {{2}} are filled with">
                    <Braces className="h-3.5 w-3.5" /> Variables
                  </Button>
                )}
                {["draft", "rejected"].includes(t.status) && (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => setEditing(t)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
                    <Button size="sm" onClick={() => submit(t)} loading={busy === t._id}><Send className="h-3.5 w-3.5" /> Submit</Button>
                  </>
                )}
                <Button size="icon" variant="ghost" onClick={() => setDeleting(t)} aria-label="Delete template"><Trash2 className="h-4 w-4 text-red-500" /></Button>
              </div>
            )}
          </Card>
        ))}
      </div>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.status === "pending" ? "Template variables" : approvedEdit ? "Edit approved template" : editing?._id ? "Edit template" : "New template"}
        size="lg"
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" form="tpl-form" loading={busy === "save"}>{onlyVariables ? "Save variables" : approvedEdit ? <><Send className="h-3.5 w-3.5" /> Submit edit for approval</> : "Save draft"}</Button></>}
      >
        {editing && (
          <div className="grid gap-5 md:grid-cols-2">
            <form id="tpl-form" onSubmit={save} className="space-y-4">
              {approvedEdit && (
                <div className="space-y-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <p className="flex items-center gap-1 font-medium"><Info className="h-3.5 w-3.5" /> How editing an approved template works</p>
                  <p>• Only Header, Body and Footer can be changed. Name, category and language are locked by WhatsApp.</p>
                  <p>• WhatsApp reviews the edit again (usually minutes to a few hours). Until then the template can not be used in chats or campaigns.</p>
                  <p>• Limit: 1 edit per 24 hours, 10 per 30 days. Edits left: <b>{editing.editLimits?.remaining ?? 10}</b>.</p>
                  <p>• <b>Variables</b> (below) are saved only in this CRM: change them any time, no review and no limit.</p>
                  {textLocked && <p className="font-medium">• Text is locked until {fmtDateTime(original.editLimits.nextAllowedAt)}. You can still change the variables.</p>}
                </div>
              )}
              <Field label={<span className="inline-flex items-center gap-1">Name {editing._id && <Lock className="h-3 w-3 text-slate-400" />}</span>} hint={editing._id ? "Can not be changed" : "lowercase_with_underscores"}>
                <Input required disabled={!!editing._id} title={editing._id ? "Template name can not be changed" : undefined} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={<span className="inline-flex items-center gap-1">Category {approvedEdit && <Lock className="h-3 w-3 text-slate-400" />}</span>}>
                  <Select value={editing.category} disabled={approvedEdit || editing.status === "pending"} title={approvedEdit ? lockedHint : undefined} onChange={(e) => setEditing({ ...editing, category: e.target.value })}>
                    <option value="MARKETING">Marketing</option>
                    <option value="UTILITY">Utility</option>
                    <option value="AUTHENTICATION">Authentication</option>
                  </Select>
                </Field>
                <Field label={<span className="inline-flex items-center gap-1">Language {editing._id && <Lock className="h-3 w-3 text-slate-400" />}</span>}>
                  <Select value={editing.language} disabled={!!editing._id} title={editing._id ? "Language can not be changed" : undefined} onChange={(e) => setEditing({ ...editing, language: e.target.value })}>
                    {LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </Select>
                </Field>
              </div>
              {editing.status === "pending" && (
                <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">WhatsApp is reviewing this template, so its text can not change now. You can still set the variables (saved only in this CRM).</p>
              )}
              <Field label="Header (optional)"><Input maxLength={60} disabled={textLocked} value={editing.header} onChange={(e) => setEditing({ ...editing, header: e.target.value })} /></Field>
              <Field label="Body" hint="Use {{1}}, {{2}} for personalised values, e.g. Hi {{1}}">
                <Textarea required rows={5} maxLength={1024} disabled={textLocked} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
              </Field>
              <Field label="Footer (optional)"><Input maxLength={60} disabled={textLocked} value={editing.footer} onChange={(e) => setEditing({ ...editing, footer: e.target.value })} placeholder="Reply STOP to unsubscribe" /></Field>
            </form>
            <div>
              <p className="mb-2 text-sm font-medium text-slate-700">Preview</p>
              <TemplatePreview {...editing} params={previewParams} />
              <p className="mt-3 text-xs text-slate-500"><Badge tone="blue">Tip</Badge> Marketing templates are charged higher by WhatsApp than Utility ones. Add an opt-out line in the footer for marketing messages.</p>
            </div>
            <div className="md:col-span-2">
              <VariableDefaultsEditor value={editing.variableDefaults} body={editing.body} onChange={(v) => setEditing({ ...editing, variableDefaults: v })} />
            </div>
          </div>
        )}
      </Modal>

      <ConfirmModal open={!!deleting} onClose={() => setDeleting(null)} onConfirm={remove} danger title="Delete template?" confirmText="Delete"
        message={`"${deleting?.name}" will also be deleted from WhatsApp.`} />
    </PageContainer>
  );
}
