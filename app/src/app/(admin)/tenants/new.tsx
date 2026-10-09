import { router, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { BUSINESS_TYPES, clampMonths, type Plan } from '@/components/superadmin-shared';
import { useToast } from '@/components/toast';
import { Button, Card, Field, Input, PasswordInput, Row, Screen, Select, T, Toggle } from '@/components/ui';
import { api } from '@/lib/api';
import { C, S } from '@/theme';

const emptyForm = {
  name: '',
  email: '',
  phone: '',
  planId: '',
  subscriptionStatus: 'trial' as 'trial' | 'active',
  months: '1',
  businessType: 'general',
  sampleCourses: false,
  admin: { existingLogin: false, name: '', email: '', password: '' },
};

/** New business + its admin login (same form as the web) */
export default function NewTenantScreen() {
  const toast = useToast();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<Plan[]>('/superadmin/plans')
      .then((p) => setPlans(p.filter((x) => x.isActive)))
      .catch(toast.error);
  }, [toast]);

  const set = <K extends keyof typeof emptyForm>(k: K, v: (typeof emptyForm)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setAdmin = <K extends keyof typeof emptyForm.admin>(k: K, v: (typeof emptyForm.admin)[K]) => setForm((f) => ({ ...f, admin: { ...f.admin, [k]: v } }));

  const planId = form.planId || plans[0]?._id || '';
  const a = form.admin;
  const ready =
    form.name.trim().length >= 2 && !!planId && !!a.email.trim() && (a.existingLogin || (a.name.trim().length >= 2 && a.password.length >= 8));

  const create = async () => {
    setSaving(true);
    try {
      const admin = a.existingLogin ? { existingLogin: true, email: a.email.trim() } : { existingLogin: false, name: a.name.trim(), email: a.email.trim(), password: a.password };
      const tenant = await api<{ _id: string }>('/superadmin/tenants', {
        method: 'POST',
        body: {
          name: form.name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
          planId,
          subscriptionStatus: form.subscriptionStatus,
          months: clampMonths(form.months),
          businessType: form.businessType,
          sampleCourses: form.businessType === 'coaching' && form.sampleCourses,
          admin,
        },
      });
      toast.success('Business created');
      router.replace(`/tenants/${tenant._id}`);
    } catch (err) {
      toast.error(err);
      setSaving(false);
    }
  };

  return (
    <Screen
      footer={
        <>
          <Button variant="secondary" title="Cancel" onPress={() => router.back()} style={{ flex: 1 }} />
          <Button title="Create business" onPress={create} loading={saving} disabled={!ready} style={{ flex: 1 }} />
        </>
      }>
      <Stack.Screen options={{ title: 'New business' }} />
      <Card style={{ gap: S.md }}>
        <Field label="Business name">
          <Input value={form.name} onChangeText={(v) => set('name', v)} maxLength={100} />
        </Field>
        <Field label="Business email">
          <Input value={form.email} onChangeText={(v) => set('email', v)} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
        </Field>
        <Field label="Phone">
          <Input value={form.phone} onChangeText={(v) => set('phone', v)} keyboardType="phone-pad" />
        </Field>
        <Field label="Business type" hint="Coaching institute = courses, Hinglish templates and the 19-status lead playbook, set up automatically">
          <Select value={form.businessType} onChange={(v) => set('businessType', v)} title="Business type" options={BUSINESS_TYPES.map(([value, label]) => ({ value, label }))} />
        </Field>
        {form.businessType === 'coaching' ? (
          <Toggle
            value={form.sampleCourses}
            onChange={(v) => set('sampleCourses', v)}
            label="Add the sample course catalog"
            description="51 IT & skill courses: AI, coding, digital marketing, office, communication… Leave off if the institute teaches other courses."
          />
        ) : null}
      </Card>

      <Card style={{ gap: S.md }}>
        <Field label="Plan">
          <Select
            value={planId}
            onChange={(v) => set('planId', v)}
            title="Plan"
            placeholder={plans.length ? 'Choose a plan' : 'No active plans — create one first'}
            options={plans.map((p) => ({ value: p._id, label: `${p.name} (₹${p.priceMonthly}/mo)` }))}
          />
        </Field>
        <Row gap={S.md} style={{ alignItems: 'flex-start' }}>
          <Field label="Start as" style={{ flex: 1 }}>
            <Select
              value={form.subscriptionStatus}
              onChange={(v) => set('subscriptionStatus', v as 'trial' | 'active')}
              title="Start as"
              options={[{ value: 'trial', label: 'Trial' }, { value: 'active', label: 'Paid (active)' }]}
            />
          </Field>
          <Field label="Months" style={{ width: 100 }}>
            <Input value={form.months} onChangeText={(v) => set('months', v.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={2} />
          </Field>
        </Row>
      </Card>

      <Card style={{ gap: S.md, backgroundColor: C.soft }}>
        <T style={{ fontWeight: '600', color: C.text }}>Admin login for this business</T>
        <Toggle
          value={a.existingLogin}
          onChange={(v) => setAdmin('existingLogin', v)}
          label="Admin already has a login (for another business)"
          description="The client opens both businesses with the same email and password, and switches between them."
        />
        {a.existingLogin ? (
          <Field label="Their login email" hint="This business is added to that login. Their password does not change.">
            <Input value={a.email} onChangeText={(v) => setAdmin('email', v)} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
          </Field>
        ) : (
          <View style={{ gap: S.md }}>
            <Field label="Admin name">
              <Input value={a.name} onChangeText={(v) => setAdmin('name', v)} />
            </Field>
            <Field label="Admin email">
              <Input value={a.email} onChangeText={(v) => setAdmin('email', v)} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
            </Field>
            <Field label="Password" hint="Min 8 characters" error={a.password && a.password.length < 8 ? `At least 8 characters (${a.password.length}/8)` : undefined}>
              <PasswordInput value={a.password} onChangeText={(v) => setAdmin('password', v)} autoComplete="new-password" />
            </Field>
          </View>
        )}
      </Card>
    </Screen>
  );
}
