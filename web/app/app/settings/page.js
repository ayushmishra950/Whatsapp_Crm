"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, FlaskConical, Link2, Unplug, Send, Plus, Trash2, ArrowUp, ArrowDown, Lock } from "lucide-react";
import { STATUS_COLORS } from "@/lib/lead-statuses";
import { api, API_URL } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDate, fmtNum, fmtPhone } from "@/lib/format";
import { useToast } from "@/components/toast";
import { PageContainer } from "@/components/shell";
import {
  Badge, Button, Card, ConfirmModal, Field, Input, PageHeader, PageLoader, PasswordInput, Select, StatusBadge, Toggle,
} from "@/components/ui";

const COLOR_NAMES = { gray: "Gray", blue: "Blue", green: "Green", yellow: "Yellow", red: "Red", purple: "Purple" };

/**
 * Admin manages contact fields (Course, City, Fees...). Built-in fields are fixed. Custom fields can be used
 * in template variables, bulk campaigns and chatbot lead questions, and are filled per contact.
 */
function ContactFieldsEditor({ onSaved }) {
  const toast = useToast();
  const [info, setInfo] = useState(null); // { builtin, fields: [{key,label,contacts}], discovered }
  const [rows, setRows] = useState([]);
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(null); // fields about to be removed

  const load = () =>
    api("/settings/contact-fields")
      .then((r) => {
        setInfo(r);
        setRows(r.fields.map(({ key, label, type }) => ({ key, label, type: type || "text" })));
      })
      .catch(toast.error);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!info) return <p className="text-sm text-slate-500">Loading…</p>;
  const removed = info.fields.filter((f) => !rows.some((r) => r.key === f.key));
  const setRow = (i, patch) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const save = async () => {
    setSaving(true);
    try {
      const res = await api("/settings/contact-fields", { method: "PUT", body: { fields: rows.map(({ key, label, type }) => ({ ...(key && { key }), label: label.trim(), type: type || "text" })) } });
      toast.success(res.removed.length ? `Fields saved. Deleted: ${res.removed.join(", ")} (values removed from ${res.contactsUpdated} contact(s)).` : "Contact fields saved");
      setConfirmRemove(null);
      await Promise.all([load(), onSaved()]);
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        {info.builtin.map((f) => (
          <div key={f.key} className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
            <Lock className="h-3.5 w-3.5 text-slate-400" /> <span className="flex-1">{f.label}</span> <span className="text-xs text-slate-400">built-in</span>
          </div>
        ))}
      </div>
      {rows.map((r, i) => {
        const stats = info.fields.find((f) => f.key === r.key);
        return (
          <div key={r.key || `new-${i}`} className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex gap-2">
                <Input className="h-9 min-w-0 flex-1" maxLength={40} value={r.label} onChange={(e) => setRow(i, { label: e.target.value })} placeholder="Field name, e.g. Course" aria-label="Field name" />
                <Select className="h-9 w-24 shrink-0 text-sm" value={r.type || "text"} onChange={(e) => setRow(i, { type: e.target.value })} aria-label="Field type" title="Date = birthday / anniversary (used by yearly drips)">
                  <option value="text">Text</option>
                  <option value="date">Date</option>
                </Select>
              </div>
              <p className="mt-0.5 text-[11px] text-slate-400">{r.key ? `${stats?.contacts || 0} contact(s) have a value` : "New field"}</p>
              {stats?.usedIn?.length > 0 && (
                <p className="mt-0.5 text-[11px] text-amber-700">Used in {stats.usedIn.join(", ")}. Remove it there first to delete this field.</p>
              )}
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="!w-7 shrink-0 self-start"
              disabled={stats?.usedIn?.length > 0}
              title={stats?.usedIn?.length ? `Can not delete: used in ${stats.usedIn.join(", ")}` : "Delete field"}
              onClick={() => setRows((x) => x.filter((_, j) => j !== i))}
              aria-label="Delete field"
            >
              <Trash2 className={`h-4 w-4 ${stats?.usedIn?.length ? "text-slate-300" : "text-red-500"}`} />
            </Button>
          </div>
        );
      })}
      {info.discovered.length > 0 && (
        <div className="rounded-md bg-sky-50 px-3 py-2 text-xs text-sky-900">
          <p className="mb-1.5">Found on your contacts but not in this list (e.g. from an older import). Add to use them:</p>
          <div className="flex flex-wrap gap-1.5">
            {info.discovered.filter((d) => !rows.some((r) => r.label.trim().toLowerCase() === d.key.replace(/_/g, " "))).map((d) => (
              <button key={d.key} type="button" className="rounded-full border border-sky-300 bg-white px-2 py-0.5 hover:bg-sky-100"
                onClick={() => setRows((x) => [...x, { label: d.key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), type: /dob|birth|anniv/i.test(d.key) ? "date" : "text" }])}>
                + {d.key.replace(/_/g, " ")} ({d.contacts})
              </button>
            ))}
          </div>
        </div>
      )}
      {removed.length > 0 && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Deleting {removed.map((f) => `“${f.label}”`).join(", ")} also deletes its saved values from {removed.reduce((n, f) => n + f.contacts, 0)} contact(s).
        </p>
      )}
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={rows.length >= 50} onClick={() => setRows((r) => [...r, { label: "", type: "text" }])}><Plus className="h-4 w-4" /> Add field</Button>
        <Button size="sm" loading={saving} disabled={rows.some((r) => !r.label.trim())} onClick={() => (removed.some((f) => f.contacts > 0) ? setConfirmRemove(removed) : save())}>Save fields</Button>
      </div>
      <ConfirmModal
        open={!!confirmRemove}
        onClose={() => setConfirmRemove(null)}
        onConfirm={save}
        loading={saving}
        danger
        title="Delete fields?"
        confirmText="Delete and save"
        message={`${confirmRemove?.map((f) => `“${f.label}”`).join(", ")} will be deleted, together with the values saved on ${confirmRemove?.reduce((n, f) => n + f.contacts, 0)} contact(s). This can not be undone.`}
      />
    </div>
  );
}

