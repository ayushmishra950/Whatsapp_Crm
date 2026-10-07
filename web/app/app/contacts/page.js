"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Plus, Search, Upload, Download, Pencil, Trash2, MessageCircle, Contact as ContactIcon, Tag, Megaphone, X, Filter, Workflow,
} from "lucide-react";
import { api, downloadFile } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLeadStatuses } from "@/lib/lead-statuses";
import { fmtDate, fmtDateTime, fmtPhone } from "@/lib/format";
import { useToast } from "@/components/toast";
import { PageContainer } from "@/components/shell";
import { CustomFieldInputs, FollowUpChip, FollowUpMessage, LeadStatusSelect, ReferralBox, TagInput } from "@/components/shared";
import { ImportWizard, CAMPAIGN_PREFILL_KEY } from "@/components/contacts/import-wizard";
import {
  Badge, Button, Card, ConfirmModal, EmptyState, Field, Input, Modal, PageHeader, PageLoader, Pagination, Select, Table, Textarea, cx,
} from "@/components/ui";

const empty = { name: "", phone: "", email: "", tags: [], leadStatus: "new", notes: "", followUpAt: null, followUpNote: "", followUpAction: "remind", followUpTemplateId: null, customFields: {} };
const NO_FILTERS = { search: "", tag: "", leadStatus: "", source: "", adId: "", followUp: "", joined: "", lastInbound: "", page: 1 };
const JOINED = [["", "Joined: any time"], ["7d", "Joined: last 7 days"], ["14d", "Joined: last 14 days"], ["30d", "Joined: last 1 month"], ["90d", "Joined: last 3 months"], ["180d", "Joined: last 6 months"], ["365d", "Joined: last 12 months"]];
const LAST_IN = [["", "Last message: any"], ["7d", "Messaged: last 7 days"], ["14d", "Messaged: last 14 days"], ["30d", "Messaged: last 1 month"], ["90d", "Messaged: last 3 months"], ["180d", "Messaged: last 6 months"], ["365d", "Messaged: last 12 months"]];
const SOURCES = [["", "All sources"], ["ad", "📣 Facebook / Instagram ad"], ["whatsapp", "WhatsApp (direct)"], ["import", "Sheet import"], ["manual", "Added manually"]];
const FOLLOW_UPS = [["", "Any follow-up"], ["due", "Due today"], ["overdue", "Overdue"], ["upcoming", "Upcoming"], ["any", "Has a follow-up"]];

