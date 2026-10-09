import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { API_URL, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useLeadStatuses } from '@/lib/business';
import { fmtDate, fmtPhone } from '@/lib/format';
import { C, F, R, S } from '@/theme';
import { DateField } from './date-field';
import { LogoPicker } from './logo-picker';
import { useToast } from './toast';
import { Badge, Button, Chip, Field, Input, PasswordInput, Row, Select, Sheet, T, Toggle, confirm } from './ui';

/** Response of GET /settings */
export type SettingsData = {
  _id: string;
  name: string;
  email?: string;
  phone?: string;
  plan?: any;
  subscription?: any;
  subscriptionActive?: boolean;
  usage: { agents: number; contacts: number; messagesThisMonth: number };
  whatsapp: { mode: string; phoneNumberId?: string; wabaId?: string; displayPhoneNumber?: string; connectedAt?: string };
  webhook: { path: string; verifyToken?: string };
  instagram?: import('./instagram-settings').InstagramInfo;
  settings: any;
};
/** PATCH /settings with { settings: patch } (or a profile body); resolves true when saved */
export type SaveFn = (body: Record<string, unknown>, message?: string) => Promise<boolean>;
type SheetProps = { s: SettingsData; onClose: () => void; onSave: SaveFn };

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const toggleIn = (list: string[] = [], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

export function Note({ children, tone = 'gray' }: { children: ReactNode; tone?: 'gray' | 'amber' | 'violet' | 'blue' }) {
  const bg = { gray: C.soft, amber: C.amber50, violet: C.violet50, blue: C.blue50 }[tone];
  const fg = { gray: C.text2, amber: C.amber900, violet: '#4c1d95', blue: '#0c4a6e' }[tone];
  return (
    <View style={{ backgroundColor: bg, borderRadius: R.md, padding: S.md }}>
      <T v="small" style={{ color: fg }}>{children}</T>
    </View>
  );
}

function SaveFooter({ onClose, onSave, busy, disabled, title = 'Save' }: { onClose: () => void; onSave: () => void; busy: boolean; disabled?: boolean; title?: string }) {
  return (
    <>
      <Button title="Cancel" variant="secondary" onPress={onClose} />
      <Button title={title} loading={busy} disabled={disabled} onPress={onSave} />
    </>
  );
}

/** Wrap a save: busy flag + close on success */
function useSaver(onClose: () => void) {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<boolean>) => {
    setBusy(true);
    const ok = await fn();
    setBusy(false);
    if (ok) onClose();
  };
  return { busy, run };
}

/** Business name, email and phone */
export function BusinessProfileSheet({ s, onClose, onSave }: SheetProps) {
  const [form, setForm] = useState({ name: s.name || '', email: s.email || '', phone: s.phone || '' });
  const { busy, run } = useSaver(onClose);
  const changed = form.name.trim() !== (s.name || '') || form.email.trim() !== (s.email || '') || form.phone.trim() !== (s.phone || '');
  return (
    <Sheet open onClose={onClose} title="Business profile"
      footer={<SaveFooter onClose={onClose} busy={busy} disabled={!changed || form.name.trim().length < 2} onSave={() => run(() => onSave({ name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim() }, 'Business profile saved'))} />}>
      <T v="small">Your business name and contact details, shown in the CRM and to your platform provider.</T>
      <Field label="Business name"><Input value={form.name} maxLength={100} onChangeText={(name) => setForm({ ...form, name })} /></Field>
      <Field label="Business email"><Input value={form.email} onChangeText={(email) => setForm({ ...form, email })} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" /></Field>
      <Field label="Phone"><Input value={form.phone} onChangeText={(phone) => setForm({ ...form, phone })} keyboardType="phone-pad" /></Field>
      <Field label="Logo"><ProfileLogo /></Field>
    </Sheet>
  );
}

