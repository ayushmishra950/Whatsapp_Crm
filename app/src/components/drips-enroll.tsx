import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDateTime, fmtPhone } from '@/lib/format';
import { useSocketEvent } from '@/lib/socket';
import { C, S } from '@/theme';
import { SegmentBuilder, type AdSource, type SegmentCount, type SegmentFilter } from './campaigns-segment';
import { STOP_REASONS } from './drips-shared';
import { useToast } from './toast';
import { Badge, Button, Card, ChipBar, Divider, IconButton, Row, SectionTitle, Sheet, StatusBadge, T, confirm } from './ui';

const STATUS_TONE: Record<string, string> = { active: 'blue', sending: 'blue', completed: 'green', stopped: 'gray' };
const STATUS_LABEL: Record<string, string> = { active: 'In progress', sending: 'In progress', completed: 'Finished', stopped: 'Stopped' };

/** People in a drip: filter, next step, remove one */
export function Enrollments({ dripId, reloadKey }: { dripId: string; reloadKey?: number }) {
  const toast = useToast();
  const { epoch } = useAuth();
  const [status, setStatus] = useState('');
  const [limit, setLimit] = useState(30);
  const [data, setData] = useState<{ items: any[]; total: number } | null>(null);

  const load = useCallback(() => api(`/drips/${dripId}/enrollments`, { query: { status, limit, page: 1 } }).then(setData).catch(() => {}), [dripId, status, limit]);
  useEffect(() => {
    load();
  }, [load, epoch, reloadKey]);
  useSocketEvent('drip:update', (u: any) => u?._id === dripId && load(), epoch);

  const remove = async (e: any) => {
    if (!(await confirm('Remove from drip?', `${e.contactId?.name || 'This contact'} will not get the remaining messages.`, { ok: 'Remove', danger: true }))) return;
    try {
      await api(`/drips/${dripId}/enrollments/${e._id}`, { method: 'DELETE' });
      toast.success('Removed from the drip');
      load();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <View style={{ gap: S.sm }}>
      <SectionTitle hint={data ? `${data.total} in total` : undefined}>People in this drip</SectionTitle>
      <ChipBar
        options={[['', 'All'], ['active', 'In progress'], ['completed', 'Finished'], ['stopped', 'Stopped']]}
        value={status}
        onChange={(v) => {
          setStatus(v);
          setLimit(30);
        }}
      />
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {!data ? (
          <T v="small" style={{ padding: S.lg, textAlign: 'center' }}>Loading…</T>
        ) : !data.items.length ? (
          <T v="small" style={{ padding: S.lg, textAlign: 'center' }}>Nobody here yet.</T>
        ) : (
          data.items.map((e, i) => {
            const running = ['active', 'sending'].includes(e.status);
            const last = e.history?.[e.history.length - 1];
            const note = e.lastError || (last?.status === 'skipped' ? last.error : '');
            const sent = (e.history || []).filter((h: any) => h.status === 'sent').length;
            return (
              <View key={e._id}>
                {i ? <Divider /> : null}
                <Row style={{ padding: S.md, alignItems: 'flex-start' }} gap={S.sm}>
                  <Pressable style={{ flex: 1, gap: 3 }} onPress={() => e.contactId?._id && router.push(`/lead/${e.contactId._id}`)}>
                    <Row wrap gap={6}>
                      <T style={{ color: C.text, fontWeight: '600' }}>{e.contactId?.name || 'Unknown'}</T>
                      <StatusBadge status={e.contactId?.leadStatus} />
                    </Row>
                    <T v="small">{fmtPhone(e.contactId?.phone)}</T>
                    <Row wrap gap={6}>
                      <Badge tone={STATUS_TONE[e.status] || 'gray'}>{STATUS_LABEL[e.status] || e.status}</Badge>
                      {e.stoppedReason ? <T v="tiny">{STOP_REASONS[e.stoppedReason] || e.stoppedReason}</T> : null}
                      <T v="tiny">{sent} step(s) done</T>
                    </Row>
                    {running && e.nextRunAt ? <T v="tiny">Next step: {fmtDateTime(e.nextRunAt)}</T> : null}
                    {note ? <T v="tiny" style={{ color: C.amber }}>{note}</T> : null}
                  </Pressable>
                  {running ? <IconButton name="close-circle-outline" color={C.muted} label="Remove from drip" onPress={() => remove(e)} /> : null}
                </Row>
              </View>
            );
          })
        )}
      </Card>
      {data && data.items.length < data.total && limit < 100 ? <Button variant="ghost" title="Show more" onPress={() => setLimit(100)} /> : null}
      {data && data.items.length < data.total && limit >= 100 ? <T v="tiny" style={{ textAlign: 'center' }}>Showing the latest 100. Use the web for the full list.</T> : null}
    </View>
  );
}

/** Same "empty" check as the web: a filter with no condition adds everyone */
const isEmptyFilter = (f: SegmentFilter) =>
  !Object.entries(f).some(([k, v]) => {
    if (k === 'tagMatch' || v === '' || v === undefined || v === null) return false;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'object') return Object.values(v as Record<string, unknown>).some(Boolean);
    return true;
  });

/** Add people to a drip by a smart filter (status, tags, ads, dates, fields, birthday, source…) or a saved filter — like the web */
export function EnrollSheet({ dripId, onClose, onDone }: { dripId: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [filter, setFilter] = useState<SegmentFilter>({});
  const [allTags, setAllTags] = useState<string[]>([]);
  const [ads, setAds] = useState<AdSource[]>([]);
  const [count, setCount] = useState<SegmentCount | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<string[]>('/contacts/tags').then(setAllTags).catch(() => {});
    api<AdSource[]>('/contacts/ad-sources').then(setAds).catch(() => {});
  }, []);

  const enroll = async () => {
    if (isEmptyFilter(filter) && !(await confirm('Add everyone?', `No filter chosen: all ${count?.reachable ?? ''} contacts will be added.`, { ok: 'Add everyone' }))) return;
    setBusy(true);
    try {
      const r = await api(`/drips/${dripId}/enroll`, { method: 'POST', body: { filter } });
      toast.success(`${r.added} contact(s) added${r.alreadyIn ? ` (${r.alreadyIn} were already in it)` : ''}`);
      onDone();
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open
      full
      onClose={onClose}
      title="Add people to this drip"
      footer={
        <>
          <Button title="Cancel" variant="secondary" onPress={onClose} />
          <Button title={`Add ${count?.reachable ?? ''} contacts`} icon="person-add" loading={busy} disabled={!count?.reachable} onPress={enroll} />
        </>
      }>
      <T v="small">Choose who to add, e.g. lead status Converted for old students (refer & earn), or load a saved filter. Opted-out contacts are never added.</T>
      <SegmentBuilder value={filter} onChange={setFilter} onCount={setCount} tags={allTags} ads={ads} />
    </Sheet>
  );
}
