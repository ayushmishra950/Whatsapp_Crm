import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { useToast } from '@/components/toast';
import { Avatar, Badge, Button, EmptyState, Field, IconButton, Input, Loader, PasswordInput, Row, Sheet, T, Toggle, confirm } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDateTime } from '@/lib/format';
import { C, R, S } from '@/theme';

type Member = { _id: string; name: string; email?: string; phone?: string; role: string; isActive: boolean; openChats?: number; lastLoginAt?: string; sharedLogin?: boolean };
type Draft = { _id?: string; name: string; email: string; phone: string; password: string; isActive: boolean; sharedLogin?: boolean };
const EMPTY: Draft = { name: '', email: '', phone: '', password: '', isActive: true };

/** Team: admin adds / edits / removes counsellors; counsellors see the list */
export default function TeamScreen() {
  const toast = useToast();
  const { session, epoch } = useAuth();
  const isAdmin = session?.user.role === 'admin';
  const [members, setMembers] = useState<Member[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(
    () =>
      api<Member[]>('/team')
        .then(setMembers)
        .catch(toast.error)
        .finally(() => setRefreshing(false)),
    [toast]
  );
  useEffect(() => {
    load();
  }, [load, epoch]);

  const agents = members?.filter((m) => m.role === 'agent') || [];
  const limit = session?.tenant?.plan?.limits?.agents;
  const full = limit != null && agents.length >= limit;

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      if (editing._id) {
        const body: Record<string, unknown> = { name: editing.name.trim(), phone: editing.phone.trim(), isActive: editing.isActive };
        if (editing.password) body.password = editing.password;
        await api(`/team/${editing._id}`, { method: 'PATCH', body });
        toast.success('Agent updated');
      } else {
        const added = await api('/team', { method: 'POST', body: { name: editing.name.trim(), email: editing.email.trim(), phone: editing.phone.trim(), password: editing.password } });
        toast.success(
          added.existingLogin
            ? `${editing.name.trim()} added. They already had a login: this business now shows in their business switcher (same email & password).`
            : 'Agent added'
        );
      }
      setEditing(null);
      load();
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (m: Member) => {
    const ok = await confirm('Delete agent?', `${m.name} will lose access to this business. Their chats will become unassigned.${m.sharedLogin ? ' Their login keeps working for their other business.' : ''}`, { ok: 'Delete', danger: true });
    if (!ok) return;
    try {
      await api(`/team/${m._id}`, { method: 'DELETE' });
      toast.success('Agent deleted. Their chats moved to unassigned.');
      load();
    } catch (err) {
      toast.error(err);
    }
  };

  const isNew = editing && !editing._id;
  const passwordShort = !!editing?.password && editing.password.length < 8;
  const canSave = !!editing && editing.name.trim().length >= 2 && (!isNew || /\S+@\S+\.\S+/.test(editing.email.trim())) && !passwordShort;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen
        options={{
          title: 'Team',
          headerRight: isAdmin ? () => <IconButton name="person-add-outline" color={full ? C.faint : C.brand700} label="Add agent" onPress={() => (full ? toast.info(`Your plan allows ${limit} agents. Ask the platform admin to upgrade.`) : setEditing({ ...EMPTY }))} /> : undefined,
        }}
      />
      {!members ? (
        <Loader />
      ) : (
        <FlatList
          data={members}
          keyExtractor={(m) => m._id}
          contentContainerStyle={{ padding: S.lg, gap: S.md }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.brand600} />}
          ListHeaderComponent={
            <View style={{ gap: S.sm }}>
              <T v="small">
                Agents handle chats with your customers.{limit != null ? ` Your plan allows ${limit} agents (${agents.length} used).` : ''}
                {!isAdmin ? ' Only the admin can add or change team members.' : ''}
              </T>
              {isAdmin ? <Button title="Add agent" icon="person-add-outline" disabled={full} onPress={() => setEditing({ ...EMPTY })} /> : null}
            </View>
          }
          ListEmptyComponent={<EmptyState icon="people-outline" title="No team members" />}
          renderItem={({ item: m }) => (
            <View style={{ backgroundColor: '#fff', borderRadius: R.lg, borderWidth: 1, borderColor: C.border, padding: S.lg, gap: S.sm, opacity: m.isActive ? 1 : 0.6 }}>
              <Row gap={S.md}>
                <Avatar name={m.name} />
                <View style={{ flex: 1, gap: 2 }}>
                  <T style={{ fontWeight: '600', color: C.text }} numberOfLines={1}>{m.name}{m._id === session?.user._id ? ' (you)' : ''}</T>
                  {m.email ? <T v="small" numberOfLines={1}>{m.email}</T> : null}
                  <Row wrap gap={4}>
                    <Badge tone={m.role === 'admin' ? 'purple' : 'gray'}>{m.role}</Badge>
                    <Badge tone={m.isActive ? 'green' : 'red'}>{m.isActive ? 'active' : 'suspended'}</Badge>
                    {m.sharedLogin ? <Badge tone="purple">shared login</Badge> : null}
                  </Row>
                </View>
                {isAdmin && m.role === 'agent' ? (
                  <Row gap={S.xs}>
                    <IconButton name="create-outline" label="Edit agent" onPress={() => setEditing({ _id: m._id, name: m.name, email: m.email || '', phone: m.phone || '', password: '', isActive: m.isActive, sharedLogin: m.sharedLogin })} />
                    <IconButton name="trash-outline" color={C.red} label="Delete agent" onPress={() => remove(m)} />
                  </Row>
                ) : null}
              </Row>
              {isAdmin ? (
                <T v="tiny">
                  {m.openChats ?? 0} open chat(s) · last login {m.lastLoginAt ? fmtDateTime(m.lastLoginAt) : 'never'}
                  {m.phone ? ` · ${m.phone}` : ''}
                </T>
              ) : null}
            </View>
          )}
        />
      )}

      <Sheet
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?._id ? 'Edit agent' : 'Add agent'}
        footer={<><Button title="Cancel" variant="secondary" onPress={() => setEditing(null)} /><Button title="Save" loading={saving} disabled={!canSave} onPress={save} /></>}>
        {editing ? (
          <>
            <Field label="Name">
              <Input value={editing.name} onChangeText={(name) => setEditing({ ...editing, name })} autoCapitalize="words" />
            </Field>
            <Field label="Email" hint={editing._id ? 'The login email can not be changed' : undefined}>
              <Input value={editing.email} editable={!editing._id} onChangeText={(email) => setEditing({ ...editing, email })} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" />
            </Field>
            <Field label="Phone">
              <Input value={editing.phone} onChangeText={(phone) => setEditing({ ...editing, phone })} keyboardType="phone-pad" />
            </Field>
            {editing.sharedLogin ? (
              <View style={{ backgroundColor: C.violet50, borderRadius: R.md, padding: S.md }}>
                <T v="small" style={{ color: '#4c1d95' }}>This person uses the same login for another business, so only they can change their password (Settings → Change password).</T>
              </View>
            ) : (
              <Field
                label={editing._id ? 'New password' : 'Password'}
                error={passwordShort ? 'Min 8 characters' : undefined}
                hint={editing._id ? 'Leave empty to keep the current password' : 'Min 8 characters. Leave empty if this email already logs in for another business: they keep their own password.'}>
                <PasswordInput value={editing.password} onChangeText={(password) => setEditing({ ...editing, password })} autoComplete="new-password" textContentType="newPassword" />
              </Field>
            )}
            {editing._id ? (
              <Toggle value={editing.isActive} onChange={(isActive) => setEditing({ ...editing, isActive })} label="Active" description="Disabled agents can not log in; their chats go back to unassigned" />
            ) : null}
          </>
        ) : null}
      </Sheet>
    </View>
  );
}
