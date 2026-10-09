import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { LeadActions, NextFollowUpSheet } from '@/components/leads';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, ChipBar, Loader, Row, Screen, StatusBadge, T } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth, useIsCoaching } from '@/lib/auth';
import { useCounts } from '@/lib/counts';
import { fmtDateTime, fmtPhone, fmtRelative, isLate, money, prettyDay, displayName } from '@/lib/format';
import { useSocketEvent } from '@/lib/socket';
import { C, S } from '@/theme';

type Lead = { _id: string; name?: string; phone: string; leadStatus?: string; course?: string; assignedTo?: { name: string } | null; createdAt?: string; followUpAt?: string; followUpNote?: string; fees?: { nextDue?: string; nextAmount?: number } };

/** Everything to act on now, in order of priority, with one-tap actions */
export default function TodayScreen() {
  const toast = useToast();
  const { session, epoch } = useAuth();
  const coaching = useIsCoaching();
  const { reload: reloadCounts } = useCounts();
  const [d, setD] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [section, setSection] = useState('all');
  const [next, setNext] = useState<{ contact: Lead; title: string } | null>(null);

  const load = useCallback(
    () =>
      api('/dashboard/today', { query: { tz: Intl.DateTimeFormat().resolvedOptions().timeZone } })
        .then(setD)
        .catch(toast.error)
        .finally(() => setRefreshing(false)),
    [toast]
  );
  useEffect(() => {
    load();
  }, [load, epoch]);
  useSocketEvent('task:update', load, epoch);

  const done = async (task: any) => {
    try {
      await api(`/tasks/${task._id}`, { method: 'PATCH', body: { status: 'done' } });
      toast.success('Done ✓');
      reloadCounts();
      if (task.contactId) setNext({ contact: task.contactId, title: task.title });
      load();
    } catch (err) {
      toast.error(err);
    }
  };

  if (!d) return <Loader />;
  const sections = [
    { key: 'call', title: '📞 Call now — new leads', hint: 'Never called yet. Call within 30 minutes: the first call wins the admission.', items: d.call, tone: 'red' },
    { key: 'tasks', title: '⏰ Tasks due / overdue', hint: 'Calls, call-backs and follow-ups you promised.', items: d.tasks, tone: 'red' },
    { key: 'hot', title: '🔥 Hot leads', hint: 'Ready to join — close them today.', items: d.hot, tone: 'amber' },
    { key: 'waiting', title: '💬 Waiting for your reply', hint: 'Customer wrote more than 30 minutes ago.', items: d.waiting, tone: 'amber' },
    ...(coaching ? [{ key: 'fees', title: '💰 Fees due / overdue', hint: 'Collect or agree a new date.', items: d.fees, tone: 'amber' }] : []),
    { key: 'followUps', title: '📅 Follow-ups due', hint: 'Reminders set on leads.', items: d.followUps, tone: 'blue' },
  ];
  const total = sections.reduce((s, x) => s + x.items.length, 0);
  const shown = sections.filter((s) => section === 'all' || s.key === section);

  const leadLine = (c: Lead, extra?: string) => (
    <Pressable onPress={() => router.push(`/lead/${c._id}`)}>
      <Row wrap gap={6}>
        <T style={{ fontWeight: '600', color: C.text }}>{displayName(c)}</T>
        <StatusBadge status={c.leadStatus} />
        {c.course ? <Badge tone="purple">{c.course}</Badge> : null}
      </Row>
      <T v="small" style={{ marginTop: 2 }}>
        {fmtPhone(c.phone)}
        {c.assignedTo?.name ? ` · ${c.assignedTo.name}` : session?.user.role === 'admin' ? ' · not assigned' : ''}
        {extra || ''}
      </T>
    </Pressable>
  );

  const item = (key: string, it: any) => {
    if (key === 'tasks') {
      const c = it.contactId;
      return (
        <View key={it._id} style={{ gap: S.sm }}>
          <T style={{ fontWeight: '600', color: C.text }}>{it.title}</T>
          {c ? leadLine(c, ` · ${isLate(it.dueAt) ? 'overdue' : 'due'} ${fmtDateTime(it.dueAt)}`) : null}
          <Row wrap gap={6}>
            {c ? <LeadActions contact={c} compact onChanged={load} /> : null}
            <Button size="sm" icon="checkmark-circle" title="Done" onPress={() => done(it)} />
          </Row>
        </View>
      );
    }
    if (key === 'waiting') {
      const c = it.contactId;
      if (!c) return null;
      return (
        <View key={it._id} style={{ gap: S.sm }}>
          {leadLine(c, ` · wrote ${fmtRelative(it.lastInboundAt)}`)}
          <T v="small" numberOfLines={2} style={{ fontStyle: 'italic' }}>“{(it.lastMessagePreview || '').slice(0, 90)}”</T>
          <Row wrap gap={6}>
            <Button size="sm" icon="logo-whatsapp" title="Reply" onPress={() => router.push(`/chat/${it._id}`)} />
            <LeadActions contact={c} compact onChanged={load} />
          </Row>
        </View>
      );
    }
    const extra =
      key === 'fees' ? ` · ${money(it.fees?.nextAmount)} due ${prettyDay(it.fees?.nextDue)}`
      : key === 'followUps' ? ` · ${fmtDateTime(it.followUpAt)}${it.followUpNote ? ` · ${it.followUpNote}` : ''}`
      : key === 'call' ? ` · came ${fmtRelative(it.createdAt)}`
      : '';
    return (
      <View key={it._id} style={{ gap: S.sm }}>
        {leadLine(it, extra)}
        <Row wrap gap={6}>
          <LeadActions contact={it} compact onChanged={load} />
          {key === 'fees' ? <Button size="sm" variant="soft" icon="cash-outline" title="Fees" onPress={() => router.push(`/lead/${it._id}?tab=fees`)} /> : <Button size="sm" variant="ghost" icon="calendar-outline" title="Next follow-up" onPress={() => setNext({ contact: it, title: 'Follow up' })} />}
        </Row>
      </View>
    );
  };

  return (
    <Screen refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); reloadCounts(); }}>
      <View>
        <T v="h2">Today</T>
        <T v="small">{total ? `${total} thing(s) to do — start from the top.` : 'All clear 🎉 Nothing waiting right now.'}</T>
      </View>
      <ChipBar
        options={[['all', 'All'], ...sections.map((s) => [s.key, s.title.split(' — ')[0]] as [string, string])]}
        value={section}
        onChange={setSection}
        counts={Object.fromEntries([['all', total], ...sections.map((s) => [s.key, s.items.length])])}
      />
      {shown.map((s) => (
        <Card key={s.key} style={{ padding: 0, overflow: 'hidden' }}>
          <View style={{ backgroundColor: C.soft, paddingHorizontal: S.lg, paddingVertical: S.sm + 2 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <T style={{ fontWeight: '700', color: C.text, flex: 1 }}>{s.title}</T>
              <Badge tone={s.items.length ? s.tone : 'gray'}>{s.items.length}</Badge>
            </Row>
            <T v="tiny" style={{ color: C.muted }}>{s.hint}</T>
          </View>
          {s.items.length ? (
            s.items.map((it: any, i: number) => (
              <View key={it._id} style={{ padding: S.lg, borderTopWidth: i ? 1 : 0, borderTopColor: C.border }}>{item(s.key, it)}</View>
            ))
          ) : (
            <T v="small" style={{ padding: S.lg }}>Nothing here 👍</T>
          )}
        </Card>
      ))}
      {next && <NextFollowUpSheet contact={next.contact} defaultTitle={next.title} onClose={() => { setNext(null); load(); reloadCounts(); }} />}
    </Screen>
  );
}
