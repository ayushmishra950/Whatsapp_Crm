"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, Upload, Pencil, Trash2, MessageCircle, Contact as ContactIcon, Tag, X } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDate, fmtPhone } from "@/lib/format";
import { useToast } from "@/components/toast";
import { PageContainer } from "@/components/shell";
import { LEAD_STATUSES, TagInput } from "@/components/shared";
import {
  Badge, Button, Card, ConfirmModal, EmptyState, Field, Input, Modal, PageHeader, PageLoader, Pagination, Select, StatusBadge, Table, Textarea,
} from "@/components/ui";

const empty = { name: "", phone: "", email: "", tags: [], leadStatus: "new", notes: "" };

export default function ContactsPage() {
  const toast = useToast();
  const router = useRouter();
  const { session } = useAuth();
  const isAdmin = session.user.role === "admin";
  const [data, setData] = useState(null);
  const [tags, setTags] = useState([]);
  const [filters, setFilters] = useState({ search: "", tag: "", leadStatus: "", page: 1 });
  const [selected, setSelected] = useState([]);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [bulkTag, setBulkTag] = useState(null); // "add" | "remove"
  const [bulkTags, setBulkTags] = useState([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api("/contacts", { query: filters }).then(setData).catch(toast.error);
  }, [filters]); // eslint-disable-line react-hooks/exhaustive-deps
  const loadTags = () => api("/contacts/tags").then(setTags);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);
  useEffect(() => { loadTags(); }, []);

  const setFilter = (k, v) => { setFilters((f) => ({ ...f, [k]: v, page: k === "page" ? v : 1 })); setSelected([]); };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    const { _id, name, phone, email, tags: t, leadStatus, notes, optedOut } = editing;
    try {
      const body = { name, phone, email: email || "", tags: t, leadStatus, notes };
      if (_id) body.optedOut = optedOut;
      await api(_id ? `/contacts/${_id}` : "/contacts", { method: _id ? "PATCH" : "POST", body });
      toast.success("Contact saved");
      setEditing(null);
      load();
      loadTags();
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  const chat = async (contact) => {
    try {
      const conv = await api("/conversations/start", { method: "POST", body: { contactId: contact._id } });
      router.push(`/app/inbox?c=${conv._id}`);
    } catch (err) {
      toast.error(err);
    }
  };

  const remove = async () => {
    try {
      if (deleting === "bulk") await api("/contacts/bulk-delete", { method: "POST", body: { ids: selected } });
      else await api(`/contacts/${deleting._id}`, { method: "DELETE" });
      toast.success("Deleted");
      setDeleting(null);
      setSelected([]);
      load();
    } catch (err) {
      toast.error(err);
    }
  };

  const applyBulkTag = async () => {
    try {
      await api("/contacts/bulk-tag", { method: "POST", body: { ids: selected, tags: bulkTags, action: bulkTag } });
      toast.success("Tags updated");
      setBulkTag(null);
      setBulkTags([]);
      setSelected([]);
      load();
      loadTags();
    } catch (err) {
      toast.error(err);
    }
  };

  const allOnPage = data?.items.map((c) => c._id) || [];
  const allSelected = allOnPage.length > 0 && allOnPage.every((id) => selected.includes(id));

  const columns = [
    {
      key: "select",
      label: <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? [] : allOnPage)} aria-label="Select all" />,
      className: "w-8",
      render: (c) => (
        <input type="checkbox" checked={selected.includes(c._id)} onChange={() => setSelected((s) => (s.includes(c._id) ? s.filter((x) => x !== c._id) : [...s, c._id]))} aria-label={`Select ${c.name}`} />
      ),
    },
    {
      key: "name",
      label: "Contact",
      render: (c) => (
        <div>
          <p className="font-medium text-slate-800">{c.name || "Unknown"} {c.optedOut && <Badge tone="red" className="ml-1">opted out</Badge>}</p>
          <p className="text-xs text-slate-500">{fmtPhone(c.phone)}{c.email ? ` · ${c.email}` : ""}</p>
        </div>
      ),
    },
    { key: "status", label: "Lead status", render: (c) => <StatusBadge status={c.leadStatus} /> },
    { key: "tags", label: "Tags", render: (c) => <div className="flex flex-wrap gap-1">{c.tags.map((t) => <Badge key={t}>{t}</Badge>)}</div> },
    { key: "source", label: "Source", render: (c) => <span className="text-slate-500 capitalize">{c.source}</span> },
    { key: "created", label: "Added", className: "whitespace-nowrap", render: (c) => fmtDate(c.createdAt) },
    {
      key: "actions",
      label: "",
      className: "text-right whitespace-nowrap",
      render: (c) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon" onClick={() => chat(c)} title="Open chat" aria-label="Open chat"><MessageCircle className="h-4 w-4 text-brand-600" /></Button>
          <Button variant="ghost" size="icon" onClick={() => setEditing({ ...empty, ...c })} aria-label="Edit"><Pencil className="h-4 w-4" /></Button>
          {isAdmin && <Button variant="ghost" size="icon" onClick={() => setDeleting(c)} aria-label="Delete"><Trash2 className="h-4 w-4 text-red-500" /></Button>}
        </div>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title="Contacts / Leads"
        description="Everyone who chats with your business is saved here automatically."
        actions={
          <>
            {isAdmin && <Button variant="secondary" onClick={() => setImportOpen(true)}><Upload className="h-4 w-4" /> Import CSV</Button>}
            <Button onClick={() => setEditing({ ...empty })}><Plus className="h-4 w-4" /> Add contact</Button>
          </>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
          <div className="relative w-full sm:w-64">
            <Search className="absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
            <Input className="pl-9" placeholder="Search name, phone, email" value={filters.search} onChange={(e) => setFilter("search", e.target.value)} />
          </div>
          <Select className="w-auto" value={filters.tag} onChange={(e) => setFilter("tag", e.target.value)}>
            <option value="">All tags</option>
            {tags.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
          <Select className="w-auto" value={filters.leadStatus} onChange={(e) => setFilter("leadStatus", e.target.value)}>
            <option value="">All statuses</option>
            {LEAD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
          {selected.length > 0 && (
            <div className="ml-auto flex items-center gap-2 text-sm">
              <span className="text-slate-500">{selected.length} selected</span>
              <Button size="sm" variant="secondary" onClick={() => setBulkTag("add")}><Tag className="h-3.5 w-3.5" /> Add tag</Button>
              <Button size="sm" variant="secondary" onClick={() => setBulkTag("remove")}>Remove tag</Button>
              {isAdmin && <Button size="sm" variant="danger" onClick={() => setDeleting("bulk")}>Delete</Button>}
            </div>
          )}
        </div>
        {!data ? <PageLoader /> : (
          <>
            <Table columns={columns} rows={data.items} empty={<EmptyState icon={ContactIcon} title="No contacts found" description="Add contacts manually, import a CSV, or they will appear when customers message you." />} />
            <Pagination page={data.page} limit={data.limit} total={data.total} onChange={(p) => setFilter("page", p)} />
          </>
        )}
      </Card>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?._id ? "Edit contact" : "Add contact"}
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" form="contact-form" loading={saving}>Save</Button></>}
      >
        {editing && (
          <form id="contact-form" onSubmit={save} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name"><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
              <Field label="WhatsApp number" hint="With country code, e.g. 919876543210"><Input required value={editing.phone} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} /></Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Email"><Input type="email" value={editing.email || ""} onChange={(e) => setEditing({ ...editing, email: e.target.value })} /></Field>
              <Field label="Lead status">
                <Select value={editing.leadStatus} onChange={(e) => setEditing({ ...editing, leadStatus: e.target.value })}>
                  {LEAD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </Select>
              </Field>
            </div>
            <Field label="Tags"><TagInput value={editing.tags} onChange={(t) => setEditing({ ...editing, tags: t })} suggestions={tags} /></Field>
            <Field label="Notes"><Textarea rows={3} value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></Field>
            {editing._id && (
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={!!editing.optedOut} onChange={(e) => setEditing({ ...editing, optedOut: e.target.checked })} />
                Opted out of bulk messages
              </label>
            )}
          </form>
        )}
      </Modal>

      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onDone={() => { load(); loadTags(); }} />

      <Modal open={!!bulkTag} onClose={() => setBulkTag(null)} title={bulkTag === "add" ? "Add tags" : "Remove tags"} size="sm"
        footer={<><Button variant="secondary" onClick={() => setBulkTag(null)}>Cancel</Button><Button onClick={applyBulkTag} disabled={!bulkTags.length}>Apply to {selected.length}</Button></>}>
        <TagInput value={bulkTags} onChange={setBulkTags} suggestions={tags} />
      </Modal>

      <ConfirmModal open={!!deleting} onClose={() => setDeleting(null)} onConfirm={remove} danger title="Delete contact?" confirmText="Delete"
        message={deleting === "bulk" ? `Delete ${selected.length} contacts and their chat history?` : `Delete ${deleting?.name || "this contact"} and their chat history?`} />
    </PageContainer>
  );
}

function ImportModal({ open, onClose, onDone }) {
  const toast = useToast();
  const [file, setFile] = useState(null);
  const [tags, setTags] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const close = () => { setFile(null); setResult(null); setTags(""); onClose(); };

  const submit = async () => {
    const form = new FormData();
    form.append("file", file);
    form.append("tags", tags);
    setLoading(true);
    try {
      const r = await api("/contacts/import", { method: "POST", form });
      setResult(r);
      onDone();
    } catch (err) {
      toast.error(err);
    } finally {
      setLoading(false);
    }
  };

  const sample = "data:text/csv;charset=utf-8," + encodeURIComponent("name,phone,email,tags,city\nRahul Sharma,919876543210,rahul@example.com,vip|jaipur,Jaipur\n");

  return (
    <Modal open={open} onClose={close} title="Import contacts from CSV"
      footer={result ? <Button onClick={close}>Done</Button> : <><Button variant="secondary" onClick={close}>Cancel</Button><Button onClick={submit} disabled={!file} loading={loading}>Import</Button></>}>
      {result ? (
        <div className="space-y-2 text-sm">
          <p>✅ <b>{result.created}</b> new contacts created</p>
          <p>🔄 <b>{result.updated}</b> existing contacts updated</p>
          {result.invalid > 0 && <p>⚠️ <b>{result.invalid}</b> rows skipped (invalid phone)</p>}
          {result.skippedLimit > 0 && <p className="text-red-600">⛔ <b>{result.skippedLimit}</b> rows skipped — plan contact limit reached</p>}
          {result.errors.length > 0 && <ul className="mt-2 list-inside list-disc text-xs text-slate-500">{result.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          <p className="text-slate-600">
            Required column: <code>phone</code> (with country code). Optional: <code>name</code>, <code>email</code>, <code>tags</code> (separate with |), <code>lead_status</code>. Other columns are saved as custom fields.{" "}
            <a href={sample} download="contacts-sample.csv" className="font-medium text-brand-700 underline">Download sample</a>
          </p>
          <input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] || null)} className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium" />
          <Field label="Add these tags to all imported contacts (optional)" hint="Comma separated"><Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="e.g. expo-2026" /></Field>
        </div>
      )}
    </Modal>
  );
}
