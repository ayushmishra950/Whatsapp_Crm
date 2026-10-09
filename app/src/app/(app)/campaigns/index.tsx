import { Stack, router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';
import { NoBroadcast, Progress, pct, useCanBroadcast, type Campaign, type Page } from '@/components/campaigns-common';
import { StateBadge } from '@/components/templates-preview';
import { useToast } from '@/components/toast';
import { Button, Card, EmptyState, IconButton, Loader, Row, T } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDateTime } from '@/lib/format';
import { useSocketEvent } from '@/lib/socket';
import { C, S } from '@/theme';

const Count = ({ label, value, tone }: { label: string; value: string | number; tone?: string }) => (
  <View style={{ flex: 1, alignItems: 'center' }}>
    <T style={{ fontWeight: '700', color: tone || C.text }}>{value}</T>
    <T v="tiny">{label}</T>
  </View>
);

/** Bulk campaigns: send an approved template to many contacts at once */
export default function CampaignsScreen() {
  const toast = useToast();
  const { epoch } = useAuth();
  const canBroadcast = useCanBroadcast();
  const [data, setData] = useState<Page<Campaign> | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(() => {
    if (!canBroadcast) return Promise.resolve();
    return api<Page<Campaign>>('/campaigns', { query: { page: 1 } })
      .then(setData)
      .catch(toast.error)
      .finally(() => setRefreshing(false));
  }, [canBroadcast, toast]);
  useEffect(() => {
    load();
  }, [load, epoch]);

  const loadMore = () => {
    if (!data || loadingMore || data.items.length >= data.total) return;
    setLoadingMore(true);
    api<Page<Campaign>>('/campaigns', { query: { page: data.page + 1 } })
      .then((r) => setData((d) => (d ? { ...r, items: [...d.items, ...r.items.filter((x) => !d.items.some((y) => y._id === x._id))] } : r)))
      .catch(toast.error)
      .finally(() => setLoadingMore(false));
  };

  useSocketEvent<{ _id: string; status: string; stats: Campaign['stats'] }>(
    'campaign:update',
    (u) => setData((d) => d && { ...d, items: d.items.map((c) => (c._id === u._id ? { ...c, status: u.status, stats: u.stats } : c)) }),
    epoch
  );

  if (!canBroadcast) {
    return (
      <>
        <Stack.Screen options={{ title: 'Bulk campaigns' }} />
        <NoBroadcast />
      </>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen options={{ title: 'Bulk campaigns', headerRight: () => <IconButton name="add" color={C.brand700} label="New campaign" onPress={() => router.push('/campaigns/new')} /> }} />
      {!data ? (
        <Loader />
      ) : (
        <FlatList
          data={data.items}
          keyExtractor={(c) => c._id}
          contentContainerStyle={{ padding: S.lg, gap: S.md }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.brand600} />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListHeaderComponent={<T v="small">Send an approved template to many contacts at once. Opted-out contacts are skipped automatically.</T>}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={C.brand600} style={{ marginVertical: S.md }} /> : null}
          ListEmptyComponent={<EmptyState icon="megaphone-outline" title="No campaigns yet" text="Create your first bulk WhatsApp campaign." action={<Button title="New campaign" icon="add" onPress={() => router.push('/campaigns/new')} />} />}
          renderItem={({ item: c }) => {
            const s = c.stats;
            return (
              <Card onPress={() => router.push(`/campaigns/${c._id}`)} style={{ gap: S.sm }}>
                <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <View style={{ flex: 1 }}>
                    <T style={{ fontWeight: '600', color: C.text }} numberOfLines={1}>{c.name}</T>
                    <T v="tiny" numberOfLines={1}>📋 {c.templateId?.name || '—'}{c.createdBy?.name ? ` · by ${c.createdBy.name}` : ''}</T>
                  </View>
                  <StateBadge status={c.status} />
                </Row>
                <Progress value={pct(s.sent + s.failed + s.skipped, s.total)} />
                <Row gap={0}>
                  <Count label="Sent" value={`${s.sent}/${s.total}`} />
                  <Count label="Delivered" value={`${pct(s.delivered, s.sent)}%`} />
                  <Count label="Read" value={`${pct(s.read, s.sent)}%`} />
                  <Count label="Failed" value={s.failed} tone={s.failed ? C.red : undefined} />
                </Row>
                {c.status === 'scheduled' ? (
                  <T v="tiny" style={{ color: C.amber, fontWeight: '600' }}>📅 Sends {fmtDateTime(c.scheduledAt)}</T>
                ) : (
                  <T v="tiny">{c.startedAt ? `Sent ${fmtDateTime(c.startedAt)} · ` : ''}Created {fmtDateTime(c.createdAt)}</T>
                )}
              </Card>
            );
          }}
        />
      )}
    </View>
  );
}
