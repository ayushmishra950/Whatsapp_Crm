"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Copy, Unplug } from "lucide-react";
import { api, API_URL } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useToast } from "./toast";
import { Avatar, Badge, Button, ConfirmModal, Field, Input } from "./ui";
import { ChannelBadge } from "./channel";

/**
 * Settings → Facebook Page: connect (Facebook login), pick the Page when the admin manages several,
 * disconnect. Used for posting on the Page and answering its comments.
 */
export function FacebookSettings({ fb, igCanPost, isAdmin, onChanged }) {
  const toast = useToast();
  const [busy, setBusy] = useState("");
  const [pages, setPages] = useState(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const live = fb.mode === "live" && !!fb.pageId;

  // Back from Facebook's login page: …/settings?facebook=connected|choose|error&reason=…#facebook
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const result = q.get("facebook");
    if (!result) return;
    if (result === "connected") toast.success(`Facebook Page connected${q.get("page") ? `: ${q.get("page")}` : ""}`);
    else if (result === "choose") toast.success("Choose the Page to connect");
    else toast.error(q.get("reason") || "Facebook was not connected");
    window.history.replaceState(null, "", `${window.location.pathname}#facebook`);
    document.getElementById("facebook")?.scrollIntoView({ behavior: "smooth" });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (isAdmin && fb.choosing && !live) api("/settings/facebook/pages").then(setPages).catch(() => setPages([]));
  }, [isAdmin, fb.choosing, live]);

  const run = async (key, fn, msg) => {
    setBusy(key);
    try {
      await fn();
      if (msg) toast.success(msg);
      await onChanged?.();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy("");
    }
  };
  const connect = () =>
    run("connect", async () => {
      const { url } = await api("/facebook/connect-url");
      window.location.assign(url); // Facebook's own login page; it comes back to Settings
    });
  const webhookUrl = fb.webhook ? `${API_URL}${fb.webhook.path}` : "";
  const copy = (text) => navigator.clipboard.writeText(text).then(() => toast.success("Copied")).catch(() => {});

  if (!fb.inPlan) return <p className="text-sm text-slate-600">Facebook / Instagram posts are not part of your plan. Ask the platform administrator to add them.</p>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <ChannelBadge channel="facebook" full />
        {live ? (
          <>
            <Badge tone="green">Connected</Badge>
            {fb.pagePicture ? <img src={fb.pagePicture} alt="" className="h-6 w-6 rounded-full" /> : null}
            <span className="text-sm font-medium text-slate-800">{fb.pageName}</span>
            {fb.connectedAt && <span className="text-xs text-slate-500">since {fmtDate(fb.connectedAt)}</span>}
          </>
        ) : (
          <Badge tone="yellow">Not connected · sandbox</Badge>
        )}
      </div>
      {fb.tokenError && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{fb.tokenError}</p>}
      {!igCanPost && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Instagram was connected before posting was added. Disconnect and connect Instagram again (section above) and allow the new permissions, so you can post and answer comments on Instagram too.
        </p>
      )}

      {isAdmin && !live && pages?.length > 0 && (
        <div className="space-y-2 rounded-md border border-blue-200 bg-blue-50 p-3">
          <p className="text-sm font-medium text-blue-950">Which Page should this business use?</p>
          {pages.map((p) => (
            <div key={p.id} className="flex items-center gap-3 rounded-md bg-white px-3 py-2">
              {p.picture ? <img src={p.picture} alt="" className="h-8 w-8 rounded-full" /> : <Avatar name={p.name} className="h-8 w-8" />}
              <span className="flex-1 text-sm font-medium">{p.name}</span>
              <Button size="sm" loading={busy === p.id} disabled={!!busy} onClick={() => run(p.id, () => api("/settings/facebook/page", { method: "POST", body: { pageId: p.id } }), `${p.name} connected`)}>Use this Page</Button>
            </div>
          ))}
        </div>
      )}

      {isAdmin && !live && (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm text-blue-950">
          <p className="font-semibold">Before you click “Connect Facebook Page”</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            <li>Log in with the Facebook profile that is an <b>admin of the business&apos;s Page</b>.</li>
            <li>When Facebook asks, tick the Page (and allow all permissions). If you tick several Pages, you choose one here after.</li>
          </ul>
        </div>
      )}

      {isAdmin && (
        <div className="flex flex-wrap items-center gap-2">
          {!live ? (
            <Button onClick={connect} loading={busy === "connect"} disabled={!fb.canConnect} title={fb.canConnect ? "Log in with Facebook and pick the Page" : "Fill FB_APP_ID and FB_REDIRECT_URL in the server's .env first"}>
              Connect Facebook Page
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => setDisconnecting(true)}><Unplug className="h-4 w-4" /> Disconnect</Button>
          )}
          {!fb.canConnect && !live && <p className="text-xs text-slate-500">Connecting needs the Meta App keys in the server&apos;s .env (FB_APP_ID, FB_LOGIN_CONFIG_ID, FB_REDIRECT_URL). Sandbox posts work now.</p>}
          <Link href="/app/social" className="text-sm text-brand-700 hover:underline">Go to posts →</Link>
        </div>
      )}

      {isAdmin && webhookUrl && (
        <details className="rounded-md bg-slate-50 p-3 text-sm">
          <summary className="cursor-pointer font-medium text-slate-700">Page webhook for the Meta App (one time, by the platform owner)</summary>
          <div className="mt-2 space-y-2">
            <Field label="Callback URL">
              <div className="flex gap-2"><Input readOnly value={webhookUrl} /><Button type="button" variant="secondary" onClick={() => copy(webhookUrl)}><Copy className="h-4 w-4" /></Button></div>
            </Field>
            <Field label="Verify token">
              <div className="flex gap-2"><Input readOnly value={fb.webhook.verifyToken || ""} /><Button type="button" variant="secondary" onClick={() => copy(fb.webhook.verifyToken)}><Copy className="h-4 w-4" /></Button></div>
            </Field>
            <p className="text-xs text-slate-500">Meta App → Webhooks → Page → subscribe to the field: feed.</p>
          </div>
        </details>
      )}

      <ConfirmModal
        open={disconnecting}
        onClose={() => setDisconnecting(false)}
        danger
        loading={busy === "disconnect"}
        title="Disconnect the Facebook Page?"
        confirmText="Disconnect"
        message="Posting on the Page and new Page comments stop. Posts and comments already here stay."
        onConfirm={() => run("disconnect", () => api("/settings/facebook", { method: "DELETE" }), "Facebook Page disconnected").then(() => setDisconnecting(false))}
      />
    </div>
  );
}
