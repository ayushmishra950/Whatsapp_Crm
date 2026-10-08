"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Bot, CalendarClock, Hand, MessageCircle, MessagesSquare, StickyNote } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useIsCoaching } from "@/lib/business";
import { useSocketEvent } from "@/lib/socket";
import { fmtDate, fmtDateTime, fmtPhone, fmtRelative } from "@/lib/format";
import { LEAD_SOURCES } from "@/lib/contact-fields";
import { useToast } from "@/components/toast";
import { LeadStatusBadge } from "@/components/shared";
import { LeadActions, NextFollowUpModal } from "@/components/actions";
import { useCourses } from "@/components/leads";
import { money, prettyDay } from "@/components/fees";
import { MessageList } from "@/components/inbox/message-list";
import { Composer } from "@/components/inbox/composer";
import { ContactPanel } from "@/components/inbox/contact-panel";
import { Avatar, Badge, Button, Card, EmptyState, PageLoader, Spinner, Textarea, cx } from "@/components/ui";

// Kinds of history entries: icon, colour and filter group
const KINDS = {
  start: { icon: "🌱", tone: "bg-emerald-100", group: "all" },
  visit: { icon: "🚶", tone: "bg-emerald-100", group: "notes" },
  course: { icon: "📘", tone: "bg-indigo-100", group: "courses" },
  call: { icon: "📞", tone: "bg-sky-100", group: "calls" },
  note: { icon: "📝", tone: "bg-amber-100", group: "notes" },
  status: { icon: "🔀", tone: "bg-violet-100", group: "status" },
  fee: { icon: "💰", tone: "bg-green-100", group: "fees" },
  task: { icon: "⏰", tone: "bg-orange-100", group: "tasks" },
  done: { icon: "✅", tone: "bg-green-100", group: "tasks" },
  drip: { icon: "🔁", tone: "bg-slate-100", group: "auto" },
  template: { icon: "📨", tone: "bg-slate-100", group: "auto" },
  bot: { icon: "🤖", tone: "bg-violet-50", group: "auto" },
  botmsg: { icon: "🤖", tone: "bg-violet-50", group: "chat" },
  customer: { icon: "💬", tone: "bg-white border border-slate-200", group: "chat" },
  reply: { icon: "↩️", tone: "bg-white border border-slate-200", group: "chat" },
};
const FILTERS = [
  ["all", "Everything"],
  ["courses", "📘 Courses"],
  ["calls", "📞 Calls"],
  ["notes", "📝 Notes"],
  ["status", "🔀 Status"],
  ["tasks", "⏰ Tasks"],
  ["fees", "💰 Fees"],
  ["auto", "🔁 Drips & templates"],
  ["chat", "💬 Messages"],
];
const CALL_OUTCOME = { connected: "Connected", no_answer: "No answer", busy: "Busy", switched_off: "Switched off", wrong_number: "Wrong number", call_back: "Asked to call back" };
const daysAgo = (d) => {
  const n = Math.floor((Date.now() - new Date(d).getTime()) / 864e5);
  return n <= 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`;
};

/**
 * One page per lead: who they are, what they wanted, what happened (calls, notes, status, tasks, fees,
 * drips) and the WhatsApp chat side by side — so the next conversation starts where the last one ended.
 */
export default function LeadPage() {
  const { id } = useParams();
  const router = useRouter();
  const toast = useToast();
  const { session } = useAuth();
  const me = session.user;
  const isAdmin = me.role === "admin";
  const coaching = useIsCoaching();
  const courses = useCourses(coaching);
  const [contact, setContact] = useState(null);
  const [conversation, setConversation] = useState(null);
  const [history, setHistory] = useState(null);
  const [withChat, setWithChat] = useState(false);
  const [filter, setFilter] = useState("all");
  const [team, setTeam] = useState([]);
  const [tags, setTags] = useState([]);
  const [tab, setTab] = useState("history"); // small screens: history | chat | details
  const [next, setNext] = useState(false);
  const [error, setError] = useState("");

  const loadContact = useCallback(
    () =>
      api(`/contacts/${id}`)
        .then((r) => {
          setContact(r.contact);
          if (r.conversation?._id) api(`/conversations/${r.conversation._id}`).then((c) => setConversation(c.conversation)).catch(() => setConversation({ _id: r.conversation._id, locked: true }));
        })
        .catch((err) => setError(err.message)),
    [id]
  );
  const loadHistory = useCallback(() => api(`/contacts/${id}/history`, { query: { chat: withChat ? "true" : "" } }).then(setHistory).catch(toast.error), [id, withChat]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadContact(); }, [loadContact]);
  useEffect(() => { loadHistory(); }, [loadHistory]);
  useEffect(() => {
    api("/team").then(setTeam).catch(() => {});
    api("/contacts/tags").then(setTags).catch(() => {});
  }, []);
  // Live: new messages / tasks for this lead refresh the history
  const refreshSoon = useRef(null);
  const refresh = () => {
    clearTimeout(refreshSoon.current);
    refreshSoon.current = setTimeout(() => loadHistory(), 800);
  };
  useSocketEvent("task:update", refresh);
  useSocketEvent("message:new", ({ conversation: c }) => {
    if (String(c.contactId?._id || c.contactId) !== id) return;
    setConversation((cur) => (cur && !cur.locked ? c : cur));
    refresh();
  });

  const updateContact = async (patch) => {
    try {
      const updated = await api(`/contacts/${id}`, { method: "PATCH", body: patch });
      setContact(updated);
      if (patch.tags) api("/contacts/tags").then(setTags).catch(() => {});
      if (patch.leadStatus || patch.followUpAt !== undefined) loadHistory();
    } catch (err) {
      toast.error(err);
    }
  };
  const updateConversation = async (patch) => {
    try {
      setConversation(await api(`/conversations/${conversation._id}`, { method: "PATCH", body: patch }));
      loadContact();
    } catch (err) {
      toast.error(err);
    }
  };
  const [botBusy, setBotBusy] = useState(false);
  const botAction = async (action) => {
    setBotBusy(true);
    try {
      setConversation(await api(`/conversations/${conversation._id}/bot`, { method: "POST", body: { action } }));
      toast.success(action === "stop" ? "You took over this chat." : "Chat handed to the bot.");
    } catch (err) {
      toast.error(err);
    } finally {
      setBotBusy(false);
    }
  };
  const startChat = async () => {
    try {
      setConversation(await api("/conversations/start", { method: "POST", body: { contactId: id } }));
      setTab("chat");
    } catch (err) {
      toast.error(err);
    }
  };

  if (error) return <div className="p-6"><EmptyState icon={MessagesSquare} title="Lead not found" description={error} action={<Link href="/app/contacts"><Button variant="secondary">Back to contacts</Button></Link>} /></div>;
  if (!contact) return <PageLoader />;

  const f = contact.fees || {};
  const payable = (f.total || 0) - (f.discount || 0);
  const s = history?.stats || {};
  const converted = ["converted"].includes(contact.leadStatus) || f.paid > 0;
  const joinDate = contact.customFields?.joining_date || (converted ? contact.statusUpdatedAt : null);
  const sourceLabel = LEAD_SOURCES.find(([v]) => v === contact.source)?.[1] || contact.source;
  const openTasks = history?.openTasks || [];
  const otherCourses = (contact.courseInterest || []).filter((c) => c.code !== contact.course);

  const facts = [
    { label: "First enquiry", value: fmtDate(contact.createdAt), sub: `${daysAgo(contact.createdAt)} · ${sourceLabel}` },
    coaching && {
      label: converted ? "Joined course" : "Interested in",
      value: contact.course ? courses.label(contact.course) : "—",
      sub: [converted ? (joinDate ? `Joined ${prettyDay(String(joinDate).slice(0, 10))}` : "Converted") : !contact.course ? "Course not known yet" : "", otherCourses.length ? `Also looked at: ${otherCourses.map((c) => c.name).join(", ")}` : ""].filter(Boolean).join(" · ") || contact.course,
    },
    coaching && payable > 0 && { label: "Fees", value: `${money(f.paid)} / ${money(payable)}`, sub: f.balance > 0 ? `Balance ${money(f.balance)}${f.nextDue ? ` · next ${money(f.nextAmount)} on ${prettyDay(f.nextDue)}` : ""}` : "Fully paid 🎉", tone: f.nextDue && f.nextDue < new Date().toISOString().slice(0, 10) ? "text-red-600" : "" },
    { label: "Calls", value: contact.callAttempts || 0, sub: contact.lastCallAt ? `Last ${fmtRelative(contact.lastCallAt)}: ${CALL_OUTCOME[contact.lastCallOutcome] || contact.lastCallOutcome || ""}` : "Never called", tone: !contact.callAttempts ? "text-amber-600" : "" },
    { label: "Customer last wrote", value: s.lastInboundAt ? fmtRelative(s.lastInboundAt) : "Never", sub: `${s.inbound || 0} messages in · ${s.outbound || 0} out` },
    { label: "Next action", value: contact.nextActionAt ? fmtDateTime(contact.nextActionAt) : "None set", sub: openTasks.length ? `${openTasks.length} open task(s)` : "Set a follow-up so the lead is not lost", tone: !contact.nextActionAt ? "text-amber-600" : new Date(contact.nextActionAt) < new Date() ? "text-red-600" : "" },
  ].filter(Boolean);

  const events = (history?.events || []).filter((e) => filter === "all" || KINDS[e.kind]?.group === filter);
  const tabs = [["history", "History"], ["chat", "Chat"], ["details", "Details"]];

  return (
    <div className="mx-auto w-full max-w-[1600px] p-3 sm:p-5">
      {/* Header */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <button onClick={() => (window.history.length > 1 ? router.back() : router.push("/app/contacts"))} className="rounded p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Back"><ArrowLeft className="h-5 w-5" /></button>
        <Avatar name={contact.name || contact.phone} className="h-11 w-11" />
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-2 text-lg font-semibold text-slate-900">
            {contact.name || fmtPhone(contact.phone)}
            <LeadStatusBadge status={contact.leadStatus} />
            {contact.course && coaching && <Badge tone="purple">{contact.course}</Badge>}
            {contact.optedOut && <Badge tone="red">opted out</Badge>}
          </h1>
          <p className="text-sm text-slate-500">
            <a href={`tel:+${contact.phone}`} className="hover:text-brand-700">{fmtPhone(contact.phone)}</a>
            {contact.email ? ` · ${contact.email}` : ""}
            {` · ${contact.assignedTo?.name ? `Counsellor: ${contact.assignedTo.name}` : "Not assigned"}`}
            {(contact.tags || []).length > 0 && <> · {contact.tags.slice(0, 4).map((t) => <Badge key={t} className="ml-1">{t}</Badge>)}</>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <LeadActions contact={contact} onChanged={(c) => { if (c?._id) setContact(c); loadHistory(); }} />
          <Button size="sm" variant="secondary" onClick={() => setNext(true)}><CalendarClock className="h-3.5 w-3.5" /> Next follow-up</Button>
        </div>
      </div>

      {/* At a glance */}
      <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        {facts.map((x) => (
          <div key={x.label} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
            <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">{x.label}</p>
            <p className={cx("truncate text-sm font-semibold text-slate-900", x.tone)} title={String(x.value)}>{x.value}</p>
            <p className="truncate text-xs text-slate-500" title={x.sub}>{x.sub}</p>
          </div>
        ))}
      </div>
      {(history?.activeDrips?.length > 0 || contact.notes) && (
        <div className="mb-3 flex flex-wrap gap-2 text-xs">
          {history.activeDrips.map((d) => <span key={d._id} className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">🔁 In drip: <b>{d.name}</b>{d.nextRunAt ? ` · next message ${fmtRelative(d.nextRunAt)}` : ""}</span>)}
          {contact.notes && <span className="max-w-full truncate rounded-full bg-amber-50 px-2.5 py-1 text-amber-900" title={contact.notes}>📌 {contact.notes}</span>}
        </div>
      )}

      {/* Small screens: tabs */}
      <div className="mb-2 flex gap-1 xl:hidden">
        {tabs.map(([v, l]) => (
          <button key={v} onClick={() => setTab(v)} className={cx("flex-1 rounded-md border px-3 py-1.5 text-sm font-medium", tab === v ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600")}>{l}</button>
        ))}
      </div>

      <div className="grid gap-3 xl:grid-cols-[300px_minmax(0,1fr)_minmax(0,440px)]">
        {/* Details (editable) */}
        <Card className={cx("scroll-thin overflow-y-auto xl:block xl:h-[calc(100dvh-230px)]", tab !== "details" && "hidden")}>
          <ContactPanel
            key={contact._id}
            contact={contact}
            conversation={conversation && !conversation.locked ? conversation : null}
            team={team.filter((t) => t.isActive !== false)}
            me={me}
            tags={tags}
            onUpdateContact={updateContact}
            onContactReplaced={(c) => { setContact(c); loadHistory(); }}
            onUpdateConversation={updateConversation}
            onBotAction={botAction}
            botBusy={botBusy}
          />
        </Card>

        {/* History */}
        <Card className={cx("flex flex-col overflow-hidden xl:flex xl:h-[calc(100dvh-230px)]", tab !== "history" && "hidden")}>
          <div className="space-y-2 border-b border-slate-200 p-3">
            <QuickNote contact={contact} conversation={conversation} onConversation={setConversation} onSaved={loadHistory} />
            <div className="flex flex-wrap items-center gap-1">
              {FILTERS.map(([v, l]) => (
                <button key={v} onClick={() => { setFilter(v); if (v === "chat") setWithChat(true); }} className={cx("rounded-full border px-2.5 py-0.5 text-xs", filter === v ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50")}>{l}</button>
              ))}
              <label className="ml-auto flex items-center gap-1 text-xs text-slate-500" title="Also list every chat message in the history">
                <input type="checkbox" checked={withChat} onChange={(e) => setWithChat(e.target.checked)} /> Include chat messages
              </label>
            </div>
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-3">
            {!history ? <div className="flex justify-center p-6"><Spinner /></div> : events.length === 0 ? (
              <p className="p-6 text-center text-sm text-slate-400">Nothing here yet.</p>
            ) : (
              <ol className="relative space-y-3 border-l border-slate-200 pl-5">
                {events.map((e, i) => {
                  const k = KINDS[e.kind] || KINDS.note;
                  return (
                    <li key={i} className="relative">
                      <span className={cx("absolute top-0 -left-[33px] flex h-6 w-6 items-center justify-center rounded-full text-xs", k.tone)}>{k.icon}</span>
                      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                        <p className="text-sm font-medium text-slate-800">{e.title}</p>
                        <p className="text-[11px] whitespace-nowrap text-slate-400" title={fmtDateTime(e.at)}>{fmtDateTime(e.at)}</p>
                      </div>
                      {e.text && <p className={cx("mt-0.5 text-xs whitespace-pre-line text-slate-600", ["customer", "reply", "botmsg", "template"].includes(e.kind) && "line-clamp-4")}>{e.text}</p>}
                      {(e.by || e.status === "failed") && <p className="mt-0.5 text-[11px] text-slate-400">{e.by && `by ${e.by}`}{e.status === "failed" && <span className="ml-1 text-red-600">· failed</span>}</p>}
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </Card>

        {/* Chat */}
        <Card className={cx("flex flex-col overflow-hidden xl:flex", tab === "chat" ? "h-[75dvh]" : "hidden", "xl:h-[calc(100dvh-230px)]")}>
          {!conversation ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
              <MessageCircle className="h-8 w-8 text-slate-300" />
              <p className="text-sm text-slate-500">No WhatsApp chat with this lead yet.</p>
              <Button onClick={startChat}><MessageCircle className="h-4 w-4" /> Start chat</Button>
            </div>
          ) : conversation.locked ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-slate-500">
              <MessagesSquare className="h-8 w-8 text-slate-300" />
              This chat is assigned to another counsellor.
            </div>
          ) : (
            <LeadChat conversation={conversation} contact={contact} me={me} isAdmin={isAdmin} onBot={botAction} botBusy={botBusy} onSent={refresh} />
          )}
        </Card>
      </div>
      {next && <NextFollowUpModal contact={contact} defaultTitle="Follow up" onClose={() => { setNext(false); loadContact(); loadHistory(); }} />}
    </div>
  );
}

/** "What happened?" — a private note on the lead, saved into its history (and the chat as a note) */
function QuickNote({ contact, conversation, onConversation, onSaved }) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      let conv = conversation;
      if (!conv || conv.locked) {
        conv = await api("/conversations/start", { method: "POST", body: { contactId: contact._id } });
        onConversation(conv);
      }
      await api(`/conversations/${conv._id}/messages`, { method: "POST", body: { type: "note", text: text.trim() } });
      setText("");
      toast.success("Note saved");
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-end gap-2">
      <Textarea rows={1} className="min-h-9 flex-1 resize-none border-amber-200 bg-amber-50/40" placeholder="Add a note: what they said, what you promised… (only your team sees it)" value={text} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); save(); } }} />
      <Button size="sm" variant="secondary" loading={busy} disabled={!text.trim()} onClick={save}><StickyNote className="h-3.5 w-3.5" /> Save note</Button>
    </div>
  );
}

/** The lead's WhatsApp chat (same as the inbox): messages, reply / template / note */
function LeadChat({ conversation, contact, me, isAdmin, onBot, botBusy, onSent }) {
  const toast = useToast();
  const router = useRouter();
  const [messages, setMessages] = useState(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [replyTo, setReplyTo] = useState(null);
  const [draftSeed, setDraftSeed] = useState(null);
  const convId = conversation._id;

  useEffect(() => {
    let alive = true;
    api(`/conversations/${convId}/messages`, { query: { limit: 50 } })
      .then((m) => {
        if (!alive) return;
        setMessages(m);
        setHasOlder(m.length === 50);
        if (conversation.unreadCount > 0) api(`/conversations/${convId}/read`, { method: "POST" }).catch(() => {});
      })
      .catch(toast.error);
    api("/templates", { query: { status: "approved" } }).then(setTemplates).catch(() => {});
    return () => {
      alive = false;
    };
  }, [convId]); // eslint-disable-line react-hooks/exhaustive-deps

  useSocketEvent("message:new", ({ message, conversation: c }) => {
    if (c._id !== convId) return;
    setMessages((m) => (m && !m.some((x) => x._id === message._id) ? [...m, message] : m));
    if (message.direction === "inbound") api(`/conversations/${convId}/read`, { method: "POST" }).catch(() => {});
  });
  useSocketEvent("message:status", ({ messageId, conversationId, status, error }) => {
    if (conversationId !== convId) return;
    setMessages((m) => m?.map((x) => (x._id === messageId ? { ...x, status, error } : x)));
  });
  useSocketEvent("message:updated", (u) => {
    if (u.conversationId === convId) setMessages((m) => m?.map((x) => (x._id === u._id ? { ...x, ...u } : x)));
  });

  const loadOlder = async () => {
    const older = await api(`/conversations/${convId}/messages`, { query: { before: messages[0]?.createdAt, limit: 50 } });
    setMessages((m) => [...older, ...m]);
    setHasOlder(older.length === 50);
  };
  const openInInbox = () => router.push(`/app/inbox?c=${convId}`);

  return (
    <>
      <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 text-sm">
        <MessageCircle className="h-4 w-4 text-brand-600" />
        <span className="flex-1 font-medium text-slate-800">WhatsApp chat</span>
        <span className={cx("text-xs", conversation.windowOpen ? "text-green-700" : "text-amber-700")}>{conversation.windowOpen ? "24h window open" : "Window closed: template only"}</span>
        <Button size="sm" variant="ghost" className="!h-7 !px-2 text-xs" onClick={openInInbox}>Inbox ↗</Button>
      </div>
      {!messages ? (
        <div className="flex flex-1 items-center justify-center"><Spinner /></div>
      ) : (
        <MessageList
          messages={messages}
          hasOlder={hasOlder}
          onLoadOlder={loadOlder}
          me={me}
          isAdmin={isAdmin}
          contactName={contact.name || fmtPhone(contact.phone)}
          windowOpen={conversation.windowOpen}
          onReply={setReplyTo}
          onCorrect={(m) => { setReplyTo(m); setDraftSeed({ nonce: Date.now(), text: m.text }); }}
          onCopy={(m) => navigator.clipboard.writeText(m.text || m.media?.caption || "").then(() => toast.success("Copied")).catch(() => {})}
          onEditNote={openInInbox}
          onDelete={openInInbox}
        />
      )}
      {conversation.bot?.active && (
        <div className="flex items-center gap-2 border-t border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-900">
          <Bot className="h-4 w-4 shrink-0" />
          <span className="flex-1">Chatbot is handling this chat.</span>
          <Button size="sm" variant="secondary" className="!h-7 text-xs" onClick={() => onBot("stop")} loading={botBusy}><Hand className="h-3.5 w-3.5" /> Take over</Button>
        </div>
      )}
      <Composer
        key={`${convId}:${draftSeed?.nonce || 0}`}
        initialText={draftSeed?.text}
        conversation={conversation}
        templates={templates}
        contact={contact}
        onSent={(m) => { setMessages((list) => (list?.some((x) => x._id === m._id) ? list : [...(list || []), m])); onSent?.(); }}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
      />
    </>
  );
}
