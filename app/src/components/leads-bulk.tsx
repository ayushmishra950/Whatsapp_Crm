import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { api } from '@/lib/api';
import { useIsAdmin } from '@/lib/auth';
import { useLeadStatuses } from '@/lib/business';
import { C, R, S } from '@/theme';
import { useCanBroadcast } from './campaigns-common';
import { TagInput } from './drips-shared';
import { useToast } from './toast';
import { Button, Chip, Field, Icon, Loader, Row, Select, Sheet, T, confirm } from './ui';

/** The Leads filters as sent to the server ({ filter } of a bulk action), without empty values */
export type LeadFilter = Record<string, string>;

/**
 * Bottom bar while selecting leads (same actions as the web Contacts page):
 * change status, add / remove tags, send a bulk WhatsApp message, add to a drip (admin), delete (admin).
 * Works on the picked rows ({ ids }) or on every lead matching the filters ({ filter }) when allMatching is on.
 */
export function BulkBar({
  ids,
  allMatching,
  total,
  filter,
  onSelectAll,
  onClear,
  onDone,
}: {
  ids: string[];
  allMatching: boolean;
  total: number;
  filter: LeadFilter;
  onSelectAll: () => void;
  onClear: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const isAdmin = useIsAdmin();
  const canBroadcast = useCanBroadcast();
  const statuses = useLeadStatuses();
  const [busy, setBusy] = useState('');
  const [statusOpen, setStatusOpen] = useState(false);
  const [tagAction, setTagAction] = useState<'add' | 'remove' | null>(null);
  const [dripOpen, setDripOpen] = useState(false);
  const count = allMatching ? total : ids.length;
  const target = () => (allMatching ? { filter } : { ids });
  // Contact ids for actions that need them (drip, campaign): everything matching = ask the server (opted-out skipped)
  const getIds = async () => (allMatching ? (await api<{ ids: string[] }>('/contacts/ids', { method: 'POST', body: { filter } })).ids : ids);

  const bulkStatus = async (leadStatus: string) => {
    setStatusOpen(false);
    const ok = await confirm('Change status?', `${count} lead(s) will move to “${statuses.label(leadStatus)}”. Their old status drips stop and this status's drip starts (if one is on).`, { ok: 'Change status' });
    if (!ok) return;
    setBusy('status');
    try {
      const r = await api<{ updated: number }>('/contacts/bulk-status', { method: 'POST', body: { ...target(), leadStatus } });
      toast.success(`Status changed for ${r.updated} contact(s)`);
      onDone();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy('');
    }
  };

  const sendCampaign = async () => {
    setBusy('campaign');
    try {
      const keys = Object.keys(filter).filter((k) => k !== 'tz');
      if (allMatching && !keys.length) {
        // Everyone: the campaign's own "All contacts" audience
        router.push({ pathname: '/campaigns/new', params: { label: 'All contacts' } });
      } else if (allMatching && keys.length === 1 && keys[0] === 'leadStatus') {
        const list = filter.leadStatus.split(',').filter(Boolean);
        router.push({ pathname: '/campaigns/new', params: { statuses: list.join(','), label: `Leads with status ${list.map((s) => statuses.label(s)).join(', ')}` } });
      } else if (allMatching && keys.length === 1 && keys[0] === 'tag') {
        router.push({ pathname: '/campaigns/new', params: { tags: filter.tag, label: `Leads tagged ${filter.tag}` } });
      } else {
        const list = await getIds();
        if (!list.length) throw new Error('No contacts to message (opted-out contacts are skipped)');
        router.push({ pathname: '/campaigns/new', params: { ids: list.join(','), label: `${list.length} contacts picked on the Leads tab` } });
      }
      onDone();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy('');
    }
  };

  const remove = async () => {
    const ok = await confirm('Delete contacts?', `Delete ${count} contacts and their chat history? This can not be undone.`, { ok: 'Delete', danger: true });
    if (!ok) return;
    setBusy('delete');
    try {
      const r = await api<{ deleted: number }>('/contacts/bulk-delete', { method: 'POST', body: target() });
      toast.success(`Deleted ${r.deleted} contact(s)`);
      onDone();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy('');
    }
  };

  return (
    <View style={{ backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: C.border, paddingTop: S.sm, paddingBottom: S.sm, gap: S.sm }}>
      <Row style={{ paddingHorizontal: S.lg }} gap={S.sm}>
        <T style={{ fontWeight: '700', color: C.text }}>{count} selected</T>
        {!allMatching && total > ids.length ? (
          <Pressable onPress={onSelectAll} hitSlop={6}>
            <T v="small" style={{ color: C.brand700, textDecorationLine: 'underline' }}>Select all {total} matching</T>
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }} />
        {count ? (
          <Pressable onPress={onClear} hitSlop={6}>
            <T v="small" style={{ textDecorationLine: 'underline' }}>Clear</T>
          </Pressable>
        ) : null}
      </Row>
      {count ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: S.sm, paddingHorizontal: S.lg }} keyboardShouldPersistTaps="handled">
          <Button size="sm" variant="secondary" icon="swap-horizontal" title="Status" loading={busy === 'status'} onPress={() => setStatusOpen(true)} />
          <Button size="sm" variant="secondary" icon="pricetag-outline" title="Add tag" onPress={() => setTagAction('add')} />
          <Button size="sm" variant="secondary" title="Remove tag" onPress={() => setTagAction('remove')} />
          {canBroadcast ? <Button size="sm" icon="megaphone-outline" title="Send bulk message" loading={busy === 'campaign'} onPress={sendCampaign} /> : null}
          {isAdmin ? <Button size="sm" variant="secondary" icon="git-network-outline" title="Add to drip" onPress={() => setDripOpen(true)} /> : null}
          {isAdmin ? <Button size="sm" variant="danger" icon="trash-outline" title="Delete" loading={busy === 'delete'} onPress={remove} /> : null}
        </ScrollView>
      ) : (
        <T v="small" style={{ paddingHorizontal: S.lg }}>Tap leads to select them (or select all {total} matching).</T>
      )}

      <Sheet open={statusOpen} onClose={() => setStatusOpen(false)} title={`Change status of ${count} lead(s) to…`}>
        {statuses.list.map((s) => (
          <Pressable key={s.key} onPress={() => bulkStatus(s.key)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingVertical: 12, paddingHorizontal: S.sm, borderRadius: R.sm, backgroundColor: pressed ? C.soft : 'transparent' })}>
            <T style={{ flex: 1, color: C.text }}>{s.label}</T>
            <Icon name="chevron-forward" size={16} color={C.faint} />
          </Pressable>
        ))}
      </Sheet>
      {tagAction ? <BulkTagSheet action={tagAction} count={count} target={target()} onClose={() => setTagAction(null)} onDone={onDone} /> : null}
      {dripOpen ? <AddToDripSheet count={count} getIds={getIds} onClose={() => setDripOpen(false)} onDone={onDone} /> : null}
    </View>
  );
}