/** Quiet hours, daily limit for automatic messages, opt-out keywords */
export function QuietHoursSheet({ s, onClose, onSave }: SheetProps) {
  const a = s.settings.automation || {};
  const [quietStart, setQuietStart] = useState<string>(a.quietStart ?? '21:00');
  const [quietEnd, setQuietEnd] = useState<string>(a.quietEnd ?? '09:00');
  const [max, setMax] = useState(String(a.maxPerContactPerDay ?? 2));
  const [keywords, setKeywords] = useState((s.settings.optOutKeywords || []).join(', '));
  const { busy, run } = useSaver(onClose);
  const badTime = !TIME.test(quietStart) || !TIME.test(quietEnd);
  const maxN = Number(max);
  const badMax = !/^\d+$/.test(max) || maxN > 10;
  return (
    <Sheet open onClose={onClose} title="Quiet hours & limits"
      footer={
        <SaveFooter onClose={onClose} busy={busy} disabled={badTime || badMax}
          onSave={() =>
            run(() =>
              onSave({ settings: { automation: { quietStart, quietEnd, maxPerContactPerDay: maxN }, optOutKeywords: keywords.split(',').map((k: string) => k.trim()).filter(Boolean) } })
            )
          }
        />
      }>
      <T v="small">Automatic messages (drips, birthdays, follow-ups): nothing automatic is sent during quiet hours; it waits until the morning. Same start and end time = no quiet hours.</T>
      <Row gap={S.md}>
        <Field label="Quiet from" style={{ flex: 1 }} error={TIME.test(quietStart) ? undefined : 'HH:MM'}>
          <Input value={quietStart} onChangeText={setQuietStart} placeholder="21:00" keyboardType="numbers-and-punctuation" maxLength={5} />
        </Field>
        <Field label="Quiet until" style={{ flex: 1 }} error={TIME.test(quietEnd) ? undefined : 'HH:MM'}>
          <Input value={quietEnd} onChangeText={setQuietEnd} placeholder="09:00" keyboardType="numbers-and-punctuation" maxLength={5} />
        </Field>
      </Row>
      <Field label="Max automatic messages per contact per day" hint="0 = no limit (max 10)" error={badMax ? '0 to 10' : undefined}>
        <Input value={max} onChangeText={setMax} keyboardType="number-pad" maxLength={2} />
      </Field>
      <Field label="Opt-out keywords" hint="Comma separated. If a customer sends one of these, they are removed from bulk campaigns. Sending START opts them back in.">
        <Input value={keywords} onChangeText={setKeywords} autoCapitalize="characters" />
      </Field>
    </Sheet>
  );
}

