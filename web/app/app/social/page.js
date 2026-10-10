"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CalendarClock, ExternalLink, FlaskConical, ImagePlus, MessageSquareText, RotateCcw, Send, Share2, Trash2, X } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { useSocketEvent } from "@/lib/socket";
import { useToast } from "@/components/toast";
import { PageContainer } from "@/components/shell";
import { ChannelBadge } from "@/components/channel";
import { PLATFORM_LABEL, PostStatusBadge, TargetBadge, mediaUrl } from "@/components/social";
import { Badge, Button, Card, ConfirmModal, EmptyState, Field, Input, Modal, PageHeader, PageLoader, Pagination, Textarea } from "@/components/ui";

const MB = 1024 * 1024;
const emptyForm = { text: "", link: "", platforms: { facebook: true, instagram: true }, schedule: false, scheduledAt: "" };

/** What blocks posting with the chosen platforms + files (same rules as the server, so the admin sees them before sending) */
function problems(form, files, status) {
  const out = [];
  const chosen = Object.keys(form.platforms).filter((p) => form.platforms[p]);
  if (!chosen.length) out.push("Choose Facebook, Instagram or both.");
  const photos = files.filter((f) => f.type.startsWith("image/"));
  const videos = files.filter((f) => f.type.startsWith("video/"));
  if (files.length !== photos.length + videos.length) out.push("Only photos and videos can be posted.");
  if (videos.length > 1 || (videos.length && photos.length)) out.push("Post either photos (up to 10) or one video.");
  if (!form.text.trim() && !files.length && !form.link) out.push("Write something or add a photo / video.");
  for (const p of chosen) {
    const st = status?.[p];
    if (st && st.mode === "live" && !st.connected) out.push(`${PLATFORM_LABEL[p]} is not connected (Settings).`);
    if (st && !st.igScopesOk) out.push("Connect Instagram again in Settings to allow posting.");
  }
  if (form.platforms.instagram) {
    if (!files.length) out.push("Instagram needs a photo or a video (text-only posts are not possible on Instagram).");
    if (form.text.length > 2200) out.push("Instagram captions can be up to 2,200 characters.");
    for (const f of photos) if (f.size > 8 * MB) out.push(`${f.name}: Instagram photos can be up to 8 MB.`);
    for (const f of videos) if (!/video\/(mp4|quicktime)/.test(f.type)) out.push(`${f.name}: Instagram needs MP4 or MOV videos.`);
  }
  if (form.platforms.facebook) for (const f of photos) if (f.size > 10 * MB) out.push(`${f.name}: Facebook photos can be up to 10 MB.`);
  if (form.schedule && !form.scheduledAt) out.push("Pick the date and time to post.");
  return [...new Set(out)];
}

