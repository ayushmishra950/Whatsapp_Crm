import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { api } from '@/lib/api';
import { useIsAdmin } from '@/lib/auth';
import { LEAD_SOURCES, useLeadStatuses } from '@/lib/business';
import { C, R, S } from '@/theme';
import { DateField } from './date-field';
import { useCustomFields } from './templates-preview';
import { useToast } from './toast';
import { Button, Chip, IconButton, Input, Row, Select, T } from './ui';

/**
 * Smart filter ("segment") for a campaign audience — same shape as the server's services/segments.js:
 * lead status + tags + ads + when they joined / last messaged + field conditions + birthday + exclude tags + source + referred.
 * Live count (POST /segments/count) and saved filters (GET/POST /segments) like the web.
 */
export type Range = { preset?: string; from?: string; to?: string };
export type SegmentFilter = {
  statuses?: string[];
  tags?: string[];
  tagMatch?: 'any' | 'all';
  excludeTags?: string[];
  adIds?: string[];
  sources?: string[];
  joined?: Range;
  lastInbound?: Range;
  fields?: { key: string; op: string; value: string }[];
  dateMatch?: { field?: string; when?: string };
  referred?: '' | 'yes' | 'no';
};
export type SegmentCount = { total: number; optedOut: number; reachable: number };
export type AdSource = { adId: string; name?: string; headline?: string; leads: number };

const PRESETS: [string, string][] = [['', 'Any time'], ['7d', 'Last 7 days'], ['14d', 'Last 14 days'], ['30d', 'Last 1 month'], ['90d', 'Last 3 months'], ['180d', 'Last 6 months'], ['365d', 'Last 12 months'], ['custom', 'Custom dates…']];
const WHEN: [string, string][] = [['', '—'], ['today', 'Today'], ['tomorrow', 'Tomorrow'], ['this_week', 'Next 7 days'], ['this_month', 'This month'], ['next_month', 'Next month']];
const OPS: [string, string][] = [['is', 'is'], ['contains', 'contains'], ['not_empty', 'is filled'], ['empty', 'is empty']];

