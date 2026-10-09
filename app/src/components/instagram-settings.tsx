import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { C, R, S } from '@/theme';
import { ChannelBadge } from './channel';
import { useToast } from './toast';
import { Badge, Button, Card, Field, Input, Row, T, confirm } from './ui';

export type InstagramInfo = {
  mode: string;
  username?: string;
  connectedAt?: string;
  tokenExpiresAt?: string;
  tokenError?: string;
  inPlan: boolean;
  ready: boolean;
  canConnect: boolean;
};

/**
 * Settings → Instagram (same as the web): status, connect / disconnect (admin) and a sandbox that pretends
 * a customer sent an Instagram DM. Connecting opens Instagram's login page in the browser; after "Allow"
 * the browser shows the CRM's web Settings — come back to the app and it shows "Connected".
 */
export function InstagramSettings({ ig, isAdmin, onChanged }: { ig?: InstagramInfo; isAdmin: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const [sandbox, setSandbox] = useState({ username: 'priya.learns', name: 'Priya', text: 'Hi! Digital marketing course ki details bhejo' });
  if (!ig) return null;
  const live = ig.mode === 'live';

  const connect = async (switchAccount = false) => {
    setBusy(switchAccount ? 'switch' : 'connect');
    try {
      const { url } = await api<{ url: string }>('/instagram/connect-url', { query: switchAccount ? { switch: '1' } : {} });
      await WebBrowser.openBrowserAsync(url); // returns when the browser is closed
      onChanged();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy('');
    }
  };
  const disconnect = async () => {
    if (!(await confirm('Disconnect Instagram?', 'New Instagram DMs stop coming in and replies can not be sent. Chats and leads already here stay.', { ok: 'Disconnect', danger: true }))) return;
    setBusy('disconnect');
    try {
      await api('/settings/instagram', { method: 'DELETE' });
      toast.success('Instagram disconnected');
      onChanged();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy('');
    }
  };
  const simulate = async () => {
    setBusy('sandbox');
    try {
      await api('/sandbox/instagram', { method: 'POST', body: sandbox });
      toast.success('Instagram message received — check the Inbox');
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy('');
    }
  };

  if (!ig.inPlan) {
    return (
      <Card>
        <T v="small">Instagram is not part of your plan. Ask the platform administrator to add it.</T>
      </Card>
    );
  }
  return (
    <Card style={{ gap: S.md }}>
      <Row wrap gap={8} style={{ alignItems: 'center' }}>
        <ChannelBadge channel="instagram" full />
        {live ? (
          <>
            <Badge tone="green">Connected</Badge>
            <T style={{ color: C.text, fontWeight: '600' }}>@{ig.username}</T>
          </>
        ) : (
          <Badge tone="yellow">Not connected · sandbox</Badge>
        )}
      </Row>
      {live && ig.connectedAt ? <T v="tiny">Connected since {fmtDate(ig.connectedAt)}{ig.tokenExpiresAt ? ` · renews itself before ${fmtDate(ig.tokenExpiresAt)}` : ''}</T> : null}
      {ig.tokenError ? <T v="small" style={{ color: C.red }}>{ig.tokenError}</T> : null}
      {!ig.ready && isAdmin ? (
        <T v="small" style={{ color: C.amber900 }}>The database update for Instagram has not run on the server yet (CHANNEL_MIGRATION=run). WhatsApp keeps working meanwhile.</T>
      ) : null}

      {isAdmin && !live ? (
        <View style={{ backgroundColor: '#fdf2f8', borderColor: '#fbcfe8', borderWidth: 1, borderRadius: R.md, padding: S.md, gap: 4 }}>
          <T style={{ fontWeight: '700', color: '#831843' }}>Before you tap “Connect Instagram”</T>
          <T v="small" style={{ color: '#831843' }}>• Your Instagram must be a Business account (a personal account can not be connected).</T>
          <T v="small" style={{ color: '#831843' }}>• To check or switch: Instagram app → Profile → ☰ → Account type and tools → Switch to professional account → Business.</T>
          <T v="small" style={{ color: '#831843' }}>• Log in with that business account when Instagram asks. If another account is logged in, use “Use a different Instagram account”.</T>
        </View>
      ) : null}

      {isAdmin ? (
        live ? (
          <Button variant="secondary" icon="unlink-outline" title="Disconnect" loading={busy === 'disconnect'} onPress={disconnect} />
        ) : (
          <View style={{ gap: 6 }}>
            <Button icon="logo-instagram" title="Connect Instagram" loading={busy === 'connect'} disabled={!ig.canConnect || !ig.ready || !!busy} onPress={() => connect()} />
            {ig.canConnect && ig.ready ? (
              <Pressable onPress={() => connect(true)} disabled={!!busy} hitSlop={8} style={{ alignSelf: 'center' }}>
                <T v="small" style={{ textDecorationLine: 'underline', color: C.muted }}>{busy === 'switch' ? 'Opening Instagram…' : 'Use a different Instagram account'}</T>
              </Pressable>
            ) : (
              <T v="tiny">Connecting needs the Meta App keys in the server’s .env and Meta’s approval. The sandbox below works now.</T>
            )}
            <T v="tiny">After “Allow”, close the browser and come back here; this page then shows “Connected”.</T>
          </View>
        )
      ) : null}

      {!live && ig.ready ? (
        <View style={{ gap: S.sm, borderTopWidth: 1, borderTopColor: C.border, paddingTop: S.md }}>
          <T style={{ fontWeight: '600', color: C.text }}>Sandbox: pretend a customer sent an Instagram DM</T>
          <Field label="Instagram username"><Input value={sandbox.username} onChangeText={(v) => setSandbox({ ...sandbox, username: v.replace(/^@/, '') })} autoCapitalize="none" autoCorrect={false} /></Field>
          <Field label="Name (optional)"><Input value={sandbox.name} onChangeText={(v) => setSandbox({ ...sandbox, name: v })} /></Field>
          <Field label="Message"><Input value={sandbox.text} onChangeText={(v) => setSandbox({ ...sandbox, text: v })} /></Field>
          <Button variant="secondary" icon="send" title="Simulate Instagram DM" loading={busy === 'sandbox'} onPress={simulate} />
        </View>
      ) : null}
    </Card>
  );
}