function Composer({ status, onPosted }) {
  const toast = useToast();
  const fileRef = useRef(null);
  const [form, setForm] = useState(emptyForm);
  const [picked, setPicked] = useState([]); // [{ file, preview }]
  const [busy, setBusy] = useState(false);
  const files = picked.map((p) => p.file);
  const issues = problems(form, files, status);

  const addFiles = (list) => {
    const added = Array.from(list || []).slice(0, 10 - picked.length).map((file) => ({ file, preview: URL.createObjectURL(file) }));
    if (picked.length + (list?.length || 0) > 10) toast.error("Up to 10 photos per post");
    setPicked([...picked, ...added]);
  };
  const removeFile = (i) => {
    URL.revokeObjectURL(picked[i].preview);
    setPicked(picked.filter((_, j) => j !== i));
  };
  const submit = async () => {
    if (issues.length) return toast.error(issues[0]);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("text", form.text);
      fd.append("link", form.link.trim());
      fd.append("platforms", Object.keys(form.platforms).filter((p) => form.platforms[p]).join(","));
      if (form.schedule) fd.append("scheduledAt", new Date(form.scheduledAt).toISOString());
      for (const f of files) fd.append("files", f, f.name);
      const post = await api("/social/posts", { method: "POST", form: fd });
      toast.success(post.status === "scheduled" && form.schedule ? `Scheduled for ${fmtDateTime(post.scheduledAt)}` : "Posting now — status updates below");
      setForm(emptyForm);
      picked.forEach((p) => URL.revokeObjectURL(p.preview));
      setPicked([]);
      onPosted();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-slate-700">Post on</span>
        {["facebook", "instagram"].map((p) => {
          const st = status?.[p];
          return (
            <label key={p} className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50">
              <input type="checkbox" checked={form.platforms[p]} onChange={(e) => setForm({ ...form, platforms: { ...form.platforms, [p]: e.target.checked } })} />
              <ChannelBadge channel={p} full />
              {st && !st.live && <span className="text-xs text-amber-700">{st.mode === "live" ? "not connected" : "sandbox"}</span>}
            </label>
          );
        })}
      </div>
      <Field label="Text / caption" hint={form.platforms.instagram ? `${form.text.length} / 2200 (Instagram limit). Links in Instagram captions are not clickable.` : undefined}>
        <Textarea id="social-text" rows={4} value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} placeholder="New batch starts Monday! Message us on WhatsApp for details…" />
      </Field>
      {form.platforms.facebook && (
        <Field label="Link (optional, Facebook only)" hint="Shown as a link preview when the post has no photo / video.">
          <Input id="social-link" type="url" value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} placeholder="https://…" />
        </Field>
      )}

      <div>
        <input ref={fileRef} type="file" multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
        <div className="flex flex-wrap gap-2">
          {picked.map(({ file: f, preview }, i) => (
            <div key={preview} className="relative h-20 w-20 overflow-hidden rounded-md border border-slate-200 bg-slate-50">
              {f.type.startsWith("video/") ? <video src={preview} className="h-full w-full object-cover" muted /> : <img src={preview} alt="" className="h-full w-full object-cover" />}
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => removeFile(i)} className="absolute top-0.5 right-0.5 rounded-full bg-slate-900/70 p-0.5 text-white hover:bg-slate-900">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {files.length < 10 && (
            <button type="button" onClick={() => fileRef.current?.click()} className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-slate-300 text-xs text-slate-500 hover:bg-slate-50">
              <ImagePlus className="h-5 w-5" /> Photo / video
            </button>
          )}
        </div>
        <p className="mt-1 text-xs text-slate-500">Up to 10 photos (JPG / PNG) or 1 video (MP4). Instagram shows several photos as a carousel and a video as a Reel.</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={form.schedule} onChange={(e) => setForm({ ...form, schedule: e.target.checked })} />
          Schedule for later
        </label>
        {form.schedule && <Input id="social-when" type="datetime-local" className="w-auto" value={form.scheduledAt} onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })} />}
      </div>

      {issues.length > 0 && (form.text || files.length || form.link) && (
        <ul className="list-disc space-y-0.5 rounded-md bg-amber-50 py-2 pr-3 pl-7 text-sm text-amber-900">
          {issues.map((i) => <li key={i}>{i}</li>)}
        </ul>
      )}
      <div className="flex justify-end">
        <Button onClick={submit} loading={busy} disabled={busy || issues.length > 0}>
          {form.schedule ? <CalendarClock className="h-4 w-4" /> : <Send className="h-4 w-4" />} {form.schedule ? "Schedule post" : "Post now"}
        </Button>
      </div>
    </Card>
  );
}

