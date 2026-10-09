"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Bot, Check, Search, Info, MessagesSquare, Hand } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useSocketEvent } from "@/lib/socket";
import { fmtPhone, fmtRelative, displayName } from "@/lib/format";
import { ChannelBadge, channelOf, contactHandle } from "@/components/channel";
import { useToast } from "@/components/toast";
import { LeadStatusBadge, LeadStatusSelect } from "@/components/shared";
import { Avatar, Badge, Button, ConfirmModal, EmptyState, Input, Modal, Select, Spinner, Textarea, cx } from "@/components/ui";
import { MessageList } from "@/components/inbox/message-list";
import { Composer } from "@/components/inbox/composer";
import { ContactPanel } from "@/components/inbox/contact-panel";
import { NotificationToggle } from "@/components/notifications";

const STATUS_TABS = [["open", "Open"], ["pending", "Pending"], ["resolved", "Resolved"], ["all", "All"]];

// useSearchParams needs a Suspense boundary
export default function InboxPage() {
  return (
    <Suspense fallback={null}>
      <Inbox />
    </Suspense>
  );
}

function Inbox() {
  const toast = useToast();
  const { session } = useAuth();
  const me = session.user;
  const isAdmin = me.role === "admin";

  const [status, setStatus] = useState("open");
  const [assigned, setAssigned] = useState("all");
  const [leadStatus, setLeadStatus] = useState(""); // filter chats by the contact's lead status
  const [source, setSource] = useState(""); // "ad" = only leads from Facebook / Instagram ads
  const [channel, setChannel] = useState(""); // "" = all, "whatsapp", "instagram"
  const [search, setSearch] = useState("");
  const [conversations, setConversations] = useState(null);
  // ?c=<conversation id> opens that chat (links from notifications, dashboard, contacts)
  const urlChat = useSearchParams().get("c");
  const [activeId, setActiveId] = useState(urlChat);
  const [active, setActive] = useState(null); // populated conversation
  const [contact, setContact] = useState(null);
  const [messages, setMessages] = useState([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingChat, setLoadingChat] = useState(!!activeId);
  const [team, setTeam] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [showInfo, setShowInfo] = useState(false);
  const [tags, setTags] = useState([]);
  const [replyTo, setReplyTo] = useState(null); // message being quoted in the composer
  const [editingNote, setEditingNote] = useState(null); // { message, text }
  const [deleting, setDeleting] = useState(null); // message to delete/hide
  // Pre-filled composer text (e.g. "Send correction"); a new nonce remounts the composer with it
  const [draftSeed, setDraftSeed] = useState(null);
  const [busy, setBusy] = useState(false);

  // A link to another chat while the inbox is already open (e.g. clicking a notification): open it.
  // Our own selectConversation() also updates the URL, but then urlChat === activeId and nothing happens.
  const [seenUrlChat, setSeenUrlChat] = useState(urlChat);
  if (urlChat !== seenUrlChat) {
    setSeenUrlChat(urlChat);
    if (urlChat && urlChat !== activeId) {
      setActiveId(urlChat);
      setActive(null);
      setMessages([]);
      setReplyTo(null);
      setDraftSeed(null);
      setLoadingChat(true);
    }
  }
  const activeIdRef = useRef(activeId);
  useEffect(() => {
    activeIdRef.current = activeId;
  });

  const selectConversation = (id) => {
    // Clicking the chat that is already open must not reset it (the load effect would not re-run)
    if (id === activeId) return;
    setActiveId(id);
    setActive(null);
    setMessages([]);
    setReplyTo(null);
    setDraftSeed(null);
    setLoadingChat(!!id);
    window.history.replaceState(null, "", id ? `/app/inbox?c=${id}` : "/app/inbox");
  };

  // ----- data loading -----
  const loadList = useCallback(() => {
    api("/conversations", { query: { status, assigned, search, leadStatus, source, channel } }).then(setConversations).catch(toast.error);
  }, [status, assigned, search, leadStatus, source, channel]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = setTimeout(loadList, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [loadList, search]);

  useEffect(() => {
    api("/team").then(setTeam).catch(() => {});
    api("/templates", { query: { status: "approved" } }).then(setTemplates).catch(() => {});
    api("/contacts/tags").then(setTags).catch(() => {});
  }, []);

  useEffect(() => {
    if (!activeId) return;
    let current = true; // ignore responses for a chat the user already left
    Promise.all([api(`/conversations/${activeId}`), api(`/conversations/${activeId}/messages`, { query: { limit: 50 } })])
      .then(([{ conversation, contact: ct }, msgs]) => {
        if (!current) return;
        setActive(conversation);
        setContact(ct);
        setMessages(msgs);
        setHasOlder(msgs.length === 50);
        if (conversation.unreadCount > 0) {
          api(`/conversations/${activeId}/read`, { method: "POST" }).catch(() => {});
          setConversations((list) => list?.map((c) => (c._id === activeId ? { ...c, unreadCount: 0 } : c)));
        }
      })
      .catch((err) => {
        if (!current) return;
        toast.error(err);
        selectConversation(null);
      })
      .finally(() => current && setLoadingChat(false));
    return () => {
      current = false;
    };
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadOlder = async () => {
    const older = await api(`/conversations/${activeId}/messages`, { query: { before: messages[0]?.createdAt, limit: 50 } });
    setMessages((m) => [...older, ...m]);
    setHasOlder(older.length === 50);
  };

  // ----- realtime -----
  const matchesFilters = (c) => {
    if (status !== "all" && c.status !== status) return false;
    const assignee = c.assignedTo?._id || null;
    if (assigned === "me" && assignee !== me._id) return false;
    if (assigned === "unassigned" && (assignee || c.bot?.active)) return false;
    if (assigned === "bot" && !c.bot?.active) return false;
    if (!isAdmin && assignee && assignee !== me._id) return false;
    if (leadStatus && c.contactId?.leadStatus !== leadStatus) return false;
    if (source === "ad" && !c.contactId?.adSource?.sourceId) return false;
    if (channel && channelOf(c) !== channel) return false;
    return true;
  };

  const upsertConversation = (conv) => {
    setConversations((list) => {
      if (!list) return list;
      const rest = list.filter((c) => c._id !== conv._id);
      if (!matchesFilters(conv) || search) return search ? list.map((c) => (c._id === conv._id ? conv : c)) : rest;
      return [conv, ...rest].sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
    });
  };

  // Keep the open chat's contact (header + details panel) in sync with live updates,
  // e.g. the chatbot saved the customer's name or tags. Full reload when the bot hands off (custom fields).
  const syncActiveContact = (conv, { reload } = {}) => {
    const c = conv.contactId;
    if (c?._id) {
      setContact((cur) => (cur && cur._id === c._id ? { ...cur, name: c.name, tags: c.tags, leadStatus: c.leadStatus, optedOut: c.optedOut } : cur));
      if (reload) api(`/contacts/${c._id}`).then((r) => setContact((cur) => (cur?._id === r.contact._id ? r.contact : cur))).catch(() => {});
    }
  };

  useSocketEvent("message:new", ({ message, conversation }) => {
    const isActive = conversation._id === activeIdRef.current;
    if (isActive) {
      setMessages((m) => (m.some((x) => x._id === message._id) ? m : [...m, message]));
      setActive(conversation);
      syncActiveContact(conversation);
      if (message.direction === "inbound") api(`/conversations/${conversation._id}/read`, { method: "POST" }).catch(() => {});
      // Chat is on screen: never show an unread badge for it (also for events that follow, e.g. an auto note)
      conversation = { ...conversation, unreadCount: 0 };
    }
    upsertConversation(conversation);
  });

  // Reaction / note edit / hide: replace the message and refresh any quote of it
  const applyMessageUpdate = (updated) => {
    setMessages((list) =>
      list.map((x) => {
        if (x._id === updated._id) return { ...x, ...updated, replyTo: updated.replyTo ?? (updated.deletedAt ? undefined : x.replyTo) };
        if (x.replyTo?._id === updated._id) return { ...x, replyTo: { ...x.replyTo, ...(updated.deletedAt ? { deletedAt: updated.deletedAt, text: "" } : {}) } };
        return x;
      })
    );
    setReplyTo((r) => (r?._id === updated._id && updated.deletedAt ? null : r));
  };

  useSocketEvent("message:updated", (updated) => {
    if (updated.conversationId === activeIdRef.current) applyMessageUpdate(updated);
  });

  useSocketEvent("message:status", ({ messageId, conversationId, status: st, error }) => {
    if (conversationId !== activeIdRef.current) return;
    setMessages((m) => m.map((x) => (x._id === messageId ? { ...x, status: st, error } : x)));
  });

  useSocketEvent("conversation:updated", (conv) => {
    const assignee = conv.assignedTo?._id || null;
    if (!isAdmin && assignee && assignee !== me._id) {
      // Chat moved to another agent
      setConversations((list) => list?.filter((c) => c._id !== conv._id));
      if (conv._id === activeIdRef.current) {
        toast.info("This chat was assigned to another agent");
        selectConversation(null);
      }
      return;
    }
    if (conv._id === activeIdRef.current) {
      setActive(conv);
      syncActiveContact(conv, { reload: true });
    }
    upsertConversation(conv);
  });

  // ----- actions -----
  const updateConversation = async (patch) => {
    try {
      const conv = await api(`/conversations/${activeId}`, { method: "PATCH", body: patch });
      setActive(conv);
      upsertConversation(conv);
      if (patch.status === "resolved") toast.success("Chat resolved");
    } catch (err) {
      toast.error(err);
    }
  };

  const updateContact = async (patch) => {
    try {
      const updated = await api(`/contacts/${contact._id}`, { method: "PATCH", body: patch });
      setContact(updated);
      // Keep the chat list badge in sync (status / name / tags shown there)
      setConversations((list) =>
        list?.map((c) => (c.contactId?._id === updated._id ? { ...c, contactId: { ...c.contactId, name: updated.name, tags: updated.tags, leadStatus: updated.leadStatus } } : c))
      );
      if (patch.tags) api("/contacts/tags").then(setTags);
    } catch (err) {
      toast.error(err);
    }
  };

  const botAction = async (action) => {
    setBusy(true);
    try {
      const conv = await api(`/conversations/${activeId}/bot`, { method: "POST", body: { action } });
      setActive(conv);
      upsertConversation(conv);
      toast.success(action === "stop" ? "You took over this chat. The bot is off here." : "Chat handed to the bot. Menu sent to the customer.");
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const copyText = async (m) => {
    try {
      await navigator.clipboard.writeText(m.text || m.media?.caption || "");
      toast.success("Copied");
    } catch {
      toast.error("Could not copy");
    }
  };

  const saveNote = async () => {
    setBusy(true);
    try {
      const updated = await api(`/conversations/${activeId}/messages/${editingNote.message._id}`, { method: "PATCH", body: { text: editingNote.text } });
      applyMessageUpdate(updated);
      setEditingNote(null);
      toast.success("Note updated");
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    setBusy(true);
    try {
      const updated = await api(`/conversations/${activeId}/messages/${deleting._id}`, { method: "DELETE" });
      applyMessageUpdate(updated);
      toast.success(deleting.direction === "internal" ? "Note deleted" : deleting.sentBy?._id === me._id ? "Message deleted from the CRM" : "Message hidden from the CRM");
      setDeleting(null);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const onSent = (message) => {
    setMessages((m) => (m.some((x) => x._id === message._id) ? m : [...m, message]));
    if (message.status === "failed") toast.error(message.error || "Message failed");
  };

  return (
    <div className="flex h-full bg-white">
      {/* Conversation list */}
      <aside className={cx("flex w-full flex-col border-r border-slate-200 md:w-80 md:shrink-0", activeId && "hidden md:flex")}>
        <div className="space-y-2 border-b border-slate-200 p-3">
          <NotificationToggle />
          <div className="relative">
            <Search className="absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
            <Input className="pl-9" placeholder="Search name or number" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="flex gap-1">
            {STATUS_TABS.map(([v, l]) => (
              <button key={v} onClick={() => setStatus(v)} className={cx("flex-1 rounded-md px-2 py-1 text-xs font-medium", status === v ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")}>
                {l}
              </button>
            ))}
          </div>
          <Select value={assigned} onChange={(e) => setAssigned(e.target.value)} className="h-8 text-xs">
            <option value="all">{isAdmin ? "All chats" : "My chats + unassigned"}</option>
            <option value="me">Assigned to me</option>
            <option value="unassigned">Unassigned</option>
            <option value="bot">🤖 Bot handling</option>
            {isAdmin && team.filter((t) => t.role === "agent").map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}
          </Select>
          <div className="grid grid-cols-2 gap-2">
            <LeadStatusSelect value={leadStatus} onChange={setLeadStatus} includeAll allLabel="All lead statuses" className="w-full min-w-0" />
            {/* One box for "where from": ads, or only WhatsApp / only Instagram chats */}
            <Select
              value={source || channel}
              onChange={(e) => {
                const v = e.target.value;
                setSource(v === "ad" ? "ad" : "");
                setChannel(v === "whatsapp" || v === "instagram" ? v : "");
              }}
              className="h-8 w-full min-w-0 text-xs"
              aria-label="Where from"
            >
              <option value="">All chats</option>
              <option value="whatsapp">WhatsApp only</option>
              <option value="instagram">Instagram only</option>
              <option value="ad">📣 From ads</option>
            </Select>
          </div>
        </div>
        <div className="scroll-thin flex-1 overflow-y-auto">
          {!conversations ? (
            <div className="flex justify-center p-6"><Spinner /></div>
          ) : !conversations.length ? (
            <EmptyState icon={MessagesSquare} title="No chats here" description="New WhatsApp and Instagram messages from customers will appear here." />
          ) : (
            conversations.map((c) => (
              <button
                key={c._id}
                onClick={() => selectConversation(c._id)}
                className={cx("flex w-full items-start gap-3 border-b border-slate-100 px-3 py-3 text-left hover:bg-slate-50", activeId === c._id && "bg-brand-50/60")}
              >
                <Avatar name={displayName(c.contactId).replace(/^[@+]/, "")} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-slate-900"><span className="truncate">{displayName(c.contactId)}</span><ChannelBadge channel={channelOf(c)} /></p>
                    <span className={cx("shrink-0 text-xs", c.unreadCount ? "font-medium text-brand-600" : "text-slate-400")}>{fmtRelative(c.lastMessageAt)}</span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <p className="truncate text-xs text-slate-500">{c.lastMessagePreview || "No messages yet"}</p>
                    {c.unreadCount > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1.5 text-[10px] font-semibold text-white">{c.unreadCount}</span>}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                    <LeadStatusBadge status={c.contactId?.leadStatus} />
                    {c.contactId?.adSource?.sourceId && <span title={c.contactId.adSource.headline} className="text-violet-600">📣 Ad</span>}
                    {c.contactId?.followUpAt && new Date(c.contactId.followUpAt) - new Date() < 864e5 && (
                      <span className={new Date(c.contactId.followUpAt) < new Date() ? "font-medium text-red-600" : "text-amber-700"} title="Follow-up">🔔</span>
                    )}
                    <span className="truncate">{c.bot?.active ? <span className="font-medium text-violet-600">🤖 Bot handling</span> : c.assignedTo ? `👤 ${c.assignedTo.name}` : "Unassigned"}</span>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* Chat area */}
      <section className={cx("min-w-0 flex-1 flex-col", activeId ? "flex" : "hidden md:flex")}>
        {!activeId ? (
          <div className="flex flex-1 items-center justify-center bg-slate-50">
            <EmptyState icon={MessagesSquare} title="Select a chat" description="Pick a conversation from the left to start replying." />
          </div>
        ) : !active || loadingChat ? (
          <div className="flex flex-1 items-center justify-center"><Spinner className="h-6 w-6" /></div>
        ) : (
          <>
            <header className="flex items-center gap-2 border-b border-slate-200 px-3 py-2.5 sm:gap-3">
              <button className="rounded p-1 text-slate-500 hover:bg-slate-100 md:hidden" onClick={() => selectConversation(null)} aria-label="Back to chats"><ArrowLeft className="h-5 w-5" /></button>
              <Avatar name={displayName(contact).replace(/^[@+]/, "")} />
              <div className="min-w-16 flex-1">
                <p className="truncate text-sm font-semibold text-slate-900">{displayName(contact)}</p>
                <p className="flex items-center gap-1.5 truncate text-xs text-slate-500"><ChannelBadge channel={channelOf(active)} full /> {contactHandle(contact)} {contact?.optedOut && <Badge tone="red" className="ml-1">opted out</Badge>}</p>
              </div>
              {contact && (
                <LeadStatusSelect
                  value={contact.leadStatus}
                  onChange={(v) => v !== contact.leadStatus && updateContact({ leadStatus: v })}
                  className="h-8 w-24 shrink-0 text-xs sm:w-36"
                  title="Lead status of this customer"
                />
              )}
              <Select className="hidden h-8 w-40 text-xs xl:block" value={active.assignedTo?._id || ""} onChange={(e) => updateConversation({ assignedTo: e.target.value || null })} aria-label="Assign to">
                <option value="">Unassigned</option>
                {team.filter((t) => t.isActive).map((t) => <option key={t._id} value={t._id}>{t._id === me._id ? `${t.name} (me)` : t.name}</option>)}
              </Select>
              {active.status !== "resolved" ? (
                <Button size="sm" variant="secondary" onClick={() => updateConversation({ status: "resolved" })}><Check className="h-4 w-4" /> <span className="hidden sm:inline">Resolve</span></Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => updateConversation({ status: "open" })}>Reopen</Button>
              )}
              <Button
                size="sm"
                variant={showInfo ? "primary" : "secondary"}
                className="px-2 sm:px-3"
                onClick={() => setShowInfo((v) => !v)}
                aria-label="Contact details"
                title="Contact details: lead status, follow-up, tags, notes"
              >
                <Info className="h-4 w-4" /> <span className="hidden 2xl:inline">Details</span>
              </Button>
            </header>

            <MessageList
              messages={messages}
              hasOlder={hasOlder}
              onLoadOlder={loadOlder}
              me={me}
              isAdmin={isAdmin}
              contactName={displayName(contact)}
              windowOpen={active.windowOpen}
              onReply={setReplyTo}
              onCorrect={(m) => {
                setReplyTo(m);
                setDraftSeed({ nonce: Date.now(), text: m.text });
              }}
              onCopy={copyText}
              onEditNote={(m) => setEditingNote({ message: m, text: m.text })}
              onDelete={setDeleting}
            />

            {active.bot?.active && (
              <div className="flex flex-wrap items-center gap-2 border-t border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-900">
                <Bot className="h-4 w-4 shrink-0" />
                <span className="flex-1">Chatbot is handling this chat. Sending a reply will stop the bot.</span>
                <Button size="sm" variant="secondary" onClick={() => botAction("stop")} loading={busy}><Hand className="h-3.5 w-3.5" /> Take over</Button>
              </div>
            )}

            <Composer
              key={`${active._id}:${draftSeed?.nonce || 0}`}
              initialText={draftSeed?.text}
              conversation={active}
              templates={templates}
              contact={contact}
              onSent={onSent}
              replyTo={replyTo}
              onCancelReply={() => setReplyTo(null)}
            />
          </>
        )}
      </section>

      {/* Contact panel */}
      {active && contact && showInfo && (
        <aside className="scroll-thin fixed inset-y-0 right-0 z-30 w-80 overflow-y-auto border-l border-slate-200 bg-white shadow-xl xl:static xl:shadow-none">
          <ContactPanel
            key={contact._id}
            contact={contact}
            conversation={active}
            team={team}
            me={me}
            tags={tags}
            onClose={() => setShowInfo(false)}
            onUpdateContact={updateContact}
            onContactReplaced={setContact}
            onUpdateConversation={updateConversation}
            onBotAction={botAction}
            botBusy={busy}
          />
        </aside>
      )}

      <Modal
        open={!!editingNote}
        onClose={() => setEditingNote(null)}
        title="Edit internal note"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditingNote(null)}>Cancel</Button>
            <Button onClick={saveNote} loading={busy} disabled={!editingNote?.text.trim()}>Save</Button>
          </>
        }
      >
        {editingNote && (
          <Textarea rows={5} autoFocus onFocus={(e) => e.target.setSelectionRange(e.target.value.length, e.target.value.length)} value={editingNote.text} onChange={(e) => setEditingNote({ ...editingNote, text: e.target.value })} />
        )}
        <p className="mt-2 text-xs text-slate-500">Notes are visible only to your team. The edit is recorded in the audit log.</p>
      </Modal>

      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        loading={busy}
        danger
        title={deleteCopy(deleting, me).title}
        confirmText={deleteCopy(deleting, me).confirm}
        message={deleteCopy(deleting, me).message}
      />
    </div>
  );
}

// Confirm-dialog wording for note delete / own message delete / admin hide
function deleteCopy(m, me) {
  if (!m) return {};
  if (m.direction === "internal") {
    return { title: "Delete this note?", confirm: "Delete note", message: "The note will be removed for everyone in your team. This is recorded in the audit log." };
  }
  if (m.sentBy?._id === me._id) {
    return {
      title: "Delete this message?",
      confirm: "Delete",
      message:
        m.status === "failed"
          ? "This message was never delivered to the customer. It will be removed from the chat."
          : "It will be removed from the CRM for your team. WhatsApp does not let businesses unsend messages, so the customer has already received it and will still see it. Tip: use “Send correction” to fix a mistake.",
    };
  }
  return {
    title: "Hide this message from the CRM?",
    confirm: "Hide message",
    message: "The message will be hidden for your whole team. It will NOT be deleted from the customer's WhatsApp. A record is kept in the audit log.",
  };
}
