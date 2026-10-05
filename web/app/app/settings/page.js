"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, FlaskConical, Link2, Unplug, Send } from "lucide-react";
import { api, API_URL } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDate, fmtNum, fmtPhone } from "@/lib/format";
import { useToast } from "@/components/toast";
import { PageContainer } from "@/components/shell";
import {
  Badge, Button, Card, ConfirmModal, Field, Input, PageHeader, PageLoader, PasswordInput, StatusBadge, Toggle,
} from "@/components/ui";

function Section({ title, description, children }) {
  return (
    <Card className="p-5">
      <h2 className="font-medium text-slate-900">{title}</h2>
      {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      <div className="mt-4">{children}</div>
    </Card>
  );
}

export default function SettingsPage() {
  const toast = useToast();
  const { session, refresh } = useAuth();
  const isAdmin = session.user.role === "admin";
  const [s, setS] = useState(null);
  const [wa, setWa] = useState({ phoneNumberId: "", wabaId: "", accessToken: "" });
  const [keywords, setKeywords] = useState("");
  const [busy, setBusy] = useState("");
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [sandbox, setSandbox] = useState({ phone: "919811112222", name: "Test Customer", text: "Hi, I want to know the price" });
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "" });

  const load = () =>
    api("/settings").then((data) => {
      setS(data);
      setKeywords(data.settings.optOutKeywords.join(", "));
    }).catch(toast.error);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (key, fn, msg) => {
    setBusy(key);
    try {
      await fn();
      if (msg) toast.success(msg);
      await Promise.all([load(), refresh()]);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy("");
    }
  };

  const updateSetting = (patch) => run("settings", () => api("/settings", { method: "PATCH", body: { settings: patch } }), "Settings saved");

  if (!s) return <PageLoader />;
  const live = s.whatsapp.mode === "live";
  const webhookUrl = `${API_URL}${s.webhook.path}`;

  return (
    <PageContainer>
      <PageHeader title="Settings" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="WhatsApp number" description="Each business connects one WhatsApp Business number using the official Cloud API.">
          <div className="mb-4 flex items-center gap-2">
            {live ? <Badge tone="green"><CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Live</Badge> : <Badge tone="yellow"><FlaskConical className="mr-1 h-3.5 w-3.5" /> Sandbox</Badge>}
            {live && <span className="text-sm text-slate-700">{fmtPhone(s.whatsapp.displayPhoneNumber)} · since {fmtDate(s.whatsapp.connectedAt)}</span>}
          </div>
          {isAdmin && !live && (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                run("wa", () => api("/settings/whatsapp", { method: "PUT", body: wa }), "WhatsApp number connected");
              }}
            >
              <Field label="Phone number ID"><Input required value={wa.phoneNumberId} onChange={(e) => setWa({ ...wa, phoneNumberId: e.target.value })} /></Field>
              <Field label="WhatsApp Business Account ID"><Input required value={wa.wabaId} onChange={(e) => setWa({ ...wa, wabaId: e.target.value })} /></Field>
              <Field label="Permanent access token" hint="Stored encrypted. Create a System User token in Meta Business Settings.">
                <PasswordInput required value={wa.accessToken} onChange={(e) => setWa({ ...wa, accessToken: e.target.value })} />
              </Field>
              <Button type="submit" loading={busy === "wa"}><Link2 className="h-4 w-4" /> Connect number</Button>
            </form>
          )}
          {isAdmin && live && (
            <Button variant="secondary" onClick={() => setConfirmDisconnect(true)}><Unplug className="h-4 w-4" /> Disconnect</Button>
          )}
          {isAdmin && (
            <div className="mt-5 space-y-1 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
              <p className="font-medium text-slate-700">Webhook (set once in your Meta App)</p>
              <p>Callback URL: <code className="break-all">{webhookUrl}</code></p>
              <p>Verify token: <code>{s.webhook.verifyToken}</code></p>
              <p>Subscribe to fields: <code>messages</code>, <code>message_template_status_update</code></p>
            </div>
          )}
        </Section>

        <Section title="Plan & usage">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Plan</dt><dd className="font-medium">{s.plan?.name} (₹{s.plan?.priceMonthly}/month)</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Subscription</dt><dd><StatusBadge status={s.subscriptionActive ? s.subscription.status : "expired"} /></dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Valid till</dt><dd>{fmtDate(s.subscription.currentPeriodEnd)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Agents</dt><dd>{s.usage.agents} / {s.plan?.limits.agents}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Contacts</dt><dd>{fmtNum(s.usage.contacts)} / {fmtNum(s.plan?.limits.contacts)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Messages this month</dt><dd>{fmtNum(s.usage.messagesThisMonth)} / {fmtNum(s.plan?.limits.monthlyMessages)}</dd></div>
          </dl>
          <p className="mt-4 text-xs text-slate-500">To upgrade or renew, contact the platform administrator.</p>
        </Section>

        {isAdmin && (
          <Section title="Automation & permissions">
            <div className="space-y-5">
              <Toggle checked={s.settings.autoAssign} onChange={(v) => updateSetting({ autoAssign: v })} label="Auto-assign new chats" description="New customer chats are given to agents one by one (round-robin)." />
              <Toggle checked={s.settings.agentsCanBroadcast} onChange={(v) => updateSetting({ agentsCanBroadcast: v })} label="Agents can send bulk campaigns" description="By default only the admin can send bulk messages." />
              <form
                className="flex items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  updateSetting({ optOutKeywords: keywords.split(",").map((k) => k.trim()).filter(Boolean) });
                }}
              >
                <Field label="Opt-out keywords" hint="If a customer sends one of these, they are removed from bulk campaigns. Sending START opts them back in." className="flex-1">
                  <Input value={keywords} onChange={(e) => setKeywords(e.target.value)} />
                </Field>
                <Button type="submit" variant="secondary" loading={busy === "settings"} className="mb-5">Save</Button>
              </form>
            </div>
          </Section>
        )}

        {!live && (
          <Section title="Sandbox: simulate a customer message" description="Test the inbox without a real number. This pretends a customer sent you a WhatsApp message.">
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                run("sandbox", () => api("/sandbox/inbound", { method: "POST", body: sandbox }), "Message received — check the Inbox");
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Customer phone"><Input value={sandbox.phone} onChange={(e) => setSandbox({ ...sandbox, phone: e.target.value })} /></Field>
                <Field label="Customer name"><Input value={sandbox.name} onChange={(e) => setSandbox({ ...sandbox, name: e.target.value })} /></Field>
              </div>
              <Field label="Message"><Input value={sandbox.text} onChange={(e) => setSandbox({ ...sandbox, text: e.target.value })} /></Field>
              <Button type="submit" variant="secondary" loading={busy === "sandbox"}><Send className="h-4 w-4" /> Simulate incoming message</Button>
            </form>
          </Section>
        )}

        <Section title="Change password">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              run("pw", () => api("/auth/change-password", { method: "POST", body: pw }), "Password changed").then(() => setPw({ currentPassword: "", newPassword: "" }));
            }}
          >
            <Field label="Current password"><PasswordInput required value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></Field>
            <Field label="New password" hint="Min 8 characters"><PasswordInput required minLength={8} value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /></Field>
            <Button type="submit" variant="secondary" loading={busy === "pw"} disabled={session.impersonating}>Update password</Button>
          </form>
        </Section>
      </div>

      <ConfirmModal
        open={confirmDisconnect}
        onClose={() => setConfirmDisconnect(false)}
        onConfirm={() => run("wa", () => api("/settings/whatsapp", { method: "DELETE" }), "Disconnected").then(() => setConfirmDisconnect(false))}
        danger
        loading={busy === "wa"}
        title="Disconnect WhatsApp?"
        confirmText="Disconnect"
        message="Messages will stop going to real customers and the account returns to sandbox mode."
      />
    </PageContainer>
  );
}
