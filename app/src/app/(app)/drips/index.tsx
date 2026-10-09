import { Stack, router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { DRIP_GROUPS, IDEAS, dripNumber, groupOf, triggerSummary, useContactFields, type Drip } from '@/components/drips-shared';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, ChipBar, Divider, EmptyState, Icon, IconButton, Input, Loader, Row, Select, Sheet, T, Toggle, confirm } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth, useIsAdmin } from '@/lib/auth';
import { useLeadStatuses } from '@/lib/business';
import { useSocketEvent } from '@/lib/socket';
import { C, S } from '@/theme';

const SORTS: [string, string][] = [['playbook', 'Playbook order (D1, D2…)'], ['name', 'Name A–Z'], ['active', 'Most people in progress'], ['sent', 'Most messages sent'], ['newest', 'Newest first']];
const STATUS: Record<string, [string, string]> = { active: ['On', 'green'], paused: ['Paused', 'yellow'], draft: ['Off', 'gray'] };

/** Drips & automations (admin): playbook batches, on / off, open to edit */
export default function DripsScreen() {
  const toast = useToast();
  const { epoch } = useAuth();
  const isAdmin = useIsAdmin();
  const { label: statusLabel } = useLeadStatuses();
  const { label: fieldLabel } = useContactFields();
  const [items, setItems] = useState<Drip[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState('');
  const [q, setQ] = useState('');
  const [show, setShow] = useState('all');
  const [sort, setSort] = useState('playbook');
  const [batches, setBatches] = useState(true);
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [ideas, setIdeas] = useState(false);

  const load = useCallback(
    () =>
      api<Drip[]>('/drips')
        .then(setItems)
        .catch(toast.error)
        .finally(() => setRefreshing(false)),
    [toast]
  );
  useEffect(() => {
    if (isAdmin) load();
  }, [load, epoch, isAdmin]);
  useSocketEvent('drip:update', () => load(), epoch);

  const summary = (d: Drip) => triggerSummary(d.trigger, { statusLabel, fieldLabel });

  const setStatus = async (d: Drip, status: 'active' | 'paused') => {
    const ok = await confirm(
      status === 'active' ? `Turn on "${d.name}"?` : `Pause "${d.name}"?`,
      status === 'active'
        ? `From now on, leads that match (${summary(d)}) start getting its ${d.steps.length} step(s) automatically — only with approved templates, never in quiet hours and within the daily limit (Settings → Automation). Open the drip first if you want to check the messages.`
        : 'No new people join and no more messages go out until you turn it on again. People in it keep their place.',
      { ok: status === 'active' ? 'Turn on' : 'Pause', danger: status !== 'active' }
    );
    if (!ok) return;
    setBusy(d._id);
    try {
      await api(`/drips/${d._id}/status`, { method: 'POST', body: { status } });
      toast.success(status === 'active' ? 'Drip is ON' : 'Drip paused');
      load();
    } catch (err) {
      toast.error(err); // e.g. "Fill these in Settings → Message info first…"
    } finally {
      setBusy('');
    }
  };

  const remove = async (d: Drip) => {
    if (!(await confirm('Delete drip?', `"${d.name}" and its history will be deleted. People in it will not get the remaining messages.`, { ok: 'Delete', danger: true }))) return;
    try {
      await api(`/drips/${d._id}`, { method: 'DELETE' });
      toast.success('Drip deleted');
      load();
    } catch (err) {
      toast.error(err);
    }
  };

  const header = <Stack.Screen options={{ title: 'Drips & automations', headerRight: isAdmin ? () => <IconButton name="add" color={C.brand700} label="New drip" onPress={() => setIdeas(true)} /> : undefined }} />;
  if (!isAdmin) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        {header}
        <EmptyState icon="lock-closed-outline" title="Only admins manage drips" />
      </View>
    );
  }
  if (!items) {
    return (
      <>
        {header}
        <Loader />
      </>
    );
  }

  const term = q.trim().toLowerCase();
  const shown = items
    .filter((d) => (show === 'all' ? true : show === 'active' ? d.status === 'active' : d.status !== 'active'))
    .filter((d) => !term || d.name.toLowerCase().includes(term))
    .sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'active') return (b.stats.active || 0) - (a.stats.active || 0);
      if (sort === 'sent') return (b.stats.sent || 0) - (a.stats.sent || 0);
      if (sort === 'newest') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      return (dripNumber(a.name) ?? 999) - (dripNumber(b.name) ?? 999) || a.name.localeCompare(b.name);
    });
  const groups = batches
    ? [...DRIP_GROUPS, { key: 'mine', label: '✍️ Your own drips' }].map((g) => ({ key: g.key, label: g.label, drips: shown.filter((d) => groupOf(d.name) === g.key) })).filter((g) => g.drips.length)
    : [{ key: 'all', label: '', drips: shown }];
  const onCount = items.filter((d) => d.status === 'active').length;

  const row = (d: Drip, i: number) => {
    const [label, tone] = STATUS[d.status] || STATUS.draft;
    return (
      <View key={d._id}>
        {i ? <Divider /> : null}
        <Pressable onPress={() => router.push(`/drips/${d._id}`)} style={({ pressed }) => [{ padding: S.md, gap: 6 }, pressed && { backgroundColor: C.soft }]}>
          <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <T style={{ flex: 1, color: C.text, fontWeight: '600' }}>{d.name}</T>
            <Badge tone={tone}>{label}</Badge>
          </Row>
          <T v="small">⚡ {summary(d)} · {d.steps.length} step(s)</T>
          <Row wrap gap={6}>
            <Badge tone="blue">{`${d.stats.active || 0} in progress`}</Badge>
            <Badge tone="green">{`${d.stats.sent || 0} sent`}</Badge>
            <Badge tone="purple">{`${d.stats.replied || 0} replied`}</Badge>
            <Badge>{`${d.stats.completed || 0} finished`}</Badge>
            {(d.stats.failed || 0) > 0 ? <Badge tone="red">{`${d.stats.failed} failed / skipped`}</Badge> : null}
          </Row>
          <Row gap={6} style={{ marginTop: 2 }}>
            {d.status === 'active' ? (
              <Button size="sm" variant="secondary" icon="pause" title="Pause" loading={busy === d._id} onPress={() => setStatus(d, 'paused')} />
            ) : (
              <Button size="sm" icon="play" title="Turn on" loading={busy === d._id} onPress={() => setStatus(d, 'active')} />
            )}
            <Button size="sm" variant="secondary" icon="create-outline" title="Open" onPress={() => router.push(`/drips/${d._id}`)} />
            <View style={{ flex: 1 }} />
            <IconButton name="trash-outline" color={C.red} label="Delete drip" onPress={() => remove(d)} />
          </Row>
        </Pressable>
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {header}
      <FlatList
        data={groups}
        keyExtractor={(g) => g.key}
        contentContainerStyle={{ padding: S.lg, gap: S.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.brand600} />}
        ListHeaderComponent={
          <View style={{ gap: S.sm }}>
            <T v="small">Messages that go out by themselves over days: welcome series, follow-ups, birthday offers, refer & earn. Only approved templates are sent (WhatsApp rule).</T>
            {items.length ? (
              <>
                <Input placeholder="Search drips" value={q} onChangeText={setQ} autoCorrect={false} />
                <ChipBar options={[['all', `All (${items.length})`], ['active', `On (${onCount})`], ['off', `Off (${items.length - onCount})`]]} value={show} onChange={setShow} />
                <Select value={sort} options={SORTS.map(([value, label]) => ({ value, label }))} onChange={setSort} title="Sort" />
                <Toggle value={batches} onChange={setBatches} label="Show in batches" />
              </>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          items.length ? (
            <Card><T v="small" style={{ textAlign: 'center' }}>No drip matches.</T></Card>
          ) : (
            <EmptyState icon="git-branch-outline" title="No drips yet" text="Start from an idea or create your own." action={<Button title="New drip" icon="add" onPress={() => setIdeas(true)} />} />
          )
        }
        renderItem={({ item: g }) => {
          const on = g.drips.filter((d) => d.status === 'active').length;
          const isClosed = closed[g.key];
          return (
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {g.label ? (
                <Pressable onPress={() => setClosed((c) => ({ ...c, [g.key]: !c[g.key] }))} style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, padding: S.md, backgroundColor: C.soft }}>
                  <Icon name={isClosed ? 'chevron-forward' : 'chevron-down'} size={16} color={C.faint} />
                  <View style={{ flex: 1 }}>
                    <T style={{ color: C.text, fontWeight: '600' }}>{g.label}</T>
                    <T v="tiny">{g.drips.length} drip(s) · {on} on</T>
                  </View>
                </Pressable>
              ) : null}
              {!isClosed ? g.drips.map(row) : null}
            </Card>
          );
        }}
      />
      <Sheet open={ideas} onClose={() => setIdeas(false)} title="New drip">
        <T v="small">Start from an idea (pre-filled, you pick the templates) or from scratch.</T>
        {IDEAS.map((i) => (
          <Card key={i.id} onPress={() => { setIdeas(false); router.push(`/drips/new?idea=${i.id}`); }} style={{ padding: S.md, gap: 2 }}>
            <T style={{ color: C.text, fontWeight: '600' }}>{i.icon} {i.title}</T>
            <T v="small">{i.text}</T>
          </Card>
        ))}
        <Button variant="secondary" icon="create-outline" title="Start from scratch" onPress={() => { setIdeas(false); router.push('/drips/new'); }} />
      </Sheet>
    </View>
  );
}
