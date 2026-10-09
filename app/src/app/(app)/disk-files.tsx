import { Ionicons } from '@expo/vector-icons';
import { Stack, router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, EmptyState, Loader, Row, T, confirm } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth, useIsAdmin } from '@/lib/auth';
import { downloadAndShare } from '@/lib/files';
import { fmtDateTime, displayName } from '@/lib/format';
import { C, R, S } from '@/theme';

type DiskFile = {
  _id: string;
  fileName?: string;
  size: number;
  url: string;
  direction: 'sent' | 'received';
  status: 'pending' | 'failed';
  attempts?: number;
  lastError?: string;
  nextTryAt?: string;
  createdAt: string;
  contactId?: { _id: string; name?: string; phone?: string } | null;
};
type Data = { items: DiskFile[]; usage: { files: number; bytes: number; failed: number }; storage: { wanted: string; active: string }; limits: { files: number; mb: number } };

const size = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** Admin: chat files kept on this server because Cloudinary failed — open, retry now or delete */
export default function DiskFilesScreen() {
  const toast = useToast();
  const { epoch } = useAuth();
  const isAdmin = useIsAdmin();
  const [data, setData] = useState<Data | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(() => api('/settings/disk-files').then(setData).catch(toast.error).finally(() => setRefreshing(false)), [toast]);
  useEffect(() => {
    load();
  }, [load, epoch]);

  if (!isAdmin) return <EmptyState icon="lock-closed-outline" title="Only the admin can see this" />;
  if (!data) return <Loader />;

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const retry = async (ids?: string[]) => {
    setBusy('retry');
    try {
      const r = await api('/settings/disk-files/retry', { method: 'POST', body: ids ? { ids } : {} });
      toast.success(r.done ? `${r.done} file(s) saved to Cloudinary` : 'Tried again — still waiting');
      setPicked([]);
      load();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy('');
    }
  };
  const remove = async (ids: string[]) => {
    const ok = await confirm(`Delete ${ids.length} file(s) from the server?`, 'They are removed from the disk for good and the chat shows "file removed". Files already delivered stay on the customer\'s WhatsApp.', { ok: 'Delete', danger: true });
    if (!ok) return;
    setBusy('delete');
    try {
      const r = await api('/settings/disk-files', { method: 'DELETE', body: { ids } });
      toast.success(`${r.deleted} file(s) deleted`);
      setPicked([]);
      load();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy('');
    }
  };
  const open = async (f: DiskFile) => {
    setBusy(f._id);
    try {
      await downloadAndShare(f.url, f.fileName || 'file');
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy('');
    }
  };

  const { usage, storage, limits } = data;
  const over = usage.files >= limits.files || usage.bytes >= limits.mb * 1024 * 1024;
  const summary =
    storage.wanted !== 'cloudinary'
      ? 'Files are stored on this server (STORAGE_DRIVER=local). Set STORAGE_DRIVER=cloudinary and the CLOUDINARY_* keys in .env to keep them in the cloud.'
      : usage.files
        ? `${usage.files} file(s) · ${size(usage.bytes)} waiting on the server disk${usage.failed ? ` · ${usage.failed} need your decision` : ''}. They upload to Cloudinary by themselves and are then removed from the disk.${storage.active !== 'cloudinary' ? ' Cloudinary keys are missing in .env.' : ''}${over ? ` Over the alert limit (${limits.files} files / ${limits.mb} MB).` : ''}`
        : '✓ All files are saved on Cloudinary. Nothing is waiting on the server disk.';
  const tone = over ? 'red' : usage.files ? 'amber' : 'green';

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen options={{ title: 'Files on server disk' }} />
      <FlatList
        data={data.items}
        keyExtractor={(f) => f._id}
        contentContainerStyle={{ padding: S.lg, gap: S.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.brand600} />}
        ListHeaderComponent={
          <View style={{ gap: S.md }}>
            <Card style={{ backgroundColor: tone === 'red' ? '#fef2f2' : tone === 'amber' ? '#fffbeb' : '#f0fdf4' }}>
              <T v="small" style={{ color: tone === 'red' ? '#991b1b' : tone === 'amber' ? '#92400e' : '#166534' }}>{summary}</T>
            </Card>
            {data.items.length ? (
              <Row wrap>
                <Button size="sm" variant="secondary" title={picked.length === data.items.length ? 'Clear' : 'Select all'} onPress={() => setPicked(picked.length === data.items.length ? [] : data.items.map((f) => f._id))} />
                <Button size="sm" variant="secondary" icon="refresh" loading={busy === 'retry'} title={picked.length ? `Retry ${picked.length}` : 'Retry all'} onPress={() => retry(picked.length ? picked : undefined)} />
                <Button size="sm" variant="danger" icon="trash-outline" disabled={!picked.length} loading={busy === 'delete'} title={`Delete${picked.length ? ` ${picked.length}` : ''}`} onPress={() => remove(picked)} />
              </Row>
            ) : null}
          </View>
        }
        ListEmptyComponent={<EmptyState icon="cloud-done-outline" title="Nothing on the disk" text="Every chat file is saved on Cloudinary." />}
        renderItem={({ item: f }) => {
          const on = picked.includes(f._id);
          return (
            <Card style={{ gap: 6, borderColor: on ? C.brand600 : C.border, borderWidth: 1 }}>
              <Row style={{ alignItems: 'flex-start' }}>
                <Pressable onPress={() => toggle(f._id)} hitSlop={10} accessibilityLabel={`Select ${f.fileName || 'file'}`}>
                  <Ionicons name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? C.brand600 : C.muted} />
                </Pressable>
                <View style={{ flex: 1, gap: 2 }}>
                  <T style={{ fontWeight: '600', color: C.text }} numberOfLines={2}>{f.fileName || 'file'}</T>
                  <Row wrap gap={6}>
                    <Badge tone={f.status === 'failed' ? 'red' : 'yellow'}>{f.status === 'failed' ? 'needs you' : 'waiting'}</Badge>
                    <T v="tiny">{size(f.size)} · {f.direction === 'received' ? 'from customer' : 'sent'}</T>
                  </Row>
                  {f.contactId ? (
                    <Pressable onPress={() => router.push(`/lead/${f.contactId!._id}`)}>
                      <T v="small" style={{ color: C.brand700 }}>{displayName(f.contactId)}</T>
                    </Pressable>
                  ) : null}
                  <T v="tiny">{fmtDateTime(f.createdAt)}{f.status === 'pending' && f.nextTryAt ? ` · next try ${fmtDateTime(f.nextTryAt)}` : ''}</T>
                  {f.lastError ? <T v="tiny" style={{ color: '#dc2626' }}>{f.lastError}{f.attempts ? ` (${f.attempts} tries)` : ''}</T> : null}
                </View>
              </Row>
              <Row style={{ justifyContent: 'flex-end', borderTopWidth: 1, borderTopColor: C.border, paddingTop: 6, borderRadius: R.sm }}>
                <Button size="sm" variant="ghost" icon="open-outline" title={busy === f._id ? 'Opening…' : 'Open'} onPress={() => open(f)} />
                <Button size="sm" variant="ghost" icon="refresh" title="Retry" onPress={() => retry([f._id])} />
                <Button size="sm" variant="ghost" icon="trash-outline" title="Delete" onPress={() => remove([f._id])} />
              </Row>
            </Card>
          );
        }}
      />
    </View>
  );
}
