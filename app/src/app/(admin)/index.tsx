import { router, Stack, type Href } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { useToast } from '@/components/toast';
import { Card, Divider, EmptyState, ListRow, Row, Screen, Stat, T, confirm, type IconName } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtNum, money } from '@/lib/format';
import { S } from '@/theme';

type Stats = {
  tenants: number;
  activeTenants: number;
  suspended: number;
  plans: number;
  messagesThisMonth: number;
  mrr: number;
  expiringSoon: { _id: string; name: string; subscription?: { currentPeriodEnd?: string } }[];
};

const LINKS: { icon: IconName; title: string; subtitle: string; href: Href }[] = [
  { icon: 'business-outline', title: 'Businesses', subtitle: 'Clients, subscriptions, admins', href: '/tenants' },
  { icon: 'card-outline', title: 'Plans', subtitle: 'Monthly plans and their limits', href: '/plans' },
  { icon: 'document-text-outline', title: 'Audit log', subtitle: 'Who did what, across all businesses', href: '/audit-logs' },
];

/** Super Admin home: platform overview + shortcuts */
export default function SuperAdminHome() {
  const toast = useToast();
  const { session, logout, epoch } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    () =>
      api<Stats>('/superadmin/stats')
        .then(setStats)
        .catch(toast.error)
        .finally(() => setRefreshing(false)),
    [toast]
  );
  useEffect(() => {
    load();
  }, [load, epoch]);

  return (
    <Screen refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }}>
      <Stack.Screen options={{ title: 'Platform overview' }} />
      <Row wrap gap={S.md}>
        <Stat label="Businesses" value={stats ? fmtNum(stats.tenants) : '…'} />
        <Stat label="Active subscriptions" value={stats ? fmtNum(stats.activeTenants) : '…'} />
        <Stat label="Suspended" value={stats ? fmtNum(stats.suspended) : '…'} />
        <Stat label="Monthly revenue (MRR)" value={stats ? money(stats.mrr) : '…'} sub="Paid active plans" />
        <Stat label="Messages this month" value={stats ? fmtNum(stats.messagesThisMonth) : '…'} />
        <Stat label="Active plans" value={stats ? fmtNum(stats.plans) : '…'} />
      </Row>

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {LINKS.map((l, i) => (
          <View key={l.title}>
            {i ? <Divider style={{ marginLeft: 62 }} /> : null}
            <ListRow icon={l.icon} title={l.title} subtitle={l.subtitle} onPress={() => router.push(l.href)} />
          </View>
        ))}
      </Card>

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <View style={{ padding: S.lg, paddingBottom: S.sm }}>
          <T v="h3">Renewals due in next 7 days</T>
        </View>
        {stats?.expiringSoon.length ? (
          stats.expiringSoon.map((t, i) => (
            <View key={t._id}>
              {i ? <Divider /> : null}
              <ListRow title={t.name} subtitle={`Ends ${fmtDate(t.subscription?.currentPeriodEnd)}`} onPress={() => router.push(`/tenants/${t._id}`)} />
            </View>
          ))
        ) : (
          <EmptyState icon="calendar-outline" title="No renewals due" text="Subscriptions ending within a week will show here." />
        )}
      </Card>

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <ListRow
          icon="log-out-outline"
          title="Log out"
          danger
          onPress={async () => (await confirm('Log out?', `You will need ${session?.user.email} and your password to log in again.`, { ok: 'Log out', danger: true })) && logout()}
        />
      </Card>
      <T v="tiny" style={{ textAlign: 'center' }}>Super Admin · {session?.user.email}</T>
    </Screen>
  );
}
