import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Stack, router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { ChannelBadge } from '@/components/channel';
import { DateField } from '@/components/date-field';
import { PLATFORM_LABEL, PostStatusBadge, TargetBadge, mediaUrl, type Platform, type PlatformState, type SocialPost } from '@/components/social';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, EmptyState, Field, Input, Loader, Row, Screen, Sheet, T, Toggle, confirm } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth, useIsAdmin } from '@/lib/auth';
import { fmtDateTime } from '@/lib/format';
import { useSocketEvent } from '@/lib/socket';
import { appendFile, pickPostMedia, type PickedFile } from '@/lib/upload';
import { C, R, S } from '@/theme';

const MB = 1024 * 1024;
type Status = Record<Platform, PlatformState>;
type Form = { text: string; link: string; platforms: Record<Platform, boolean>; schedule: boolean; scheduledAt: Date | null };
const emptyForm = (): Form => ({ text: '', link: '', platforms: { facebook: true, instagram: true }, schedule: false, scheduledAt: null });

/** What blocks posting (same rules as the server, shown before sending) */
function problems(form: Form, files: PickedFile[], status: Status | null) {
  const out: string[] = [];
  const chosen = (Object.keys(form.platforms) as Platform[]).filter((p) => form.platforms[p]);
  if (!chosen.length) out.push('Choose Facebook, Instagram or both.');
  const photos = files.filter((f) => f.mimeType.startsWith('image/'));
  const videos = files.filter((f) => f.mimeType.startsWith('video/'));
  if (videos.length > 1 || (videos.length && photos.length)) out.push('Post either photos (up to 10) or one video.');
  if (!form.text.trim() && !files.length && !form.link) out.push('Write something or add a photo / video.');
  for (const p of chosen) {
    const st = status?.[p];
    if (st && st.mode === 'live' && !st.connected) out.push(`${PLATFORM_LABEL[p]} is not connected (Settings).`);
    if (st && !st.igScopesOk) out.push('Connect Instagram again in Settings to allow posting.');
  }
  if (form.platforms.instagram) {
    if (!files.length) out.push('Instagram needs a photo or a video (text-only posts are not possible on Instagram).');
    if (form.text.length > 2200) out.push('Instagram captions can be up to 2,200 characters.');
    for (const f of photos) if ((f.size || 0) > 8 * MB) out.push(`${f.name}: Instagram photos can be up to 8 MB.`);
    for (const f of videos) if (!/video\/(mp4|quicktime)/.test(f.mimeType)) out.push(`${f.name}: Instagram needs MP4 or MOV videos.`);
  }
  if (form.schedule && !form.scheduledAt) out.push('Pick the date and time to post.');
  return [...new Set(out)];
}