function PostCard({ post, isAdmin, sandbox, onChanged, onSandbox }) {
  const toast = useToast();
  const [busy, setBusy] = useState("");
  const [confirm, setConfirm] = useState(false);
  const failed = post.targets.some((t) => t.status === "failed");
  const run = async (key, fn) => {
    setBusy(key);
    try {
      await fn();
      onChanged();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy("");
    }
  };
  const first = post.media?.[0];

  return (
    <Card className="flex gap-3 p-3">
      <div className="h-20 w-20 shrink-0 overflow-hidden rounded-md bg-slate-100">
        {first ? (
          first.type === "video" ? <video src={mediaUrl(first.url)} className="h-full w-full object-cover" muted /> : <img src={mediaUrl(first.url)} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-slate-400"><Share2 className="h-6 w-6" /></div>
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <PostStatusBadge status={post.status} />
          <span className="text-xs text-slate-500">
            {post.status === "scheduled" ? "Goes out " : ""}{fmtDateTime(post.scheduledAt)}{post.createdBy?.name ? ` · by ${post.createdBy.name}` : ""}
          </span>
          {post.media?.length > 1 && <Badge>{post.media.length} photos</Badge>}
        </div>
        <p className="line-clamp-2 text-sm whitespace-pre-line text-slate-800">{post.text || <span className="text-slate-400">(no text)</span>}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {post.targets.map((t) => (
            <div key={t.platform} className="flex items-center gap-1.5 text-xs">
              <ChannelBadge channel={t.platform} />
              <TargetBadge status={t.status} />
              {t.permalink && (
                <a href={t.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-brand-700 hover:underline">
                  Open <ExternalLink className="h-3 w-3" />
                </a>
              )}
              {t.error && <span className="text-red-700" title={t.error}>{t.error.slice(0, 80)}</span>}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {post.commentCount > 0 && (
            <Link href={`/app/social/comments?post=${post._id}`} className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline">
              <MessageSquareText className="h-3.5 w-3.5" /> {post.commentCount} comment{post.commentCount > 1 ? "s" : ""}
              {post.unreadComments > 0 && <Badge tone="red">{post.unreadComments} new</Badge>}
            </Link>
          )}
          {isAdmin && failed && post.status !== "publishing" && (
            <Button size="sm" variant="secondary" loading={busy === "retry"} onClick={() => run("retry", () => api(`/social/posts/${post._id}/retry`, { method: "POST" }).then(() => toast.success("Trying again")))}>
              <RotateCcw className="h-3.5 w-3.5" /> Retry failed
            </Button>
          )}
          {sandbox && post.targets.some((t) => t.status === "posted") && (
            <Button size="sm" variant="secondary" onClick={() => onSandbox(post)}><FlaskConical className="h-3.5 w-3.5" /> Test comment</Button>
          )}
          {isAdmin && post.status !== "publishing" && (
            <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>
              <Trash2 className="h-3.5 w-3.5" /> {post.status === "scheduled" ? "Cancel" : "Delete"}
            </Button>
          )}
        </div>
      </div>
      <ConfirmModal
        open={confirm}
        onClose={() => setConfirm(false)}
        danger
        loading={busy === "delete"}
        title={post.status === "scheduled" ? "Cancel this scheduled post?" : "Delete this post?"}
        confirmText={post.status === "scheduled" ? "Cancel post" : "Delete"}
        message={
          post.status === "scheduled"
            ? "It will not be posted."
            : "The Facebook post is removed from your Page. Instagram does not allow deleting from other apps: delete it in the Instagram app."
        }
        onConfirm={() =>
          run("delete", async () => {
            const r = await api(`/social/posts/${post._id}`, { method: "DELETE" });
            toast.success(r.cancelled ? "Scheduled post cancelled" : r.note || "Post deleted");
            setConfirm(false);
          })
        }
      />
    </Card>
  );
}

/** Facebook Page / Instagram posts: write once, post on both (now or later), see status, comments and links */
export default function SocialPage() {
  const toast = useToast();
  const { session } = useAuth();
  const isAdmin = session.user.role === "admin";
  const [status, setStatus] = useState(null);
  const [posts, setPosts] = useState(null);
  const [page, setPage] = useState(1);
  const [sandbox, setSandbox] = useState(null); // { post, platform, name, text }
  const [sending, setSending] = useState(false);

  const load = (p = page) => api("/social/posts", { query: { page: p } }).then(setPosts).catch(toast.error);
  useEffect(() => {
    api("/social/status").then(setStatus).catch(toast.error);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(page); }, [page]); // eslint-disable-line react-hooks/exhaustive-deps
  useSocketEvent("social:post", () => load());
  useSocketEvent("social:comment", () => load());

  // While something is being posted, check again every few seconds (Instagram videos take a while)
  const busyPosts = posts?.items.some((p) => p.status === "publishing" || (p.status === "scheduled" && new Date(p.scheduledAt) <= new Date()));
  useEffect(() => {
    if (!busyPosts) return;
    const t = setInterval(() => load(), 5000);
    return () => clearInterval(t);
  }, [busyPosts]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!status || !posts) return <PageLoader />;
  const anySandbox = Object.values(status).some((s) => !s.live);
  const sendSandbox = async () => {
    setSending(true);
    try {
      await api("/social/sandbox/comment", { method: "POST", body: { platform: sandbox.platform, postId: sandbox.post._id, name: sandbox.name, text: sandbox.text } });
      toast.success("Comment added — see Comments");
      setSandbox(null);
      load();
    } catch (err) {
      toast.error(err);
    } finally {
      setSending(false);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title="Facebook / Instagram posts"
        description="Write once and post on your Facebook Page and Instagram, now or later. Comments on these posts come into Comments."
        actions={<Link href="/app/social/comments"><Button variant="secondary"><MessageSquareText className="h-4 w-4" /> Comments</Button></Link>}
      />
      <div className="space-y-5">
        {anySandbox && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {Object.entries(status).filter(([, s]) => !s.live).map(([p]) => PLATFORM_LABEL[p]).join(" and ")} {Object.values(status).filter((s) => !s.live).length > 1 ? "are" : "is"} not connected, so posts there are only pretend (sandbox).{" "}
            {isAdmin && <Link href="/app/settings#facebook" className="font-medium underline">Connect in Settings</Link>}
          </p>
        )}
        {isAdmin && <Composer status={status} onPosted={() => load(1)} />}
        {!posts.items.length ? (
          <EmptyState icon={Share2} title="No posts yet" description={isAdmin ? "Write your first post above." : "Posts made by your admin show up here."} />
        ) : (
          <div className="space-y-3">
            {posts.items.map((p) => (
              <PostCard
                key={p._id}
                post={p}
                isAdmin={isAdmin}
                sandbox={p.targets.some((t) => !status[t.platform]?.live)}
                onChanged={() => load()}
                onSandbox={(post) => {
                  const platform = post.targets.find((t) => t.status === "posted" && !status[t.platform]?.live)?.platform || "facebook";
                  setSandbox({ post, platform, name: "Rahul Sharma", text: "Fees kitni hai? Details bhejo" });
                }}
              />
            ))}
            <Pagination page={page} limit={20} total={posts.total} onChange={setPage} />
          </div>
        )}
      </div>

      <Modal
        open={!!sandbox}
        onClose={() => setSandbox(null)}
        title="Sandbox: pretend someone commented"
        footer={<><Button variant="secondary" onClick={() => setSandbox(null)}>Close</Button><Button onClick={sendSandbox} loading={sending}>Add comment</Button></>}
      >
        {sandbox && (
          <div className="space-y-3">
            <Field label="On">
              <div className="flex gap-2">
                {sandbox.post.targets.filter((t) => t.status === "posted" && !status[t.platform]?.live).map((t) => (
                  <label key={t.platform} className="flex items-center gap-1.5 text-sm">
                    <input type="radio" checked={sandbox.platform === t.platform} onChange={() => setSandbox({ ...sandbox, platform: t.platform })} /> {PLATFORM_LABEL[t.platform]}
                  </label>
                ))}
              </div>
            </Field>
            <Field label="Name"><Input id="sb-name" value={sandbox.name} onChange={(e) => setSandbox({ ...sandbox, name: e.target.value })} /></Field>
            <Field label="Comment"><Input id="sb-text" value={sandbox.text} onChange={(e) => setSandbox({ ...sandbox, text: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
    </PageContainer>
  );
}
