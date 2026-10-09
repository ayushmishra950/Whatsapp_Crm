"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Plus, Search, Upload, Download, Pencil, Trash2, MessageCircle, Contact as ContactIcon, Tag, Megaphone, X, Filter, Workflow, Phone, Bookmark,
} from "lucide-react";
import { CallLogModal, CourseSelect, LANGUAGES, LeadTasks, useCourses } from "@/components/leads";
import { api, downloadFile } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { LEAD_SOURCES, MANUAL_SOURCES } from "@/lib/contact-fields";
import { useIsCoaching } from "@/lib/business";
import { FeesPanel } from "@/components/fees";
import { useLeadStatuses } from "@/lib/lead-statuses";
import { fmtDate, fmtDateTime, fmtPhone } from "@/lib/format";
import { useToast } from "@/components/toast";
import { ChannelBadge } from "@/components/channel";
import { QuickAddButton } from "@/components/quick-add";
import { PageContainer } from "@/components/shell";
import { CustomFieldInputs, FollowUpChip, FollowUpMessage, LeadStatusSelect, ReferralBox, TagInput } from "@/components/shared";
import { ImportWizard, CAMPAIGN_PREFILL_KEY } from "@/components/contacts/import-wizard";
import {
  Badge, Button, Card, ConfirmModal, EmptyState, Field, Input, Modal, PageHeader, PageLoader, Pagination, Select, Table, Textarea, cx,
} from "@/components/ui";