/** Business name, email and phone (the Super Admin sees changes live) */
function BusinessProfile({ s, onSave, busy }) {
  const [form, setForm] = useState({ name: s.name || "", email: s.email || "", phone: s.phone || "" });
  const changed = form.name.trim() !== (s.name || "") || form.email.trim() !== (s.email || "") || form.phone.trim() !== (s.phone || "");
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim() });
      }}
    >
      <Field label="Business name"><Input required minLength={2} maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Business email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="Phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
      </div>
      <div className="flex justify-end"><Button type="submit" variant="secondary" size="sm" loading={busy} disabled={!changed || form.name.trim().length < 2}>Save</Button></div>
    </form>
  );
}

/** Quiet hours and daily limit for automatic messages (drips, birthday messages, follow-up messages) */
function AutomationRules({ settings, onSave, busy }) {
  const a = settings.automation || {};
  const [quietStart, setQuietStart] = useState(a.quietStart ?? "21:00");
  const [quietEnd, setQuietEnd] = useState(a.quietEnd ?? "09:00");
  const [max, setMax] = useState(a.maxPerContactPerDay ?? 2);
  return (
    <form
      className="space-y-3 rounded-md border border-slate-200 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ automation: { quietStart, quietEnd, maxPerContactPerDay: Number(max) } });
      }}
    >
      <div>
        <p className="text-sm font-medium text-slate-800">Automatic messages (drips, birthdays, follow-ups)</p>
        <p className="text-xs text-slate-500">Nothing automatic is sent during quiet hours; it waits until the morning. Same start and end time = no quiet hours.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Quiet from"><Input type="time" required value={quietStart} onChange={(e) => setQuietStart(e.target.value)} /></Field>
        <Field label="Quiet until"><Input type="time" required value={quietEnd} onChange={(e) => setQuietEnd(e.target.value)} /></Field>
        <Field label="Max automatic messages per contact per day" hint="0 = no limit" className="col-span-2"><Input type="number" min={0} max={10} value={max} onChange={(e) => setMax(e.target.value)} className="w-28" /></Field>
      </div>
      <div className="flex justify-end"><Button type="submit" variant="secondary" size="sm" loading={busy}>Save</Button></div>
    </form>
  );
}