/** Drips, replies, fee reminders, overdue tasks, morning report, "lead came back" */
export function LeadFlowSheet({ s, onClose, onSave }: SheetProps) {
  const { list: statuses } = useLeadStatuses();
  const a = s.settings.automation || {};
  const [form, setForm] = useState({
    oneDripAtATime: a.oneDripAtATime !== false,
    alertOnReply: a.alertOnReply !== false,
    feeReminders: a.feeReminders !== false,
    overdueAlertMinutes: String(a.overdueAlertMinutes ?? 30),
    dailyReportTime: (a.dailyReportTime ?? '09:00') as string,
    returningLead: { enabled: !!a.returningLead?.enabled, fromStatuses: (a.returningLead?.fromStatuses || []) as string[], toStatus: (a.returningLead?.toStatus || '') as string },
  });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const rl = form.returningLead;
  const { busy, run } = useSaver(onClose);
  const badTime = !!form.dailyReportTime && !TIME.test(form.dailyReportTime);
  const mins = Number(form.overdueAlertMinutes || 0);
  const badMins = !/^\d*$/.test(form.overdueAlertMinutes) || mins > 1440;
  return (
    <Sheet open onClose={onClose} title="Lead follow-up rules" full
      footer={
        <SaveFooter onClose={onClose} busy={busy} disabled={badTime || badMins || (rl.enabled && (!rl.toStatus || !rl.fromStatuses.length))}
          onSave={() => run(() => onSave({ settings: { automation: { ...form, overdueAlertMinutes: mins } } }))}
        />
      }>
      <T v="small">Drips, replies, overdue tasks and the morning report, so no lead is lost.</T>
      <Toggle value={form.oneDripAtATime} onChange={(v) => set({ oneDripAtATime: v })} label="One drip at a time" description="When a lead starts a status drip, their other status drips stop (birthday / refer drips keep running)." />
      <Toggle value={form.alertOnReply} onChange={(v) => set({ alertOnReply: v })} label="Alert when a lead replies during a drip" description="The counsellor (or admins) get a 🔔 so a human answers quickly." />
      <Toggle value={form.feeReminders} onChange={(v) => set({ feeReminders: v })} label="Fee reminders" description="WhatsApp reminder 3 days before, on the day and after a missed instalment (approved fee templates), plus a task to collect overdue fees." />
      <Field label="Alert when a task is late by (minutes)" hint="0 = never" error={badMins ? '0 to 1440' : undefined}>
        <Input value={form.overdueAlertMinutes} onChangeText={(v) => set({ overdueAlertMinutes: v })} keyboardType="number-pad" maxLength={4} />
      </Field>
      <Field label="Morning “needs attention” report at" hint="HH:MM, empty = off. Sent to admins' 🔔" error={badTime ? 'Time must be HH:MM' : undefined}>
        <Input value={form.dailyReportTime} onChangeText={(v) => set({ dailyReportTime: v })} placeholder="09:00" keyboardType="numbers-and-punctuation" maxLength={5} />
      </Field>
      <View style={{ borderWidth: 1, borderColor: C.border, borderRadius: R.md, padding: S.md, gap: S.md }}>
        <Toggle value={rl.enabled} onChange={(v) => set({ returningLead: { ...rl, enabled: v } })} label="Lead came back" description="A lead in Nurture / Lost writes again → move them and alert the team." />
        {rl.enabled ? (
          <>
            <Field label="When a lead in one of these statuses writes">
              <Row wrap gap={6}>
                {statuses.map((st) => (
                  <Chip key={st.key} label={st.label} active={rl.fromStatuses.includes(st.key)} onPress={() => set({ returningLead: { ...rl, fromStatuses: toggleIn(rl.fromStatuses, st.key) } })} />
                ))}
              </Row>
            </Field>
            <Field label="Move them to">
              <Select value={rl.toStatus} title="Move them to" onChange={(toStatus) => set({ returningLead: { ...rl, toStatus } })} options={statuses.map((st) => ({ value: st.key, label: st.label }))} />
            </Field>
          </>
        ) : null}
      </View>
    </Sheet>
  );
}

const fromDay = (d: string) => {
  const [y, m, day] = d.split('-').map(Number);
  return y ? new Date(y, m - 1, day) : null;
};
const toDay = (d: Date | null) => (d ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : '');

/** Business details used by template variables ({{review link}}, {{offer end}}…) */
export function MessageInfoSheet({ s, onClose, onSave, coaching }: SheetProps & { coaching: boolean }) {
  const m = s.settings.messageInfo || {};
  const [form, setForm] = useState({
    reviewLink: m.reviewLink || '', proofLink: m.proofLink || '', offerEnd: m.offerEnd || '', address: m.address || '', mapsLink: m.mapsLink || '', paymentDetails: m.paymentDetails || '',
    city: m.city || '', studentsTrained: m.studentsTrained || '', sinceYear: m.sinceYear || '', rating: m.rating || '',
  });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const { busy, run } = useSaver(onClose);
  const url = { autoCapitalize: 'none' as const, autoCorrect: false, keyboardType: 'url' as const, maxLength: 300 };
  return (
    <Sheet open onClose={onClose} title="Message info" full footer={<SaveFooter onClose={onClose} busy={busy} onSave={() => run(() => onSave({ settings: { messageInfo: form } }))} />}>
      <T v="small">Business details you can put in template variables: review link, offer end date, address, payment details.{coaching ? ' Courses have their own details on the Courses page.' : ''}</T>
      <Row gap={S.md}>
        <Field label="City" style={{ flex: 1 }}><Input maxLength={60} value={form.city} placeholder="e.g. Jaipur" onChangeText={(city) => set({ city })} /></Field>
        <Field label="Rating" style={{ flex: 1 }} hint="Shown as ★ 4.9/5"><Input maxLength={20} value={form.rating} placeholder="e.g. 4.9/5" onChangeText={(rating) => set({ rating })} /></Field>
      </Row>
      <Row gap={S.md}>
        <Field label="Students trained" style={{ flex: 1 }}><Input maxLength={20} value={form.studentsTrained} placeholder="e.g. 3,000+" onChangeText={(studentsTrained) => set({ studentsTrained })} /></Field>
        <Field label="Since (year)" style={{ flex: 1 }}><Input maxLength={10} value={form.sinceYear} placeholder="e.g. 2012" keyboardType="number-pad" onChangeText={(sinceYear) => set({ sinceYear })} /></Field>
      </Row>
      <Field label="Google review link"><Input {...url} value={form.reviewLink} placeholder="https://g.page/r/…" onChangeText={(reviewLink) => set({ reviewLink })} /></Field>
      <Field label="Proof / results link" hint="Placements, student work…"><Input {...url} value={form.proofLink} onChangeText={(proofLink) => set({ proofLink })} /></Field>
      <Field label="Current offer ends on">
        <DateField mode="date" clearable value={form.offerEnd ? fromDay(form.offerEnd) : null} onChange={(d) => set({ offerEnd: toDay(d) })} placeholder="No offer end date" />
      </Field>
      <Field label="Google Maps link"><Input {...url} value={form.mapsLink} onChangeText={(mapsLink) => set({ mapsLink })} /></Field>
      <Field label="Address"><Input maxLength={300} multiline value={form.address} onChangeText={(address) => set({ address })} /></Field>
      <Field label="Payment details" hint="UPI id / bank details sent to fee-pending leads"><Input maxLength={500} multiline value={form.paymentDetails} onChangeText={(paymentDetails) => set({ paymentDetails })} /></Field>
    </Sheet>
  );
}

