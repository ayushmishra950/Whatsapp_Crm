import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { ChannelBadge, channelOf } from '@/components/channel';
import { useToast } from '@/components/toast';
import { Avatar, Badge, ChipBar, CountBadge, EmptyState, Input, Loader, Row, Select, StatusBadge, T } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useLeadStatuses } from '@/lib/business';
import { fmtRelative, displayName } from '@/lib/format';
import { useSocketEvent } from '@/lib/socket';
import { C, S } from '@/theme';

const STATUS: [string, string][] = [['open', 'Open'], ['pending', 'Pending'], ['resolved', 'Resolved'], ['all', 'All']];
const ASSIGNED: [string, string][] = [['all', 'All chats'], ['me', 'Assigned to me'], ['unassigned', 'Unassigned'], ['bot', '🤖 Bot handling']];

/** All WhatsApp and Instagram chats of the business, newest first (live) */
export default function InboxScreen() {
  const toast = useToast();
  const { session, epoch } = useAuth();
  const statuses = useLeadStatuses();
  const isAdmin = session?.user.role === 'admin';
  const [status, setStatus] = useState('open');
  const [assigned, setAssigned] = useState('all');
  const [leadStatus, setLeadStatus] = useState('');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<any[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(() => {
    // "__ad" = chats from a Facebook / Instagram ad; "__wa" / "__ig" = only WhatsApp / Instagram chats (any lead status)
    const special = leadStatus.startsWith('__');
    api<any[]>('/conversations', { query: { status, assigned, search, leadStatus: special ? '' : leadStatus, source: leadStatus === '__ad' ? 'ad' : '', channel: leadStatus === '__wa' ? 'whatsapp' : leadStatus === '__ig' ? 'instagram' : '' } })
      .then(setItems)
      .catch(toast.error)
      .finally(() => setRefreshing(false));
  }, [status, assigned, search, leadStatus, toast]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(load, search ? 300 : 0);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load, search, epoch]);

  const matches = (c: any) => {
    if (status !== 'all' && c.status !== status) return false;
    const a = c.assignedTo?._id || null;
    if (assigned === 'me' && a !== session?.user._id) return false;
    if (assigned === 'unassigned' && (a || c.bot?.active)) return false;
    if (assigned === 'bot' && !c.bot?.active) return false;
    if (!isAdmin && a && a !== session?.user._id) return false;
    if (leadStatus === '__ad') return !!c.contactId?.adSource?.sourceId;
    if (leadStatus === '__wa') return channelOf(c) === 'whatsapp';
    if (leadStatus === '__ig') return channelOf(c) === 'instagram';
    if (leadStatus && c.contactId?.leadStatus !== leadStatus) return false;
    return true;
  };
  const upsert = (conv: any) =>
    setItems((list) => {
      if (!list) return list;
      if (search) return list.map((c) => (c._id === conv._id ? conv : c));
      const rest = list.filter((c) => c._id !== conv._id);
      return matches(conv) ? [conv, ...rest].sort((a, b) => +new Date(b.lastMessageAt) - +new Date(a.lastMessageAt)) : rest;
    });
  useSocketEvent('message:new', ({ conversation }) => upsert(conversation), epoch);
  useSocketEvent('conversation:updated', (conv) => upsert(conv), epoch);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ padding: S.lg, paddingBottom: S.sm, gap: S.sm, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: C.border }}>
        <Input placeholder="Search name or phone" value={search} onChangeText={setSearch} autoCorrect={false} clearButtonMode="while-editing" />
        <ChipBar options={STATUS} value={status} onChange={setStatus} />
        <Row gap={S.sm}>
          <View style={{ flex: 1 }}><Select value={assigned} onChange={setAssigned} options={ASSIGNED.map(([value, label]) => ({ value, label }))} title="Show" /></View>
          <View style={{ flex: 1 }}><Select value={leadStatus} onChange={setLeadStatus} options={[{ value: '', label: 'All lead statuses' }, { value: '__wa', label: 'WhatsApp only' }, { value: '__ig', label: 'Instagram only' }, { value: '__ad', label: '📣 Came from an ad' }, ...statuses.list.map((s) => ({ value: s.key, label: s.label }))]} title="Lead status" /></View>
        </Row>
      </View>
      {!items ? (
        <Loader />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(c) => c._id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.brand600} />}
          ListEmptyComponent={<EmptyState icon="chatbubbles-outline" title="No chats here" text="New WhatsApp and Instagram messages show up here instantly." />}
          ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: C.border, marginLeft: 72 }} />}
          renderItem={({ item: c }) => {
            const ct = c.contactId || {};
            return (
              <Pressable onPress={() => router.push(`/chat/${c._id}`)} style={({ pressed }) => ({ flexDirection: 'row', gap: S.md, padding: S.lg, backgroundColor: pressed ? C.soft : '#fff' })}>
                <Avatar name={displayName(ct).replace(/^[@+]/, '')} size={46} />
                <View style={{ flex: 1, gap: 3 }}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Row gap={6} style={{ flex: 1 }}>
                      <T style={{ fontWeight: c.unreadCount ? '700' : '600', color: C.text, flexShrink: 1 }} numberOfLines={1}>{displayName(ct)}</T>
                      <ChannelBadge channel={channelOf(c)} />
                    </Row>
                    <T v="tiny" style={{ color: c.unreadCount ? C.brand600 : C.faint }}>{fmtRelative(c.lastMessageAt)}</T>
                  </Row>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <T v="small" numberOfLines={1} style={{ flex: 1, color: c.unreadCount ? C.text2 : C.muted }}>{c.lastMessagePreview || '—'}</T>
                    <CountBadge n={c.unreadCount} tone="green" />
                  </Row>
                  <Row wrap gap={4}>
                    <StatusBadge status={ct.leadStatus} />
                    {c.bot?.active ? <Badge tone="purple">🤖 Bot</Badge> : c.assignedTo?.name ? <Badge>{c.assignedTo.name}</Badge> : <Badge tone="amber">Unassigned</Badge>}
                    {ct.adSource?.sourceId ? <Badge tone="purple">📣 Ad</Badge> : null}
                    {!c.windowOpen ? <Badge>🔒 24h closed</Badge> : null}
                  </Row>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}