/** Add / remove tags on the selected leads */
function BulkTagSheet({ action, count, target, onClose, onDone }: { action: 'add' | 'remove'; count: number; target: object; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [tags, setTags] = useState<string[]>([]);
  const [known, setKnown] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<string[]>('/contacts/tags').then(setKnown).catch(() => {});
  }, []);
  const apply = async () => {
    setBusy(true);
    try {
      const r = await api<{ updated: number }>('/contacts/bulk-tag', { method: 'POST', body: { ...target, tags, action } });
      toast.success(`Tags updated for ${r.updated} contact(s)`);
      onClose();
      onDone();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  const suggestions = known.filter((t) => !tags.includes(t));
  return (
    <Sheet open onClose={onClose} title={action === 'add' ? 'Add tags' : 'Remove tags'} footer={<><Button title="Cancel" variant="secondary" onPress={onClose} /><Button title={`Apply to ${count}`} loading={busy} disabled={!tags.length} onPress={apply} /></>}>
      <Field label="Tags" hint="Type a tag and press Enter (or separate with commas). Tags are saved in lowercase.">
        <TagInput value={tags} onChange={setTags} lower placeholder="e.g. diwali-offer" />
      </Field>
      {suggestions.length ? (
        <Field label="Existing tags">
          <Row wrap gap={6}>
            {suggestions.slice(0, 40).map((t) => <Chip key={t} label={`+ ${t}`} onPress={() => setTags((s) => [...s, t])} />)}
          </Row>
        </Field>
      ) : null}
    </Sheet>
  );
}

/** Put the selected leads into a drip (admin) */
function AddToDripSheet({ count, getIds, onClose, onDone }: { count: number; getIds: () => Promise<string[]>; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [drips, setDrips] = useState<any[] | null>(null);
  const [dripId, setDripId] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<any[]>('/drips')
      .then((d) => setDrips(d.filter((x) => x.trigger?.type !== 'date')))
      .catch((err) => {
        toast.error(err);
        setDrips([]);
      });
  }, [toast]);
  const add = async () => {
    setBusy(true);
    try {
      const contactIds = await getIds();
      const r = await api<{ added: number; alreadyIn: number }>(`/drips/${dripId}/enroll`, { method: 'POST', body: { contactIds } });
      const d = drips?.find((x) => x._id === dripId);
      toast.success(`${r.added} contact(s) added to "${d?.name}"${r.alreadyIn ? ` (${r.alreadyIn} already in it or opted out)` : ''}${d?.status !== 'active' ? '. Turn the drip on to start sending.' : ''}`);
      onClose();
      onDone();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open onClose={onClose} title={`Add ${count} contact(s) to a drip`} footer={<><Button title="Cancel" variant="secondary" onPress={onClose} /><Button title="Add" loading={busy} disabled={!dripId} onPress={add} /></>}>
      {!drips ? (
        <View style={{ height: 80 }}><Loader /></View>
      ) : !drips.length ? (
        <T>No drips yet. Create one in Drips &amp; automations.</T>
      ) : (
        <Field label="Drip" hint="Opted-out contacts and people already in it are skipped.">
          <Select value={dripId} onChange={setDripId} title="Drip" options={drips.map((d) => ({ value: d._id, label: `${d.name}${d.status !== 'active' ? ` (${d.status})` : ''}` }))} />
        </Field>
      )}
    </Sheet>
  );
}
