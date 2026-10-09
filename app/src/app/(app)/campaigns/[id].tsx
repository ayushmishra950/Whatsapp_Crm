import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';
import { NoBroadcast, Progress, pct, useCanBroadcast, type Campaign, type Page } from '@/components/campaigns-common';
import { StateBadge, TemplatePreview } from '@/components/templates-preview';
import { useToast } from '@/components/toast';
import { Button, Card, ChipBar, Loader, Row, SectionTitle, Stat, T, confirm } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDateTime, fmtPhone } from '@/lib/format';
import { useSocketEvent } from '@/lib/socket';
import { C, R, S } from '@/theme';

type Filter = '' | 'sent' | 'delivered' | 'read' | 'failed' | 'skipped' | 'pending';
const FILTERS: [Filter, string][] = [['', 'All'], ['sent', 'Sent'], ['delivered', 'Delivered'], ['read', 'Read'], ['failed', 'Failed'], ['skipped', 'Skipped'], ['pending', 'Pending']];
type Recipient = { _id: string; phone: string; status: string; error?: string; sentAt?: string; contactId?: { _id: string; name?: string; phone?: string } };

/** One campaign: stats, recipients, and launch / pause / resume / cancel / edit / delete */
export default function CampaignScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const toast = useToast();
  const { epoch } = useAuth();
  const canBroadcast = useCanBroadcast();
  const [c, setC] = useState<Campaign | null>(null);
  const [recipients, setRecipients] = useState<Page<Recipient> | null>(null);
  const [filter, setFilter] = useState<Filter>('');
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState('');

  const load = useCallback(() => {
    if (!canBroadcast) return Promise.resolve();
    return api<Campaign>(`/campaigns/${id}`)
      .then(setC)
      .catch((err) => {
        toast.error(err);
        if (err?.status === 404) router.back();
      });
  }, [id, canBroadcast, toast]);
  const loadRecipients = useCallback(() => {
    if (!canBroadcast) return Promise.resolve();
    return api<Page<Recipient>>(`/campaigns/${id}/recipients`, { query: { status: filter, page: 1 } })
      .then(setRecipients)
      .catch(() => {});
  }, [id, filter, canBroadcast]);
  const reload = useCallback(() => Promise.all([load(), loadRecipients()]).finally(() => setRefreshing(false)), [load, loadRecipients]);
  useEffect(() => {
    reload();
  }, [reload, epoch]);

  useSocketEvent<{ _id: string; status: string; stats: Campaign['stats'] }>(
    'campaign:update',
    (u) => {
      if (u._id !== id) return;
      setC((prev) => prev && { ...prev, status: u.status, stats: u.stats });
      loadRecipients();
    },
    epoch
  );

  const loadMore = () => {
    if (!recipients || loadingMore || recipients.items.length >= recipients.total) return;
    setLoadingMore(true);
    api<Page<Recipient>>(`/campaigns/${id}/recipients`, { query: { status: filter, page: recipients.page + 1 } })
      .then((r) => setRecipients((d) => (d ? { ...r, items: [...d.items, ...r.items.filter((x) => !d.items.some((y) => y._id === x._id))] } : r)))
      .catch(toast.error)
      .finally(() => setLoadingMore(false));
  };

  const act = async (action: 'launch' | 'pause' | 'resume' | 'cancel' | 'delete') => {
    if (!c) return;
    if (action === 'cancel' && !(await confirm('Cancel campaign?', 'Messages not yet sent will be skipped. This can not be undone.', { ok: 'Cancel campaign', danger: true }))) return;
    if (action === 'delete' && !(await confirm('Delete campaign?', 'The campaign and its report will be deleted. Messages already sent stay in the chats.', { ok: 'Delete', danger: true }))) return;
    if (action === 'launch' && !(await confirm('Launch now?', `“${c.templateId?.name}” goes out on WhatsApp right away to everyone in this campaign's audience. Opted-out contacts are skipped.`, { ok: 'Send now' }))) return;
    setBusy(action);
    try {
      if (action === 'delete') {
        await api(`/campaigns/${id}`, { method: 'DELETE' });
        toast.success('Campaign deleted');
        router.back();
        return;
      }
      await api(`/campaigns/${id}/${action}`, { method: 'POST', body: {} });
      toast.success(`Campaign ${action === 'launch' ? 'started' : `${action}d`}`);
      reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy('');
    }
  };

  if (!canBroadcast) {
    return (
      <>
        <Stack.Screen options={{ title: 'Campaign' }} />
        <NoBroadcast />
      </>
    );
  }
  if (!c) return <Loader />;
  const s = c.stats;
  const processed = s.sent + s.failed + s.skipped;

  const header = (
    <View style={{ gap: S.md }}>
      <Card style={{ gap: 4 }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <T v="h3" style={{ flex: 1 }}>{c.name}</T>
          <StateBadge status={c.status} />
        </Row>
        <T v="small">Template {c.templateId?.name || '—'} · created by {c.createdBy?.name || '—'} on {fmtDateTime(c.createdAt)}</T>
        {c.status === 'scheduled' ? <T v="small" style={{ color: C.amber, fontWeight: '600' }}>📅 Sends {fmtDateTime(c.scheduledAt)}</T> : c.startedAt ? <T v="small">Sent {fmtDateTime(c.startedAt)}</T> : null}
        {c.status === 'paused' && c.pauseReason ? (
          <View style={{ backgroundColor: C.amber50, borderRadius: R.sm, padding: S.sm, marginTop: 6 }}>
            <T v="small" style={{ color: C.amber900 }}>Paused automatically: {c.pauseReason}</T>
          </View>
        ) : null}
      </Card>

      <Row wrap gap={S.sm} style={{ alignItems: 'stretch' }}>
        {['draft', 'scheduled'].includes(c.status) ? <Button size="sm" variant="secondary" icon="create-outline" title="Edit" onPress={() => router.push(`/campaigns/new?edit=${c._id}`)} /> : null}
        {c.status === 'draft' ? <Button size="sm" icon="rocket-outline" title="Launch now" loading={busy === 'launch'} onPress={() => act('launch')} /> : null}
        {['running', 'scheduled'].includes(c.status) ? <Button size="sm" variant="secondary" icon="pause" title="Pause" loading={busy === 'pause'} onPress={() => act('pause')} /> : null}
        {c.status === 'paused' ? <Button size="sm" icon="play" title="Resume" loading={busy === 'resume'} onPress={() => act('resume')} /> : null}
        {['running', 'scheduled', 'paused'].includes(c.status) ? <Button size="sm" variant="secondary" icon="close-circle-outline" title="Cancel" loading={busy === 'cancel'} onPress={() => act('cancel')} /> : null}
        {['draft', 'completed', 'cancelled', 'failed', 'paused'].includes(c.status) ? <Button size="sm" variant="ghost" icon="trash-outline" title="Delete" loading={busy === 'delete'} onPress={() => act('delete')} /> : null}
      </Row>

      <Row wrap gap={S.sm} style={{ alignItems: 'stretch' }}>
        <Stat label="Recipients" value={s.total} />
        <Stat label="Sent" value={s.sent} sub={`${pct(processed, s.total)}% processed`} />
        <Stat label="Delivered" value={s.delivered} sub={`${pct(s.delivered, s.sent)}% of sent`} />
        <Stat label="Read" value={s.read} sub={`${pct(s.read, s.sent)}% of sent`} />
        <Stat label="Failed / skipped" value={`${s.failed} / ${s.skipped}`} tone={s.failed ? C.red : undefined} />
      </Row>
      <Progress value={pct(processed, s.total)} />

      {c.templateId ? (
        <>
          <SectionTitle>Message</SectionTitle>
          <TemplatePreview t={c.templateId} />
        </>
      ) : null}

      <SectionTitle>Recipients</SectionTitle>
      <ChipBar options={FILTERS} value={filter} onChange={setFilter} />
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen options={{ title: c.name }} />
      <FlatList
        data={recipients?.items || []}
        keyExtractor={(r) => r._id}
        ListHeaderComponent={header}
        contentContainerStyle={{ padding: S.lg, gap: S.sm }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); reload(); }} tintColor={C.brand600} />}
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        ListFooterComponent={loadingMore ? <ActivityIndicator color={C.brand600} style={{ marginVertical: S.md }} /> : null}
        ListEmptyComponent={
          !recipients ? (
            <ActivityIndicator color={C.brand600} style={{ marginVertical: S.lg }} />
          ) : (
            <T v="small" style={{ textAlign: 'center', padding: S.lg }}>{c.status === 'draft' ? 'Recipients are added when the campaign is launched.' : 'No recipients in this filter.'}</T>
          )
        }
        renderItem={({ item: r }) => (
          <Card
            style={{ paddingVertical: S.md, gap: 2 }}
            onPress={r.contactId?._id ? () => router.push(`/lead/${r.contactId?._id}`) : undefined}>
            <Row style={{ justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <T style={{ color: C.text, fontWeight: '500' }} numberOfLines={1}>{r.contactId?.name || '—'}</T>
                <T v="tiny">{fmtPhone(r.phone)}</T>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 2 }}>
                <StateBadge status={r.status} />
                {r.sentAt ? <T v="tiny">{fmtDateTime(r.sentAt)}</T> : null}
              </View>
            </Row>
            {r.error ? <T v="tiny" style={{ color: C.red }}>{r.error}</T> : null}
          </Card>
        )}
      />
    </View>
  );
}
