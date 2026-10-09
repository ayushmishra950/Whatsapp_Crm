import { Stack, router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, EmptyState, Field, IconButton, Input, Loader, Row, Sheet, Stat, T, Toggle } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth, useIsAdmin } from '@/lib/auth';
import { fmtDateTime, fmtPhone, money } from '@/lib/format';
import { C, R, S } from '@/theme';

type ReferralSettings = { enabled?: boolean; rewardText?: string; rewardAmount?: number; linkNumber?: string; messageText?: string };
type Referrer = {
  contactId: string;
  name?: string;
  phone: string;
  code?: string;
  referred: number;
  converted: number;
  rewardsEarned: number;
  rewardsGiven: number;
  rewardsPending: number;
  pendingValue: number;
  lastAt?: string;
};
type Data = { settings: ReferralSettings; totals: { referred: number; converted: number; pending: number }; items: Referrer[] };

const DEFAULT_MESSAGE = 'Hi! {name} ne mujhe refer kiya hai. Referral code: {code}';

/** Refer & earn (admin): who referred how many friends, how many joined, fee discounts given / still due */
export default function ReferralsScreen() {
  const toast = useToast();
  const { epoch, refresh } = useAuth();
  const isAdmin = useIsAdmin();
  const [data, setData] = useState<Data | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState('');
  const [editing, setEditing] = useState(false);

  const load = useCallback(
    () =>
      api<Data>('/referrals')
        .then(setData)
        .catch(toast.error)
        .finally(() => setRefreshing(false)),
    [toast]
  );
  useEffect(() => {
    if (isAdmin) load();
  }, [load, epoch, isAdmin]);

  const setGiven = async (row: Referrer, given: number) => {
    setBusy(row.contactId);
    try {
      await api(`/referrals/contact/${row.contactId}/rewards`, { method: 'PATCH', body: { given } });
      load();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy('');
    }
  };

  const header = <Stack.Screen options={{ title: 'Refer & earn', headerRight: isAdmin ? () => <IconButton name="settings-outline" color={C.brand700} label="Referral settings" onPress={() => setEditing(true)} /> : undefined }} />;
  if (!isAdmin) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        {header}
        <EmptyState icon="lock-closed-outline" title="Only admins see refer & earn" />
      </View>
    );
  }
  if (!data) {
    return (
      <>
        {header}
        <Loader />
      </>
    );
  }
  const s = data.settings || {};

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {header}
      <FlatList
        data={data.items}
        keyExtractor={(r) => r.contactId}
        contentContainerStyle={{ padding: S.lg, gap: S.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.brand600} />}
        ListHeaderComponent={
          <View style={{ gap: S.md }}>
            <T v="small">
              Old students share their code; for every friend who joins (Converted) they get: {s.rewardText || 'a fee discount'}
              {s.rewardAmount ? ` (${money(s.rewardAmount)})` : ''}.
            </T>
            {s.enabled === false ? (
              <View style={{ backgroundColor: C.amber50, borderRadius: R.md, padding: S.md }}>
                <T v="small" style={{ color: C.amber900 }}>Refer & earn is turned off, new referral codes in messages are not being matched.</T>
              </View>
            ) : null}
            <Row wrap gap={S.sm}>
              <Stat label="Friends referred" value={data.totals.referred} />
              <Stat label="Joined (Converted)" value={data.totals.converted} />
            </Row>
            <Stat label="Discounts still to give" value={data.totals.pending} sub={s.rewardAmount ? money(data.totals.pending * s.rewardAmount) : undefined} tone={data.totals.pending ? C.amber : undefined} />
            <Button variant="secondary" icon="settings-outline" title="Referral settings" onPress={() => setEditing(true)} />
            {data.items.length ? <T v="label">Referrers</T> : null}
          </View>
        }
        ListEmptyComponent={<EmptyState icon="gift-outline" title="No referrals yet" text="Send old students their referral code with a drip (Drips → Refer & earn idea). When a friend messages you with the code, it shows up here." />}
        renderItem={({ item: r }) => (
          <Card style={{ gap: 6 }}>
            <Pressable onPress={() => router.push(`/lead/${r.contactId}`)}>
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <T style={{ color: C.text, fontWeight: '600' }}>{r.name || 'Unknown'}</T>
                  <T v="small">{fmtPhone(r.phone)}</T>
                </View>
                {r.code ? <Badge>{r.code}</Badge> : null}
              </Row>
            </Pressable>
            <Row wrap gap={S.md}>
              <T v="small">Referred: <T style={{ fontWeight: '700', color: C.text }}>{r.referred}</T></T>
              <T v="small">Joined: <T style={{ fontWeight: '700', color: C.text }}>{r.converted}</T></T>
              <T v="tiny">Last: {r.lastAt ? fmtDateTime(r.lastAt) : '—'}</T>
            </Row>
            <Row gap={S.sm}>
              <T v="small">Discounts given</T>
              <IconButton name="remove-circle-outline" color={busy === r.contactId || r.rewardsGiven <= 0 ? C.border : C.text2} label="One less" onPress={() => busy !== r.contactId && r.rewardsGiven > 0 && setGiven(r, r.rewardsGiven - 1)} />
              <T style={{ fontWeight: '700', color: C.text, minWidth: 20, textAlign: 'center' }}>{r.rewardsGiven}</T>
              <IconButton name="add-circle-outline" color={busy === r.contactId || r.rewardsGiven >= r.rewardsEarned ? C.border : C.brand700} label="Mark one more given" onPress={() => busy !== r.contactId && r.rewardsGiven < r.rewardsEarned && setGiven(r, r.rewardsGiven + 1)} />
              {r.rewardsPending > 0 ? <Badge tone="yellow">{`${r.rewardsPending} due${s.rewardAmount ? ` · ${money(r.pendingValue)}` : ''}`}</Badge> : null}
            </Row>
          </Card>
        )}
      />
      {editing ? (
        <ReferralSettingsSheet
          settings={s}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            refresh();
            load();
          }}
        />
      ) : null}
    </View>
  );
}

