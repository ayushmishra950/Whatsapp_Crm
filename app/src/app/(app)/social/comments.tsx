import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, Linking, Pressable, RefreshControl, View } from 'react-native';
import { ChannelBadge } from '@/components/channel';
import { commenterName, nameHidden, type SocialComment } from '@/components/social';
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
  const [fresh, setFresh] = useState<Set<string>>(() => new Set()); // unread when they reached the screen: highlighted for this visit
  const marking = useRef(false);
  // Replies shown at once, before Facebook / Instagram confirm (per comment id)
  const [pending, setPending] = useState<Record<string, { key: string; text: string; failed: boolean }[]>>({});
  const seq = useRef(0);

  const load = useCallback(
    () =>
      api<Data>('/social/comments', { query: { postId, unread: filter === 'unread' ? '1' : '', platform: filter === 'facebook' || filter === 'instagram' ? filter : '' } })
        .then((r) => {
          setData(r);
          setNow(Date.now());
          const unseen = r.items.filter((c) => !c.readAt && !c.fromBusiness).map((c) => c._id);
          if (!unseen.length) return;
          setFresh((f) => new Set([...f, ...unseen]));
          // Seen = read (badges go down). In "Unread" they stay unread until the user acts.
          if (filter === 'unread' || AppState.currentState !== 'active' || marking.current) return;
          marking.current = true;
          api('/social/comments/read', { method: 'POST', body: { ids: unseen } })
            .then(() => reloadCounts())
            .catch(() => {})
            .finally(() => (marking.current = false));
        })
        .catch(toast.error)
        .finally(() => setRefreshing(false)),
    [toast, filter, postId, reloadCounts]
  );
  useEffect(() => {
    load();
  }, [load, epoch]);
  useSocketEvent('social:comment', load, epoch);
  useSocketEvent('notification:new', load, epoch);
  // Safety net when a live update is missed: reload on opening the screen, on coming back to the app, and every 20 s
  useFocusEffect(
    useCallback(() => {
      load();
      const t = setInterval(() => AppState.currentState === 'active' && load(), 20000);
      const sub = AppState.addEventListener('change', (st) => st === 'active' && load());
      return () => {
        clearInterval(t);
        sub.remove();
      };
    }, [load])
  );

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
  // Read the comments again from Facebook / Instagram (picks up comments whose webhook never came)
  const syncNow = async (quiet = false) => {
    setBusy('sync');
    try {
      const r = await api<{ added: number; errors: string[] }>('/social/comments/sync', { method: 'POST' });
      if (r.errors?.length) toast.error(r.errors[0]);
      else if (!quiet || r.added) toast.success(r.added ? `${r.added} new comment${r.added > 1 ? 's' : ''} found` : 'Up to date — no new comments');
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy('');
      load();
      reloadCounts();
    }
  };
  const sendReply = async () => {
    if (!reply?.text.trim()) return;
    if (reply.private) {
      // One private message per comment: wait for Meta's answer before closing
      if (await run('reply', () => api(`/social/comments/${reply.c._id}/private-reply`, { method: 'POST', body: { text: reply.text } }), 'Private message sent')) setReply(null);
      return;
    }
    postReply(reply.c._id, reply.text.trim());
    setReply(null);
  };
  // Instant public reply: shows as "Sending…" under the comment; Facebook / Instagram confirm in the background
  const postReply = async (commentId: string, text: string, retryKey?: string) => {
    const key = retryKey || `r${(seq.current += 1)}`;
    const update = (fn: (l: { key: string; text: string; failed: boolean }[]) => { key: string; text: string; failed: boolean }[]) =>
      setPending((p) => ({ ...p, [commentId]: fn(p[commentId] || []) }));
    update((l) => (retryKey ? l.map((x) => (x.key === key ? { ...x, failed: false } : x)) : [...l, { key, text, failed: false }]));
    try {
      await api(`/social/comments/${commentId}/reply`, { method: 'POST', body: { text } });
      await load();
      update((l) => l.filter((x) => x.key !== key));
      reloadCounts();
    } catch (err) {
      update((l) => l.map((x) => (x.key === key ? { ...x, failed: true } : x)));
      toast.error(err);
    }
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
  // "New" = not seen before this visit; a thread with a new reply comes to the top
  const isNew = (x: SocialComment) => !x.fromBusiness && (!x.readAt || fresh.has(x._id));
  const lastActivity = (c: SocialComment) => Math.max(new Date(c.at).getTime(), ...(replies[c.externalId] || []).map((r) => new Date(r.at).getTime()));
  top.sort((a, b) => lastActivity(b) - lastActivity(a));
  const newCount = data.items.filter(isNew).length;

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
    const unread = isNew(c);
    const post = c.socialPostId;
    const permalink = post?.targets?.find((t) => t.platform === c.platform)?.permalink;
    const thread = replies[c.externalId] || [];
    const newReplies = thread.filter(isNew).length;
    return (
      <Card style={[{ gap: 6 }, (unread || newReplies > 0) && { borderColor: C.brand500, borderWidth: 1.5, backgroundColor: C.brand50 }]}>
        <Row gap={S.sm} style={{ alignItems: 'flex-start' }}>
          <Avatar name={commenterName(c)} size={36} />
          <View style={{ flex: 1, gap: 3 }}>
            <Row wrap gap={6}>
              <T style={{ fontWeight: '700', color: C.text }}>{commenterName(c)}</T>
              {nameHidden(c) ? <T v="tiny">(name hidden by {c.platform === 'instagram' ? 'Instagram' : 'Facebook'})</T> : null}
              <ChannelBadge channel={c.platform} />
              {unread ? <Badge tone="red">New</Badge> : null}
              {newReplies ? <Badge tone="red">{`${newReplies} new ${newReplies > 1 ? 'replies' : 'reply'} below`}</Badge> : null}
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
        {thread.length || pending[c._id]?.length ? (
          <View style={{ marginLeft: 44, borderLeftWidth: 2, borderLeftColor: C.border, paddingLeft: S.sm, gap: 4 }}>
            {thread.map((r) => (
              <View key={r._id} style={isNew(r) ? { backgroundColor: '#fef2f2', borderRadius: 4, padding: 4 } : undefined}>
                <T v="small">
                  <T v="small" style={{ fontWeight: '700', color: r.fromBusiness ? C.brand700 : C.text }}>{commenterName(r)} </T>
                  {isNew(r) ? <T v="small" style={{ color: C.red, fontWeight: '700' }}>NEW </T> : null}
                  <T v="small" style={{ color: C.text2 }}>{r.text}</T>
                </T>
              </View>
            ))}
            {(pending[c._id] || []).map((p) => (
              <View key={p.key} style={{ opacity: p.failed ? 1 : 0.7 }}>
                <T v="small">
                  <T v="small" style={{ fontWeight: '700', color: C.brand700 }}>You </T>
                  <T v="small" style={{ color: C.text2 }}>{p.text} </T>
                  {p.failed ? null : <T v="tiny">Sending…</T>}
                </T>
                {p.failed ? (
                  <Row gap={S.md}>
                    <T v="tiny" style={{ color: C.red }}>Not sent</T>
                    <Pressable onPress={() => postReply(c._id, p.text, p.key)} hitSlop={6}><T v="tiny" style={{ color: C.brand700, fontWeight: '700' }}>Try again</T></Pressable>
                    <Pressable onPress={() => setPending((all) => ({ ...all, [c._id]: (all[c._id] || []).filter((x) => x.key !== p.key) }))} hitSlop={6}><T v="tiny" style={{ color: C.muted }}>Remove</T></Pressable>
                  </Row>
                ) : null}
              </View>
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
          headerRight: () => (
            <Row gap={S.md}>
              {data.unread ? (
                <Pressable hitSlop={8} onPress={() => run('all', () => api('/social/comments/read', { method: 'POST', body: { all: true } }))}>
                  <T v="small" style={{ color: C.brand700, fontWeight: '600' }}>Mark all read</T>
                </Pressable>
              ) : null}
              {busy === 'sync' ? <ActivityIndicator color={C.brand600} /> : <IconButton name="refresh" label="Refresh comments" color={C.brand700} onPress={() => syncNow()} />}
            </Row>
          ),
        }}
      />
      <View style={{ paddingHorizontal: S.lg, paddingTop: S.md, gap: S.sm }}>
        <ChipBar<Filter> options={[['all', 'All'], ['unread', 'Unread'], ['facebook', 'Facebook'], ['instagram', 'Instagram']]} value={filter} onChange={setFilter} counts={{ unread: data.unread }} />
        {newCount ? (
          <View style={{ backgroundColor: '#fef2f2', borderRadius: R.sm, padding: S.sm }}>
            <T v="small" style={{ color: '#991b1b' }}>
              <T v="small" style={{ color: '#991b1b', fontWeight: '700' }}>{`${newCount} new comment${newCount > 1 ? 's' : ''}`}</T> since you opened this screen — marked with a red New tag.
            </T>
          </View>
        ) : null}
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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); syncNow(true); }} tintColor={C.brand600} />}
        ListEmptyComponent={<EmptyState icon="chatbubbles-outline" title={filter === 'unread' ? 'No unread comments' : 'No comments yet'} text="Comments on your Facebook Page and Instagram posts appear here as they come." />}
      />

      <Sheet
        open={!!reply}
        onClose={() => setReply(null)}
        title={reply ? (reply.private ? `Private message to ${commenterName(reply.c)}` : `Reply to ${commenterName(reply.c)}`) : ''}
        footer={<Button title={reply?.private ? 'Send private message' : 'Post reply'} icon="send" loading={reply?.private && busy === 'reply'} disabled={!reply?.text.trim()} onPress={sendReply} full />}>
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
