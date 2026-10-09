import { Stack, router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { StateBadge, type Tpl } from '@/components/templates-preview';
import { useToast } from '@/components/toast';
import { Card, ChipBar, EmptyState, IconButton, Input, Loader, Row, T } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth, useIsAdmin } from '@/lib/auth';
import { useSocketEvent } from '@/lib/socket';
import { C, S } from '@/theme';

type Filter = 'all' | 'draft' | 'pending' | 'approved' | 'rejected';
const FILTERS: [Filter, string][] = [['all', 'All'], ['draft', 'Draft'], ['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected']];

/** WhatsApp message templates: needed for the first message to a customer and for bulk campaigns */
export default function TemplatesScreen() {
  const toast = useToast();
  const { epoch } = useAuth();
  const isAdmin = useIsAdmin();
  const [items, setItems] = useState<Tpl[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    () =>
      api<Tpl[]>('/templates')
        .then(setItems)
        .catch(toast.error)
        .finally(() => setRefreshing(false)),
    [toast]
  );
  useEffect(() => {
    load();
  }, [load, epoch]);
  useSocketEvent<Tpl>('template:update', (t) => setItems((list) => list?.map((x) => (x._id === t._id ? { ...x, ...t } : x)) ?? list), epoch);

  const counts = useMemo(() => {
    const c: Partial<Record<Filter, number>> = { all: items?.length || 0 };
    for (const t of items || []) c[t.status as Filter] = (c[t.status as Filter] || 0) + 1;
    return c;
  }, [items]);
  const term = q.trim().toLowerCase();
  const shown = (items || []).filter((t) => (filter === 'all' || t.status === filter) && (!term || `${t.name} ${t.body} ${t.category}`.toLowerCase().includes(term)));

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen
        options={{
          title: 'Templates',
          headerRight: isAdmin ? () => <IconButton name="add" color={C.brand700} label="New template" onPress={() => router.push('/templates/new')} /> : undefined,
        }}
      />
      <View style={{ padding: S.lg, paddingBottom: S.sm, gap: S.sm, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: C.border }}>
        <Input placeholder="Search templates" value={q} onChangeText={setQ} autoCorrect={false} autoCapitalize="none" clearButtonMode="while-editing" />
        <ChipBar options={FILTERS} value={filter} onChange={setFilter} counts={counts} />
      </View>
      {!items ? (
        <Loader />
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(t) => t._id}
          contentContainerStyle={{ padding: S.lg, gap: S.md }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.brand600} />}
          ListHeaderComponent={<T v="small">WhatsApp only allows pre-approved templates for the first message to a customer and for bulk campaigns.</T>}
          ListEmptyComponent={
            <EmptyState
              icon="document-text-outline"
              title={items.length ? 'No templates match' : 'No templates yet'}
              text={items.length ? undefined : 'Create a template, submit it, and once approved you can use it in chats and campaigns.'}
            />
          }
          renderItem={({ item: t }) => (
            <Card onPress={() => router.push(`/templates/${t._id}`)} style={{ gap: 6 }}>
              <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1 }}>
                  <T style={{ fontWeight: '600', color: C.text }} numberOfLines={1}>{t.name}</T>
                  <T v="tiny">{t.category} · {t.language}</T>
                </View>
                <StateBadge status={t.status} />
              </Row>
              <T v="small" numberOfLines={3}>{t.header ? `${t.header}\n` : ''}{t.body}</T>
              {t.status === 'rejected' && t.rejectionReason ? <T v="tiny" style={{ color: C.red }} numberOfLines={2}>Rejected: {t.rejectionReason}</T> : null}
              {t.status === 'pending' && t.previousVersion?.body ? <T v="tiny" style={{ color: C.amber }}>✏️ Edit in WhatsApp review</T> : null}
            </Card>
          )}
        />
      )}
    </View>
  );
}
