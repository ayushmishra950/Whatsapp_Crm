import { Stack, router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { useToast } from '@/components/toast';
import { Button, EmptyState, Loader, Row, T } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCounts } from '@/lib/counts';
import { fmtRelative } from '@/lib/format';
import { useSocketEvent } from '@/lib/socket';
import { C, S } from '@/theme';

const ICON: Record<string, string> = { hot: '🔥', task: '⏰', overdue: '⚠️', alert: '🚨', reply: '💬', info: 'ℹ️', report: '📊', storage: '💾', comment: '💬' };

/** The bell: alerts for this person (hot leads, tasks, overdue, replies during drips…) */
export default function NotificationsScreen() {
  const toast = useToast();
  const { epoch } = useAuth();
  const { reload: reloadCounts } = useCounts();
  const [data, setData] = useState<{ items: any[]; unread: number } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(() => api('/notifications', { query: { limit: 100 } }).then(setData).catch(toast.error).finally(() => setRefreshing(false)), [toast]);
  useEffect(() => {
    load();
  }, [load, epoch]);
  useSocketEvent('notification:new', load, epoch);

  const markAll = async () => {
    await api('/notifications/read', { method: 'POST', body: { all: true } }).catch(() => {});
    load();
    reloadCounts();
  };
  const open = async (n: any) => {
    if (!n.readAt) api('/notifications/read', { method: 'POST', body: { ids: [n._id] } }).then(reloadCounts).catch(() => {});
    const cid = n.contactId?._id || n.contactId;
    if (n.kind === 'storage') router.push('/disk-files');
    else if (n.kind === 'comment') router.push('/social/comments');
    else if (!cid && n.taskId) router.push('/tasks'); // task alert without a lead
    else if (cid) router.push(`/lead/${cid}`);
    else load();
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen options={{ title: 'Notifications', headerRight: () => (data?.unread ? <Button size="sm" variant="ghost" title="Mark all read" onPress={markAll} /> : null) }} />
      {!data ? (
        <Loader />
      ) : (
        <FlatList
          data={data.items}
          keyExtractor={(n) => n._id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.brand600} />}
          ListEmptyComponent={<EmptyState icon="notifications-off-outline" title="No notifications" text="Hot leads, tasks and replies show up here." />}
          ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: C.border }} />}
          renderItem={({ item: n }) => (
            <Pressable onPress={() => open(n)} style={({ pressed }) => ({ flexDirection: 'row', gap: S.md, padding: S.lg, backgroundColor: pressed ? C.soft : n.readAt ? '#fff' : C.brand50 })}>
              <T style={{ fontSize: 20 }}>{ICON[n.kind] || '🔔'}</T>
              <View style={{ flex: 1, gap: 2 }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <T style={{ fontWeight: n.readAt ? '500' : '700', color: C.text, flex: 1 }}>{n.title}</T>
                  <T v="tiny">{fmtRelative(n.createdAt)}</T>
                </Row>
                {n.body ? <T v="small">{n.body}</T> : null}
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