/** Refer & earn: reward (fee discount) and the WhatsApp link students share */
function ReferralSettings({ settings, connectedNumber, onSave, busy }) {
  const r = settings.referral || {};
  const [form, setForm] = useState({
    enabled: r.enabled !== false,
    rewardText: r.rewardText ?? "Fee discount on your next course",
    rewardAmount: r.rewardAmount ?? 500,
    linkNumber: r.linkNumber ?? "",
    messageText: r.messageText ?? "Hi! {name} ne mujhe refer kiya hai. Referral code: {code}",
  });
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const sample = form.messageText.replaceAll("{name}", "Rahul Sharma").replaceAll("{code}", "RAHUL7K2");
  const number = (form.linkNumber || connectedNumber || "").replace(/\D/g, "");
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ referral: { ...form, rewardAmount: Number(form.rewardAmount) || 0 } });
      }}
    >
      <Toggle checked={form.enabled} onChange={(v) => set({ enabled: v })} label="Refer & earn is on" description="A message with a student's referral code links the new lead to that student." />
      <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
        <Field label="Reward for each friend who joins"><Input maxLength={200} value={form.rewardText} onChange={(e) => set({ rewardText: e.target.value })} placeholder="e.g. ₹500 off your next course fee" /></Field>
        <Field label="Value (₹)" hint="For the report"><Input type="number" min={0} value={form.rewardAmount} onChange={(e) => set({ rewardAmount: e.target.value })} /></Field>
      </div>
      <Field label="WhatsApp number for referral links" hint={connectedNumber ? `Empty = your connected number (${connectedNumber})` : "Your business WhatsApp number with country code, e.g. 919876543210"}>
        <Input value={form.linkNumber} onChange={(e) => set({ linkNumber: e.target.value.replace(/[^\d]/g, "") })} placeholder={connectedNumber || "919876543210"} />
      </Field>
      <Field label="Message the friend sends (pre-filled by the link)" hint="{name} = student's name, {code} = their referral code (must stay in the message)">
        <Input maxLength={500} value={form.messageText} onChange={(e) => set({ messageText: e.target.value })} />
      </Field>
      <p className="rounded-md bg-slate-50 px-3 py-2 text-xs break-all text-slate-600">
        Link example: https://wa.me/{number || "…"}?text={encodeURIComponent(sample)}
      </p>
      {!number && <p className="text-xs text-amber-700">Add the WhatsApp number, otherwise the referral link can not open a chat.</p>}
      <div className="flex justify-end"><Button type="submit" variant="secondary" size="sm" loading={busy} disabled={!form.messageText.includes("{code}")}>Save</Button></div>
    </form>
  );
}

