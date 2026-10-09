import { router, Stack } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';
import { BusinessLogo } from '@/components/business-switcher';
import { SaStatus } from '@/components/superadmin-shared';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, ChipBar, EmptyState, Input, Loader, Row, T, confirm } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtNum } from '@/lib/format';
import { useSocketEvent } from '@/lib/socket';
import { C, S } from '@/theme';

type Tenant = {
  _id: string;
  name: string;
  logo?: string;
  status: string;
  businessType?: string;
  plan?: { name: string; priceMonthly: number } | null;
  subscription?: { status?: string; currentPeriodEnd?: string };
  whatsapp?: { mode?: string };
  admin?: { name: string; email: string } | null;
  agentCount: number;
  contactCount: number;
};
type Page = { items: Tenant[]; total: number; page: number; limit: number };

/** Account status is filtered by the server; subscription status on the loaded rows (the API has no such filter) */
const FILTERS: [string, string][] = [
  ['', 'All'],
  ['active', 'Active'],
  ['suspended', 'Suspended'],
  ['sub:trial', 'Trial'],
  ['sub:active', 'Paid'],
  ['sub:expired', 'Expired'],
  ['sub:cancelled', 'Cancelled'],
];
const LIMIT = 50;

export default function TenantsScreen() {
  const toast = useToast();
  const { epoch, impersonate } = useAuth();
  // Open a business as its admin straight from the list (same as on the business page; audit-logged)
  const viewAs = async (t: Tenant) => {
    if (!(await confirm(`Open ${t.name} as its admin?`, 'Everything you do is recorded in the audit log. Use “Exit” at the bottom to come back.', { ok: 'Open' }))) return;
    try {
      await impersonate(t._id);
    } catch (err) {
      toast.error(err);
    }
  };
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [items, setItems] = useState<Tenant[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);
  const [more, setMore] = useState(false);
  const seq = useRef(0);

  const status = filter.startsWith('sub:') ? '' : filter;
  const fetchPage = useCallback(
    (p: number) => api<Page>('/superadmin/tenants', { query: { search: search.trim(), status, page: p, limit: LIMIT } }),
    [search, status]
  );
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
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load, epoch]);
  // A business was renamed / edited elsewhere: refresh the list
  useSocketEvent('tenant:updated', () => load(), epoch);

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

  const shown = items && filter.startsWith('sub:') ? items.filter((t) => t.subscription?.status === filter.slice(4)) : items;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen options={{ title: 'Businesses', headerRight: () => <Button size="sm" icon="add" title="New business" onPress={() => router.push('/tenants/new')} /> }} />
      <View style={{ padding: S.lg, paddingBottom: S.sm, gap: S.sm, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: C.border }}>
        <Input placeholder="Search businesses" value={search} onChangeText={setSearch} autoCorrect={false} autoCapitalize="none" clearButtonMode="while-editing" />
        <ChipBar options={FILTERS} value={filter} onChange={setFilter} />
        <T v="tiny">
          {items ? `${fmtNum(total)} ${total === 1 ? 'business' : 'businesses'}` : ''}
          {filter.startsWith('sub:') && items ? ` · ${shown?.length || 0} of ${items.length} loaded match` : ''}
        </T>
      </View>
      {!shown ? (
        <Loader />
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(t) => t._id}
          contentContainerStyle={{ padding: S.lg, gap: S.md }}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.brand600} />}
          ListEmptyComponent={
            <EmptyState
              icon="business-outline"
              title={search || filter ? 'No businesses match' : 'No businesses yet'}
              text={search || filter ? undefined : 'Create the first business and its admin login.'}
              action={!search && !filter ? <Button icon="add" title="New business" onPress={() => router.push('/tenants/new')} /> : undefined}
            />
          }
          ListFooterComponent={more ? <ActivityIndicator color={C.brand600} /> : null}
          renderItem={({ item: t }) => (
            <Card onPress={() => router.push(`/tenants/${t._id}`)} style={{ gap: 6 }}>
              <Row gap={S.md} style={{ alignItems: 'flex-start' }}>
                <BusinessLogo name={t.name} logo={t.logo} size={40} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Row wrap gap={6}>
                    <T style={{ fontWeight: '600', color: C.text, flexShrink: 1 }} numberOfLines={2}>{t.name}</T>
                    {t.businessType === 'coaching' ? <Badge tone="purple">Coaching</Badge> : null}
                  </Row>
                  <T v="small" numberOfLines={1}>{t.admin?.email || 'No admin'}</T>
                </View>
                <SaStatus status={t.status} />
              </Row>
              <Row wrap gap={6}>
                <Badge>{t.plan?.name || 'No plan'}</Badge>
                <SaStatus status={t.subscription?.status} />
                <T v="tiny">till {fmtDate(t.subscription?.currentPeriodEnd)}</T>
                {t.whatsapp?.mode === 'live' ? <Badge tone="green">WhatsApp live</Badge> : <Badge tone="yellow">Sandbox</Badge>}
              </Row>
              <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <T v="tiny">{fmtNum(t.agentCount)} agents · {fmtNum(t.contactCount)} contacts</T>
                {t.admin ? <Button size="sm" variant="ghost" icon="eye-outline" title="View as admin" onPress={() => viewAs(t)} /> : null}
              </Row>
            </Card>
          )}
        />
      )}
    </View>
  );
}