/** Reward (fee discount) and the WhatsApp link students share — same as Settings → Refer & earn on the web */
function ReferralSettingsSheet({ settings, onClose, onSaved }: { settings: ReferralSettings; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    enabled: settings.enabled !== false,
    rewardText: settings.rewardText ?? 'Fee discount on your next course',
    rewardAmount: String(settings.rewardAmount ?? 500),
    linkNumber: settings.linkNumber ?? '',
    messageText: settings.messageText ?? DEFAULT_MESSAGE,
  });
  const [connected, setConnected] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api('/settings')
      .then((r) => setConnected(r.whatsapp?.displayPhoneNumber || ''))
      .catch(() => {});
  }, []);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const sample = form.messageText.replaceAll('{name}', 'Rahul Sharma').replaceAll('{code}', 'RAHUL7K2');
  const number = (form.linkNumber || connected || '').replace(/\D/g, '');

  const save = async () => {
    setBusy(true);
    try {
      await api('/settings', { method: 'PATCH', body: { settings: { referral: { ...form, rewardAmount: Number(form.rewardAmount) || 0 } } } });
      toast.success('Settings saved');
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open
      full
      onClose={onClose}
      title="Referral settings"
      footer={
        <>
          <Button title="Cancel" variant="secondary" onPress={onClose} />
          <Button title="Save" loading={busy} disabled={!form.messageText.includes('{code}')} onPress={save} />
        </>
      }>
      <Toggle value={form.enabled} onChange={(enabled) => set({ enabled })} label="Refer & earn is on" description="A message with a student's referral code links the new lead to that student." />
      <Field label="Reward for each friend who joins"><Input maxLength={200} value={form.rewardText} onChangeText={(rewardText) => set({ rewardText })} placeholder="e.g. ₹500 off your next course fee" /></Field>
      <Field label="Value (₹)" hint="For the report"><Input keyboardType="number-pad" value={form.rewardAmount} onChangeText={(v) => set({ rewardAmount: v.replace(/[^\d]/g, '') })} /></Field>
      <Field label="WhatsApp number for referral links" hint={connected ? `Empty = your connected number (${connected})` : 'Your business WhatsApp number with country code, e.g. 919876543210'}>
        <Input keyboardType="phone-pad" value={form.linkNumber} onChangeText={(v) => set({ linkNumber: v.replace(/[^\d]/g, '') })} placeholder={connected || '919876543210'} />
      </Field>
      <Field
        label="Message the friend sends (pre-filled by the link)"
        hint="{name} = student's name, {code} = their referral code (must stay in the message)"
        error={form.messageText.includes('{code}') ? undefined : 'Keep {code} in the message'}>
        <Input multiline maxLength={500} value={form.messageText} onChangeText={(messageText) => set({ messageText })} />
      </Field>
      <View style={{ backgroundColor: C.soft, borderRadius: R.md, padding: S.md }}>
        <T v="tiny" selectable>Link example: https://wa.me/{number || '…'}?text={encodeURIComponent(sample)}</T>
      </View>
      {!number ? <T v="small" style={{ color: C.amber }}>Add the WhatsApp number, otherwise the referral link can not open a chat.</T> : null}
    </Sheet>
  );
}
