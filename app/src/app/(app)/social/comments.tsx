import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Linking, Pressable, RefreshControl, View } from 'react-native';
import { ChannelBadge } from '@/components/channel';
import { commenterName, type SocialComment } from '@/components/social';
import { useToast } from '@/components/toast';
import { showActionMenu } from '@/components/action-menu';
import { Avatar, Badge, Button, Card, ChipBar, EmptyState, IconButton, Input, Loader, Row, Sheet, T, confirm } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth, useIsAdmin } from '@/lib/auth';
import { useCounts } from '@/lib/counts';
import { fmtRelative } from '@/lib/format';
import { useSocketEvent } from '@/lib/socket';
import { C, R, S } from '@/theme';

type Data = { items: SocialComment[]; total: number; unread: number };
type Filter = 'all' | 'unread' | 'facebook' | 'instagram';
const PRIVATE_DAYS = 7;

/** Comments on the business's Facebook Page / Instagram posts: reply, private message, hide, delete, make lead */
export default function CommentsScreen() {
  const toast = useToast();
  const { epoch } = useAuth();
  const isAdmin = useIsAdmin();
  const { reload: reloadCounts } = useCounts();
  const { post: postId } = useLocalSearchParams<{ post?: string }>();
  const [filter, setFilter] = useState<Filter>('all');
  const [data, setData] = useState<Data | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [reply, setReply] = useState<{ c: SocialComment; text: string; private?: boolean } | null>(null);
  const [busy, setBusy] = useState('');

  const load = useCallback(
    () =>
      api<Data>('/social/comments', { query: { postId, unread: filter === 'unread' ? '1' : '', platform: filter === 'facebook' || filter === 'instagram' ? filter : '' } })
        .then((r) => {
          setData(r);
          setNow(Date.now());
        })
        .catch(toast.error)
        .finally(() => setRefreshing(false)),
    [toast, filter, postId]
  );
  useEffect(() => {
    load();
  }, [load, epoch]);
  useSocketEvent('social:comment', load, epoch);

  const run = async (key: string, fn: () => Promise<unknown>, msg?: string) => {
    setBusy(key);
    try {
      await fn();
      if (msg) toast.success(msg);
      load();
      reloadCounts();
      return true;
    } catch (err) {
      toast.error(err);
      return false;
    } finally {
      setBusy('');
    }
  };
  const sendReply = async () => {
    if (!reply?.text.trim()) return;
    const path = `/social/comments/${reply.c._id}/${reply.private ? 'private-reply' : 'reply'}`;
    if (await run('reply', () => api(path, { method: 'POST', body: { text: reply.text } }), reply.private ? 'Private message sent' : 'Reply posted')) setReply(null);
  };

  if (!data) return <Loader />;
  // Thread the page: replies under the comment they answer
  const byExternal = new Set(data.items.map((c) => c.externalId));
  const replies: Record<string, SocialComment[]> = {};
  const top: SocialComment[] = [];
  for (const c of [...data.items].reverse()) {
    if (c.parentExternalId && byExternal.has(c.parentExternalId)) (replies[c.parentExternalId] ||= []).push(c);
    else top.unshift(c);
  }

  // "⋯" menu of a customer's comment
  const openMenu = (c: SocialComment) => {
    const canPrivate = !c.privateReplyAt && now - new Date(c.at).getTime() < PRIVATE_DAYS * 86400000;
    const items = [
      ...(canPrivate ? [{ key: 'private', label: 'Private message' }] : []),
      { key: 'hide', label: c.hidden ? 'Unhide' : 'Hide from others' },
      { key: 'lead', label: c.contactId ? 'Open lead' : 'Make lead' },
      ...(!c.readAt ? [{ key: 'read', label: 'Mark read' }] : []),
      ...(isAdmin ? [{ key: 'delete', label: 'Delete', danger: true }] : []),
    ];
    showActionMenu(commenterName(c), items, async (key) => {
      if (key === 'private') setReply({ c, text: 'Hi! Thanks for your comment. ', private: true });
      else if (key === 'hide') run('hide', () => api(`/social/comments/${c._id}/hide`, { method: 'POST', body: { hidden: !c.hidden } }), c.hidden ? 'Comment shown again' : 'Comment hidden from others');
      else if (key === 'lead') {
        if (c.contactId) router.push(`/lead/${c.contactId}`);
        else run('lead', () => api(`/social/comments/${c._id}/lead`, { method: 'POST' }), 'Saved as a lead');
      } else if (key === 'read') run('read', () => api('/social/comments/read', { method: 'POST', body: { ids: [c._id] } }));
      else if (key === 'delete' && (await confirm('Delete this comment?', `It is removed from ${c.platform === 'facebook' ? 'Facebook' : 'Instagram'} for everyone. To only keep it out of sight, use Hide.`, { ok: 'Delete', danger: true }))) {
        run('delete', () => api(`/social/comments/${c._id}`, { method: 'DELETE' }), 'Comment deleted');
      }
    });
  };

  const renderItem = ({ item: c }: { item: SocialComment }) => {
    const unread = !c.readAt && !c.fromBusiness;
    const post = c.socialPostId;
    const permalink = post?.targets?.find((t) => t.platform === c.platform)?.permalink;
    const thread = replies[c.externalId] || [];
    return (
      <Card style={[{ gap: 6 }, unread && { borderColor: C.brand500, backgroundColor: C.brand50 }]}>
        <Row gap={S.sm} style={{ alignItems: 'flex-start' }}>
          <Avatar name={commenterName(c)} size={36} />
          <View style={{ flex: 1, gap: 3 }}>
            <Row wrap gap={6}>
              <T style={{ fontWeight: '700', color: C.text }}>{commenterName(c)}</T>
              <ChannelBadge channel={c.platform} />
              {unread ? <Badge tone="red">New</Badge> : null}
              {c.hidden ? <Badge>Hidden</Badge> : null}
              {c.privateReplyAt ? <Badge tone="blue">Private message sent</Badge> : null}
              <T v="tiny">{fmtRelative(c.at)}</T>
            </Row>
            <T style={{ color: c.hidden ? C.faint : C.text }} selectable>{c.text}</T>
            {post ? (
              <Row gap={4}>
                <T v="tiny" numberOfLines={1} style={{ flexShrink: 1 }}>On: {post.text?.slice(0, 60) || 'your post'}</T>
                {permalink ? <Pressable onPress={() => Linking.openURL(permalink)} hitSlop={6}><T v="tiny" style={{ color: C.brand700, fontWeight: '600' }}>Open ↗</T></Pressable> : null}
              </Row>
            ) : null}
          </View>
          {!c.fromBusiness ? <IconButton name="ellipsis-horizontal" label="More actions" onPress={() => openMenu(c)} /> : null}
        </Row>
        {thread.length ? (
          <View style={{ marginLeft: 44, borderLeftWidth: 2, borderLeftColor: C.border, paddingLeft: S.sm, gap: 4 }}>
            {thread.map((r) => (
              <T key={r._id} v="small">
                <T v="small" style={{ fontWeight: '700', color: r.fromBusiness ? C.brand700 : C.text }}>{commenterName(r)} </T>
                <T v="small" style={{ color: C.text2 }}>{r.text}</T>
              </T>
            ))}
          </View>
        ) : null}
        {!c.fromBusiness ? (
          <View style={{ marginLeft: 44 }}>
            <Button size="sm" variant="soft" icon="arrow-undo-outline" title="Reply" onPress={() => setReply({ c, text: '' })} style={{ alignSelf: 'flex-start' }} />
          </View>
        ) : null}
      </Card>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen
        options={{
          title: 'Comments',
          headerRight: () =>
            data.unread ? (
              <Pressable hitSlop={8} onPress={() => run('all', () => api('/social/comments/read', { method: 'POST', body: { all: true } }))}>
                <T v="small" style={{ color: C.brand700, fontWeight: '600' }}>Mark all read</T>
              </Pressable>
            ) : null,
        }}
      />
      <View style={{ paddingHorizontal: S.lg, paddingTop: S.md, gap: S.sm }}>
        <ChipBar<Filter> options={[['all', 'All'], ['unread', 'Unread'], ['facebook', 'Facebook'], ['instagram', 'Instagram']]} value={filter} onChange={setFilter} counts={{ unread: data.unread }} />
        {postId ? (
          <Pressable onPress={() => router.setParams({ post: '' })}>
            <T v="small">Showing one post’s comments · <T v="small" style={{ color: C.brand700, fontWeight: '600' }}>Show all</T></T>
          </Pressable>
        ) : null}
      </View>
      <FlatList
        data={top}
        keyExtractor={(c) => c._id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: S.lg, gap: S.sm }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.brand600} />}
        ListEmptyComponent={<EmptyState icon="chatbubbles-outline" title={filter === 'unread' ? 'No unread comments' : 'No comments yet'} text="Comments on your Facebook Page and Instagram posts appear here as they come." />}
      />

      <Sheet
        open={!!reply}
        onClose={() => setReply(null)}
        title={reply ? (reply.private ? `Private message to ${commenterName(reply.c)}` : `Reply to ${commenterName(reply.c)}`) : ''}
        footer={<Button title={reply?.private ? 'Send private message' : 'Post reply'} icon="send" loading={busy === 'reply'} disabled={!reply?.text.trim()} onPress={sendReply} full />}>
        {reply ? (
          <View style={{ gap: S.sm }}>
            <View style={{ backgroundColor: C.soft, borderRadius: R.sm, padding: S.sm }}>
              <T v="small" numberOfLines={3}>“{reply.c.text}”</T>
            </View>
            {reply.private ? (
              <T v="tiny">Goes to their {reply.c.platform === 'facebook' ? 'Messenger' : 'Instagram DMs'}. Only one private message per comment is allowed, within 7 days.</T>
            ) : (
              <T v="tiny">Shows publicly under the comment on {reply.c.platform === 'facebook' ? 'Facebook' : 'Instagram'}, as your business.</T>
            )}
            <Input multiline autoFocus value={reply.text} onChangeText={(v) => setReply({ ...reply, text: v })} placeholder="Write your reply…" style={{ minHeight: 80 }} />
          </View>
        ) : null}
      </Sheet>
    </View>
  );
}
