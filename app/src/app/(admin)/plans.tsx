import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import type { Plan } from '@/components/superadmin-shared';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, EmptyState, Field, IconButton, Input, Loader, Row, Sheet, T, Toggle, confirm } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtNum, money } from '@/lib/format';
import { C, S } from '@/theme';

/** Plan being edited: numbers and features as text (like the web form) */
type Draft = {
  _id?: string;
  name: string;
  description: string;
  priceMonthly: string;
  agents: string;
  contacts: string;
  monthlyMessages: string;
  features: string;
  chatbot: boolean;
  instagram: boolean;
  social: boolean;
  isActive: boolean;
};
const emptyDraft: Draft = { name: '', description: '', priceMonthly: '0', agents: '3', contacts: '1000', monthlyMessages: '5000', features: '', chatbot: true, instagram: true, social: true, isActive: true };
const toDraft = (p: Plan): Draft => ({
  _id: p._id,
  name: p.name,
  description: p.description || '',
  priceMonthly: String(p.priceMonthly ?? 0),
  agents: String(p.limits?.agents ?? 0),
  contacts: String(p.limits?.contacts ?? 0),
  monthlyMessages: String(p.limits?.monthlyMessages ?? 0),
  features: (p.features || []).join('\n'),
  chatbot: p.modules?.chatbot !== false,
  instagram: p.modules?.instagram !== false,
  social: p.modules?.social !== false,
  isActive: p.isActive,
});
const num = (v: string) => Math.max(0, parseInt(v, 10) || 0);

