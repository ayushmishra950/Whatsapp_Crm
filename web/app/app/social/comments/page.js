"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCheck, ExternalLink, EyeOff, Eye, Mail, MessageSquareText, Reply, Search, Trash2, UserPlus, UserRound, X } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtRelative } from "@/lib/format";
import { useSocketEvent } from "@/lib/socket";
import { useToast } from "@/components/toast";
import { PageContainer } from "@/components/shell";
import { ChannelBadge } from "@/components/channel";
import { commenterName, mediaUrl } from "@/components/social";
import { Avatar, Badge, Button, Card, ConfirmModal, EmptyState, Input, Modal, PageHeader, PageLoader, Pagination, Select, Textarea, cx } from "@/components/ui";

const PRIVATE_DAYS = 7;

function CommentRow({ c, replies, isAdmin, now, onChanged }) {
  const toast = useToast();
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState("");
  const [dm, setDm] = useState(null); // private message text
  const [deleting, setDeleting] = useState(false);
  const unread = !c.readAt && !c.fromBusiness;
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
  const sendReply = () =>
    run("reply", () => api(`/social/comments/${c._id}/reply`, { method: "POST", body: { text } }), "Reply posted").then((ok) => {
      if (ok) { setText(""); setReplying(false); }
    });

  return (
    <Card className={cx("p-3", unread && "border-brand-300 bg-brand-50/30")}>
      <div className="flex gap-3">
        <Avatar name={commenterName(c)} className="h-9 w-9 shrink-0" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium text-slate-900">{commenterName(c)}</span>
            <ChannelBadge channel={c.platform} />
            {unread && <Badge tone="red">New</Badge>}
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

          {replies.length > 0 && (
            <div className="mt-2 space-y-1.5 border-l-2 border-slate-200 pl-3">
              {replies.map((r) => (
                <div key={r._id} className="text-sm">
                  <span className={cx("font-medium", r.fromBusiness ? "text-brand-700" : "text-slate-900")}>{commenterName(r)}</span>{" "}
                  <span className="text-slate-700">{r.text}</span>{" "}
                  <span className="text-xs text-slate-400">{fmtRelative(r.at)}</span>
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
              {unread && <Button size="sm" variant="ghost" loading={busy === "read"} onClick={() => run("read", () => api("/social/comments/read", { method: "POST", body: { ids: [c._id] } }))}><CheckCheck className="h-3.5 w-3.5" /> Mark read</Button>}
              {isAdmin && <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setDeleting(true)}><Trash2 className="h-3.5 w-3.5" /> Delete</Button>}
            </div>
          )}
          {replying && (
            <div className="flex items-end gap-2 pt-1">
              <Textarea id={`reply-${c._id}`} rows={2} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={`Public reply to ${commenterName(c)}…`} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && text.trim()) { e.preventDefault(); sendReply(); } }} />
              <Button onClick={sendReply} loading={busy === "reply"} disabled={!text.trim() || busy === "reply"}>Reply</Button>
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
  const [now, setNow] = useState(() => Date.now()); // for the 7-day private-message window

  const load = () =>
    api("/social/comments", { query: { ...filters, postId, page } })
      .then((r) => { setData(r); setNow(Date.now()); })
      .catch(toast.error);
  useEffect(() => { load(); }, [filters, postId, page]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setTimeout(() => { setPage(1); setFilters((f) => (f.search === search ? f : { ...f, search })); }, 350);
    return () => clearTimeout(t);
  }, [search]);
  useSocketEvent("social:comment", load);

  if (!data) return <PageLoader />;
  // Thread the page: replies under the comment they answer
  const byExternal = new Map(data.items.map((c) => [c.externalId, c]));
  const replies = {};
  const top = [];
  for (const c of [...data.items].reverse()) {
    if (c.parentExternalId && byExternal.has(c.parentExternalId)) (replies[c.parentExternalId] ||= []).push(c);
    else top.unshift(c);
  }
  const setFilter = (patch) => { setPage(1); setFilters({ ...filters, ...patch }); };
  const markAll = async () => {
    setMarking(true);
    try {
      await api("/social/comments/read", { method: "POST", body: { all: true } });
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
        actions={data.unread > 0 && <Button variant="secondary" onClick={markAll} loading={marking}><CheckCheck className="h-4 w-4" /> Mark all read ({data.unread})</Button>}
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
      {postId && (
        <p className="mb-3 flex items-center gap-2 text-sm text-slate-600">
          Showing one post&apos;s comments. <Link href="/app/social/comments" className="text-brand-700 hover:underline">Show all</Link>
        </p>
      )}
      {!top.length ? (
        <EmptyState icon={MessageSquareText} title={filters.unread ? "No unread comments" : "No comments yet"} description="Comments on posts made from the CRM (and other posts on your Page / Instagram) appear here as they come." />
      ) : (
        <div className="space-y-2">
          {top.map((c) => <CommentRow key={c._id} c={c} replies={replies[c.externalId] || []} isAdmin={isAdmin} now={now} onChanged={load} />)}
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
