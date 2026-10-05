"use client";

import { useEffect, useState } from "react";
import { Plus, Send, Pencil, Trash2, FileText } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useSocketEvent } from "@/lib/socket";
import { useToast } from "@/components/toast";
import { PageContainer } from "@/components/shell";
import { TemplatePreview } from "@/components/shared";
import { Badge, Button, Card, ConfirmModal, EmptyState, Field, Input, Modal, PageHeader, PageLoader, Select, StatusBadge, Textarea } from "@/components/ui";

const empty = { name: "", language: "en", category: "MARKETING", header: "", body: "", footer: "" };
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
    try {
      await api(_id ? `/templates/${_id}` : "/templates", { method: _id ? "PATCH" : "POST", body: { name, language, category, header, body, footer } });
      toast.success("Template saved as draft. Submit it for WhatsApp approval.");
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
            {isAdmin && (
              <div className="mt-auto flex items-center justify-end gap-1 pt-3">
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
        title={editing?._id ? "Edit template" : "New template"}
        size="lg"
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" form="tpl-form" loading={busy === "save"}>Save draft</Button></>}
      >
        {editing && (
          <div className="grid gap-5 md:grid-cols-2">
            <form id="tpl-form" onSubmit={save} className="space-y-4">
              <Field label="Name" hint="lowercase_with_underscores">
                <Input required disabled={!!editing._id} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Category">
                  <Select value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })}>
                    <option value="MARKETING">Marketing</option>
                    <option value="UTILITY">Utility</option>
                    <option value="AUTHENTICATION">Authentication</option>
                  </Select>
                </Field>
                <Field label="Language">
                  <Select value={editing.language} disabled={!!editing._id} onChange={(e) => setEditing({ ...editing, language: e.target.value })}>
                    {LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </Select>
                </Field>
              </div>
              <Field label="Header (optional)"><Input maxLength={60} value={editing.header} onChange={(e) => setEditing({ ...editing, header: e.target.value })} /></Field>
              <Field label="Body" hint="Use {{1}}, {{2}} for personalised values, e.g. Hi {{1}}">
                <Textarea required rows={5} maxLength={1024} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
              </Field>
              <Field label="Footer (optional)"><Input maxLength={60} value={editing.footer} onChange={(e) => setEditing({ ...editing, footer: e.target.value })} placeholder="Reply STOP to unsubscribe" /></Field>
            </form>
            <div>
              <p className="mb-2 text-sm font-medium text-slate-700">Preview</p>
              <TemplatePreview {...editing} />
              <p className="mt-3 text-xs text-slate-500"><Badge tone="blue">Tip</Badge> Marketing templates are charged higher by WhatsApp than Utility ones. Add an opt-out line in the footer for marketing messages.</p>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmModal open={!!deleting} onClose={() => setDeleting(null)} onConfirm={remove} danger title="Delete template?" confirmText="Delete"
        message={`"${deleting?.name}" will also be deleted from WhatsApp.`} />
    </PageContainer>
  );
}