/** Admin edits the business's lead statuses (Interested, Not interested, Call back...) */
function LeadStatusEditor({ initial, onSaved }) {
  const toast = useToast();
  const [rows, setRows] = useState(initial.map((s) => ({ ...s })));
  const [saving, setSaving] = useState(false);
  const setRow = (i, patch) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i, d) =>
    setRows((r) => {
      const n = [...r];
      const j = i + d;
      if (j < 0 || j >= n.length) return n;
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  const removed = initial.filter((s) => !rows.some((r) => r.key === s.key));

  const save = async () => {
    setSaving(true);
    try {
      const res = await api("/settings/lead-statuses", { method: "PUT", body: { statuses: rows.map(({ key, label, color }) => ({ ...(key && { key }), label, color })) } });
      toast.success(res.movedToNew ? `Statuses saved. ${res.movedToNew} lead(s) of removed statuses moved to "${res.leadStatuses[0]?.key === "new" ? res.leadStatuses[0].label : "New"}".` : "Lead statuses saved");
      setRows(res.leadStatuses);
      await onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      {rows.map((r, i) => (
        <div key={r.key || `new-${i}`} className="flex items-center gap-2">
          <label
            title={`Color: ${COLOR_NAMES[r.color] || "Gray"} (click to change)`}
            className={`relative h-5 w-5 shrink-0 cursor-pointer rounded-full ring-2 ring-white ring-offset-1 ring-offset-slate-200 ${{ gray: "bg-slate-400", blue: "bg-sky-500", green: "bg-brand-500", yellow: "bg-amber-400", red: "bg-red-500", purple: "bg-violet-500" }[r.color] || "bg-slate-400"}`}
          >
            <select className="absolute inset-0 cursor-pointer opacity-0" value={r.color} onChange={(e) => setRow(i, { color: e.target.value })} aria-label="Color">
              {STATUS_COLORS.map((c) => <option key={c} value={c}>{COLOR_NAMES[c]}</option>)}
            </select>
          </label>
          <Input className="min-w-0 flex-1" maxLength={30} value={r.label} onChange={(e) => setRow(i, { label: e.target.value })} aria-label="Status name" placeholder="e.g. Call back" />
          <Button size="icon" variant="ghost" className="!w-6 shrink-0" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp className="h-4 w-4" /></Button>
          <Button size="icon" variant="ghost" className="!w-6 shrink-0" disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown className="h-4 w-4" /></Button>
          <Button size="icon" variant="ghost" className="!w-7 shrink-0" disabled={r.key === "new"} title={r.key === "new" ? "New leads get this status, it can be renamed but not removed" : "Remove"} onClick={() => setRows((x) => x.filter((_, j) => j !== i))} aria-label="Remove status">
            <Trash2 className={`h-4 w-4 ${r.key === "new" ? "text-slate-300" : "text-red-500"}`} />
          </Button>
        </div>
      ))}
      {removed.length > 0 && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Removing {removed.map((s) => `“${s.label}”`).join(", ")}: leads with this status will move to the first status (“New”).
        </p>
      )}
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={rows.length >= 20} onClick={() => setRows((r) => [...r, { label: "", color: "gray" }])}><Plus className="h-4 w-4" /> Add status</Button>
        <Button size="sm" onClick={save} loading={saving} disabled={rows.some((r) => !r.label.trim())}>Save statuses</Button>
      </div>
    </div>
  );
}

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
        {isAdmin && (
          <Section title="Business profile" description="Your business name and contact details, shown in the CRM and to your platform provider.">
            <BusinessProfile key={`${s.name}|${s.email}|${s.phone}`} s={s} busy={busy === "profile"} onSave={(body) => run("profile", () => api("/settings", { method: "PATCH", body }), "Business profile saved")} />
          </Section>
        )}
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
              <Toggle
                checked={s.settings.autoLeadStatus !== false}
                onChange={(v) => updateSetting({ autoLeadStatus: v })}
                label="Auto lead status from chat"
                description={'Customer writes "interested" → Interested, "not interested" / "interest nahi hai" → Not interested. Converted leads are never changed.'}
              />
              <AutomationRules key={JSON.stringify(s.settings.automation || {})} settings={s.settings} onSave={updateSetting} busy={busy === "settings"} />
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

        {isAdmin && (
          <Section title="Lead statuses" description="How you sort your leads (Interested, Not interested, Converted, Call back…). Used in Contacts, Inbox, bulk campaigns and reports.">
            <LeadStatusEditor initial={s.settings.leadStatuses} onSaved={() => Promise.all([load(), refresh()])} />
          </Section>
        )}

        {isAdmin && (
          <Section title="Contact fields" description="Extra details you keep for each lead (Course, City, Fees…). Use them in template variables ({{1}}), bulk campaigns and chatbot questions, and fill them on each contact.">
            <ContactFieldsEditor onSaved={refresh} />
          </Section>
        )}

        {isAdmin && (
          <Section title="Refer & earn" description="Old students share their own code; a friend who messages with it is linked to them. You give a fee discount for each friend who joins (report: Refer & earn page).">
            <ReferralSettings key={JSON.stringify(s.settings.referral || {})} settings={s.settings} connectedNumber={s.whatsapp.displayPhoneNumber} onSave={updateSetting} busy={busy === "settings"} />
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