function Composer({ status, onPosted }: { status: Status; onPosted: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState<Form>(emptyForm);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const issues = problems(form, files, status);
  const started = !!(form.text || files.length || form.link);

  const add = async () => {
    try {
      const picked = await pickPostMedia(10 - files.length);
      if (picked.length) setFiles([...files, ...picked].slice(0, 10));
    } catch (err) {
      toast.error(err);
    }
  };
  const submit = async () => {
    if (issues.length) return toast.error(issues[0]);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('text', form.text);
      fd.append('link', form.link.trim());
      fd.append('platforms', (Object.keys(form.platforms) as Platform[]).filter((p) => form.platforms[p]).join(','));
      if (form.schedule && form.scheduledAt) fd.append('scheduledAt', form.scheduledAt.toISOString());
      for (const f of files) appendFile(fd, 'files', f);
      const post = await api<SocialPost>('/social/posts', { method: 'POST', form: fd });
      toast.success(form.schedule ? `Scheduled for ${fmtDateTime(post.scheduledAt)}` : 'Posting now — status updates below');
      setForm(emptyForm());
      setFiles([]);
      onPosted();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ gap: S.md }}>
      <Row wrap gap={S.sm}>
        <T v="label">Post on</T>
        {(['facebook', 'instagram'] as Platform[]).map((p) => {
          const on = form.platforms[p];
          const st = status[p];
          return (
            <Pressable
              key={p}
              onPress={() => setForm({ ...form, platforms: { ...form.platforms, [p]: !on } })}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: on ? C.brand500 : C.border, backgroundColor: on ? C.brand50 : '#fff', borderRadius: R.md, paddingHorizontal: 10, paddingVertical: 6 }}>
              <Ionicons name={on ? 'checkbox' : 'square-outline'} size={18} color={on ? C.brand600 : C.faint} />
              <ChannelBadge channel={p} full />
              {!st?.live ? <T v="tiny" style={{ color: C.amber900 }}>{st?.mode === 'live' ? 'not connected' : 'sandbox'}</T> : null}
            </Pressable>
          );
        })}
      </Row>
      <Field label="Text / caption" hint={form.platforms.instagram ? `${form.text.length} / 2200 (Instagram limit)` : undefined}>
        <Input multiline value={form.text} onChangeText={(v) => setForm({ ...form, text: v })} placeholder="New batch starts Monday! Message us for details…" style={{ minHeight: 90 }} />
      </Field>
      {form.platforms.facebook ? (
        <Field label="Link (optional, Facebook only)">
          <Input value={form.link} onChangeText={(v) => setForm({ ...form, link: v })} placeholder="https://…" autoCapitalize="none" keyboardType="url" autoCorrect={false} />
        </Field>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
        {files.map((f, i) => (
          <View key={`${f.uri}-${i}`} style={{ width: 72, height: 72, borderRadius: R.sm, overflow: 'hidden', backgroundColor: C.soft }}>
            {f.mimeType.startsWith('video/') ? (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="videocam" size={26} color={C.muted} /></View>
            ) : (
              <Image source={{ uri: f.uri }} style={{ width: 72, height: 72 }} contentFit="cover" />
            )}
            <Pressable onPress={() => setFiles(files.filter((_, j) => j !== i))} hitSlop={6} style={{ position: 'absolute', top: 2, right: 2, backgroundColor: 'rgba(15,23,42,0.7)', borderRadius: 10 }}>
              <Ionicons name="close" size={16} color="#fff" />
            </Pressable>
          </View>
        ))}
        {files.length < 10 ? (
          <Pressable onPress={add} style={{ width: 72, height: 72, borderRadius: R.sm, borderWidth: 1, borderStyle: 'dashed', borderColor: C.borderStrong, alignItems: 'center', justifyContent: 'center', gap: 2 }}>
            <Ionicons name="images-outline" size={22} color={C.muted} />
            <T v="tiny">Photo / video</T>
          </Pressable>
        ) : null}
      </View>
      <T v="tiny">Up to 10 photos or 1 video. Instagram shows several photos as a carousel and a video as a Reel.</T>

      <Toggle value={form.schedule} onChange={(v) => setForm({ ...form, schedule: v })} label="Schedule for later" />
      {form.schedule ? <DateField value={form.scheduledAt} onChange={(d) => setForm({ ...form, scheduledAt: d })} minimumDate={new Date()} placeholder="Pick date & time" /> : null}

      {issues.length && started ? (
        <View style={{ backgroundColor: '#fffbeb', borderRadius: R.sm, padding: S.sm, gap: 2 }}>
          {issues.map((i) => <T key={i} v="small" style={{ color: C.amber900 }}>• {i}</T>)}
        </View>
      ) : null}
      <Button icon={form.schedule ? 'calendar-outline' : 'send'} title={form.schedule ? 'Schedule post' : 'Post now'} loading={busy} disabled={busy || issues.length > 0} onPress={submit} />
    </Card>
  );
}