// <input type="datetime-local"> value in the user's own time zone
const toLocalInput = (d) => {
  if (!d) return "";
  const date = new Date(d);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

// useSearchParams needs a Suspense boundary; a new query (e.g. a dashboard link) starts with fresh filters
export default function ContactsRoute() {
  return (
    <Suspense fallback={null}>
      <ContactsFromUrl />
    </Suspense>
  );
}

function ContactsFromUrl() {
  const query = useSearchParams().toString();
  return <ContactsPage key={query} urlQuery={query} />;
}

function ContactsPage({ urlQuery }) {
  const toast = useToast();
  const router = useRouter();
  const { session, refresh } = useAuth();
  const { list: statuses } = useLeadStatuses();
  const isAdmin = session.user.role === "admin";
  const [data, setData] = useState(null);
  const [counts, setCounts] = useState(null);
  const [tags, setTags] = useState([]);
  const [ads, setAds] = useState([]);
  // Links like /app/contacts?leadStatus=qualified or ?followUp=due open with that filter (page renders after hydration)
  const [filters, setFilters] = useState(() => {
    const q = new URLSearchParams(urlQuery);
    return { ...NO_FILTERS, ...Object.fromEntries(Object.keys(NO_FILTERS).filter((k) => k !== "page" && q.get(k)).map((k) => [k, q.get(k)])) };
  });
  const [selected, setSelected] = useState([]);
  const [allMatching, setAllMatching] = useState(false); // bulk action on every contact matching the filters
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [bulkTag, setBulkTag] = useState(null); // "add" | "remove"
  const [dripOpen, setDripOpen] = useState(false);
  const [bulkTags, setBulkTags] = useState([]);
  const [busy, setBusy] = useState("");

  const { page, ...filterOnly } = filters;
  const query = { ...filters, tz: Intl.DateTimeFormat().resolvedOptions().timeZone };

  const filtersKey = JSON.stringify(filters);
  const load = useCallback(() => {
    const q = { ...JSON.parse(filtersKey), tz: Intl.DateTimeFormat().resolvedOptions().timeZone };
    api("/contacts", { query: q }).then(setData).catch(toast.error);
    const { leadStatus: _l, page: _p, ...rest } = q;
    api("/contacts/status-counts", { query: rest }).then(setCounts).catch(() => {});
  }, [filtersKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const loadLists = () => {
    api("/contacts/tags").then(setTags).catch(() => {});
    api("/contacts/ad-sources").then(setAds).catch(() => {});
  };

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);
  useEffect(() => { loadLists(); }, []);

  const clearSelection = () => {
    setSelected([]);
    setAllMatching(false);
  };
  const setFilter = (k, v) => {
    setFilters((f) => ({ ...f, [k]: v, ...(k === "source" && v !== "ad" && { adId: "" }), page: k === "page" ? v : 1 }));
    if (k !== "page") clearSelection();
  };
  const hasFilters = Object.entries(filterOnly).some(([, v]) => v);

  const selectionCount = allMatching ? data?.total || 0 : selected.length;
  const target = () => (allMatching ? { filter: { ...filterOnly, tz: query.tz } } : { ids: selected });

  // ---------- actions ----------
  const save = async (e) => {
    e.preventDefault();
    setBusy("save");
    const { _id, name, phone, email, tags: t, leadStatus, notes, optedOut, followUpAt, followUpNote, followUpAction, followUpTemplateId } = editing;
    // Empty custom values are dropped (= value deleted)
    const customFields = Object.fromEntries(Object.entries(editing.customFields || {}).map(([k, v]) => [k, String(v ?? "").trim()]).filter(([, v]) => v));
    try {
      const body = { name, phone, email: email || "", tags: t, leadStatus, notes, followUpAt: followUpAt || null, followUpNote: followUpNote || "", followUpAction: followUpAt ? followUpAction || "remind" : "remind", followUpTemplateId: followUpAt && followUpAction === "message" ? followUpTemplateId || null : null, customFields };
      if (_id) body.optedOut = optedOut;
      await api(_id ? `/contacts/${_id}` : "/contacts", { method: _id ? "PATCH" : "POST", body });
      toast.success("Contact saved");
      setEditing(null);
      load();
      loadLists();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy("");
    }
  };

  const changeStatus = async (contact, leadStatus) => {
    setData((d) => ({ ...d, items: d.items.map((c) => (c._id === contact._id ? { ...c, leadStatus } : c)) }));
    try {
      await api(`/contacts/${contact._id}`, { method: "PATCH", body: { leadStatus } });
      api("/contacts/status-counts", { query: (({ leadStatus: _l, page: _p, ...r }) => r)(query) }).then(setCounts).catch(() => {});
    } catch (err) {
      toast.error(err);
      load();
    }
  };

  const bulkStatus = async (leadStatus) => {
    if (!leadStatus) return;
    setBusy("status");
    try {
      const r = await api("/contacts/bulk-status", { method: "POST", body: { ...target(), leadStatus } });
      toast.success(`Status changed for ${r.updated} contact(s)`);
      clearSelection();
      load();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy("");
    }
  };

  const applyBulkTag = async () => {
    try {
      const r = await api("/contacts/bulk-tag", { method: "POST", body: { ...target(), tags: bulkTags, action: bulkTag } });
      toast.success(`Tags updated for ${r.updated} contact(s)`);
      setBulkTag(null);
      setBulkTags([]);
      clearSelection();
      load();
      loadLists();
    } catch (err) {
      toast.error(err);
    }
  };

  const sendCampaign = async () => {
    setBusy("campaign");
    try {
      const ids = allMatching ? (await api("/contacts/ids", { method: "POST", body: { filter: { ...filterOnly, tz: query.tz } } })).ids : selected;
      if (!ids.length) throw new Error("No contacts to message (opted-out contacts are skipped)");
      sessionStorage.setItem(CAMPAIGN_PREFILL_KEY, JSON.stringify({ audience: { type: "contacts", contactIds: ids }, label: `${ids.length} contacts picked on the Contacts page` }));
      router.push("/app/campaigns/new");
    } catch (err) {
      toast.error(err);
      setBusy("");
    }
  };

  const remove = async () => {
    try {
      if (deleting === "bulk") {
        const r = await api("/contacts/bulk-delete", { method: "POST", body: target() });
        toast.success(`Deleted ${r.deleted} contact(s)`);
      } else {
        await api(`/contacts/${deleting._id}`, { method: "DELETE" });
        toast.success("Deleted");
      }
      setDeleting(null);
      clearSelection();
      load();
    } catch (err) {
      toast.error(err);
    }
  };

  const exportLeads = async (format) => {
    setBusy(`export-${format}`);
    try {
      await downloadFile("/contacts/export", { ...filterOnly, tz: query.tz, format }, `leads.${format}`);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy("");
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

  // ---------- table ----------
  const allOnPage = data?.items.map((c) => c._id) || [];
  const pageSelected = allOnPage.length > 0 && allOnPage.every((id) => selected.includes(id));

  const columns = [
    {
      key: "select",
      label: <input type="checkbox" checked={pageSelected || allMatching} onChange={() => { setAllMatching(false); setSelected(pageSelected ? [] : allOnPage); }} aria-label="Select all on this page" />,
      className: "w-8",
      render: (c) => (
        <input
          type="checkbox"
          checked={allMatching || selected.includes(c._id)}
          onChange={() => {
            setAllMatching(false);
            setSelected((s) => (s.includes(c._id) ? s.filter((x) => x !== c._id) : [...s, c._id]));
          }}
          aria-label={`Select ${c.name}`}
        />
      ),
    },
    {
      key: "name",
      label: "Contact",
      render: (c) => (
        <div className="min-w-40">
          <p className="font-medium text-slate-800">
            {c.name || "Unknown"} {c.optedOut && <Badge tone="red" className="ml-1">opted out</Badge>}
          </p>
          <p className="text-xs text-slate-500">{fmtPhone(c.phone)}{c.email ? ` · ${c.email}` : ""}</p>
          {c.adSource?.sourceId && <p className="mt-0.5 truncate text-[11px] text-violet-700" title={c.adSource.headline}>📣 {c.adSource.headline || `Ad ${c.adSource.sourceId}`}</p>}
        </div>
      ),
    },
    { key: "status", label: "Lead status", render: (c) => <LeadStatusSelect value={c.leadStatus} onChange={(v) => changeStatus(c, v)} /> },
    { key: "tags", label: "Tags", render: (c) => <div className="flex max-w-56 flex-wrap gap-1">{c.tags.map((t) => <Badge key={t}>{t}</Badge>)}</div> },
    { key: "followup", label: "Follow-up", render: (c) => <FollowUpChip at={c.followUpAt} /> },
    { key: "source", label: "Source", render: (c) => <span className="text-slate-500 capitalize">{c.source === "ad" ? "Ad" : c.source}</span> },
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
        description="Everyone who chats with your business is saved here automatically. Sort them by status, tag, ad or follow-up."
        actions={
          <>
            {isAdmin && (
              <>
                <Button variant="secondary" onClick={() => exportLeads("xlsx")} loading={busy === "export-xlsx"} title="Download the leads you see (with filters) as Excel">
                  <Download className="h-4 w-4" /> Excel
                </Button>
                <Button variant="secondary" onClick={() => exportLeads("csv")} loading={busy === "export-csv"} title="Download as CSV">CSV</Button>
                <Button variant="secondary" onClick={() => setImportOpen(true)}><Upload className="h-4 w-4" /> Import sheet</Button>
              </>
            )}
            <Button onClick={() => setEditing({ ...empty })}><Plus className="h-4 w-4" /> Add contact</Button>
          </>
        }
      />

      {/* Status tabs with counts */}
      <div className="scroll-thin mb-3 flex gap-1 overflow-x-auto">
        <StatusTab active={!filters.leadStatus} onClick={() => setFilter("leadStatus", "")} label="All" count={counts?.total} />
        {statuses.map((s) => (
          <StatusTab key={s.key} active={filters.leadStatus === s.key} onClick={() => setFilter("leadStatus", s.key)} label={s.label} count={counts?.counts?.[s.key] || 0} color={s.color} />
        ))}
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
          <div className="relative w-full sm:w-60">
            <Search className="absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
            <Input className="pl-9" placeholder="Search name, phone, email" value={filters.search} onChange={(e) => setFilter("search", e.target.value)} />
          </div>
          <Select className="sm:w-auto" value={filters.tag} onChange={(e) => setFilter("tag", e.target.value)} aria-label="Tag">
            <option value="">All tags</option>
            {tags.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
          <Select className="sm:w-auto" value={filters.source} onChange={(e) => setFilter("source", e.target.value)} aria-label="Source">
            {SOURCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
          {filters.source === "ad" && ads.length > 0 && (
            <Select className="sm:w-auto sm:max-w-56" value={filters.adId} onChange={(e) => setFilter("adId", e.target.value)} aria-label="Ad">
              <option value="">All ads</option>
              {ads.map((a) => <option key={a.adId} value={a.adId}>{a.name || a.headline || a.adId} ({a.leads})</option>)}
            </Select>
          )}
          <Select className="sm:w-auto" value={filters.followUp} onChange={(e) => setFilter("followUp", e.target.value)} aria-label="Follow-up">
            {FOLLOW_UPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
          <Select className="sm:w-auto" value={filters.joined} onChange={(e) => setFilter("joined", e.target.value)} aria-label="First contact">
            {JOINED.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
          <Select className="sm:w-auto" value={filters.lastInbound} onChange={(e) => setFilter("lastInbound", e.target.value)} aria-label="Last message from customer">
            {LAST_IN.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
          {hasFilters && (
            <Button size="sm" variant="ghost" onClick={() => { setFilters(NO_FILTERS); clearSelection(); }}><X className="h-3.5 w-3.5" /> Clear filters</Button>
          )}
        </div>

        {selectionCount > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-brand-50/60 px-3 py-2 text-sm">
            <span className="font-medium text-slate-700">{selectionCount} selected</span>
            {!allMatching && pageSelected && data.total > allOnPage.length && (
              <button className="text-brand-700 underline" onClick={() => setAllMatching(true)}>
                Select all {data.total} {hasFilters ? "matching contacts" : "contacts"}
              </button>
            )}
            {allMatching && <button className="text-slate-500 underline" onClick={clearSelection}>Clear selection</button>}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <LeadStatusSelect value="" includeAll allLabel="Change status to…" onChange={bulkStatus} disabled={busy === "status"} className="h-8" />
              <Button size="sm" variant="secondary" onClick={() => setBulkTag("add")}><Tag className="h-3.5 w-3.5" /> Add tag</Button>
              <Button size="sm" variant="secondary" onClick={() => setBulkTag("remove")}>Remove tag</Button>
              {(isAdmin || session.tenant?.settings?.agentsCanBroadcast) && (
                <Button size="sm" onClick={sendCampaign} loading={busy === "campaign"}><Megaphone className="h-3.5 w-3.5" /> Send bulk message</Button>
              )}
              {isAdmin && <Button size="sm" variant="secondary" onClick={() => setDripOpen(true)}><Workflow className="h-3.5 w-3.5" /> Add to drip</Button>}
              {isAdmin && <Button size="sm" variant="danger" onClick={() => setDeleting("bulk")}>Delete</Button>}
            </div>
          </div>
        )}

        {!data ? <PageLoader /> : (
          <>
            <Table
              columns={columns}
              rows={data.items}
              empty={
                <EmptyState
                  icon={hasFilters ? Filter : ContactIcon}
                  title={hasFilters ? "No contacts match these filters" : "No contacts yet"}
                  description={hasFilters ? "Try another status or clear the filters." : "Add contacts manually, import a sheet, or they will appear when customers message you."}
                />
              }
            />
            <Pagination page={data.page} limit={data.limit} total={data.total} onChange={(p) => setFilter("page", p)} />
          </>
        )}
      </Card>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?._id ? "Edit contact" : "Add contact"}
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" form="contact-form" loading={busy === "save"}>Save</Button></>}
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
                <LeadStatusSelect value={editing.leadStatus} onChange={(v) => setEditing({ ...editing, leadStatus: v })} className="h-9 w-full text-sm" />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-[14rem_1fr]">
              <Field label="Follow-up on" hint="Shows on the dashboard when it is due">
                <Input type="datetime-local" value={toLocalInput(editing.followUpAt)} onChange={(e) => setEditing({ ...editing, followUpAt: e.target.value ? new Date(e.target.value).toISOString() : null })} />
              </Field>
              <Field label="Follow-up note">
                <Input value={editing.followUpNote || ""} maxLength={500} placeholder="e.g. Call about Python batch fees" onChange={(e) => setEditing({ ...editing, followUpNote: e.target.value })} />
              </Field>
            </div>
            {editing.followUpAt && <FollowUpMessage value={editing} onChange={(patch) => setEditing({ ...editing, ...patch })} />}
            <Field label="Tags"><TagInput value={editing.tags} onChange={(t) => setEditing({ ...editing, tags: t })} suggestions={tags} /></Field>
            <Field label="Notes"><Textarea rows={3} value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></Field>
            <CustomFieldInputs value={editing.customFields || {}} onChange={(cf) => setEditing({ ...editing, customFields: cf })} />
            {editing._id && <ReferralBox contactId={editing._id} />}
            {editing.adSource?.sourceId && (
              <div className="rounded-md bg-violet-50 p-3 text-sm text-violet-900">
                <p className="text-xs font-medium text-violet-700">📣 Came from a Facebook / Instagram ad · {fmtDateTime(editing.adSource.at)}</p>
                <p className="font-medium">{editing.adSource.headline || "Ad"}</p>
                <p className="text-xs">Ad ID: {editing.adSource.sourceId}{editing.adSource.sourceUrl && <> · <a href={editing.adSource.sourceUrl} target="_blank" rel="noreferrer" className="underline">open</a></>}</p>
              </div>
            )}
            {editing._id && (
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={!!editing.optedOut} onChange={(e) => setEditing({ ...editing, optedOut: e.target.checked })} />
                Opted out of bulk messages
              </label>
            )}
          </form>
        )}
      </Modal>

      {dripOpen && (
        <AddToDripModal
          count={selectionCount}
          getIds={async () => (allMatching ? (await api("/contacts/ids", { method: "POST", body: { filter: { ...filterOnly, tz: query.tz } } })).ids : selected)}
          onClose={() => setDripOpen(false)}
          onDone={clearSelection}
        />
      )}
      <ImportWizard
        open={importOpen}
        onClose={() => setImportOpen(false)}
        tagSuggestions={tags}
        onImported={(_r, opts) => {
          refresh(); // extra sheet columns became contact fields
          loadLists();
          if (opts?.showTag) setFilters({ ...NO_FILTERS, tag: opts.showTag });
          else load();
        }}
      />

      <Modal open={!!bulkTag} onClose={() => setBulkTag(null)} title={bulkTag === "add" ? "Add tags" : "Remove tags"} size="sm"
        footer={<><Button variant="secondary" onClick={() => setBulkTag(null)}>Cancel</Button><Button onClick={applyBulkTag} disabled={!bulkTags.length}>Apply to {selectionCount}</Button></>}>
        <TagInput value={bulkTags} onChange={setBulkTags} suggestions={tags} />
      </Modal>

      <ConfirmModal open={!!deleting} onClose={() => setDeleting(null)} onConfirm={remove} danger title="Delete contact?" confirmText="Delete"
        message={deleting === "bulk" ? `Delete ${selectionCount} contacts and their chat history? This can not be undone.` : `Delete ${deleting?.name || "this contact"} and their chat history?`} />
    </PageContainer>
  );
}

const tabDots = { gray: "bg-slate-400", blue: "bg-sky-500", green: "bg-brand-500", yellow: "bg-amber-400", red: "bg-red-500", purple: "bg-violet-500" };

/** Put the selected contacts into a drip (admin) */
function AddToDripModal({ count, getIds, onClose, onDone }) {
  const toast = useToast();
  const [drips, setDrips] = useState(null);
  const [dripId, setDripId] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api("/drips").then((d) => setDrips(d.filter((x) => x.trigger.type !== "date"))).catch(toast.error);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const add = async () => {
    setBusy(true);
    try {
      const ids = await getIds();
      const r = await api(`/drips/${dripId}/enroll`, { method: "POST", body: { contactIds: ids } });
      const d = drips.find((x) => x._id === dripId);
      toast.success(`${r.added} contact(s) added to "${d?.name}"${r.alreadyIn ? ` (${r.alreadyIn} already in it or opted out)` : ""}${d?.status !== "active" ? ". Turn the drip on to start sending." : ""}`);
      onDone();
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={`Add ${count} contact(s) to a drip`} size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={add} loading={busy} disabled={!dripId}>Add</Button></>}>
      {!drips ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : !drips.length ? (
        <p className="text-sm text-slate-600">No drips yet. Create one in <b>Drips &amp; automations</b>.</p>
      ) : (
        <Field label="Drip" hint="Opted-out contacts and people already in it are skipped.">
          <Select value={dripId} onChange={(e) => setDripId(e.target.value)}>
            <option value="">Choose…</option>
            {drips.map((d) => <option key={d._id} value={d._id}>{d.name}{d.status !== "active" ? ` (${d.status})` : ""}</option>)}
          </Select>
        </Field>
      )}
    </Modal>
  );
}

function StatusTab({ active, onClick, label, count, color }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
        active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
      )}
    >
      {color && <span className={cx("h-2 w-2 rounded-full", tabDots[color])} />}
      {label}
      <span className={cx("rounded-full px-1.5 text-xs tabular-nums", active ? "bg-white/20" : "bg-slate-100 text-slate-500")}>{count ?? "…"}</span>
    </button>
  );
}
