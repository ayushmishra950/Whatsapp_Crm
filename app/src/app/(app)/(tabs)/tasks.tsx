import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { LeadActions, NextFollowUpSheet } from '@/components/leads';
import { useToast } from '@/components/toast';
import { Badge, Button, ChipBar, EmptyState, Loader, Row, Select, StatusBadge, T, confirm } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCounts } from '@/lib/counts';
import { fmtDateTime, isLate, displayName } from '@/lib/format';
import { useSocketEvent } from '@/lib/socket';
import { C, S } from '@/theme';

const VIEWS: [string, string][] = [['overdue', 'Overdue'], ['today', 'Due in 24h'], ['open', 'All open'], ['done', 'Done']];
const KIND: Record<string, string> = { call: '📞 Call', callback: '🔁 Call back', demo: '🎓 Demo', followup: '📅 Follow-up', other: '📌 Task' };

/** Calls, call-backs and follow-ups. Counsellors see their own; admins see everyone's. */
export default function TasksScreen() {
  const toast = useToast();
  const { session, epoch } = useAuth();
  const { reload: reloadCounts } = useCounts();
  const isAdmin = session?.user.role === 'admin';
  const [view, setView] = useState('open');
  const [who, setWho] = useState('');
  const [team, setTeam] = useState<any[]>([]);
  const [items, setItems] = useState<any[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [next, setNext] = useState<{ contact: any; title: string } | null>(null);

  const load = useCallback(() => {
    const query = view === 'done' ? { status: 'done' } : { status: 'open', when: view === 'open' ? '' : view };
    return api<any[]>('/tasks', { query: { ...query, assignedTo: who } })
      .then(setItems)
      .catch(toast.error)
      .finally(() => setRefreshing(false));
  }, [view, who, toast]);
  useEffect(() => {
    load();
  }, [load, epoch]);
  useEffect(() => {
    if (isAdmin) api('/team').then(setTeam).catch(() => {});
  }, [isAdmin, epoch]);
  useSocketEvent('task:update', load, epoch);

  // Admin: give the task to another counsellor
  const reassign = async (t: any, assignedTo: string) => {
    try {
      await api(`/tasks/${t._id}`, { method: 'PATCH', body: { assignedTo: assignedTo || null } });
      toast.success(assignedTo ? `Given to ${team.find((m) => m._id === assignedTo)?.name || 'counsellor'}` : 'Task unassigned');
      reloadCounts();
      load();
    } catch (err) {
      toast.error(err);
    }
  };
  const setStatus = async (t: any, status: 'done' | 'cancelled' | 'open') => {
    try {
      await api(`/tasks/${t._id}`, { method: 'PATCH', body: { status } });
      reloadCounts();
      if (status === 'done') {
        toast.success('Done ✓');
        if (t.contactId) setNext({ contact: t.contactId, title: t.title });
      }
      load();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ padding: S.lg, paddingBottom: S.sm, gap: S.sm, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: C.border }}>
        <ChipBar options={VIEWS} value={view} onChange={setView} />
        {isAdmin ? <Select value={who} onChange={setWho} title="Whose tasks" options={[{ value: '', label: 'Everyone' }, { value: 'me', label: 'Mine' }, { value: 'none', label: 'Not assigned' }, ...team.filter((t) => t._id !== session?.user._id).map((t) => ({ value: t._id, label: t.name }))]} /> : null}
      </View>
      {!items ? (
        <Loader />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(t) => t._id}
          contentContainerStyle={{ padding: S.lg, gap: S.md }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.brand600} />}
          ListEmptyComponent={<EmptyState icon="checkbox-outline" title={view === 'done' ? 'No finished tasks' : 'Nothing due 🎉'} text="Tasks come from drips, the chatbot, call logs and follow-ups." />}
          renderItem={({ item: t }) => {
            const c = t.contactId;
            const late = t.status === 'open' && isLate(t.dueAt);
            return (
              <View style={{ backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: late ? '#fecaca' : C.border, padding: S.lg, gap: 6 }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Badge tone={late ? 'red' : 'gray'}>{KIND[t.kind] || t.kind}</Badge>
                  <T v="tiny" style={late ? { color: C.red, fontWeight: '600' } : undefined}>{late ? 'Overdue · ' : ''}{fmtDateTime(t.status === 'done' ? t.doneAt : t.dueAt)}</T>
                </Row>
                <T style={{ fontWeight: '600', color: C.text }}>{t.title}</T>
                {c ? (
                  <Pressable onPress={() => router.push(`/lead/${c._id}`)}>
                    <Row wrap gap={6}>
                      <T style={{ color: C.brand700 }}>{displayName(c)}</T>
                      <StatusBadge status={c.leadStatus} />
                    </Row>
                  </Pressable>
                ) : null}
                <T v="tiny">{t.assignedTo?.name ? `For ${t.assignedTo.name}` : 'Not assigned'}{t.sourceName ? ` · ${t.sourceName}` : ''}{t.status === 'done' && t.doneBy?.name ? ` · done by ${t.doneBy.name}` : ''}</T>
                {t.note ? <T v="small">{t.note}</T> : null}
                {t.status === 'open' ? (
                  <Row wrap gap={6} style={{ marginTop: 4 }}>
                    {c ? <LeadActions contact={c} compact onChanged={load} /> : null}
                    <Button size="sm" icon="checkmark-circle" title="Done" onPress={() => setStatus(t, 'done')} />
                    <Button size="sm" variant="ghost" title="Cancel" onPress={async () => (await confirm('Cancel this task?', t.title, { ok: 'Cancel task', danger: true })) && setStatus(t, 'cancelled')} />
                  </Row>
                ) : null}
                {t.status === 'open' && isAdmin && team.length ? (
                  <Select
                    value={t.assignedTo?._id || ''}
                    onChange={(v) => reassign(t, v)}
                    title="Give this task to"
                    options={[{ value: '', label: 'Not assigned' }, ...team.filter((m) => m.isActive !== false).map((m) => ({ value: m._id, label: m._id === session?.user._id ? `${m.name} (me)` : m.name }))]}
                  />
                ) : null}
                {t.status !== 'open' ? (
                  <Button size="sm" variant="ghost" icon="refresh" title="Reopen" onPress={() => setStatus(t, 'open')} style={{ alignSelf: 'flex-start' }} />
                ) : null}
              </View>
            );
          }}
        />
      )}
      {next && <NextFollowUpSheet contact={next.contact} defaultTitle={next.title} onClose={() => { setNext(null); load(); reloadCounts(); }} />}
    </View>
  );
}