function PostCard({ post, isAdmin, sandbox, onChanged, onSandbox }: { post: SocialPost; isAdmin: boolean; sandbox: boolean; onChanged: () => void; onSandbox: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const first = post.media?.[0];
  const failed = post.targets.some((t) => t.status === 'failed');
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
      onChanged();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy('');
    }
  };
  const remove = async () => {
    const scheduled = post.status === 'scheduled';
    const ok = await confirm(
      scheduled ? 'Cancel this scheduled post?' : 'Delete this post?',
      scheduled ? 'It will not be posted.' : 'The Facebook post is removed from your Page. Instagram does not allow deleting from other apps: delete it in the Instagram app.',
      { ok: scheduled ? 'Cancel post' : 'Delete', danger: true }
    );
    if (!ok) return;
    run('delete', async () => {
      const r = await api<{ cancelled?: boolean; note?: string }>(`/social/posts/${post._id}`, { method: 'DELETE' });
      toast.success(r.cancelled ? 'Scheduled post cancelled' : r.note || 'Post deleted');
    });
  };

  return (
    <Card style={{ gap: S.sm }}>
      <Row gap={S.md} style={{ alignItems: 'flex-start' }}>
        <View style={{ width: 64, height: 64, borderRadius: R.sm, overflow: 'hidden', backgroundColor: C.soft, alignItems: 'center', justifyContent: 'center' }}>
          {first?.type === 'image' ? <Image source={{ uri: mediaUrl(first.url) }} style={{ width: 64, height: 64 }} contentFit="cover" /> : <Ionicons name={first?.type === 'video' ? 'videocam' : 'share-social-outline'} size={24} color={C.muted} />}
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Row wrap gap={6}>
            <PostStatusBadge status={post.status} />
            {post.media?.length > 1 ? <Badge>{`${post.media.length} photos`}</Badge> : null}
          </Row>
          <T v="tiny">{post.status === 'scheduled' ? 'Goes out ' : ''}{fmtDateTime(post.scheduledAt)}{post.createdBy?.name ? ` · by ${post.createdBy.name}` : ''}</T>
          <T numberOfLines={3} style={{ color: C.text }}>{post.text || '(no text)'}</T>
        </View>
      </Row>
      {post.targets.map((t) => (
        <Row key={t.platform} wrap gap={6}>
          <ChannelBadge channel={t.platform} />
          <TargetBadge status={t.status} />
          {t.permalink ? (
            <Pressable onPress={() => Linking.openURL(t.permalink!)} hitSlop={6}>
              <T v="small" style={{ color: C.brand700, fontWeight: '600' }}>Open ↗</T>
            </Pressable>
          ) : null}
          {t.error ? <T v="tiny" style={{ color: C.red, flexShrink: 1 }} numberOfLines={2}>{t.error}</T> : null}
        </Row>
      ))}
      <Row wrap gap={S.sm}>
        {post.commentCount ? (
          <Button size="sm" variant="soft" icon="chatbubbles-outline" title={`${post.commentCount} comment${post.commentCount > 1 ? 's' : ''}${post.unreadComments ? ` · ${post.unreadComments} new` : ''}`} onPress={() => router.push({ pathname: '/social/comments', params: { post: post._id } })} />
        ) : null}
        {isAdmin && failed && post.status !== 'publishing' ? (
          <Button size="sm" variant="secondary" icon="refresh" title="Retry failed" loading={busy === 'retry'} onPress={() => run('retry', () => api(`/social/posts/${post._id}/retry`, { method: 'POST' }))} />
        ) : null}
        {sandbox && post.targets.some((t) => t.status === 'posted') ? <Button size="sm" variant="secondary" icon="flask-outline" title="Test comment" onPress={onSandbox} /> : null}
        {isAdmin && post.status !== 'publishing' ? <Button size="sm" variant="ghost" icon="trash-outline" title={post.status === 'scheduled' ? 'Cancel' : 'Delete'} loading={busy === 'delete'} onPress={remove} /> : null}
      </Row>
    </Card>
  );
}

