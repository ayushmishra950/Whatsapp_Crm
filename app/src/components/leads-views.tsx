import { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { api } from '@/lib/api';
import { useAuth, useIsAdmin } from '@/lib/auth';
import { C, R, S } from '@/theme';
import { useToast } from './toast';
import { Badge, Button, Field, Icon, IconButton, Input, Loader, Row, Sheet, T, Toggle, confirm } from './ui';

export type SavedView = { _id: string; name: string; shared: boolean; mine: boolean; query: Record<string, string>; userId?: { name?: string } | string };

/**
 * Saved views of the Leads filters (same as the web Contacts page): own views + views an admin shared with the team.
 * Tap = apply its filters; save the current filters (admins can share with the team); delete own (admins: any).
 */
export function ViewsSheet({ open, onClose, current, onApply }: { open: boolean; onClose: () => void; current: Record<string, string>; onApply: (query: Record<string, string>) => void }) {
  const toast = useToast();
  const { epoch } = useAuth();
  const isAdmin = useIsAdmin();
  const [views, setViews] = useState<SavedView[] | null>(null);
  const [saving, setSaving] = useState<{ name: string; shared: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const hasFilters = Object.values(current).some(Boolean);

  const load = useCallback(() => api<SavedView[]>('/views', { query: { page: 'contacts' } }).then(setViews).catch(toast.error), [toast]);
  useEffect(() => {
    if (open) load();
  }, [open, load, epoch]);

  const close = () => {
    setSaving(null);
    onClose();
  };
  const store = async () => {
    if (!saving) return;
    setBusy(true);
    try {
      const query = Object.fromEntries(Object.entries(current).filter(([, v]) => v).map(([k, v]) => [k, String(v)]));
      await api('/views', { method: 'POST', body: { page: 'contacts', name: saving.name.trim(), shared: isAdmin && saving.shared, query } });
      toast.success(`View "${saving.name.trim()}" saved`);
      setSaving(null);
      load();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (v: SavedView) => {
    if (!(await confirm('Delete view?', `“${v.name}” will be removed${v.shared ? ' for the whole team' : ''}.`, { ok: 'Delete', danger: true }))) return;
    try {
      await api(`/views/${v._id}`, { method: 'DELETE' });
      toast.success('View deleted');
      load();
    } catch (err) {
      toast.error(err);
    }
  };

  if (saving) {
    return (
      <Sheet open={open} onClose={close} title="Save current filters" footer={<><Button title="Cancel" variant="secondary" onPress={() => setSaving(null)} /><Button title="Save view" loading={busy} disabled={!saving.name.trim()} onPress={store} /></>}>
        <Field label="View name">
          <Input autoFocus maxLength={60} value={saving.name} placeholder="e.g. My hot leads – no reply 3 days" onChangeText={(name) => setSaving({ ...saving, name })} />
        </Field>
        {isAdmin ? <Toggle value={saving.shared} onChange={(shared) => setSaving({ ...saving, shared })} label="Share with the whole team" description="Counsellors see it in their saved views too." /> : null}
      </Sheet>
    );
  }

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Saved views"
      footer={<Button icon="add" title="Save current filters" variant="secondary" disabled={!hasFilters} onPress={() => setSaving({ name: '', shared: false })} />}>
      {!views ? (
        <View style={{ height: 80 }}><Loader /></View>
      ) : !views.length ? (
        <T v="small">No saved views yet. Set some filters, then save them here (e.g. “My hot leads today”).</T>
      ) : (
        views.map((v) => (
          <Row key={v._id} gap={S.xs}>
            <Pressable
              onPress={() => {
                onApply(v.query || {});
                close();
              }}
              style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingVertical: 12, paddingHorizontal: S.sm, borderRadius: R.sm, backgroundColor: pressed ? C.soft : 'transparent' })}>
              <Icon name="bookmark-outline" size={18} color={C.brand700} />
              <T style={{ flex: 1, color: C.text }} numberOfLines={1}>{v.name}</T>
              {v.shared ? <Badge tone="purple">team</Badge> : null}
            </Pressable>
            {v.mine || isAdmin ? <IconButton name="trash-outline" size={18} color={C.faint} label={`Delete view ${v.name}`} onPress={() => remove(v)} /> : null}
          </Row>
        ))
      )}
      {!hasFilters ? <T v="tiny">Set some filters first to save them as a view.</T> : null}
    </Sheet>
  );
}