/** Meta's price per template message (₹) for the dashboard's cost estimate */
export function WaRatesSheet({ s, onClose, onSave }: SheetProps) {
  const r = s.settings.waRates || {};
  const [form, setForm] = useState({ marketing: String(r.marketing ?? 0.86), utility: String(r.utility ?? 0.115), authentication: String(r.authentication ?? 0.115) });
  const { busy, run } = useSaver(onClose);
  const bad = Object.values(form).some((v) => v.trim() === '' || !(Number(v) >= 0 && Number(v) <= 100));
  const num = (v: string) => Number(v.replace(',', '.'));
  return (
    <Sheet open onClose={onClose} title="WhatsApp rates (cost estimate)"
      footer={<SaveFooter onClose={onClose} busy={busy} disabled={bad} onSave={() => run(() => onSave({ settings: { waRates: { marketing: num(form.marketing), utility: num(form.utility), authentication: num(form.authentication) } } }))} />}>
      <T v="small">Used for the “WhatsApp cost” on the dashboard.</T>
      {(['marketing', 'utility', 'authentication'] as const).map((k) => (
        <Field key={k} label={`${k[0].toUpperCase()}${k.slice(1)} (₹)`}>
          <Input value={form[k]} onChangeText={(v) => setForm({ ...form, [k]: v })} keyboardType="decimal-pad" />
        </Field>
      ))}
      <T v="tiny">Per delivered template message, from Meta&apos;s WhatsApp pricing for India (check business.whatsapp.com/products/platform-pricing — rates change). Replies to a customer within 24 hours are free.</T>
    </Sheet>
  );
}

