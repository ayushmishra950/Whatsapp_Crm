import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useState } from 'react';
import { Image } from 'expo-image';
import { Pressable, View } from 'react-native';
import { api, API_URL } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { C, R, S } from '@/theme';
import { ChannelBadge } from './channel';
import { useToast } from './toast';
import { Avatar, Badge, Button, Card, Row, T, confirm } from './ui';

export type Platform = 'facebook' | 'instagram';
export const PLATFORM_LABEL: Record<Platform, string> = { facebook: 'Facebook', instagram: 'Instagram' };
export type PlatformState = { mode: string; connected: boolean; live: boolean; igScopesOk: boolean };

export type SocialTarget = { platform: Platform; status: 'pending' | 'publishing' | 'posted' | 'failed'; permalink?: string; error?: string; externalId?: string };
export type SocialPost = {
  _id: string;
  text: string;
  link?: string;
  media: { url: string; type: 'image' | 'video' }[];
  targets: SocialTarget[];
  status: 'scheduled' | 'publishing' | 'posted' | 'partial' | 'failed' | 'deleted';
  scheduledAt: string;
  createdBy?: { name?: string };
  commentCount?: number;
  unreadComments?: number;
};
export type SocialComment = {
  _id: string;
  platform: Platform;
  externalId: string;
  parentExternalId?: string;
  from?: { id?: string; name?: string; username?: string };
  text: string;
  at: string;
  fromBusiness?: boolean;
  sentBy?: { name?: string };
  hidden?: boolean;
  readAt?: string;
  privateReplyAt?: string;
  contactId?: string;
  socialPostId?: { _id: string; text?: string; media?: { url: string; type: string }[]; targets?: SocialTarget[] } | null;
};

/** Stored file link (Cloudinary, or /uploads/… on the server disk) */
export const mediaUrl = (url?: string) => (url && !/^https?:/.test(url) ? `${API_URL}${url}` : url || '');

const TARGET: Record<string, [string, string]> = { pending: ['Waiting', 'yellow'], publishing: ['Posting…', 'blue'], posted: ['Posted', 'green'], failed: ['Failed', 'red'] };
export const TargetBadge = ({ status }: { status: string }) => <Badge tone={TARGET[status]?.[1] || 'gray'}>{TARGET[status]?.[0] || status}</Badge>;
const POST: Record<string, [string, string]> = { scheduled: ['Scheduled', 'blue'], publishing: ['Posting…', 'yellow'], posted: ['Posted', 'green'], partial: ['Partly posted', 'yellow'], failed: ['Failed', 'red'], deleted: ['Deleted', 'gray'] };
export const PostStatusBadge = ({ status }: { status: string }) => <Badge tone={POST[status]?.[1] || 'gray'}>{POST[status]?.[0] || status}</Badge>;

/** "Priya" / "@priya.learns" / "You" */
export const commenterName = (c: SocialComment) =>
  c.fromBusiness ? (c.sentBy?.name ? `You (${c.sentBy.name})` : 'You') : c.from?.name || (c.from?.username ? `@${c.from.username}` : 'Someone');

export type FacebookInfo = {
  mode: string;
  pageId?: string;
  pageName?: string;
  pagePicture?: string;
  connectedAt?: string;
  tokenError?: string;
  inPlan: boolean;
  canConnect: boolean;
  choosing: boolean;
};

/**
 * Settings → Facebook Page (same as the web): connect in the browser (Facebook login), pick the Page when
 * the admin manages several, disconnect. Used for posting on the Page and answering its comments.
 */
