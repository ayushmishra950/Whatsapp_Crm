import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { C, F, R, S } from '@/theme';
import { useToast } from './toast';
import { Button, CountBadge, Field, Input, PasswordInput, Row, Sheet, T } from './ui';

export type Business = { userId: string; role: string; tenantId: string | null; name: string; logo: string; businessType: string; suspended: boolean; unread?: number; tasksDue?: number };
const ROLE: Record<string, string> = { admin: 'Admin', agent: 'Counsellor', super_admin: 'Super Admin' };

export function BusinessLogo({ name, logo, size = 32 }: { name: string; logo?: string; size?: number }) {
  return logo ? (
    <Image source={{ uri: logo }} style={{ width: size, height: size, borderRadius: 8, borderWidth: 1, borderColor: C.border, backgroundColor: '#fff' }} contentFit="contain" />
  ) : (
    <View style={{ width: size, height: size, borderRadius: 8, backgroundColor: C.brand600, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#fff', fontWeight: '700', fontSize: size * 0.45 }}>{(name.match(/[A-Za-z0-9]/)?.[0] || '?').toUpperCase()}</Text>
    </View>
  );
}

/** Businesses of this login (with what is waiting in each), polled while the app is open */
export function useBusinesses(enabled: boolean) {
  const { epoch } = useAuth();
  const [data, setData] = useState<{ items: Business[]; current: string } | null>(null);
  const load = useCallback(() => api('/auth/businesses').then(setData).catch(() => {}), []);
  useEffect(() => {
    if (!enabled) return;
    load();
    const t = setInterval(load, 120 * 1000);
    return () => clearInterval(t);
  }, [enabled, load, epoch]);
  return { data, load };
}

/**
 * One login, several businesses: list them, open one without logging out,
 * or link another login (its email + password).
 */
export function BusinessSwitcher({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { session, switchBusiness } = useAuth();
  const toast = useToast();
  const { data, load } = useBusinesses(open);
  const [busy, setBusy] = useState('');
  const [linking, setLinking] = useState(false);

  const pick = async (b: Business) => {
    if (b.userId === data?.current || b.suspended) return onClose();
    setBusy(b.userId);
    try {
      await switchBusiness(b.userId);
      toast.success(`Opened ${b.name}`);
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy('');
    }
  };

  return (
    <>
      <Sheet open={open && !linking} onClose={onClose} title="Your businesses">
        {!data ? (
          <ActivityIndicator color={C.brand600} />
        ) : (
          data.items.map((b) => {
            const current = b.userId === data.current;
            return (
              <Pressable key={b.userId} onPress={() => pick(b)} disabled={!!busy} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: S.md, padding: S.md, borderRadius: R.md, backgroundColor: current ? C.brand50 : pressed ? C.soft : 'transparent', opacity: b.suspended ? 0.5 : 1 }]}>
                <BusinessLogo name={b.name} logo={b.logo} size={38} />
                <View style={{ flex: 1 }}>
                  <T style={{ fontWeight: '600', color: C.text }} numberOfLines={1}>{b.name}</T>
                  <T v="small">{ROLE[b.role] || b.role}{b.suspended ? ' · suspended' : ''}</T>
                </View>
                {busy === b.userId ? (
                  <ActivityIndicator color={C.brand600} />
                ) : current ? (
                  <Ionicons name="checkmark-circle" size={22} color={C.brand600} />
                ) : (
                  <Row gap={4}>
                    <CountBadge n={b.unread} tone="green" />
                    <CountBadge n={b.tasksDue} tone="red" />
                  </Row>
                )}
              </Pressable>
            );
          })
        )}
        <T v="tiny" style={{ marginTop: S.xs }}>Green = unread chats · Red = tasks due. Logged in as {session?.user.email}.</T>
        <Button title="I have another business with a different login" variant="ghost" icon="link-outline" size="sm" onPress={() => setLinking(true)} />
      </Sheet>
      {linking && <LinkLoginSheet onClose={() => setLinking(false)} onLinked={load} />}
    </>
  );
}

/** Prove you own another login (its email + password): its businesses join this login */
function LinkLoginSheet({ onClose, onLinked }: { onClose: () => void; onLinked: () => void }) {
  const { session, refresh } = useAuth();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const link = async () => {
    setBusy(true);
    try {
      const r = await api<{ businesses: string[] }>('/auth/link', { method: 'POST', body: { email: email.trim(), password } });
      toast.success(`Linked: ${r.businesses.join(', ')}. Log in with ${session?.user.email} from now on.`);
      await refresh();
      onLinked();
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open onClose={onClose} title="Add your other business" footer={<><Button title="Cancel" variant="secondary" onPress={onClose} /><Button title="Link" icon="link-outline" loading={busy} disabled={!email.trim() || !password} onPress={link} /></>}>
      <T v="small">Enter the email and password you use for your other business. After linking, one login opens both and you switch from the business name at the top.</T>
      <Field label="Other login email">
        <Input value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="off" textContentType="none" placeholder="owner@otherbusiness.com" />
      </Field>
      <Field label="Its password" hint="Type it yourself (the phone may fill in this login's password).">
        <PasswordInput value={password} onChangeText={setPassword} autoComplete="off" textContentType="none" />
      </Field>
      <View style={{ backgroundColor: C.amber50, borderRadius: R.md, padding: S.md }}>
        <Text style={{ color: C.amber900, fontSize: F.sm }}>From now on log in with {session?.user.email}. The other email stops working as a login; that business&apos;s own email and WhatsApp number do not change.</Text>
      </View>
    </Sheet>
  );
}