/** Refer & earn: reward and the WhatsApp link students share */
export function ReferralSheet({ s, onClose, onSave }: SheetProps) {
  const r = s.settings.referral || {};
  const connectedNumber = s.whatsapp.displayPhoneNumber || '';
  const [form, setForm] = useState({
    enabled: r.enabled !== false,
    rewardText: r.rewardText ?? 'Fee discount on your next course',
    rewardAmount: String(r.rewardAmount ?? 500),
    linkNumber: r.linkNumber ?? '',
    messageText: r.messageText ?? 'Hi! {name} ne mujhe refer kiya hai. Referral code: {code}',
  });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const { busy, run } = useSaver(onClose);
  const sample = form.messageText.replaceAll('{name}', 'Rahul Sharma').replaceAll('{code}', 'RAHUL7K2');
  const number = (form.linkNumber || connectedNumber || '').replace(/\D/g, '');
  return (
    <Sheet open onClose={onClose} title="Refer & earn" full
      footer={<SaveFooter onClose={onClose} busy={busy} disabled={!form.messageText.includes('{code}')} onSave={() => run(() => onSave({ settings: { referral: { ...form, rewardAmount: Number(form.rewardAmount) || 0 } } }))} />}>
      <T v="small">Old students share their own code; a friend who messages with it is linked to them. You give a reward for each friend who joins.</T>
      <Toggle value={form.enabled} onChange={(enabled) => set({ enabled })} label="Refer & earn is on" description="A message with a student's referral code links the new lead to that student." />
      <Field label="Reward for each friend who joins"><Input maxLength={200} value={form.rewardText} onChangeText={(rewardText) => set({ rewardText })} placeholder="e.g. ₹500 off your next course fee" /></Field>
      <Field label="Value (₹)" hint="For the report"><Input value={form.rewardAmount} onChangeText={(rewardAmount) => set({ rewardAmount: rewardAmount.replace(/[^\d]/g, '') })} keyboardType="number-pad" /></Field>
      <Field label="WhatsApp number for referral links" hint={connectedNumber ? `Empty = your connected number (${connectedNumber})` : 'Your business WhatsApp number with country code, e.g. 919876543210'}>
        <Input value={form.linkNumber} onChangeText={(v) => set({ linkNumber: v.replace(/[^\d]/g, '') })} placeholder={connectedNumber || '919876543210'} keyboardType="phone-pad" />
      </Field>
      <Field label="Message the friend sends (pre-filled by the link)" hint="{name} = student's name, {code} = their referral code (must stay in the message)" error={form.messageText.includes('{code}') ? undefined : 'Keep {code} in the message'}>
        <Input maxLength={500} multiline value={form.messageText} onChangeText={(messageText) => set({ messageText })} />
      </Field>
      <Note>Link example: https://wa.me/{number || '…'}?text={encodeURIComponent(sample)}</Note>
      {!number ? <T v="small" style={{ color: C.amber }}>Add the WhatsApp number, otherwise the referral link can not open a chat.</T> : null}
    </Sheet>
  );
}

/** Which approved template welcomes a walk-in (empty = approved walkin_welcome_en / _hi) */
export function WalkInTemplateSheet({ s, onClose, onSave }: SheetProps) {
  const toast = useToast();
  const [templates, setTemplates] = useState<any[] | null>(null);
  const [value, setValue] = useState<string>(String(s.settings.automation?.walkInTemplateId || ''));
  const { busy, run } = useSaver(onClose);
  useEffect(() => {
    api<any[]>('/templates', { query: { status: 'approved' } })
      .then(setTemplates)
      .catch((err) => {
        toast.error(err);
        setTemplates([]);
      });
  }, [toast]);
  const chosen = templates?.find((t) => t._id === value);
  return (
    <Sheet open onClose={onClose} title="Walk-in welcome message"
      footer={<SaveFooter onClose={onClose} busy={busy} disabled={!templates} onSave={() => run(() => onSave({ settings: { automation: { walkInTemplateId: value || null } } }, 'Welcome message saved'))} />}>
      <T v="small">Sent on WhatsApp when you save a walk-in / phone enquiry. Default: the approved walkin_welcome_en / walkin_welcome_hi templates. A Hinglish lead gets the “_hi” twin of an “_en” template when it is approved.</T>
      {!templates ? (
        <ActivityIndicator color={C.brand600} />
      ) : (
        <Field label="Template">
          <Select
            value={value}
            title="Welcome template"
            onChange={setValue}
            options={[{ value: '', label: 'Default (walkin_welcome)' }, ...templates.map((t) => ({ value: t._id, label: t.name, hint: `${t.language} · ${t.category}` }))]}
          />
        </Field>
      )}
      {chosen ? <Note>{chosen.body}</Note> : null}
      {templates && !templates.length ? <T v="small" style={{ color: C.amber }}>No approved templates yet. Create one on the Templates page and submit it to WhatsApp.</T> : null}
    </Sheet>
  );
}

