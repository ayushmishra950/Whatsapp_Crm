"use client";

import { useEffect, useState } from "react";
import { Copy, Send, Unplug } from "lucide-react";
import { api, API_URL } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useToast } from "./toast";
import { Badge, Button, ConfirmModal, Field, Input } from "./ui";
import { ChannelBadge } from "./channel";

/**
 * Settings → Instagram: connection status, connect / disconnect (admin), and a sandbox that pretends
 * a customer sent an Instagram DM (until a real account is connected).
 */
export function InstagramSettings({ ig, isAdmin, onChanged }) {
  const toast = useToast();
  const [busy, setBusy] = useState("");
  const [sandbox, setSandbox] = useState({ username: "priya.learns", name: "Priya", text: "Hi! Digital marketing course ki details bhejo" });
  const [disconnecting, setDisconnecting] = useState(false);
  const live = ig.mode === "live";
  // Back from Instagram's login page: …/settings?instagram=connected|error&reason=…#instagram
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const result = q.get("instagram");
    if (!result) return;
    if (result === "connected") toast.success(`Instagram connected${q.get("username") ? `: @${q.get("username")}` : ""}`);
    else toast.error(q.get("reason") || "Instagram was not connected");
    window.history.replaceState(null, "", `${window.location.pathname}#instagram`);
    document.getElementById("instagram")?.scrollIntoView({ behavior: "smooth" });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const webhookUrl = ig.webhook ? `${API_URL}${ig.webhook.path}` : "";

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
  // switchAccount: Instagram always asks to log in (another, e.g. personal, account is logged in on this browser)
  const connect = (switchAccount = false) =>
    run(switchAccount ? "switch" : "connect", async () => {
      const { url } = await api("/instagram/connect-url", { query: switchAccount ? { switch: "1" } : {} });
      window.location.assign(url); // Instagram's own login page; it comes back to Settings
    });
  const copy = (text) => navigator.clipboard.writeText(text).then(() => toast.success("Copied")).catch(() => {});

  if (!ig.inPlan) {
    return <p className="text-sm text-slate-600">Instagram is not part of your plan. Ask the platform administrator to add it.</p>;
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <ChannelBadge channel="instagram" full />
        {live ? (
          <>
            <Badge tone="green">Connected</Badge>
            <span className="text-sm text-slate-700">@{ig.username}</span>
            {ig.connectedAt && <span className="text-xs text-slate-500">since {fmtDate(ig.connectedAt)}</span>}
          </>
        ) : (
          <Badge tone="yellow">Not connected · sandbox</Badge>
        )}
      </div>

      {!ig.ready && isAdmin && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          The database update for Instagram has not run on this server yet. Take a backup, set <code>CHANNEL_MIGRATION=run</code> in the server&apos;s .env and restart. WhatsApp keeps working meanwhile.
        </p>
      )}
      {ig.tokenError && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{ig.tokenError}</p>}
      {live && ig.tokenExpiresAt && <p className="text-xs text-slate-500">The connection renews itself before {fmtDate(ig.tokenExpiresAt)}.</p>}

      {isAdmin && !live && (
        <div className="rounded-md border border-pink-200 bg-pink-50 px-3 py-2.5 text-sm text-pink-950">
          <p className="font-semibold">Before you click “Connect Instagram”</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            <li>Your Instagram must be a <b>Business account</b> (a personal account can not be connected).</li>
            <li>To check or switch: Instagram app → Profile → ☰ → <b>Account type and tools</b> → <b>Switch to professional account</b> → <b>Business</b>.</li>
            <li>Log in with that business account when Instagram asks. If another account is logged in on this browser, use “Use a different Instagram account”.</li>
          </ul>
        </div>
      )}

      {isAdmin && (
        <div className="flex flex-wrap gap-2">
          {!live ? (
            <>
              <Button onClick={() => connect()} loading={busy === "connect"} disabled={!ig.canConnect || !ig.ready} title={ig.canConnect ? "Log in with the business's Instagram account" : "Fill IG_APP_ID and IG_REDIRECT_URL in the server's .env first"}>
                Connect Instagram
              </Button>
              {ig.canConnect && ig.ready && (
                <button type="button" onClick={() => connect(true)} disabled={!!busy} className="self-center text-xs text-slate-500 underline hover:text-slate-800" title="Instagram asks you to log in, so you can pick the business account">
                  {busy === "switch" ? "Opening Instagram…" : "Use a different Instagram account"}
                </button>
              )}
            </>
          ) : (
            <Button variant="secondary" onClick={() => setDisconnecting(true)}><Unplug className="h-4 w-4" /> Disconnect</Button>
          )}
          {!ig.canConnect && !live && <p className="self-center text-xs text-slate-500">Connecting needs the Meta App keys in the server&apos;s .env (IG_APP_ID, IG_REDIRECT_URL) and Meta&apos;s approval. The sandbox below works now.</p>}
        </div>
      )}

      {isAdmin && webhookUrl && (
        <details className="rounded-md bg-slate-50 p-3 text-sm">
          <summary className="cursor-pointer font-medium text-slate-700">Webhook for the Meta App (one time, by the platform owner)</summary>
          <div className="mt-2 space-y-2">
            <Field label="Callback URL">
              <div className="flex gap-2"><Input readOnly value={webhookUrl} /><Button type="button" variant="secondary" onClick={() => copy(webhookUrl)}><Copy className="h-4 w-4" /></Button></div>
            </Field>
            <Field label="Verify token">
              <div className="flex gap-2"><Input readOnly value={ig.webhook.verifyToken} /><Button type="button" variant="secondary" onClick={() => copy(ig.webhook.verifyToken)}><Copy className="h-4 w-4" /></Button></div>
            </Field>
            <p className="text-xs text-slate-500">Fields to subscribe: messages, messaging_postbacks, messaging_seen, message_reactions, messaging_referral.</p>
          </div>
        </details>
      )}

      {!live && ig.ready && (
        <form
          className="space-y-3 rounded-md border border-dashed border-pink-200 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            run("sandbox", () => api("/sandbox/instagram", { method: "POST", body: sandbox }), "Instagram message received — check the Inbox");
          }}
        >
          <p className="text-sm font-medium text-slate-700">Sandbox: pretend a customer sent an Instagram DM</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Instagram username"><Input id="ig-sandbox-username" value={sandbox.username} onChange={(e) => setSandbox({ ...sandbox, username: e.target.value.replace(/^@/, "") })} /></Field>
            <Field label="Name (optional)"><Input id="ig-sandbox-name" value={sandbox.name} onChange={(e) => setSandbox({ ...sandbox, name: e.target.value })} /></Field>
          </div>
          <Field label="Message"><Input id="ig-sandbox-text" value={sandbox.text} onChange={(e) => setSandbox({ ...sandbox, text: e.target.value })} /></Field>
          <Button type="submit" variant="secondary" loading={busy === "sandbox"}><Send className="h-4 w-4" /> Simulate Instagram DM</Button>
        </form>
      )}

      <ConfirmModal
        open={disconnecting}
        onClose={() => setDisconnecting(false)}
        danger
        loading={busy === "disconnect"}
        title="Disconnect Instagram?"
        confirmText="Disconnect"
        message="New Instagram DMs stop coming in and replies can not be sent. Chats and leads already here stay."
        onConfirm={() => run("disconnect", () => api("/settings/instagram", { method: "DELETE" }), "Instagram disconnected").then(() => setDisconnecting(false))}
      />
    </div>
  );
}