export function FacebookSettings({ fb, igCanPost, isAdmin, onChanged }: { fb?: FacebookInfo; igCanPost: boolean; isAdmin: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const [pages, setPages] = useState<{ id: string; name: string; picture?: string }[]>([]);
  const live = fb?.mode === 'live' && !!fb?.pageId;
  const loadPages = useCallback(() => {
    if (isAdmin && fb?.choosing && !live) api('/settings/facebook/pages').then(setPages).catch(() => setPages([]));
  }, [isAdmin, fb?.choosing, live]);
  useEffect(loadPages, [loadPages]);
  if (!fb) return null;

  const run = async (key: string, fn: () => Promise<unknown>, msg?: string) => {
    setBusy(key);
    try {
      await fn();
      if (msg) toast.success(msg);
      onChanged();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy('');
    }
  };
  const connect = () =>
    run('connect', async () => {
      const { url } = await api<{ url: string }>('/facebook/connect-url');
      await WebBrowser.openBrowserAsync(url); // returns when the browser is closed
    });
  const disconnect = async () => {
    if (!(await confirm('Disconnect the Facebook Page?', 'Posting on the Page and new Page comments stop. Posts and comments already here stay.', { ok: 'Disconnect', danger: true }))) return;
    run('disconnect', () => api('/settings/facebook', { method: 'DELETE' }), 'Facebook Page disconnected');
  };

  if (!fb.inPlan) {
    return (
      <Card>
        <T v="small">Facebook / Instagram posts are not part of your plan. Ask the platform administrator to add them.</T>
      </Card>
    );
  }
  return (
    <Card style={{ gap: S.md }}>
      <Row wrap gap={8} style={{ alignItems: 'center' }}>
        <ChannelBadge channel="facebook" full />
        {live ? (
          <>
            <Badge tone="green">Connected</Badge>
            {fb.pagePicture ? <Image source={{ uri: fb.pagePicture }} style={{ width: 22, height: 22, borderRadius: 11 }} /> : null}
            <T style={{ color: C.text, fontWeight: '600' }}>{fb.pageName}</T>
          </>
        ) : (
          <Badge tone="yellow">Not connected · sandbox</Badge>
        )}
      </Row>
      {live && fb.connectedAt ? <T v="tiny">Connected since {fmtDate(fb.connectedAt)}</T> : null}
      {fb.tokenError ? <T v="small" style={{ color: C.red }}>{fb.tokenError}</T> : null}
      {!igCanPost ? (
        <T v="small" style={{ color: C.amber900 }}>
          Instagram was connected before posting was added. Disconnect and connect Instagram again (section above) and allow the new permissions, so you can post and answer comments on Instagram too.
        </T>
      ) : null}

      {isAdmin && !live && pages.length ? (
        <View style={{ gap: S.sm, backgroundColor: '#eff6ff', borderRadius: R.md, padding: S.md }}>
          <T style={{ fontWeight: '700', color: '#1e3a8a' }}>Which Page should this business use?</T>
          {pages.map((p) => (
            <Row key={p.id} gap={S.sm} style={{ backgroundColor: '#fff', borderRadius: R.sm, padding: S.sm }}>
              {p.picture ? <Image source={{ uri: p.picture }} style={{ width: 32, height: 32, borderRadius: 16 }} /> : <Avatar name={p.name} size={32} />}
              <T style={{ flex: 1, fontWeight: '600', color: C.text }} numberOfLines={1}>{p.name}</T>
              <Button size="sm" title="Use" loading={busy === p.id} disabled={!!busy} onPress={() => run(p.id, () => api('/settings/facebook/page', { method: 'POST', body: { pageId: p.id } }), `${p.name} connected`)} />
            </Row>
          ))}
        </View>
      ) : null}

      {isAdmin && !live ? (
        <View style={{ backgroundColor: '#eff6ff', borderColor: '#bfdbfe', borderWidth: 1, borderRadius: R.md, padding: S.md, gap: 4 }}>
          <T style={{ fontWeight: '700', color: '#1e3a8a' }}>Before you tap “Connect Facebook Page”</T>
          <T v="small" style={{ color: '#1e3a8a' }}>• Log in with the Facebook profile that is an admin of the business’s Page.</T>
          <T v="small" style={{ color: '#1e3a8a' }}>• When Facebook asks, tick the Page and allow all permissions. If you tick several Pages, you choose one here after.</T>
        </View>
      ) : null}

      {isAdmin ? (
        live ? (
          <Button variant="secondary" icon="unlink-outline" title="Disconnect" loading={busy === 'disconnect'} onPress={disconnect} />
        ) : (
          <View style={{ gap: 6 }}>
            <Button icon="logo-facebook" title="Connect Facebook Page" loading={busy === 'connect'} disabled={!fb.canConnect || !!busy} onPress={connect} />
            {!fb.canConnect ? <T v="tiny">Connecting needs the Meta App keys in the server’s .env (FB_APP_ID, FB_LOGIN_CONFIG_ID, FB_REDIRECT_URL). Sandbox posts work now.</T> : null}
            <T v="tiny">After “Allow”, close the browser and come back here; this page then shows “Connected” (or the Pages to choose from).</T>
          </View>
        )
      ) : null}
      <Pressable onPress={() => router.push('/social')} hitSlop={8}>
        <T v="small" style={{ color: C.brand700, fontWeight: '600' }}>Go to posts →</T>
      </Pressable>
    </Card>
  );
}