/** Connect the business's WhatsApp number (Cloud API) or disconnect it */
export function WhatsAppSheet({ s, onClose, onDone, isAdmin }: { s: SettingsData; onClose: () => void; onDone: () => Promise<unknown>; isAdmin: boolean }) {
  const toast = useToast();
  const live = s.whatsapp.mode === 'live';
  const [wa, setWa] = useState({ phoneNumberId: '', wabaId: '', accessToken: '' });
  const [sandbox, setSandbox] = useState({ phone: '919811112222', name: 'Test Customer', text: 'Hi, I want to know the price' });
  const [busy, setBusy] = useState('');
  const act = async (key: string, fn: () => Promise<unknown>, msg: string, close = true) => {
    setBusy(key);
    try {
      await fn();
      toast.success(msg);
      await onDone();
      if (close) onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy('');
    }
  };
  const disconnect = async () => {
    if (!(await confirm('Disconnect WhatsApp?', 'Messages will stop going to real customers and the account returns to sandbox mode.', { ok: 'Disconnect', danger: true }))) return;
    act('wa', () => api('/settings/whatsapp', { method: 'DELETE' }), 'Disconnected');
  };
  const canConnect = wa.phoneNumberId.trim().length >= 5 && wa.wabaId.trim().length >= 5 && wa.accessToken.trim().length >= 20;
  return (
    <Sheet open onClose={onClose} title="WhatsApp number" full>
      <T v="small">Each business connects one WhatsApp Business number using the official Cloud API.</T>
      <Row gap={S.sm} wrap>
        {live ? <Badge tone="green">✓ Live</Badge> : <Badge tone="yellow">🧪 Sandbox</Badge>}
        {live ? <T style={{ color: C.text }}>{fmtPhone(s.whatsapp.displayPhoneNumber)} · since {fmtDate(s.whatsapp.connectedAt)}</T> : null}
      </Row>
      {isAdmin && !live ? (
        <>
          <Field label="Phone number ID"><Input value={wa.phoneNumberId} onChangeText={(phoneNumberId) => setWa({ ...wa, phoneNumberId })} autoCapitalize="none" autoCorrect={false} keyboardType="number-pad" /></Field>
          <Field label="WhatsApp Business Account ID"><Input value={wa.wabaId} onChangeText={(wabaId) => setWa({ ...wa, wabaId })} autoCapitalize="none" autoCorrect={false} keyboardType="number-pad" /></Field>
          <Field label="Permanent access token" hint="Stored encrypted. Create a System User token in Meta Business Settings.">
            <PasswordInput value={wa.accessToken} onChangeText={(accessToken) => setWa({ ...wa, accessToken })} autoComplete="off" textContentType="none" />
          </Field>
          <Button title="Connect number" icon="link-outline" loading={busy === 'wa'} disabled={!canConnect} onPress={() => act('wa', () => api('/settings/whatsapp', { method: 'PUT', body: { phoneNumberId: wa.phoneNumberId.trim(), wabaId: wa.wabaId.trim(), accessToken: wa.accessToken.trim() } }), 'WhatsApp number connected')} />
        </>
      ) : null}
      {isAdmin && live ? <Button title="Disconnect" variant="secondary" icon="cloud-offline-outline" loading={busy === 'wa'} onPress={disconnect} /> : null}
      {isAdmin && s.webhook.verifyToken ? (
        <Note>
          <T v="small" style={{ fontWeight: '600', color: C.text2 }}>Webhook (set once in your Meta App){'\n'}</T>
          Callback URL: <T v="small" selectable style={{ fontFamily: 'Courier', fontSize: F.xs }}>{`${API_URL}${s.webhook.path}`}</T>
          {'\n'}Verify token: <T v="small" selectable style={{ fontFamily: 'Courier', fontSize: F.xs }}>{s.webhook.verifyToken}</T>
          {'\n'}Subscribe to fields: messages, message_template_status_update
        </Note>
      ) : null}
      {!live ? (
        <View style={{ borderTopWidth: 1, borderTopColor: C.border, paddingTop: S.md, gap: S.md }}>
          <T v="h3">Sandbox: simulate a customer message</T>
          <T v="small">Test the inbox without a real number. This pretends a customer sent you a WhatsApp message.</T>
          <Field label="Customer phone"><Input value={sandbox.phone} onChangeText={(phone) => setSandbox({ ...sandbox, phone })} keyboardType="phone-pad" /></Field>
          <Field label="Customer name"><Input value={sandbox.name} onChangeText={(name) => setSandbox({ ...sandbox, name })} /></Field>
          <Field label="Message"><Input value={sandbox.text} onChangeText={(text) => setSandbox({ ...sandbox, text })} multiline /></Field>
          <Button title="Simulate incoming message" variant="secondary" icon="send-outline" loading={busy === 'sandbox'} onPress={() => act('sandbox', () => api('/sandbox/inbound', { method: 'POST', body: sandbox }), 'Message received — check the Inbox', false)} />
        </View>
      ) : null}
    </Sheet>
  );
}

