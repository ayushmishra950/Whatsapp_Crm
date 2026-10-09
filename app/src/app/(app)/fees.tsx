import { Stack, router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { FeesPanel } from '@/components/fees';
import { LeadActions } from '@/components/leads';
import { useToast } from '@/components/toast';
import { Badge, Button, ChipBar, EmptyState, Input, Loader, Row, Sheet, Stat, T } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth, useIsCoaching } from '@/lib/auth';
import { useCounts } from '@/lib/counts';
import { fmtPhone, money, prettyDay, displayName } from '@/lib/format';
import { C, S } from '@/theme';

const VIEWS: [string, string][] = [['overdue', 'Overdue'], ['today', 'Due today'], ['week', 'Due in 7 days'], ['month', 'Due in 30 days'], ['all', 'All with balance']];

/** Students' fees: totals, who has to pay and when, record payments (coaching businesses) */
export default function FeesScreen() {
  const coaching = useIsCoaching();
  if (!coaching) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <Stack.Screen options={{ title: 'Fees' }} />
        <EmptyState icon="cash-outline" title="Fees are for coaching businesses" text="Fee plans, instalments and reminders are available when the business type is Coaching." />
      </View>
    );
  }
  return <FeesList />;
}

function FeesList() {
  const toast = useToast();
  const { epoch } = useAuth();
  const { reload: reloadCounts } = useCounts();
  const [when, setWhen] = useState('week');
  const [search, setSearch] = useState('');
  const [data, setData] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState<any>(null);

  const load = useCallback(
    () =>
      api('/fees', { query: { when, search: search.trim() } })
        .then(setData)
        .catch(toast.error)
        .finally(() => setRefreshing(false)),
    [when, search, toast]
  );
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load, epoch]);

  const close = () => {
    setOpen(null);
    load();
    reloadCounts();
  };

  const t = data?.totals;
  const header = t ? (
    <View style={{ gap: S.sm }}>
      <Row wrap gap={S.sm}>
        <Stat label="Collected this month" value={money(t.collectedThisMonth)} sub={`${t.paymentsThisMonth} payment(s)`} tone={C.brand700} />
        <Stat label="Pending (all)" value={money(t.balance)} sub={`of ${money(t.billed)} billed · ${t.students} student(s)`} />
        <Stat label="Due in next 7 days" value={money(t.dueWeek)} />
        <Stat label="Students overdue" value={t.overdue} sub={t.overdue ? 'Call them today' : 'None 🎉'} tone={t.overdue ? C.red : undefined} />
      </Row>
      <T v="tiny">Set a fee plan on each student from the lead page. Reminders go out on WhatsApp 3 days before, on the day and after a missed due date; overdue fees also create a task.</T>
    </View>
  ) : null;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen options={{ title: 'Fees' }} />
      <View style={{ padding: S.lg, paddingBottom: S.sm, gap: S.sm, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: C.border }}>
        <ChipBar options={VIEWS} value={when} onChange={setWhen} />
        <Input placeholder="Search student (name or phone)" value={search} onChangeText={setSearch} autoCorrect={false} clearButtonMode="while-editing" />
      </View>
      {!data ? (
        <Loader />
      ) : (
        <FlatList
          data={data.items}
          keyExtractor={(c: any) => c._id}
          contentContainerStyle={{ padding: S.lg, gap: S.md }}
          ListHeaderComponent={header}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.brand600} />}
          ListEmptyComponent={<EmptyState icon="cash-outline" title="Nothing due here" text="Students with a fee plan and a balance show here. Set a plan from the student's lead page." />}
          renderItem={({ item: c }) => {
            const overdue = !!c.fees.nextDue && c.fees.nextDue < data.today;
            return (
              <Pressable onPress={() => setOpen(c)} style={({ pressed }) => [{ backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: overdue ? '#fecaca' : C.border, padding: S.lg, gap: 6 }, pressed && { opacity: 0.85 }]}>
                <Row style={{ justifyContent: 'space-between' }} gap={S.sm}>
                  <T style={{ fontWeight: '600', color: C.text, flex: 1 }} numberOfLines={1}>{displayName(c)}</T>
                  <T style={{ fontWeight: '700', color: C.amber }}>{money(c.fees.balance)}</T>
                </Row>
                <T v="tiny">{fmtPhone(c.phone)}{c.course ? ` · ${c.course}` : ''}{c.assignedTo?.name ? ` · ${c.assignedTo.name}` : ''}</T>
                <Row wrap gap={6}>
                  {overdue ? <Badge tone="red">overdue</Badge> : null}
                  <T v="small" style={overdue ? { color: C.red, fontWeight: '600' } : undefined}>
                    Next: <T v="small" style={{ fontWeight: '700', color: overdue ? C.red : C.text }}>{money(c.fees.nextAmount)}</T> · {prettyDay(c.fees.nextDue)}
                  </T>
                </Row>
                <T v="small">Paid {money(c.fees.paid)} / {money((c.fees.total || 0) - (c.fees.discount || 0))}</T>
                <Row wrap gap={6} style={{ marginTop: 4 }}>
                  <LeadActions contact={c} compact onChanged={load} />
                  <Button size="sm" title="₹ Payment / plan" onPress={() => setOpen(c)} />
                </Row>
              </Pressable>
            );
          }}
        />
      )}
      <Sheet
        open={!!open}
        onClose={close}
        full
        title={open ? `Fees · ${displayName(open)}` : ''}
        footer={
          open ? (
            <>
              <Button title="Open lead" variant="secondary" icon="person-outline" onPress={() => { const id = open._id; setOpen(null); router.push(`/lead/${id}`); }} />
              <Button title="Done" onPress={close} />
            </>
          ) : null
        }>
        {open ? <FeesPanel contactId={open._id} onChanged={load} /> : null}
      </Sheet>
    </View>
  );
}
