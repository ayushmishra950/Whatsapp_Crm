import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { api } from '@/lib/api';
import { fmtPhone, fmtRelative, displayName } from '@/lib/format';
import { C, S } from '@/theme';
import { Button, Divider, ListRow, Sheet, StatusBadge, T } from './ui';

/**
 * Leads of one ad / course in a sheet (GET /contacts with a filter, e.g. { adId } or { course });
 * a row opens the lead page.
 */
export function LeadsSheet({ title, query, onClose }: { title: string; query: Record<string, string>; onClose: () => void }) {
  const [limit, setLimit] = useState(50);
  const [data, setData] = useState<{ items: any[]; total: number } | null>(null);
  const [error, setError] = useState('');
  const key = JSON.stringify(query);
  useEffect(() => {
    let alive = true;
    api('/contacts', { query: { ...JSON.parse(key), limit, page: 1 } })
      .then((r) => alive && setData(r))
      .catch((err) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, [key, limit]);

  const open = (id: string) => {
    onClose();
    router.push(`/lead/${id}`);
  };

  return (
    <Sheet open full onClose={onClose} title={title}>
      {error ? <T v="small" style={{ color: C.red }}>{error}</T> : null}
      {!data && !error ? <T v="small">Loading…</T> : null}
      {data ? <T v="small">{data.total} lead(s)</T> : null}
      {data && !data.items.length ? <T v="small" style={{ textAlign: 'center', paddingVertical: S.lg }}>No leads yet.</T> : null}
      {data?.items.length ? (
        <View style={{ borderWidth: 1, borderColor: C.border, borderRadius: 12, overflow: 'hidden' }}>
          {data.items.map((c, i) => (
            <View key={c._id}>
              {i ? <Divider /> : null}
              <ListRow
                title={displayName(c)}
                subtitle={[c.name ? fmtPhone(c.phone) : '', c.assignedTo?.name, fmtRelative(c.createdAt)].filter(Boolean).join(' · ')}
                right={<StatusBadge status={c.leadStatus} />}
                onPress={() => open(c._id)}
              />
            </View>
          ))}
        </View>
      ) : null}
      {data && data.items.length < data.total && limit < 100 ? <Button variant="ghost" title="Show more" onPress={() => setLimit(100)} /> : null}
      {data && data.items.length < data.total && limit >= 100 ? <T v="tiny" style={{ textAlign: 'center' }}>Showing the newest 100.</T> : null}
    </Sheet>
  );
}