const empty = { source: "manual", name: "", phone: "", email: "", tags: [], leadStatus: "new", notes: "", followUpAt: null, followUpNote: "", followUpAction: "remind", followUpTemplateId: null, customFields: {}, course: "", language: "" };
const NO_FILTERS = {
  search: "", tag: "", stage: "", leadStatus: "", source: "", channel: "", adId: "", course: "", nextAction: "", followUp: "", joined: "", lastInbound: "",
  assignedTo: "", createdFrom: "", createdTo: "", noReply: "", calls: "", language: "", optedOut: "", page: 1,
};
const NO_REPLY = [["", "Customer replied: any"], ["1d", "No reply for 1+ day"], ["3d", "No reply for 3+ days"], ["7d", "No reply for 7+ days"], ["14d", "No reply for 14+ days"], ["30d", "No reply for 30+ days"]];
const CALLS = [["", "Calls: any"], ["none", "Never called"], ["1", "Called at least once"], ["3", "Called 3+ times"]];
// Filters shown in the "More filters" panel (the badge counts how many are set)
const MORE_KEYS = ["tag", "source", "channel", "adId", "followUp", "joined", "createdFrom", "createdTo", "lastInbound", "noReply", "calls", "language", "optedOut"];
const NEXT_ACTIONS = [["", "Any next action"], ["none", "⚠️ No next action"], ["overdue", "Next action overdue"], ["set", "Has a next action"]];
const JOINED = [["", "Joined: any time"], ["7d", "Joined: last 7 days"], ["14d", "Joined: last 14 days"], ["30d", "Joined: last 1 month"], ["90d", "Joined: last 3 months"], ["180d", "Joined: last 6 months"], ["365d", "Joined: last 12 months"]];
const LAST_IN = [["", "Last message: any"], ["7d", "Messaged: last 7 days"], ["14d", "Messaged: last 14 days"], ["30d", "Messaged: last 1 month"], ["90d", "Messaged: last 3 months"], ["180d", "Messaged: last 6 months"], ["365d", "Messaged: last 12 months"]];
const SOURCES = [["", "All sources"], ...LEAD_SOURCES.map(([v, l]) => [v, v === "ad" ? `📣 ${l}` : l])];
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
  const { list: statuses, stages } = useLeadStatuses();
  const coaching = useIsCoaching();
  const courses = useCourses(coaching);
  const [calling, setCalling] = useState(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [team, setTeam] = useState([]);
  const [views, setViews] = useState([]);
  const [viewsOpen, setViewsOpen] = useState(false);
  const [saveView, setSaveView] = useState(null); // { name, shared }
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

  // A stage tab = all statuses of that stage (the server only knows statuses)
  const toApi = ({ stage, ...f }) => (stage && !f.leadStatus ? { ...f, leadStatus: stages.find((s) => s.key === stage)?.keys.join(",") || "" } : f);
  const { page, ...filterOnly } = toApi(filters);
  const query = { ...toApi(filters), tz: Intl.DateTimeFormat().resolvedOptions().timeZone };

  const filtersKey = JSON.stringify(toApi(filters));
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
  const loadViews = () => api("/views", { query: { page: "contacts" } }).then(setViews).catch(() => {});
  useEffect(() => {
    api("/team").then((t) => setTeam(t.filter((m) => m.isActive !== false))).catch(() => {});
    loadViews();
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);
  useEffect(() => { loadLists(); }, []);
  // ?open=<contactId> (e.g. from an alert) opens that lead
  useEffect(() => {
    const id = new URLSearchParams(urlQuery).get("open");
    if (id) api(`/contacts/${id}`).then((r) => setEditing({ ...empty, ...r.contact, languageAtOpen: r.contact.language || "", sourceAtOpen: r.contact.source })).catch(toast.error);
  }, [urlQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  const clearSelection = () => {
    setSelected([]);
    setAllMatching(false);
  };
  const setFilter = (k, v) => {
    setFilters((f) => ({ ...f, [k]: v, ...(k === "source" && v !== "ad" && { adId: "" }), ...(k === "stage" && { leadStatus: "" }), page: k === "page" ? v : 1 }));
    if (k !== "page") clearSelection();
  };
  const hasFilters = Object.entries(filterOnly).some(([, v]) => v);
  const moreCount = MORE_KEYS.filter((k) => filters[k] && !(k === "adId" && !filters.source)).length;
  // The filters in use, as removable chips
  const memberName = (id) => (id === "me" ? "Me" : id === "none" ? "Not assigned" : team.find((m) => m._id === id)?.name || "Counsellor");
  const optionLabel = (list, v) => list.find(([k]) => k === v)?.[1] || v;
  const chips = [
    filters.assignedTo && ["assignedTo", `Counsellor: ${memberName(filters.assignedTo)}`],
    filters.course && ["course", `Course: ${filters.course === "none" ? "not set" : courses.label(filters.course)}`],
    filters.nextAction && ["nextAction", optionLabel(NEXT_ACTIONS, filters.nextAction)],
    filters.tag && ["tag", `Tag: ${filters.tag}`],
    filters.source && ["source", `Source: ${optionLabel(SOURCES, filters.source)}`],
    filters.channel && ["channel", filters.channel === "instagram" ? "Wrote on Instagram" : "Has a WhatsApp number"],
    filters.adId && ["adId", `Ad: ${ads.find((a) => a.adId === filters.adId)?.name || filters.adId}`],
    filters.followUp && ["followUp", optionLabel(FOLLOW_UPS, filters.followUp)],
    filters.joined && filters.joined !== "custom" && ["joined", optionLabel(JOINED, filters.joined)],
    (filters.createdFrom || filters.createdTo) && ["createdFrom", `Added ${filters.createdFrom ? `from ${fmtDate(filters.createdFrom)}` : ""} ${filters.createdTo ? `to ${fmtDate(filters.createdTo)}` : ""}`],
    filters.lastInbound && ["lastInbound", optionLabel(LAST_IN, filters.lastInbound)],
    filters.noReply && ["noReply", optionLabel(NO_REPLY, filters.noReply)],
    filters.calls && ["calls", optionLabel(CALLS, filters.calls)],
    filters.language && ["language", `Language: ${LANGUAGES.find((l) => l.value === filters.language)?.label || "not known"}`],
    filters.optedOut && ["optedOut", "Opted out only"],
  ].filter(Boolean);
  const removeChip = (k) => {
    setFilters((f) => ({ ...f, [k]: "", ...(k === "createdFrom" && { createdTo: "", joined: "" }), ...(k === "source" && { adId: "" }), page: 1 }));
    clearSelection();
  };
  const applyView = (v) => {
    setFilters({ ...NO_FILTERS, ...Object.fromEntries(Object.entries(v.query || {}).filter(([k]) => k in NO_FILTERS && k !== "page")) });
    setViewsOpen(false);
    clearSelection();
  };
  const storeView = async () => {
    try {
      const query = Object.fromEntries(Object.entries(filters).filter(([k, v]) => k !== "page" && v).map(([k, v]) => [k, String(v)]));
      await api("/views", { method: "POST", body: { page: "contacts", name: saveView.name, shared: !!saveView.shared, query } });
      toast.success(`View "${saveView.name}" saved`);
      setSaveView(null);
      loadViews();
    } catch (err) {
      toast.error(err);
    }
  };
  const deleteView = async (v) => {
    try {
      await api(`/views/${v._id}`, { method: "DELETE" });
      loadViews();
    } catch (err) {
      toast.error(err);
    }
  };

  const selectionCount = allMatching ? data?.total || 0 : selected.length;
  const target = () => (allMatching ? { filter: { ...filterOnly, tz: query.tz } } : { ids: selected });

  // ---------- actions ----------
  const save = async (e) => {
    e.preventDefault();
    setBusy("save");
    const { _id, name, phone, email, tags: t, leadStatus, notes, optedOut, followUpAt, followUpNote, followUpAction, followUpTemplateId, course, language, source } = editing;
    // Empty custom values are dropped (= value deleted)
    const customFields = Object.fromEntries(Object.entries(editing.customFields || {}).map(([k, v]) => [k, String(v ?? "").trim()]).filter(([, v]) => v));
    try {
      // An Instagram lead may have no number yet: an empty box is not sent
      const body = { name, ...(String(phone || "").trim() && { phone: String(phone).trim() }), email: email || "", tags: t, leadStatus, notes, followUpAt: followUpAt || null, followUpNote: followUpNote || "", followUpAction: followUpAt ? followUpAction || "remind" : "remind", followUpTemplateId: followUpAt && followUpAction === "message" ? followUpTemplateId || null : null, customFields, course: course || "" };
      // Only a language the user changed is sent (it then stops auto-detection)
      if ((language || "") !== (editing.languageAtOpen || "")) body.language = language || "";
      if (MANUAL_SOURCES.some(([v]) => v === source) && (!_id || source !== editing.sourceAtOpen)) body.source = source;
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

  const [statusAsk, setStatusAsk] = useState(""); // bulk status waiting for "Are you sure?"
  const bulkStatus = async (leadStatus) => {
    if (!leadStatus) return;
    setStatusAsk("");
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
          <Link href={`/app/contacts/${c._id}`} className="group block" title="Open the lead page: details, history and chat">
            <p className="font-medium text-slate-800 group-hover:text-brand-700 group-hover:underline">
              {c.name || (c.instagram?.username ? `@${c.instagram.username}` : "Unknown")} {c.instagram?.igsid && <ChannelBadge channel="instagram" className="ml-1" />} {c.optedOut && <Badge tone="red" className="ml-1">opted out</Badge>}
            </p>
            <p className="text-xs text-slate-500 group-hover:text-brand-700">{[fmtPhone(c.phone), c.name && c.instagram?.username && `@${c.instagram.username}`, c.email].filter(Boolean).join(" · ")}</p>
          </Link>
          {c.adSource?.sourceId && <p className="mt-0.5 truncate text-[11px] text-violet-700" title={c.adSource.headline}>📣 {c.adSource.headline || `Ad ${c.adSource.sourceId}`}</p>}
        </div>
      ),
    },
    { key: "status", label: "Lead status", render: (c) => <LeadStatusSelect value={c.leadStatus} onChange={(v) => changeStatus(c, v)} /> },
    { key: "owner", label: "Counsellor", render: (c) => <span className="text-sm text-slate-600">{c.assignedTo?.name || <span className="text-slate-300">—</span>}</span> },
    coaching && { key: "course", label: "Course", render: (c) => (c.course ? <span title={courses.label(c.course)}><Badge tone="purple">{c.course}</Badge></span> : <span className="text-slate-300">—</span>) },
    { key: "tags", label: "Tags", render: (c) => <div className="flex max-w-56 flex-wrap gap-1">{c.tags.map((t) => <Badge key={t}>{t}</Badge>)}</div> },
    {
      key: "followup",
      label: "Next action",
      render: (c) => (c.nextActionAt || c.followUpAt ? <FollowUpChip at={c.nextActionAt || c.followUpAt} /> : <span className="text-xs text-amber-600" title="No task or follow-up: this lead can get lost">none</span>),
    },
    { key: "source", label: "Source", render: (c) => <span className="text-slate-500">{LEAD_SOURCES.find(([v]) => v === c.source)?.[1] || c.source}</span> },
    { key: "created", label: "Added", className: "whitespace-nowrap", render: (c) => fmtDate(c.createdAt) },
    {
      key: "actions",
      label: "",
      className: "text-right whitespace-nowrap",
      render: (c) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon" onClick={() => chat(c)} title="Open chat" aria-label="Open chat"><MessageCircle className="h-4 w-4 text-brand-600" /></Button>
          <Button variant="ghost" size="icon" onClick={() => setCalling(c)} title={`Log call${c.callAttempts ? ` (${c.callAttempts} so far)` : ""}`} aria-label="Log call"><Phone className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" onClick={() => setEditing({ ...empty, ...c, languageAtOpen: c.language || "", sourceAtOpen: c.source })} aria-label="Edit"><Pencil className="h-4 w-4" /></Button>
          {isAdmin && <Button variant="ghost" size="icon" onClick={() => setDeleting(c)} aria-label="Delete"><Trash2 className="h-4 w-4 text-red-500" /></Button>}
        </div>
      ),
    },
  ].filter(Boolean);

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
            <Button variant="secondary" onClick={() => setEditing({ ...empty })}><Plus className="h-4 w-4" /> Add contact</Button>
            <QuickAddButton label="Walk-in / quick add" onAdded={() => load()} />
          </>
        }
      />

      {/* Stage tabs (when statuses have stages), then status tabs with counts */}
      {stages.length > 0 && (
        <div className="scroll-thin mb-2 flex gap-1 overflow-x-auto">
          <StatusTab active={!filters.stage} onClick={() => setFilter("stage", "")} label="All stages" count={counts?.total} />
          {stages.map((st) => (
            <StatusTab key={st.key} active={filters.stage === st.key} onClick={() => setFilter("stage", st.key)} label={st.label}
              count={counts ? st.keys.reduce((n, k) => n + (counts.counts?.[k] || 0), 0) : undefined} />
          ))}
        </div>
      )}
      <div className="scroll-thin mb-3 flex gap-1 overflow-x-auto">
        <StatusTab active={!filters.leadStatus} onClick={() => setFilter("leadStatus", "")} label={filters.stage ? "Whole stage" : "All"}
          count={filters.stage ? (stages.find((st) => st.key === filters.stage)?.keys || []).reduce((n, k) => n + (counts?.counts?.[k] || 0), 0) : counts?.total} />
        {statuses.filter((s) => !filters.stage || s.stage === filters.stage).map((s) => (
          <StatusTab key={s.key} active={filters.leadStatus === s.key} onClick={() => setFilter("leadStatus", s.key)} label={s.label} count={counts?.counts?.[s.key] || 0} color={s.color} />
        ))}
      </div>

      <Card>
        <div className="space-y-2 border-b border-slate-200 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-60">
              <Search className="absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
              <Input className="pl-9" placeholder="Search name, phone, email" value={filters.search} onChange={(e) => setFilter("search", e.target.value)} />
            </div>
            <Select className="sm:w-auto sm:max-w-48" value={filters.assignedTo} onChange={(e) => setFilter("assignedTo", e.target.value)} aria-label="Counsellor">
              <option value="">All counsellors</option>
              <option value="me">Assigned to me</option>
              <option value="none">Not assigned</option>
              {isAdmin && team.filter((m) => m._id !== session.user._id).map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}
            </Select>
            {coaching && courses.list.length > 0 && <CourseSelect className="sm:w-auto sm:max-w-52" includeAll value={filters.course} onChange={(v) => setFilter("course", v)} />}
            <Select className="sm:w-auto" value={filters.nextAction} onChange={(e) => setFilter("nextAction", e.target.value)} aria-label="Next action">
              {NEXT_ACTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
            <Button size="sm" variant={moreOpen || moreCount ? "secondary" : "ghost"} onClick={() => setMoreOpen((o) => !o)}>
              <Filter className="h-3.5 w-3.5" /> More filters{moreCount ? ` (${moreCount})` : ""}
            </Button>
            <div className="relative">
              <Button size="sm" variant="ghost" onClick={() => setViewsOpen((o) => !o)}><Bookmark className="h-3.5 w-3.5" /> Saved views{views.length ? ` (${views.length})` : ""}</Button>
              {viewsOpen && (
                <div className="absolute top-9 right-0 z-30 w-72 rounded-lg border border-slate-200 bg-white p-2 shadow-lg sm:right-auto sm:left-0">
                  {!views.length && <p className="px-2 py-3 text-xs text-slate-500">No saved views yet. Set some filters, then save them here (e.g. “My hot leads today”).</p>}
                  {views.map((v) => (
                    <div key={v._id} className="group flex items-center gap-1 rounded hover:bg-slate-50">
                      <button type="button" onClick={() => applyView(v)} className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-sm text-slate-700">
                        {v.name} {v.shared && <span className="text-[10px] text-violet-600">· team</span>}
                      </button>
                      {(v.mine || isAdmin) && (
                        <button type="button" onClick={() => deleteView(v)} className="rounded p-1 text-slate-300 hover:text-red-600" aria-label={`Delete view ${v.name}`}><X className="h-3.5 w-3.5" /></button>
                      )}
                    </div>
                  ))}
                  <div className="mt-1 border-t border-slate-100 pt-2">
                    <Button size="sm" variant="secondary" className="w-full justify-center" disabled={!hasFilters} title={hasFilters ? "" : "Set some filters first"} onClick={() => { setSaveView({ name: "", shared: false }); setViewsOpen(false); }}>
                      <Plus className="h-3.5 w-3.5" /> Save current filters
                    </Button>
                  </div>
                </div>
              )}
            </div>
            {hasFilters && (
              <Button size="sm" variant="ghost" onClick={() => { setFilters(NO_FILTERS); clearSelection(); }}><X className="h-3.5 w-3.5" /> Clear all</Button>
            )}
          </div>
          {moreOpen && (
            <div className="grid gap-2 rounded-md bg-slate-50 p-3 sm:grid-cols-2 lg:grid-cols-4">
              <Select value={filters.tag} onChange={(e) => setFilter("tag", e.target.value)} aria-label="Tag">
                <option value="">All tags</option>
                {tags.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
              <Select value={filters.channel} onChange={(e) => setFilter("channel", e.target.value)} aria-label="App">
                <option value="">WhatsApp + Instagram</option>
                <option value="whatsapp">Has a WhatsApp number</option>
                <option value="instagram">Wrote on Instagram</option>
              </Select>
              <Select value={filters.source} onChange={(e) => setFilter("source", e.target.value)} aria-label="Source">
                {SOURCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
              {filters.source === "ad" && ads.length > 0 && (
                <Select value={filters.adId} onChange={(e) => setFilter("adId", e.target.value)} aria-label="Ad">
                  <option value="">All ads</option>
                  {ads.map((a) => <option key={a.adId} value={a.adId}>{a.name || a.headline || a.adId} ({a.leads})</option>)}
                </Select>
              )}
              <Select value={filters.followUp} onChange={(e) => setFilter("followUp", e.target.value)} aria-label="Follow-up">
                {FOLLOW_UPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
              <Select value={filters.noReply} onChange={(e) => setFilter("noReply", e.target.value)} aria-label="No reply since">
                {NO_REPLY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
              <Select value={filters.calls} onChange={(e) => setFilter("calls", e.target.value)} aria-label="Calls">
                {CALLS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
              <Select value={filters.lastInbound} onChange={(e) => setFilter("lastInbound", e.target.value)} aria-label="Last message from customer">
                {LAST_IN.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
              <Select value={filters.createdFrom || filters.createdTo ? "custom" : filters.joined} onChange={(e) => setFilters((f) => ({ ...f, joined: e.target.value === "custom" ? "custom" : e.target.value, ...(e.target.value !== "custom" && { createdFrom: "", createdTo: "" }), page: 1 }))} aria-label="Added">
                {JOINED.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                <option value="custom">Joined: pick dates…</option>
              </Select>
              {(filters.joined === "custom" || filters.createdFrom || filters.createdTo) && (
                <div className="flex items-center gap-1 sm:col-span-2">
                  <Input type="date" value={filters.createdFrom} onChange={(e) => setFilter("createdFrom", e.target.value)} aria-label="Added from" />
                  <span className="text-xs text-slate-500">to</span>
                  <Input type="date" value={filters.createdTo} onChange={(e) => setFilter("createdTo", e.target.value)} aria-label="Added to" />
                </div>
              )}
              {coaching && (
                <Select value={filters.language} onChange={(e) => setFilter("language", e.target.value)} aria-label="Language">
                  <option value="">Language: any</option>
                  <option value="en">English</option>
                  <option value="hi">Hinglish</option>
                  <option value="none">Not known</option>
                </Select>
              )}
              <Select value={filters.optedOut} onChange={(e) => setFilter("optedOut", e.target.value)} aria-label="Opted out">
                <option value="">Opted out: include</option>
                <option value="true">Only opted out</option>
              </Select>
            </div>
          )}
          {chips.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {chips.map(([k, label]) => (
                <span key={k} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-0.5 text-xs text-brand-800">
                  {label}
                  <button type="button" onClick={() => removeChip(k)} className="text-brand-600 hover:text-brand-900" aria-label={`Remove filter ${label}`}><X className="h-3 w-3" /></button>
                </span>
              ))}
              <span className="text-xs text-slate-500">{data ? `${data.total} lead(s)` : ""}</span>
            </div>
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
              <LeadStatusSelect value="" includeAll allLabel="Change status to…" onChange={(v) => v && setStatusAsk(v)} disabled={busy === "status"} className="h-8" />
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
              <Field label="WhatsApp number" hint={editing.instagram?.igsid && !editing.phone ? `Instagram lead @${editing.instagram.username || ""}: add the number when they share it` : "With country code, e.g. 919876543210"}>
                <Input required={!editing.instagram?.igsid} value={editing.phone || ""} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Email"><Input type="email" value={editing.email || ""} onChange={(e) => setEditing({ ...editing, email: e.target.value })} /></Field>
              <Field label="Lead status">
                <LeadStatusSelect value={editing.leadStatus} onChange={(v) => setEditing({ ...editing, leadStatus: v })} className="h-9 w-full text-sm" />
              </Field>
            </div>
            {(!editing._id || MANUAL_SOURCES.some(([v]) => v === editing.sourceAtOpen)) && (
              <Field label="Lead source" hint="Where this lead came from (WhatsApp, ad and import are set automatically)">
                <Select value={editing.source || "manual"} onChange={(e) => setEditing({ ...editing, source: e.target.value })}>
                  {MANUAL_SOURCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
              </Field>
            )}
            {coaching && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Course"><CourseSelect className="w-full" value={editing.course} onChange={(v) => setEditing({ ...editing, course: v })} /></Field>
              <Field label="Language" hint={editing.languageLocked || !editing._id ? undefined : "Detected from their messages"}>
                <Select value={editing.language || ""} onChange={(e) => setEditing({ ...editing, language: e.target.value })}>
                  {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                </Select>
              </Field>
            </div>
            )}
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
            {editing._id && <LeadTasks contact={editing} onChange={load} />}
            {editing._id && coaching && <FeesPanel contactId={editing._id} />}
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

      <Modal open={!!saveView} onClose={() => setSaveView(null)} title="Save current filters" size="sm"
        footer={<><Button variant="secondary" onClick={() => setSaveView(null)}>Cancel</Button><Button onClick={storeView} disabled={!saveView?.name?.trim()}>Save view</Button></>}>
        {saveView && (
          <div className="space-y-3">
            <Field label="View name"><Input autoFocus maxLength={60} value={saveView.name} placeholder="e.g. My hot leads – no reply 3 days" onChange={(e) => setSaveView({ ...saveView, name: e.target.value })} /></Field>
            <p className="text-xs text-slate-500">{chips.map(([, l]) => l).join(" · ") || "No filters"}</p>
            {isAdmin && (
              <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={saveView.shared} onChange={(e) => setSaveView({ ...saveView, shared: e.target.checked })} /> Share with the whole team</label>
            )}
          </div>
        )}
      </Modal>
      <CallLogModal open={!!calling} onClose={() => setCalling(null)} contact={calling} onSaved={() => load()} />
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

      <ConfirmModal open={!!statusAsk} onClose={() => setStatusAsk("")} onConfirm={() => bulkStatus(statusAsk)} loading={busy === "status"} title="Change status?" confirmText="Change status"
        message={`${selectionCount} lead(s) will move to “${statuses.find((x) => x.key === statusAsk)?.label || statusAsk}”. Their old status drips stop and this status's drip starts (if one is on).`} />
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