/** Monthly subscription plans and their limits */
export default function PlansScreen() {
  const toast = useToast();
  const { epoch } = useAuth();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(
    () =>
      api<Plan[]>('/superadmin/plans')
        .then(setPlans)
        .catch(toast.error)
        .finally(() => setRefreshing(false)),
    [toast]
  );
  useEffect(() => {
    load();
  }, [load, epoch]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setEditing((d) => (d ? { ...d, [k]: v } : d));

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    const body = {
      name: editing.name.trim(),
      description: editing.description.trim(),
      priceMonthly: Math.max(0, Number(editing.priceMonthly) || 0),
      limits: { agents: num(editing.agents), contacts: num(editing.contacts), monthlyMessages: num(editing.monthlyMessages) },
      features: editing.features.split('\n').map((f) => f.trim()).filter(Boolean),
      modules: { chatbot: editing.chatbot, instagram: editing.instagram, social: editing.social },
      isActive: editing.isActive,
    };
    try {
      await api(editing._id ? `/superadmin/plans/${editing._id}` : '/superadmin/plans', { method: editing._id ? 'PATCH' : 'POST', body });
      toast.success('Plan saved');
      setEditing(null);
      load();
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p: Plan) => {
    const ok = await confirm('Delete plan?', `"${p.name}" will be deleted. Plans used by a business can not be deleted — deactivate them instead.`, { ok: 'Delete', danger: true });
    if (!ok) return;
    try {
      await api(`/superadmin/plans/${p._id}`, { method: 'DELETE' });
      toast.success('Plan deleted');
      load();
    } catch (err) {
      toast.error(err);
    }
  };

  const numField = (label: string, k: 'agents' | 'contacts' | 'monthlyMessages') => (
    <Field label={label} style={{ flex: 1 }}>
      <Input value={editing?.[k]} onChangeText={(v) => set(k, v.replace(/\D/g, ''))} keyboardType="number-pad" />
    </Field>
  );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen options={{ title: 'Plans', headerRight: () => <Button size="sm" icon="add" title="New plan" onPress={() => setEditing({ ...emptyDraft })} /> }} />
      {!plans ? (
        <Loader />
      ) : (
        <FlatList
          data={plans}
          keyExtractor={(p) => p._id}
          contentContainerStyle={{ padding: S.lg, gap: S.md }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.brand600} />}
          ListEmptyComponent={<EmptyState icon="card-outline" title="No plans yet" action={<Button icon="add" title="New plan" onPress={() => setEditing({ ...emptyDraft })} />} />}
          renderItem={({ item: p }) => (
            <Card style={{ gap: 6 }}>
              <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1 }}>
                  <T v="h3">{p.name}</T>
                  <T style={{ fontSize: 22, fontWeight: '700', color: C.text }}>
                    {money(p.priceMonthly)}
                    <T v="small">/month</T>
                  </T>
                </View>
                {p.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}
              </Row>
              {p.description ? <T v="small">{p.description}</T> : null}
              <View style={{ gap: 2, marginTop: 4 }}>
                <T>👥 {fmtNum(p.limits?.agents)} agents</T>
                <T>📇 {fmtNum(p.limits?.contacts)} contacts</T>
                <T>✉️ {fmtNum(p.limits?.monthlyMessages)} messages / month</T>
                <T style={p.modules?.chatbot === false ? { color: C.faint } : undefined}>{p.modules?.chatbot !== false ? '🤖 Chatbot included' : '🤖 No chatbot'}</T>
                <T style={p.modules?.instagram === false ? { color: C.faint } : undefined}>{p.modules?.instagram !== false ? '📸 Instagram DMs included' : '📸 No Instagram'}</T>
                <T style={p.modules?.social === false ? { color: C.faint } : undefined}>{p.modules?.social !== false ? '📣 Facebook / Instagram posts & comments' : '📣 No posts & comments'}</T>
                {(p.features || []).map((f) => (
                  <T key={f} v="small">• {f}</T>
                ))}
              </View>
              <Row style={{ justifyContent: 'space-between', marginTop: 4 }}>
                <T v="tiny">{p.tenantCount || 0} businesses</T>
                <Row gap={S.md}>
                  <IconButton name="create-outline" label="Edit plan" onPress={() => setEditing(toDraft(p))} />
                  <IconButton name="trash-outline" color={C.red} label="Delete plan" onPress={() => remove(p)} />
                </Row>
              </Row>
            </Card>
          )}
        />
      )}

      <Sheet
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?._id ? 'Edit plan' : 'New plan'}
        full
        footer={
          <>
            <Button variant="secondary" title="Cancel" onPress={() => setEditing(null)} />
            <Button title="Save" onPress={save} loading={saving} disabled={!editing || editing.name.trim().length < 2 || editing.priceMonthly === ''} />
          </>
        }>
        {editing ? (
          <>
            <Field label="Name">
              <Input value={editing.name} onChangeText={(v) => set('name', v)} />
            </Field>
            <Field label="Price per month (₹)">
              <Input value={editing.priceMonthly} onChangeText={(v) => set('priceMonthly', v.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" />
            </Field>
            <Field label="Description">
              <Input value={editing.description} onChangeText={(v) => set('description', v)} />
            </Field>
            <Row gap={S.sm} style={{ alignItems: 'flex-start' }}>
              {numField('Agents', 'agents')}
              {numField('Contacts', 'contacts')}
            </Row>
            {numField('Messages / month', 'monthlyMessages')}
            <Field label="Features" hint="One per line">
              <Input value={editing.features} onChangeText={(v) => set('features', v)} multiline />
            </Field>
            <Toggle value={editing.chatbot} onChange={(v) => set('chatbot', v)} label="Chatbot module" description="Businesses on this plan can use the WhatsApp chatbot" />
            <Toggle value={editing.instagram} onChange={(v) => set('instagram', v)} label="Instagram module" description="Businesses on this plan can connect Instagram and answer Instagram DMs" />
            <Toggle value={editing.social} onChange={(v) => set('social', v)} label="Posts & comments module" description="Businesses on this plan can post on their Facebook Page / Instagram and reply to comments" />
            <Toggle value={editing.isActive} onChange={(v) => set('isActive', v)} label="Active" description="Inactive plans can not be chosen for new businesses" />
          </>
        ) : null}
      </Sheet>
    </View>
  );
}
