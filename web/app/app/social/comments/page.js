"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCheck, ExternalLink, RefreshCw, EyeOff, Eye, Mail, MessageSquareText, Reply, Search, Trash2, UserPlus, UserRound, X } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtRelative } from "@/lib/format";
import { useSocketEvent } from "@/lib/socket";
import { useToast } from "@/components/toast";
import { PageContainer } from "@/components/shell";
import { ChannelBadge } from "@/components/channel";
import { commenterName, mediaUrl, nameHidden } from "@/components/social";
import { Avatar, Badge, Button, Card, ConfirmModal, EmptyState, Input, Modal, PageHeader, PageLoader, Pagination, Select, Textarea, cx } from "@/components/ui";

const PRIVATE_DAYS = 7;

function CommentRow({ c, replies, isAdmin, now, fresh, onChanged }) {
  const toast = useToast();
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState("");
  const [dm, setDm] = useState(null); // private message text
  const [deleting, setDeleting] = useState(false);
  const seq = useRef(0);
  const [sending, setSending] = useState([]); // replies shown at once, before Facebook / Instagram confirm: { key, text, failed }
  // "New" = not seen before this visit (it is marked read as soon as it is on screen, but stays highlighted here)
  const isNew = (x) => !x.fromBusiness && (!x.readAt || fresh.has(x._id));
  const unread = isNew(c);
  const newReplies = replies.filter(isNew).length;
  const post = c.socialPostId;
  const canPrivate = !c.fromBusiness && !c.privateReplyAt && now - new Date(c.at).getTime() < PRIVATE_DAYS * 86400000;

  const run = async (key, fn, msg) => {
    setBusy(key);
    try {
      await fn();
      if (msg) toast.success(msg);
      onChanged();
      return true;
    } catch (err) {
      toast.error(err);
      return false;
    } finally {
      setBusy("");
    }
  };
  // Instant: the reply shows right away as "Sending…", the box is free for the next one; Facebook / Instagram confirm in the background
  const sendReply = async (body = text, retryKey) => {
    const msg = body.trim();
    if (!msg) return;
    const key = retryKey || `r${(seq.current += 1)}`;
    setSending((list) => (retryKey ? list.map((p) => (p.key === key ? { ...p, failed: false } : p)) : [...list, { key, text: msg, failed: false }]));
    setText("");
    setReplying(false);
    try {
      await api(`/social/comments/${c._id}/reply`, { method: "POST", body: { text: msg } });
      await onChanged(); // the real reply is in the list now
      setSending((list) => list.filter((p) => p.key !== key));
    } catch (err) {
      setSending((list) => list.map((p) => (p.key === key ? { ...p, failed: true } : p)));
      toast.error(err);
    }
  };

  return (
    <Card className={cx("p-3", (unread || newReplies > 0) && "border-brand-400 bg-brand-50/40 ring-1 ring-brand-200")}>
      <div className="flex gap-3">
        <Avatar name={commenterName(c)} className="h-9 w-9 shrink-0" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium text-slate-900">{commenterName(c)}</span>
            {nameHidden(c) && <span className="text-xs text-slate-400" title="Facebook / Instagram hide the name until the Meta app gets Advanced Access (App Review)">(name hidden by {c.platform === "instagram" ? "Instagram" : "Facebook"})</span>}
            <ChannelBadge channel={c.platform} />
            {unread && <Badge tone="red">New</Badge>}
            {newReplies > 0 && <Badge tone="red">{newReplies} new {newReplies > 1 ? "replies" : "reply"} below</Badge>}
            {c.hidden && <Badge tone="gray">Hidden</Badge>}
            {c.privateReplyAt && <Badge tone="blue">Private message sent</Badge>}
            <span className="text-xs text-slate-500">{fmtRelative(c.at)}</span>
          </div>
          <p className={cx("text-sm whitespace-pre-line", c.hidden ? "text-slate-400" : "text-slate-800")}>{c.text}</p>
          {post && (
            <p className="flex items-center gap-1.5 text-xs text-slate-500">
              {post.media?.[0]?.type === "image" && <img src={mediaUrl(post.media[0].url)} alt="" className="h-5 w-5 rounded object-cover" />}
              On: <span className="truncate">{post.text?.slice(0, 70) || "your post"}</span>
              {post.targets?.find((t) => t.platform === c.platform)?.permalink && (
                <a href={post.targets.find((t) => t.platform === c.platform).permalink} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-0.5 text-brand-700 hover:underline">
                  Open <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </p>
          )}

          {(replies.length > 0 || sending.length > 0) && (
            <div className="mt-2 space-y-1.5 border-l-2 border-slate-200 pl-3">
              {replies.map((r) => (
                <div key={r._id} className={cx("rounded text-sm", isNew(r) && "-mx-1.5 bg-red-50 px-1.5 py-0.5")}>
                  <span className={cx("font-medium", r.fromBusiness ? "text-brand-700" : "text-slate-900")}>{commenterName(r)}</span>{" "}
                  {isNew(r) && <Badge tone="red" className="mr-1">New</Badge>}
                  <span className="text-slate-700">{r.text}</span>{" "}
                  <span className="text-xs text-slate-400">{fmtRelative(r.at)}</span>
                </div>
              ))}
              {sending.map((p) => (
                <div key={p.key} className={cx("text-sm", !p.failed && "opacity-70")}>
                  <span className="font-medium text-brand-700">You</span> <span className="text-slate-700">{p.text}</span>{" "}
                  {p.failed ? (
                    <span className="text-xs text-red-600">
                      Not sent ·{" "}
                      <button type="button" className="underline" onClick={() => sendReply(p.text, p.key)}>Try again</button> ·{" "}
                      <button type="button" className="underline" onClick={() => setSending((l) => l.filter((x) => x.key !== p.key))}>Remove</button>
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400">Sending…</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {!c.fromBusiness && (
            <div className="flex flex-wrap items-center gap-1 pt-1">
              <Button size="sm" variant="ghost" onClick={() => setReplying((v) => !v)}><Reply className="h-3.5 w-3.5" /> Reply</Button>
              {canPrivate && <Button size="sm" variant="ghost" onClick={() => setDm(`Hi! Thanks for your comment. `)} title="One private message (Messenger / Instagram DM), within 7 days"><Mail className="h-3.5 w-3.5" /> Private message</Button>}
              <Button size="sm" variant="ghost" loading={busy === "hide"} onClick={() => run("hide", () => api(`/social/comments/${c._id}/hide`, { method: "POST", body: { hidden: !c.hidden } }), c.hidden ? "Comment shown again" : "Comment hidden from others")}>
                {c.hidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />} {c.hidden ? "Unhide" : "Hide"}
              </Button>
              {c.contactId ? (
                <Link href={`/app/contacts/${c.contactId}`}><Button size="sm" variant="ghost"><UserRound className="h-3.5 w-3.5" /> Open lead</Button></Link>
              ) : (
                <Button size="sm" variant="ghost" loading={busy === "lead"} onClick={() => run("lead", () => api(`/social/comments/${c._id}/lead`, { method: "POST" }), "Saved as a lead")}><UserPlus className="h-3.5 w-3.5" /> Make lead</Button>
              )}
              {isAdmin && <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setDeleting(true)}><Trash2 className="h-3.5 w-3.5" /> Delete</Button>}
            </div>
          )}
          {replying && (
            <div className="flex items-end gap-2 pt-1">
              <Textarea id={`reply-${c._id}`} rows={2} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={`Public reply to ${commenterName(c)}…`} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && text.trim()) { e.preventDefault(); sendReply(); } }} />
              <Button onClick={() => sendReply()} disabled={!text.trim()}>Reply</Button>
              <Button variant="ghost" size="icon" aria-label="Close reply" onClick={() => setReplying(false)}><X className="h-4 w-4" /></Button>
            </div>
          )}
        </div>
      </div>

      <Modal
        open={dm !== null}
        onClose={() => setDm(null)}
        title={`Private message to ${commenterName(c)}`}
        footer={<><Button variant="secondary" onClick={() => setDm(null)}>Cancel</Button><Button loading={busy === "dm"} disabled={!dm?.trim()} onClick={() => run("dm", () => api(`/social/comments/${c._id}/private-reply`, { method: "POST", body: { text: dm } }), "Private message sent").then((ok) => ok && setDm(null))}>Send</Button></>}
      >
        <p className="mb-2 text-sm text-slate-600">
          Goes to their {c.platform === "facebook" ? "Messenger" : "Instagram DMs"}. {c.platform === "facebook" ? "Facebook" : "Instagram"} allows only <b>one</b> private message per comment, within 7 days. If they reply, continue the chat {c.platform === "instagram" ? "in the Inbox" : "in Messenger"}.
        </p>
        <Textarea id={`dm-${c._id}`} rows={4} value={dm || ""} onChange={(e) => setDm(e.target.value)} />
      </Modal>
      <ConfirmModal
        open={deleting}
        onClose={() => setDeleting(false)}
        danger
        loading={busy === "delete"}
        title="Delete this comment?"
        confirmText="Delete"
        message={`It is removed from ${c.platform === "facebook" ? "Facebook" : "Instagram"} for everyone. To only keep it out of sight, use Hide.`}
        onConfirm={() => run("delete", () => api(`/social/comments/${c._id}`, { method: "DELETE" }), "Comment deleted").then(() => setDeleting(false))}
      />
    </Card>
  );
}

function CommentsInbox() {
  const toast = useToast();
  const { session } = useAuth();
  const isAdmin = session.user.role === "admin";
  const postId = useSearchParams().get("post") || "";
  const [filters, setFilters] = useState({ unread: "", platform: "", search: "" });
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [marking, setMarking] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [now, setNow] = useState(() => Date.now()); // for the 7-day private-message window
  const [fresh, setFresh] = useState(() => new Set()); // unread when they reached the screen: highlighted for this visit
  const marking$ = useRef(false);

  const load = () =>
    api("/social/comments", { query: { ...filters, postId, page } })
      .then((r) => {
        setData(r);
        setNow(Date.now());
        const unseen = r.items.filter((c) => !c.readAt && !c.fromBusiness).map((c) => c._id);
        if (!unseen.length) return;
        setFresh((f) => new Set([...f, ...unseen]));
        // Seen = read (sidebar count goes down). In "Unread only" they stay unread until the user acts.
        if (filters.unread || document.hidden || marking$.current) return;
        marking$.current = true;
        api("/social/comments/read", { method: "POST", body: { ids: unseen } })
          .then(() => window.dispatchEvent(new Event("crm-counts-refresh")))
          .catch(() => {})
          .finally(() => (marking$.current = false));
      })
      .catch(toast.error);
  useEffect(() => { load(); }, [filters, postId, page]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setTimeout(() => { setPage(1); setFilters((f) => (f.search === search ? f : { ...f, search })); }, 350);
    return () => clearTimeout(t);
  }, [search]);
  useSocketEvent("social:comment", load);
  useSocketEvent("notification:new", load);
  // Safety net when a live update is missed: check again every 20 s while the page is on screen, and on coming back to the tab
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) load(); }, 20000);
    const onShow = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("focus", onShow);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onShow); window.removeEventListener("focus", onShow); };
  }, [filters, postId, page]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return <PageLoader />;
  // Thread the page: replies under the comment they answer
  const byExternal = new Map(data.items.map((c) => [c.externalId, c]));
  const replies = {};
  const top = [];
  for (const c of [...data.items].reverse()) {
    if (c.parentExternalId && byExternal.has(c.parentExternalId)) (replies[c.parentExternalId] ||= []).push(c);
    else top.unshift(c);
  }
  // A thread with a new reply comes to the top
  const lastActivity = (c) => Math.max(new Date(c.at).getTime(), ...(replies[c.externalId] || []).map((r) => new Date(r.at).getTime()));
  top.sort((a, b) => lastActivity(b) - lastActivity(a));
  const newCount = data.items.filter((c) => !c.fromBusiness && (!c.readAt || fresh.has(c._id))).length;
  const setFilter = (patch) => { setPage(1); setFilters({ ...filters, ...patch }); };
  // Read the comments again from Facebook / Instagram (picks up comments whose webhook never came)
  const refresh = async () => {
    setSyncing(true);
    try {
      const r = await api("/social/comments/sync", { method: "POST" });
      if (r.errors?.length) toast.error(r.errors[0]);
      else toast.success(r.added ? `${r.added} new comment${r.added > 1 ? "s" : ""} found` : "Up to date — no new comments");
      load();
    } catch (err) {
      toast.error(err);
    } finally {
      setSyncing(false);
    }
  };
  const markAll = async () => {
    setMarking(true);
    try {
      await api("/social/comments/read", { method: "POST", body: { all: true } });
      window.dispatchEvent(new Event("crm-counts-refresh"));
      load();
    } catch (err) {
      toast.error(err);
    } finally {
      setMarking(false);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title="Comments"
        description="Comments on your Facebook Page and Instagram posts. Reply here and it shows on Facebook / Instagram as your business."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={refresh} loading={syncing} title="Read the comments of the last 7 days' posts again from Facebook / Instagram">
              {!syncing && <RefreshCw className="h-4 w-4" />} Refresh
            </Button>
            {data.unread > 0 && <Button variant="secondary" onClick={markAll} loading={marking}><CheckCheck className="h-4 w-4" /> Mark all read ({data.unread})</Button>}
          </div>
        }
      />
      <div className="mb-4 grid gap-2 sm:grid-cols-[auto_auto_1fr]">
        <Select id="cm-unread" value={filters.unread} onChange={(e) => setFilter({ unread: e.target.value })}>
          <option value="">All comments</option>
          <option value="1">Unread only</option>
        </Select>
        <Select id="cm-platform" value={filters.platform} onChange={(e) => setFilter({ platform: e.target.value })}>
          <option value="">Facebook + Instagram</option>
          <option value="facebook">Facebook</option>
          <option value="instagram">Instagram</option>
        </Select>
        <div className="relative">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 h-4 w-4 text-slate-400" />
          <Input id="cm-search" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search comment or name" />
        </div>
      </div>
      {newCount > 0 && (
        <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          <b>{newCount} new comment{newCount > 1 ? "s" : ""}</b> since you opened this page — highlighted below with a red <b>New</b> tag.
        </p>
      )}
      {postId && (
        <p className="mb-3 flex items-center gap-2 text-sm text-slate-600">
          Showing one post&apos;s comments. <Link href="/app/social/comments" className="text-brand-700 hover:underline">Show all</Link>
        </p>
      )}
      {!top.length ? (
        <EmptyState icon={MessageSquareText} title={filters.unread ? "No unread comments" : "No comments yet"} description="Comments on posts made from the CRM (and other posts on your Page / Instagram) appear here as they come." />
      ) : (
        <div className="space-y-2">
          {top.map((c) => <CommentRow key={c._id} c={c} replies={replies[c.externalId] || []} isAdmin={isAdmin} now={now} fresh={fresh} onChanged={load} />)}
          <Pagination page={page} limit={50} total={data.total} onChange={setPage} />
        </div>
      )}
    </PageContainer>
  );
}

// useSearchParams needs a Suspense boundary
export default function CommentsPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <CommentsInbox />
    </Suspense>
  );
}
