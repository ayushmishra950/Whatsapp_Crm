import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, View } from 'react-native';
import { showActionMenu } from '@/components/chat';
import { ChannelBadge } from '@/components/channel';
import { ImportSheet } from '@/components/import-sheet';
import { NewLeadSheet } from '@/components/new-lead';
import { CourseSelect } from '@/components/leads';
import { BulkBar } from '@/components/leads-bulk';
import { ViewsSheet } from '@/components/leads-views';
import { useToast } from '@/components/toast';
import { Avatar, Badge, Button, Chip, ChipBar, EmptyState, Field, Icon, Input, Loader, Row, Select, Sheet, StatusBadge, T, Toggle } from '@/components/ui';
import { api } from '@/lib/api';
import { downloadAndShare } from '@/lib/files';
import { useAuth, useIsCoaching } from '@/lib/auth';
import { LANGUAGES, LEAD_SOURCES, useLeadStatuses } from '@/lib/business';
import { useCourses } from '@/lib/courses';
import { displayName, fmtDate, fmtPhone, fmtRelative, isLate } from '@/lib/format';
import { C, S } from '@/theme';

// adId and a custom date range come only from saved views / links (the other filters have a control below)
const NO_FILTERS = { search: '', leadStatus: '', stage: '', assignedTo: '', course: '', source: '', channel: '', nextAction: '', noReply: '', calls: '', followUp: '', joined: '', tag: '', adId: '', lastInbound: '', createdFrom: '', createdTo: '', language: '', optedOut: '' };
type Filters = typeof NO_FILTERS;
const NEXT: [string, string][] = [['', 'Any next action'], ['none', '⚠️ No next action'], ['overdue', 'Next action overdue'], ['set', 'Has a next action']];
const NO_REPLY: [string, string][] = [['', 'Customer replied: any'], ['1d', 'No reply 1+ day'], ['3d', 'No reply 3+ days'], ['7d', 'No reply 7+ days'], ['14d', 'No reply 14+ days'], ['30d', 'No reply 30+ days']];
const CALLS: [string, string][] = [['', 'Calls: any'], ['none', 'Never called'], ['1', 'Called at least once'], ['3', 'Called 3+ times']];
const FOLLOW: [string, string][] = [['', 'Any follow-up'], ['due', 'Due today'], ['overdue', 'Overdue'], ['upcoming', 'Upcoming'], ['any', 'Has a follow-up']];
const JOINED: [string, string][] = [['', 'Joined: any time'], ['7d', 'Last 7 days'], ['30d', 'Last 1 month'], ['90d', 'Last 3 months'], ['365d', 'Last 12 months']];
const LAST_IN: [string, string][] = [['', 'Messaged us: any time'], ['7d', 'In the last 7 days'], ['14d', 'In the last 14 days'], ['30d', 'In the last 30 days'], ['90d', 'In the last 3 months'], ['180d', 'In the last 6 months'], ['365d', 'In the last 12 months']];
const opts = (l: [string, string][]) => l.map(([value, label]) => ({ value, label }));
const EXTRA: [keyof typeof NO_FILTERS, (v: string) => string][] = [
  ['adId', (v) => `Ad: ${v}`],
  ['createdFrom', (v) => `Added from ${v}`],
  ['createdTo', (v) => `Added until ${v}`],
];