/** Facebook Page / Instagram posts: write once, post on both (now or later), see status, comments and links */
export default function SocialScreen() {
  const toast = useToast();
  const { epoch } = useAuth();
  const isAdmin = useIsAdmin();
  const [status, setStatus] = useState<Status | null>(null);
  const [posts, setPosts] = useState<{ items: SocialPost[]; total: number } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [sandbox, setSandbox] = useState<{ post: SocialPost; platform: Platform; name: string; text: string } | null>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(
    () =>
      Promise.all([api<Status>('/social/status'), api('/social/posts')])
        .then(([s, p]) => {
          setStatus(s);
          setPosts(p);
        })
        .catch(toast.error)
        .finally(() => setRefreshing(false)),
    [toast]
  );
  useEffect(() => {
    load();
  }, [load, epoch]);
  useSocketEvent('social:post', load, epoch);
  useSocketEvent('social:comment', load, epoch);
  // While something is being posted, check again every few seconds (Instagram videos take a while)
  const busyPosts = !!posts?.items.some((p) => p.status === 'publishing' || p.status === 'scheduled');
  useEffect(() => {
    if (!busyPosts) return;
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [busyPosts, load]);

  if (!status || !posts) return <Loader />;
  const notLive = (Object.keys(status) as Platform[]).filter((p) => !status[p].live);
  const sendSandbox = async () => {
    if (!sandbox) return;
    setSending(true);
    try {
      await api('/social/sandbox/comment', { method: 'POST', body: { platform: sandbox.platform, postId: sandbox.post._id, name: sandbox.name, text: sandbox.text } });
      toast.success('Comment added — see Comments');
      setSandbox(null);
      load();
    } catch (err) {
      toast.error(err);
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }}>
      <Stack.Screen options={{ title: 'Facebook / Insta posts', headerRight: () => <Pressable onPress={() => router.push('/social/comments')} hitSlop={8}><Ionicons name="chatbubbles-outline" size={22} color={C.brand700} /></Pressable> }} />
      {notLive.length ? (
        <Card style={{ backgroundColor: '#fffbeb', gap: 4 }}>
          <T v="small" style={{ color: C.amber900 }}>
            {notLive.map((p) => PLATFORM_LABEL[p]).join(' and ')} {notLive.length > 1 ? 'are' : 'is'} not connected, so posts there are only pretend (sandbox).
          </T>
          {isAdmin ? <Pressable onPress={() => router.push('/settings')}><T v="small" style={{ color: C.brand700, fontWeight: '600' }}>Connect in Settings →</T></Pressable> : null}
        </Card>
      ) : null}
      {isAdmin ? <Composer status={status} onPosted={load} /> : null}
      {!posts.items.length ? (
        <EmptyState icon="share-social-outline" title="No posts yet" text={isAdmin ? 'Write your first post above.' : 'Posts made by your admin show up here.'} />
      ) : (
        posts.items.map((p) => (
          <PostCard
            key={p._id}
            post={p}
            isAdmin={isAdmin}
            sandbox={p.targets.some((t) => !status[t.platform]?.live)}
            onChanged={load}
            onSandbox={() => {
              const platform = p.targets.find((t) => t.status === 'posted' && !status[t.platform]?.live)?.platform || 'facebook';
              setSandbox({ post: p, platform, name: 'Rahul Sharma', text: 'Fees kitni hai? Details bhejo' });
            }}
          />
        ))
      )}

      <Sheet
        open={!!sandbox}
        onClose={() => setSandbox(null)}
        title="Sandbox: pretend someone commented"
        footer={<Button title="Add comment" loading={sending} onPress={sendSandbox} full />}>
        {sandbox ? (
          <View style={{ gap: S.md }}>
            <Row gap={S.sm}>
              {sandbox.post.targets.filter((t) => t.status === 'posted' && !status[t.platform]?.live).map((t) => (
                <Button key={t.platform} size="sm" variant={sandbox.platform === t.platform ? 'primary' : 'secondary'} title={PLATFORM_LABEL[t.platform]} onPress={() => setSandbox({ ...sandbox, platform: t.platform })} />
              ))}
            </Row>
            <Field label="Name"><Input value={sandbox.name} onChangeText={(v) => setSandbox({ ...sandbox, name: v })} /></Field>
            <Field label="Comment"><Input value={sandbox.text} onChangeText={(v) => setSandbox({ ...sandbox, text: v })} /></Field>
          </View>
        ) : null}
      </Sheet>
    </Screen>
  );
}
