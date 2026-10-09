import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, RefreshControl, View } from 'react-native';
import { useToast } from '@/components/toast';
import { Badge, EmptyState, Loader, Row, Select, T } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDateTime, fmtNum } from '@/lib/format';
import { C, R, S } from '@/theme';

type Log = {
  _id: string;
  action: string;
  actorRole?: string;
  actorId?: { name?: string; email?: string; role?: string } | null;
  tenantId?: { _id: string; name: string } | null;
  impersonatedBy?: { name?: string } | null;
  targetType?: string;
  ip?: string;
  meta?: Record<string, unknown> | null;
  createdAt: string;
};
type Page = { items: Log[]; total: number; page: number; limit: number };
const LIMIT = 30;

/** Short one-line summary of an audit entry's details */
function metaSummary(meta?: Record<string, unknown> | null) {
  if (!meta || typeof meta !== 'object') return '';
  const parts = Object.entries(meta)
    .filter(([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => {
      const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
      return `${k}: ${s.length > 60 ? `${s.slice(0, 60)}…` : s}`;
    });
  const out = parts.join(' · ');
  return out.length > 220 ? `${out.slice(0, 220)}…` : out;
}

/** Who did what, across all businesses (filter by business) */
export default function AuditLogsScreen() {
  const params = useLocalSearchParams<{ tenantId?: string; tenantName?: string }>();
  const toast = useToast();
  const { epoch } = useAuth();
  const [tenantId, setTenantId] = useState(params.tenantId || '');
  const [businesses, setBusinesses] = useState<{ value: string; label: string }[]>(params.tenantId ? [{ value: params.tenantId, label: params.tenantName || 'This business' }] : []);
  const [items, setItems] = useState<Log[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);
  const [more, setMore] = useState(false);
  const seq = useRef(0);

  const fetchPage = useCallback((p: number) => api<Page>('/superadmin/audit-logs', { query: { page: p, limit: LIMIT, tenantId } }), [tenantId]);
  const load = useCallback(() => {
    const n = ++seq.current;
    return fetchPage(1)
      .then((d) => {
        if (n !== seq.current) return;
        setItems(d.items);
        setTotal(d.total);
        setPage(1);
      })
      .catch(toast.error)
      .finally(() => setRefreshing(false));
  }, [fetchPage, toast]);
  useEffect(() => {
    load();
  }, [load, epoch]);

  // Businesses for the filter (first 100, newest first)
  useEffect(() => {
    api<{ items: { _id: string; name: string }[] }>('/superadmin/tenants', { query: { limit: 100 } })
      .then((d) =>
        setBusinesses((cur) => {
          const list = d.items.map((t) => ({ value: t._id, label: t.name }));
          const extra = cur.filter((c) => !list.some((l) => l.value === c.value));
          return [...extra, ...list];
        })
      )
      .catch(() => {});
  }, [epoch]);

  const loadMore = () => {
    if (more || !items || items.length >= total) return;
    setMore(true);
    const n = seq.current;
    fetchPage(page + 1)
      .then((d) => {
        if (n !== seq.current) return;
        setItems((l) => [...(l || []), ...d.items.filter((x) => !(l || []).some((y) => y._id === x._id))]);
        setTotal(d.total);
        setPage(d.page);
      })
      .catch(toast.error)
      .finally(() => setMore(false));
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen options={{ title: 'Audit log' }} />
      <View style={{ padding: S.lg, paddingBottom: S.sm, gap: S.sm, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: C.border }}>
        <Select value={tenantId} onChange={setTenantId} title="Business" options={[{ value: '', label: 'All businesses' }, ...businesses]} />
        <T v="tiny">{items ? `${fmtNum(total)} entries` : ''}</T>
      </View>
      {!items ? (
        <Loader />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(l) => l._id}
          contentContainerStyle={{ padding: S.lg, gap: S.sm }}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.brand600} />}
          ListEmptyComponent={<EmptyState icon="document-text-outline" title="No activity yet" />}
          ListFooterComponent={more ? <ActivityIndicator color={C.brand600} /> : null}
          renderItem={({ item: l }) => {
            const meta = metaSummary(l.meta);
            return (
              <View style={{ backgroundColor: '#fff', borderRadius: R.lg, borderWidth: 1, borderColor: C.border, padding: S.md, gap: 4 }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <View style={{ backgroundColor: C.soft, borderRadius: R.sm, paddingHorizontal: 6, paddingVertical: 2, flexShrink: 1 }}>
                    <T v="small" style={{ fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', color: C.text2 }} numberOfLines={1}>{l.action}</T>
                  </View>
                  <T v="tiny">{fmtDateTime(l.createdAt)}</T>
                </Row>
                <Row wrap gap={6}>
                  <T style={{ color: C.text, fontWeight: '500' }}>{l.actorId?.name || '—'}</T>
                  {l.actorRole ? <T v="tiny">({l.actorRole})</T> : null}
                  {l.impersonatedBy ? <Badge tone="yellow">via {l.impersonatedBy.name}</Badge> : null}
                </Row>
                <T v="small">{l.tenantId?.name || 'Platform'}{l.ip ? ` · ${l.ip}` : ''}</T>
                {meta ? <T v="tiny" numberOfLines={3}>{meta}</T> : null}
              </View>
            );
          }}
        />
      )}
    </View>
  );
}