/** All contacts / leads with search, status tabs and filters; tap = lead page */
export default function LeadsScreen() {
  const toast = useToast();
  const { session, epoch } = useAuth();
  const coaching = useIsCoaching();
  const statuses = useLeadStatuses();
  const courses = useCourses();
  const isAdmin = session?.user.role === 'admin';
  // Links from the dashboard / other screens open the tab with a filter: /leads?leadStatus=hot, ?nextAction=none …
  const params = useLocalSearchParams<Partial<Record<keyof Filters, string>>>();
  const paramKey = JSON.stringify(params);
  const fromParams = (): Filters => ({ ...NO_FILTERS, ...Object.fromEntries(Object.entries(params).filter(([k, v]) => k in NO_FILTERS && typeof v === 'string')) });
  const [f, setF] = useState<Filters>(fromParams);
  const [seenParams, setSeenParams] = useState(paramKey);
  if (seenParams !== paramKey) {
    setSeenParams(paramKey);
    setF(fromParams());
  }
  const [items, setItems] = useState<any[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [counts, setCounts] = useState<{ total: number; counts: Record<string, number> } | null>(null);
  const [more, setMore] = useState(false);
  const [importing, setImporting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [team, setTeam] = useState<any[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [viewsOpen, setViewsOpen] = useState(false);
  // Bulk actions: picked rows, or every lead matching the filters
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [allMatching, setAllMatching] = useState(false);
  const filtersKey = JSON.stringify(f);
  const [seenFilters, setSeenFilters] = useState(filtersKey);
  if (seenFilters !== filtersKey) {
    setSeenFilters(filtersKey);
    setSelected([]);
    setAllMatching(false);
  }
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const query = useCallback(
    (p: number) => {
      const stageKeys = f.stage ? statuses.stages.find((s) => s.key === f.stage)?.keys.join(',') : '';
      return { ...f, stage: undefined, leadStatus: f.leadStatus || stageKeys || '', tz: Intl.DateTimeFormat().resolvedOptions().timeZone, page: p, limit: 30 };
    },
    [f, statuses.stages]
  );
  const load = useCallback(
    (p = 1) => {
      if (p > 1) setLoadingMore(true);
      return api('/contacts', { query: query(p) as any })
        .then((r) => {
          setItems((cur) => (p > 1 && cur ? [...cur, ...r.items] : r.items));
          setTotal(r.total);
          setPage(p);
        })
        .catch(toast.error)
        .finally(() => {
          setRefreshing(false);
          setLoadingMore(false);
        });
    },
    [query, toast]
  );
  const loadCounts = useCallback(() => {
    const { leadStatus: _l, ...rest } = query(1);
    api('/contacts/status-counts', { query: rest as any }).then(setCounts).catch(() => {});
  }, [query]);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      load(1);
      loadCounts();
    }, f.search ? 300 : 0);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load, loadCounts, f.search, epoch]);
  useEffect(() => {
    api('/team').then((t) => setTeam(t.filter((m: any) => m.isActive !== false))).catch(() => {});
    api<string[]>('/contacts/tags').then(setTags).catch(() => {});
  }, [epoch]);

  const set = (k: keyof Filters, v: string) => setF((cur) => ({ ...cur, [k]: v, ...(k === 'stage' && { leadStatus: '' }), ...(k === 'source' && v !== 'ad' && { adId: '' }) }));
  const extras = EXTRA.filter(([k]) => f[k]);
  const moreCount = (['source', 'channel', 'noReply', 'calls', 'followUp', 'joined', 'nextAction', 'assignedTo', 'course', 'tag', 'lastInbound', 'language', 'optedOut'] as (keyof Filters)[]).filter((k) => f[k]).length + extras.length;
  // The filters as the server reads them (bulk actions on "all matching", like the web's { filter })
  const bulkFilter: Record<string, string> = Object.fromEntries(
    Object.entries(query(1)).filter(([k, v]) => k !== 'page' && k !== 'limit' && v !== undefined && v !== '').map(([k, v]) => [k, String(v)])
  );
  const savedViewQuery: Record<string, string> = Object.fromEntries(Object.entries(f).filter(([, v]) => v));
  const applyView = (q: Record<string, string>) => setF({ ...NO_FILTERS, ...Object.fromEntries(Object.entries(q).filter(([k, v]) => k in NO_FILTERS && typeof v === 'string')) });
  const exitSelect = () => {
    setSelectMode(false);
    setSelected([]);
    setAllMatching(false);
  };
  const toggleRow = (id: string) => {
    if (allMatching) {
      setAllMatching(false);
      setSelected((items || []).map((c) => c._id).filter((x) => x !== id));
      return;
    }
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };
  const bulkDone = () => {
    exitSelect();
    load(1);
    loadCounts();
  };
  const shownStatuses = statuses.list.filter((s) => !f.stage || s.stage === f.stage);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ padding: S.lg, paddingBottom: S.sm, gap: S.sm, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: C.border }}>
        <Row gap={S.sm}>
          <View style={{ flex: 1 }}><Input placeholder="Search name, phone, email" value={f.search} onChangeText={(v) => set('search', v)} autoCorrect={false} clearButtonMode="while-editing" /></View>
          <Button variant={moreCount ? 'soft' : 'secondary'} icon="options-outline" title={moreCount ? `${moreCount}` : ''} style={{ paddingHorizontal: moreCount ? 8 : 0, minWidth: 40 }} onPress={() => setMore(true)} />
          <Button variant="secondary" icon="bookmark-outline" style={{ paddingHorizontal: 0, width: 40 }} onPress={() => setViewsOpen(true)} />
          {selectMode ? (
            <Button variant="soft" title="Done" style={{ paddingHorizontal: 10 }} onPress={exitSelect} />
          ) : (
            <Button variant="secondary" icon="checkbox-outline" style={{ paddingHorizontal: 0, width: 40 }} onPress={() => setSelectMode(true)} />
          )}
          {!selectMode ? (
            <Button
              variant="secondary"
              icon="ellipsis-horizontal"
              style={{ paddingHorizontal: 0, width: 40 }}
              onPress={() =>
                showActionMenu('Leads', [{ key: 'add', label: '➕ Add a lead (full form)' }, ...(isAdmin ? [{ key: 'import', label: '📥 Import Excel / CSV sheet' }, { key: 'xlsx', label: '📤 Export these leads (Excel)' }, { key: 'csv', label: '📤 Export these leads (CSV)' }] : [])], async (k) => {
                  if (k === 'add') return setAdding(true);
                  if (k === 'import') return setImporting(true);
                  try {
                    const { page: _p, limit: _l, ...q } = query(1) as Record<string, any>;
                    const qs = Object.entries({ ...q, format: k }).filter(([, v]) => v !== undefined && v !== '').map(([a, v]) => `${a}=${encodeURIComponent(String(v))}`).join('&');
                    await downloadAndShare(`/contacts/export?${qs}`, `leads.${k}`);
                  } catch (err) {
                    toast.error(err);
                  }
                })
              }
            />
          ) : null}
        </Row>
        {statuses.stages.length ? (
          <ChipBar options={[['', 'All stages'], ...statuses.stages.map((s) => [s.key, s.label] as [string, string])]} value={f.stage} onChange={(v) => set('stage', v)} />
        ) : null}
        <ChipBar
          options={[['', f.stage ? 'Whole stage' : 'All'], ...shownStatuses.map((s) => [s.key, s.label] as [string, string])]}
          value={f.leadStatus}
          onChange={(v) => set('leadStatus', v)}
          counts={counts ? { '': f.stage ? shownStatuses.reduce((n, s) => n + (counts.counts[s.key] || 0), 0) : counts.total, ...counts.counts } : undefined}
        />
      </View>
      {!items ? (
        <Loader />
      ) : (
        <FlatList
          data={items}
          extraData={[selectMode, selected, allMatching]}
          keyExtractor={(c) => c._id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(1); }} tintColor={C.brand600} />}
          onEndReached={() => !loadingMore && items.length < total && load(page + 1)}
          onEndReachedThreshold={0.4}
          ListHeaderComponent={<T v="tiny" style={{ paddingHorizontal: S.lg, paddingTop: S.sm }}>{total} lead(s)</T>}
          ListFooterComponent={loadingMore ? <ActivityIndicator style={{ margin: 16 }} color={C.brand600} /> : null}
          ListEmptyComponent={<EmptyState icon="people-outline" title="No leads found" text="Change the filters, or add a walk-in with the green + at the top." />}
          ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: C.border, marginLeft: 70 }} />}
          renderItem={({ item: c }) => {
            const next = c.nextActionAt || c.followUpAt;
            const on = allMatching || selected.includes(c._id);
            return (
              <Pressable
                onPress={() => (selectMode ? toggleRow(c._id) : router.push(`/lead/${c._id}`))}
                onLongPress={() => {
                  if (selectMode) return;
                  setSelectMode(true);
                  setSelected([c._id]);
                }}
                style={({ pressed }) => ({ flexDirection: 'row', gap: S.md, padding: S.lg, backgroundColor: pressed ? C.soft : selectMode && on ? C.brand50 : '#fff' })}>
                {selectMode ? (
                  <View style={{ width: 42, height: 42, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={on ? 'checkbox' : 'square-outline'} size={26} color={on ? C.brand600 : C.faint} />
                  </View>
                ) : (
                  <Avatar name={displayName(c).replace(/^[@+]/, '')} size={42} />
                )}
                <View style={{ flex: 1, gap: 3 }}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Row gap={6} style={{ flex: 1 }}>
                      <T style={{ fontWeight: '600', color: C.text, flexShrink: 1 }} numberOfLines={1}>{c.name || (c.instagram?.username ? `@${c.instagram.username}` : 'Unknown')}</T>
                      {c.instagram?.igsid ? <ChannelBadge channel="instagram" /> : null}
                    </Row>
                    <T v="tiny">{fmtDate(c.createdAt)}</T>
                  </Row>
                  <T v="small">{[fmtPhone(c.phone), c.name && c.instagram?.username ? `@${c.instagram.username}` : '', c.assignedTo?.name].filter(Boolean).join(' · ')}</T>
                  <Row wrap gap={4}>
                    <StatusBadge status={c.leadStatus} />
                    {coaching && c.course ? <Badge tone="purple">{c.course}</Badge> : null}
                    {c.optedOut ? <Badge tone="red">opted out</Badge> : null}
                    {next ? <Badge tone={isLate(next) ? 'red' : 'blue'}>⏰ {fmtRelative(next)}</Badge> : <Badge tone="amber">no next action</Badge>}
                    {c.adSource?.sourceId ? <Badge tone="purple">📣 Ad</Badge> : null}
                  </Row>
                </View>
              </Pressable>
            );
          }}
        />
      )}

      {selectMode && items ? (
        <BulkBar
          ids={selected}
          allMatching={allMatching}
          total={total}
          filter={bulkFilter}
          onSelectAll={() => setAllMatching(true)}
          onClear={() => {
            setSelected([]);
            setAllMatching(false);
          }}
          onDone={bulkDone}
        />
      ) : null}
      <ViewsSheet open={viewsOpen} onClose={() => setViewsOpen(false)} current={savedViewQuery} onApply={applyView} />
      <ImportSheet open={importing} onClose={() => setImporting(false)} onImported={() => load(1)} />
      <NewLeadSheet open={adding} onClose={() => setAdding(false)} onAdded={() => { load(1); loadCounts(); }} />
      <Sheet open={more} onClose={() => setMore(false)} title="Filters" full footer={<><Button title="Clear all" variant="ghost" onPress={() => setF({ ...NO_FILTERS, search: f.search })} /><Button title="Show leads" onPress={() => setMore(false)} /></>}>
        <Field label="Counsellor">
          <Select value={f.assignedTo} onChange={(v) => set('assignedTo', v)} title="Counsellor" options={[{ value: '', label: 'All counsellors' }, { value: 'me', label: 'Assigned to me' }, { value: 'none', label: 'Not assigned' }, ...(isAdmin ? team.filter((m) => m._id !== session?.user._id).map((m) => ({ value: m._id, label: m.name })) : [])]} />
        </Field>
        {coaching && courses.list.length ? <Field label="Course"><CourseSelect value={f.course} onChange={(v) => set('course', v)} placeholder="All courses" /></Field> : null}
        <Field label="Next action"><Select value={f.nextAction} onChange={(v) => set('nextAction', v)} options={opts(NEXT)} title="Next action" /></Field>
        <Field label="Follow-up"><Select value={f.followUp} onChange={(v) => set('followUp', v)} options={opts(FOLLOW)} title="Follow-up" /></Field>
        <Field label="Customer replied"><Select value={f.noReply} onChange={(v) => set('noReply', v)} options={opts(NO_REPLY)} title="Customer replied" /></Field>
        <Field label="Calls"><Select value={f.calls} onChange={(v) => set('calls', v)} options={opts(CALLS)} title="Calls" /></Field>
        <Field label="Joined"><Select value={f.joined} onChange={(v) => set('joined', v)} options={opts(JOINED)} title="Joined" /></Field>
        <Field label="App">
          <Select value={f.channel} onChange={(v) => set('channel', v)} title="App" options={[{ value: '', label: 'WhatsApp + Instagram' }, { value: 'whatsapp', label: 'Has a WhatsApp number' }, { value: 'instagram', label: 'Wrote on Instagram' }]} />
        </Field>
        <Field label="Tag"><Select value={f.tag} onChange={(v) => set('tag', v)} title="Tag" options={[{ value: '', label: 'Any tag' }, ...tags.map((t) => ({ value: t, label: t }))]} /></Field>
        <Field label="Last message from the customer"><Select value={f.lastInbound} onChange={(v) => set('lastInbound', v)} options={opts(LAST_IN)} title="Messaged us" /></Field>
        {coaching ? <Field label="Language"><Select value={f.language} onChange={(v) => set('language', v)} title="Language" options={[{ value: '', label: 'Any language' }, ...LANGUAGES.filter(([v]) => v).map(([value, label]) => ({ value, label }))]} /></Field> : null}
        <Toggle value={f.optedOut === 'true'} onChange={(v) => set('optedOut', v ? 'true' : '')} label="Opted out only" description="Leads who said stop to bulk messages" />
        {extras.length ? (
          <Field label="Also filtering by (tap to remove)">
            <Row wrap gap={6}>
              {extras.map(([k, label]) => <Chip key={k} active label={`✕ ${label(f[k])}`} onPress={() => set(k, '')} />)}
            </Row>
          </Field>
        ) : null}
        <Field label="Source">
          <Row wrap gap={6}>
            <Chip label="All" active={!f.source} onPress={() => set('source', '')} />
            {LEAD_SOURCES.map(([v, l]) => <Chip key={v} label={v === 'ad' ? `📣 ${l}` : l} active={f.source === v} onPress={() => set('source', v)} />)}
          </Row>
        </Field>
      </Sheet>
    </View>
  );
}