const toggleIn = (list: string[] = [], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
const opts = (l: [string, string][]) => l.map(([value, label]) => ({ value, label }));
const dayKey = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const fromKey = (k?: string) => {
  if (!k) return null;
  const [y, m, d] = k.split('-').map(Number);
  return y ? new Date(y, m - 1, d) : null;
};

function Part({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <T v="label">{label}</T>
      {children}
    </View>
  );
}

function RangePicker({ value = {}, onChange }: { value?: Range; onChange: (r: Range) => void }) {
  return (
    <View style={{ gap: 6 }}>
      <Select value={value.preset || ''} onChange={(preset) => onChange({ preset })} options={opts(PRESETS)} title="When" />
      {value.preset === 'custom' ? (
        <Row gap={6}>
          <View style={{ flex: 1 }}><DateField mode="date" placeholder="From" clearable value={fromKey(value.from)} onChange={(d) => onChange({ ...value, from: d ? dayKey(d) : '' })} /></View>
          <View style={{ flex: 1 }}><DateField mode="date" placeholder="To" clearable value={fromKey(value.to)} onChange={(d) => onChange({ ...value, to: d ? dayKey(d) : '' })} /></View>
        </Row>
      ) : null}
    </View>
  );
}

export function SegmentBuilder({ value, onChange, onCount, tags, ads }: { value: SegmentFilter; onChange: (f: SegmentFilter) => void; onCount?: (c: SegmentCount) => void; tags: string[]; ads: AdSource[] }) {
  const toast = useToast();
  const isAdmin = useIsAdmin();
  const { list: statuses } = useLeadStatuses();
  const custom = useCustomFields();
  const dateFields = custom.filter((c) => c.type === 'date');
  const [saved, setSaved] = useState<{ _id: string; name: string; filter: SegmentFilter; summary?: string }[]>([]);
  const [count, setCount] = useState<SegmentCount | null>(null);
  const [saveName, setSaveName] = useState<string | null>(null);
  const f = value || {};
  const [more, setMore] = useState(() => !!(f.excludeTags?.length || f.sources?.length || f.fields?.length || f.dateMatch?.when || f.referred));
  const set = (patch: Partial<SegmentFilter>) => onChange({ ...f, ...patch });

  useEffect(() => {
    api('/segments').then(setSaved).catch(() => {});
  }, []);

  // Live count (debounced)
  const key = JSON.stringify(f);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      api<SegmentCount>('/segments/count', { method: 'POST', body: { filter: JSON.parse(key) } })
        .then((r) => {
          if (!alive) return;
          setCount(r);
          onCount?.(r);
        })
        .catch(() => {});
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const fieldOptions = [{ value: 'name', label: 'Name' }, { value: 'email', label: 'Email' }, ...custom.filter((c) => c.type !== 'date').map((c) => ({ value: `custom.${c.key}`, label: c.label }))];

  const saveSegment = async () => {
    try {
      const s = await api('/segments', { method: 'POST', body: { name: (saveName || '').trim(), filter: f } });
      setSaved((l) => [...l, s].sort((a, b) => a.name.localeCompare(b.name)));
      setSaveName(null);
      toast.success(`Filter "${s.name}" saved`);
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <View style={{ gap: S.md, borderWidth: 1, borderColor: C.border, borderRadius: R.md, padding: S.md }}>
      {saved.length || isAdmin ? (
        <View style={{ gap: 6, paddingBottom: S.sm, borderBottomWidth: 1, borderBottomColor: C.soft }}>
          {saved.length ? (
            <Select
              value=""
              placeholder="Load a saved filter…"
              title="Saved filters"
              onChange={(v) => {
                const s = saved.find((x) => x._id === v);
                if (s) {
                  onChange(s.filter);
                  setMore(true);
                }
              }}
              options={saved.map((s) => ({ value: s._id, label: s.name, hint: s.summary }))}
            />
          ) : null}
          {isAdmin && saveName === null ? <Button size="sm" variant="ghost" icon="save-outline" title="Save this filter" onPress={() => setSaveName('')} style={{ alignSelf: 'flex-start' }} /> : null}
          {saveName !== null ? (
            <Row gap={6}>
              <Input style={{ flex: 1 }} autoFocus maxLength={80} placeholder="Name, e.g. Hot PHP leads" value={saveName} onChangeText={setSaveName} />
              <Button size="sm" title="Save" disabled={saveName.trim().length < 2} onPress={saveSegment} />
              <IconButton name="close" label="Cancel" onPress={() => setSaveName(null)} />
            </Row>
          ) : null}
        </View>
      ) : null}

      <Part label="Lead status">
        <Row wrap gap={6}>
          {statuses.map((s) => <Chip key={s.key} label={s.label} active={!!f.statuses?.includes(s.key)} onPress={() => set({ statuses: toggleIn(f.statuses, s.key) })} />)}
        </Row>
      </Part>
      <Part label="Tags">
        <Row wrap gap={6}>
          {!tags.length ? <T v="small">No tags yet</T> : null}
          {tags.map((t) => <Chip key={t} label={t} active={!!f.tags?.includes(t)} onPress={() => set({ tags: toggleIn(f.tags, t) })} />)}
        </Row>
        {(f.tags?.length || 0) > 1 ? <Select value={f.tagMatch || 'any'} title="Tag match" onChange={(v) => set({ tagMatch: v as 'any' | 'all' })} options={[{ value: 'any', label: 'Any of these' }, { value: 'all', label: 'All of these' }]} /> : null}
      </Part>
      {ads.length ? (
        <Part label="From ad">
          <Row wrap gap={6}>
            {ads.map((a) => <Chip key={a.adId} label={`📣 ${a.name || a.headline || a.adId} (${a.leads})`} active={!!f.adIds?.includes(a.adId)} onPress={() => set({ adIds: toggleIn(f.adIds, a.adId) })} />)}
          </Row>
        </Part>
      ) : null}
      <Part label="First contacted us">
        <RangePicker value={f.joined} onChange={(joined) => set({ joined })} />
      </Part>
      <Part label="Last message from them">
        <RangePicker value={f.lastInbound} onChange={(lastInbound) => set({ lastInbound })} />
      </Part>

      {!more ? (
        <Pressable onPress={() => setMore(true)}>
          <T v="small" style={{ color: C.brand700, fontWeight: '600' }}>+ More filters (course / city, birthday, exclude tags, source, referred)</T>
        </Pressable>
      ) : (
        <>
          <Part label="Details (Course, City…)">
            {(f.fields || []).map((c, i) => {
              const patch = (p: Partial<{ key: string; op: string; value: string }>) => set({ fields: (f.fields || []).map((x, j) => (j === i ? { ...x, ...p } : x)) });
              return (
                <View key={i} style={{ gap: 6, padding: S.sm, backgroundColor: C.soft, borderRadius: R.sm }}>
                  <Row gap={6}>
                    <View style={{ flex: 1 }}><Select value={c.key} title="Field" onChange={(k) => patch({ key: k })} options={fieldOptions} /></View>
                    <View style={{ flex: 1 }}><Select value={c.op} title="Condition" onChange={(op) => patch({ op })} options={opts(OPS)} /></View>
                    <IconButton name="close" label="Remove condition" onPress={() => set({ fields: (f.fields || []).filter((_, j) => j !== i) })} />
                  </Row>
                  {['is', 'contains'].includes(c.op) ? <Input value={c.value} placeholder="e.g. PHP" onChangeText={(v) => patch({ value: v })} /> : null}
                </View>
              );
            })}
            <Button size="sm" variant="ghost" icon="add" title="Add condition" style={{ alignSelf: 'flex-start' }} onPress={() => set({ fields: [...(f.fields || []), { key: fieldOptions[2]?.value || 'name', op: 'is', value: '' }] })} />
          </Part>
          {dateFields.length ? (
            <Part label="Birthday / anniversary">
              <Row gap={6}>
                <View style={{ flex: 1 }}>
                  <Select value={f.dateMatch?.field || ''} placeholder="Choose field…" title="Date field" onChange={(field) => set({ dateMatch: { ...f.dateMatch, field } })} options={dateFields.map((d) => ({ value: `custom.${d.key}`, label: d.label }))} />
                </View>
                <View style={{ flex: 1 }}>
                  <Select value={f.dateMatch?.when || ''} title="When" onChange={(when) => set({ dateMatch: { field: f.dateMatch?.field || `custom.${dateFields[0].key}`, when } })} options={opts(WHEN)} />
                </View>
              </Row>
            </Part>
          ) : null}
          <Part label="Without tags">
            <Row wrap gap={6}>
              {tags.map((t) => <Chip key={t} label={t} active={!!f.excludeTags?.includes(t)} onPress={() => set({ excludeTags: toggleIn(f.excludeTags, t) })} />)}
            </Row>
          </Part>
          <Part label="Source">
            <Row wrap gap={6}>
              {LEAD_SOURCES.map(([v, l]) => <Chip key={v} label={l} active={!!f.sources?.includes(v)} onPress={() => set({ sources: toggleIn(f.sources, v) })} />)}
            </Row>
          </Part>
          <Part label="Referred by a friend">
            <Select value={f.referred || ''} title="Referred" onChange={(v) => set({ referred: v as '' | 'yes' | 'no' })} options={[{ value: '', label: "Doesn't matter" }, { value: 'yes', label: 'Yes, referred' }, { value: 'no', label: 'No' }]} />
          </Part>
        </>
      )}

      <Row style={{ justifyContent: 'space-between', backgroundColor: C.soft, borderRadius: R.sm, padding: S.sm }}>
        <T v="small" style={{ flex: 1, color: C.text2 }}>
          <T v="small" style={{ fontWeight: '700', color: C.text }}>{count ? count.reachable : '…'}</T> contacts match
          {count && count.optedOut > 0 ? ` (+${count.optedOut} opted out, skipped)` : ''}
        </T>
        <Pressable onPress={() => onChange({})} hitSlop={8}>
          <T v="tiny" style={{ color: C.muted }}>Clear filter</T>
        </Pressable>
      </Row>
    </View>
  );
}