/** Password of this login (all businesses of the login when it has several) */
export function ChangePasswordSheet({ onClose }: { onClose: () => void }) {
  const { session } = useAuth();
  const toast = useToast();
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [busy, setBusy] = useState(false);
  const many = (session?.businessCount || 1) > 1;
  const save = async () => {
    setBusy(true);
    try {
      await api('/auth/change-password', { method: 'POST', body: pw });
      toast.success('Password changed');
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  const short = !!pw.newPassword && pw.newPassword.length < 8;
  return (
    <Sheet open onClose={onClose} title="Change password"
      footer={<SaveFooter onClose={onClose} busy={busy} title="Update password" disabled={!pw.currentPassword || pw.newPassword.length < 8 || !!session?.impersonating} onSave={save} />}>
      <T v="small">
        You log in as <T v="small" style={{ fontWeight: '700', color: C.text }}>{session?.user.email}</T>.{' '}
        {many ? `This login opens ${session?.businessCount} businesses: the new password works for all of them.` : 'Own another business on this CRM? Link it from “Your businesses” in Settings.'}
      </T>
      {session?.impersonating ? <Note tone="amber">You can not change the password while the Super Admin is viewing this business.</Note> : null}
      <Field label="Current password">
        <PasswordInput value={pw.currentPassword} onChangeText={(currentPassword) => setPw({ ...pw, currentPassword })} autoComplete="current-password" textContentType="password" />
      </Field>
      <Field label="New password" hint="Min 8 characters" error={short ? 'Min 8 characters' : undefined}>
        <PasswordInput value={pw.newPassword} onChangeText={(newPassword) => setPw({ ...pw, newPassword })} autoComplete="new-password" textContentType="newPassword" />
      </Field>
    </Sheet>
  );
}

/** Coaching industry pack: templates, drips and contact fields; sample course catalog */
export function CoachingPackSheet({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<unknown> }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const load = async (key: string, sampleCourses: boolean) => {
    setBusy(key);
    try {
      const r = await api('/settings/coaching-content', { method: 'POST', body: sampleCourses ? { sampleCourses: true } : {} });
      toast.success(sampleCourses ? `Added ${r.courses} sample courses. Edit or delete them on the Courses page.` : `Added: ${r.templates} templates, ${r.drips} drips, ${r.fields} contact fields`);
      await onDone();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy('');
    }
  };
  const steps = [
    'Fill Message info (city, rating, students trained, since year, address, review link). Templates use these instead of a fixed institute name.',
    'Load the pack (templates and drips come as drafts). Add your courses on the Courses page, or load the sample catalog.',
    'Templates page: check each template and Submit it (WhatsApp approves it).',
    'Drips page: turn on a drip once its templates are approved.',
  ];
  return (
    <Sheet open onClose={onClose} title="Coaching industry pack">
      <T v="small">Ready-made WhatsApp templates (English + Hinglish), 25 drips and contact fields for coaching institutes. Only what is missing is added, so your edits are kept.</T>
      {steps.map((t, i) => (
        <Row key={i} gap={S.sm} style={{ alignItems: 'flex-start' }}>
          <T v="small" style={{ fontWeight: '700', color: C.brand700 }}>{i + 1}.</T>
          <T v="small" style={{ flex: 1, color: C.text2 }}>{t}</T>
        </Row>
      ))}
      <Button title="Load templates & drips" icon="sparkles-outline" variant="soft" loading={busy === 'content'} disabled={!!busy} onPress={() => load('content', false)} />
      <Button title="Load sample course catalog (51 IT & skill courses)" variant="secondary" loading={busy === 'courses'} disabled={!!busy} onPress={() => load('courses', true)} />
    </Sheet>
  );
}

/** The business logo (saved at once, separate from the form above) */
function ProfileLogo() {
  const { session, refresh } = useAuth();
  const t = session?.tenant;
  if (!t) return null;
  return <LogoPicker name={t.name} logo={t.logo} path="/settings/logo" onSaved={() => refresh()} />;
}
