import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { LogoPicker } from '@/components/logo-picker';
import { BusinessLogo } from '@/components/business-switcher';
import { BUSINESS_TYPES, SaStatus, clampMonths, type Plan } from '@/components/superadmin-shared';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Divider, Field, InfoLine, Input, Loader, PasswordInput, Row, Screen, SectionTitle, Select, Sheet, T, confirm } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtDateTime, fmtNum, fmtPhone } from '@/lib/format';
import { useSocketEvent } from '@/lib/socket';
import { C, S } from '@/theme';

type TUser = { _id: string; name: string; email: string; role: string; isActive: boolean; lastLoginAt?: string; otherBusinesses?: string[] };
type Detail = {
  tenant: {
    _id: string;
    name: string;
    email?: string;
    phone?: string;
    logo?: string;
    status: string;
    businessType?: string;
    createdAt?: string;
    plan?: Plan | null;
    subscription?: { status?: string; currentPeriodStart?: string; currentPeriodEnd?: string };
    usage?: { month?: string; messagesSent?: number };
    whatsapp?: { mode?: string; displayPhoneNumber?: string; connectedAt?: string };
    instagram?: { mode?: string; username?: string };
  };
  users: TUser[];
  counts: { contacts: number; conversations: number; campaigns: number; templates: number };
};
type Modal = null | 'edit' | 'renew' | 'password' | 'delete';
type Edit = { name: string; email: string; phone: string; adminName: string; adminEmail: string; adminPassword: string; adminPassword2: string; hasAdmin: boolean };

/** One business: subscription, plan, type, team, admin login, suspend / delete */
export default function TenantDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const toast = useToast();
  const { epoch, impersonate } = useAuth();
  const [data, setData] = useState<Detail | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [months, setMonths] = useState('1');
  const [password, setPassword] = useState('');
  const [confirmName, setConfirmName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      api<Detail>(`/superadmin/tenants/${id}`)
        .then(setData)
        .catch(toast.error)
        .finally(() => setRefreshing(false)),
    [id, toast]
  );
  useEffect(() => {
    load();
    api<Plan[]>('/superadmin/plans').then(setPlans).catch(() => {});
  }, [load, epoch]);
  // The business admin (or another Super Admin screen) changed this business: show the new details
  useSocketEvent<{ tenantId?: string }>('tenant:updated', (u) => u?.tenantId === id && load(), epoch);

  if (!data) return <Loader />;
  const { tenant, users, counts } = data;
  const admin = users.find((u) => u.role === 'admin');
  const adminOthers = admin?.otherBusinesses || [];
  const sub = tenant.subscription || {};
  const plan = tenant.plan;
  const active = tenant.status === 'active';

  const run = async (fn: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    try {
      await fn();
      if (success) toast.success(success);
      setModal(null);
      await load();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const openEdit = () => {
    setEdit({ name: tenant.name, email: tenant.email || '', phone: tenant.phone || '', adminName: admin?.name || '', adminEmail: admin?.email || '', adminPassword: '', adminPassword2: '', hasAdmin: !!admin });
    setModal('edit');
  };
  const saveEdit = () =>
    edit &&
    run(async () => {
      await api(`/superadmin/tenants/${id}`, { method: 'PATCH', body: { name: edit.name.trim(), email: edit.email.trim(), phone: edit.phone.trim() } });
      if (admin && (edit.adminName.trim() !== admin.name || edit.adminEmail.trim().toLowerCase() !== admin.email)) {
        await api(`/superadmin/tenants/${id}/admin`, { method: 'PATCH', body: { name: edit.adminName.trim(), email: edit.adminEmail.trim() } });
      }
      // Optional: new login password for the admin (e.g. admin is locked out)
      if (admin && edit.adminPassword) {
        await api(`/superadmin/tenants/${id}/reset-admin-password`, { method: 'POST', body: { password: edit.adminPassword } });
      }
    }, edit.adminPassword ? 'Business details and admin password saved' : 'Business details saved');

  const pw = edit?.adminPassword || '';
  const pw2 = edit?.adminPassword2 || '';
  const passwordError = !!pw && (pw.length < 8 || pw !== pw2);
  const passwordHint = !pw
    ? null
    : pw.length < 8
      ? { color: C.muted, text: `At least 8 characters (${pw.length}/8)` }
      : !pw2
        ? { color: C.muted, text: 'Now type the same password in “Confirm new password”.' }
        : pw !== pw2
          ? { color: C.red, text: 'Passwords do not match' }
          : { color: C.brand700, text: '✓ Passwords match. The admin must log in with the new password from now on; tell them safely.' };

  const changePlan = (planId: string) => planId !== plan?._id && run(() => api(`/superadmin/tenants/${id}`, { method: 'PATCH', body: { planId } }), 'Plan updated');

  const changeType = async (businessType: string) => {
    if (businessType === (tenant.businessType || 'general')) return;
    const ok = await confirm(
      businessType === 'coaching' ? 'Make this a coaching institute?' : 'Switch to general business?',
      businessType === 'coaching'
        ? 'Turns on the Courses page, Hinglish templates and the 19-status lead playbook (statuses and rules are set up only if the business does not have them yet).'
        : 'The coaching format (courses, fees, playbook) is hidden for this business. Its data is kept.',
      { ok: 'Switch' }
    );
    if (!ok) return;
    run(
      () => api(`/superadmin/tenants/${id}`, { method: 'PATCH', body: { businessType } }),
      businessType === 'coaching' ? 'Coaching institute: courses and the lead playbook are switched on' : 'Switched to general business'
    );
  };

  const toggleStatus = async () => {
    const ok = await confirm(
      active ? 'Suspend business?' : 'Activate business?',
      active ? 'Admin and agents will not be able to log in, and campaigns will pause.' : 'The business team will be able to log in again.',
      { ok: active ? 'Suspend' : 'Activate', danger: active }
    );
    if (ok) run(() => api(`/superadmin/tenants/${id}`, { method: 'PATCH', body: { status: active ? 'suspended' : 'active' } }), active ? 'Business suspended' : 'Business activated');
  };

  const cancelSub = async () => {
    if (await confirm('Cancel subscription?', 'The subscription is marked cancelled. Renew it any time to turn it back on.', { ok: 'Cancel subscription', danger: true })) {
      run(() => api(`/superadmin/tenants/${id}/subscription`, { method: 'POST', body: { action: 'cancel' } }), 'Subscription cancelled');
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api(`/superadmin/tenants/${id}`, { method: 'DELETE', body: { confirmName } });
      toast.success('Business deleted');
      setModal(null);
      router.back();
    } catch (err) {
      toast.error(err);
      setBusy(false);
    }
  };

  return (
    <Screen refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }}>
      <Stack.Screen options={{ title: tenant.name }} />

      <Card style={{ gap: S.md }}>
        <Row gap={S.md}>
          <BusinessLogo name={tenant.name} logo={tenant.logo} size={52} />
          <View style={{ flex: 1, gap: 2 }}>
            <T v="h3" numberOfLines={2}>{tenant.name}</T>
            <Row wrap gap={6}>
              <SaStatus status={tenant.status} />
              {tenant.businessType === 'coaching' ? <Badge tone="purple">Coaching</Badge> : null}
            </Row>
            <T v="tiny">Created {fmtDate(tenant.createdAt)}</T>
          </View>
        </Row>
        <View>
          <InfoLine label="Email" value={tenant.email || '—'} />
          <InfoLine label="Phone" value={tenant.phone || '—'} />
          <InfoLine label="Admin" value={admin ? `${admin.name} · ${admin.email}` : 'No admin'} />
        </View>
        <Row wrap gap={S.sm}>
          <Button size="sm" variant="secondary" icon="create-outline" title="Edit" onPress={openEdit} />
          <Button size="sm" variant={active ? 'secondary' : 'primary'} icon={active ? 'ban-outline' : 'checkmark-circle-outline'} title={active ? 'Suspend' : 'Activate'} onPress={toggleStatus} disabled={busy} />
          <LogoPicker name={tenant.name} logo={tenant.logo} path={`/superadmin/tenants/${id}/logo`} onSaved={() => load()} />
        </Row>
        <Button
          size="sm"
          variant="soft"
          icon="eye-outline"
          title="Login as admin (view this business)"
          onPress={async () => {
            if (!(await confirm('Open this business as its admin?', 'Everything you do is recorded in the audit log. Use “Exit” at the bottom to come back.', { ok: 'Open' }))) return;
            try {
              await impersonate(String(id));
            } catch (err) {
              toast.error(err);
            }
          }}
        />
      </Card>

      <SectionTitle right={<SaStatus status={sub.status} />}>Subscription</SectionTitle>
      <Card style={{ gap: S.md }}>
        <View>
          <InfoLine label="Period" value={`${fmtDate(sub.currentPeriodStart)} – ${fmtDate(sub.currentPeriodEnd)}`} />
          <InfoLine label="Monthly price" value={plan ? `₹${plan.priceMonthly}` : '—'} />
        </View>
        <Field label="Plan">
          <Select
            value={plan?._id || ''}
            onChange={changePlan}
            disabled={busy}
            title="Plan"
            options={plans.map((p) => ({ value: p._id, label: `${p.name} (₹${p.priceMonthly}/mo)${!p.isActive ? ' — inactive' : ''}` }))}
          />
        </Field>
        <Field label="Business type" hint={tenant.businessType === 'coaching' ? 'Courses page, Hinglish templates, 19-status playbook' : 'Coaching format is hidden for this business'}>
          <Select value={tenant.businessType || 'general'} onChange={changeType} disabled={busy} title="Business type" options={BUSINESS_TYPES.map(([value, label]) => ({ value, label }))} />
        </Field>
        <Button icon="refresh" title="Record payment / Renew" onPress={() => { setMonths('1'); setModal('renew'); }} full />
        {sub.status !== 'cancelled' ? <Button variant="ghost" title="Cancel subscription" onPress={cancelSub} disabled={busy} /> : null}
      </Card>

      <SectionTitle>Usage</SectionTitle>
      <Card style={{ paddingVertical: S.sm }}>
        <InfoLine label="Agents" value={`${users.filter((u) => u.role === 'agent').length} / ${plan?.limits?.agents ?? '∞'}`} />
        <InfoLine label="Contacts" value={`${fmtNum(counts.contacts)} / ${fmtNum(plan?.limits?.contacts)}`} />
        <InfoLine label={`Messages (${tenant.usage?.month || 'this month'})`} value={`${fmtNum(tenant.usage?.messagesSent)} / ${fmtNum(plan?.limits?.monthlyMessages)}`} />
        <InfoLine label="Conversations" value={fmtNum(counts.conversations)} />
        <InfoLine label="Campaigns / Templates" value={`${counts.campaigns} / ${counts.templates}`} />
      </Card>

      <SectionTitle>WhatsApp number</SectionTitle>
      <Card style={{ paddingVertical: S.sm }}>
        <InfoLine label="Mode" value={tenant.whatsapp?.mode === 'live' ? <Badge tone="green">Live</Badge> : <Badge tone="yellow">Sandbox</Badge>} />
        <InfoLine label="Number" value={fmtPhone(tenant.whatsapp?.displayPhoneNumber) || '—'} />
        <InfoLine label="Connected" value={fmtDate(tenant.whatsapp?.connectedAt)} />
        <InfoLine label="Instagram" value={tenant.instagram?.mode === 'live' ? <Badge tone="green">@{tenant.instagram.username}</Badge> : <Badge tone="yellow">Not connected</Badge>} />
      </Card>

      <SectionTitle hint={`${users.length} ${users.length === 1 ? 'login' : 'logins'}`}>Team</SectionTitle>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {users.map((u, i) => (
          <View key={u._id}>
            {i ? <Divider /> : null}
            <View style={{ padding: S.lg, gap: 4 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <T style={{ fontWeight: '600', color: C.text, flex: 1 }} numberOfLines={1}>{u.name}</T>
                <Row gap={6}>
                  <Badge tone={u.role === 'admin' ? 'purple' : 'gray'}>{u.role === 'admin' ? 'Admin' : 'Agent'}</Badge>
                  <SaStatus status={u.isActive ? 'active' : 'suspended'} />
                </Row>
              </Row>
              <T v="small" selectable>{u.email}</T>
              {u.otherBusinesses?.length ? <T v="tiny" style={{ color: C.violet }}>Same login also opens: {u.otherBusinesses.join(', ')}</T> : null}
              <T v="tiny">Last login {fmtDateTime(u.lastLoginAt)}</T>
            </View>
          </View>
        ))}
        {!users.length ? <T v="small" style={{ padding: S.lg }}>No users.</T> : null}
      </Card>

      <Card style={{ gap: S.sm }}>
        <Button variant="secondary" icon="key-outline" title="Reset admin password" onPress={() => { setPassword(''); setModal('password'); }} disabled={!admin} />
        <Button variant="secondary" icon="document-text-outline" title="Audit log of this business" onPress={() => router.push({ pathname: '/audit-logs', params: { tenantId: tenant._id, tenantName: tenant.name } })} />
        <Button variant="danger" icon="trash-outline" title="Delete business" onPress={() => { setConfirmName(''); setModal('delete'); }} />
      </Card>

      <Sheet
        open={modal === 'edit'}
        onClose={() => setModal(null)}
        title="Edit business"
        footer={
          <>
            <Button variant="secondary" title="Cancel" onPress={() => setModal(null)} />
            <Button title="Save" onPress={saveEdit} loading={busy} disabled={!edit || edit.name.trim().length < 2 || (edit.hasAdmin && edit.adminName.trim().length < 2) || passwordError} />
          </>
        }>
        {edit ? (
          <>
            <Field label="Business name">
              <Input value={edit.name} maxLength={100} onChangeText={(v) => setEdit({ ...edit, name: v })} />
            </Field>
            <Field label="Business email">
              <Input value={edit.email} onChangeText={(v) => setEdit({ ...edit, email: v })} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
            </Field>
            <Field label="Phone">
              <Input value={edit.phone} onChangeText={(v) => setEdit({ ...edit, phone: v })} keyboardType="phone-pad" />
            </Field>
            {edit.hasAdmin ? (
              <Card style={{ gap: S.md, backgroundColor: C.soft, padding: S.md }}>
                <T style={{ fontWeight: '600', color: C.text }}>Business admin</T>
                <Field label="Admin name">
                  <Input value={edit.adminName} maxLength={80} onChangeText={(v) => setEdit({ ...edit, adminName: v })} />
                </Field>
                <Field label="Admin email (login)" hint="The admin logs in with this email.">
                  <Input value={edit.adminEmail} onChangeText={(v) => setEdit({ ...edit, adminEmail: v })} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
                </Field>
                <Field label="New password (optional)" hint="Leave empty to keep the current password">
                  <PasswordInput autoComplete="new-password" value={edit.adminPassword} onChangeText={(v) => setEdit({ ...edit, adminPassword: v, ...(!v && { adminPassword2: '' }) })} />
                </Field>
                <Field label="Confirm new password">
                  <PasswordInput autoComplete="new-password" value={edit.adminPassword2} editable={!!edit.adminPassword} onChangeText={(v) => setEdit({ ...edit, adminPassword2: v })} />
                </Field>
                {passwordHint ? <T v="small" style={{ color: passwordHint.color }}>{passwordHint.text}</T> : null}
                {adminOthers.length ? (
                  <View style={{ backgroundColor: C.violet50, borderRadius: 8, padding: S.sm }}>
                    <T v="small" style={{ color: C.violet }}>
                      This admin uses the same login for: <T v="small" style={{ fontWeight: '700', color: C.violet }}>{adminOthers.join(', ')}</T>. A new email or password changes their login for those businesses too.
                    </T>
                  </View>
                ) : null}
              </Card>
            ) : null}
          </>
        ) : null}
      </Sheet>

      <Sheet
        open={modal === 'renew'}
        onClose={() => setModal(null)}
        title="Renew subscription"
        footer={
          <>
            <Button variant="secondary" title="Cancel" onPress={() => setModal(null)} />
            <Button title="Renew" onPress={() => run(() => api(`/superadmin/tenants/${id}/subscription`, { method: 'POST', body: { action: 'renew', months: clampMonths(months) } }), 'Subscription renewed')} loading={busy} />
          </>
        }>
        <T v="small">Use this after you receive the monthly payment. The period is extended from the current end date (or from today if expired).</T>
        <Field label="Months" hint="1 to 36">
          <Input value={months} onChangeText={(v) => setMonths(v.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={2} />
        </Field>
      </Sheet>

      <Sheet
        open={modal === 'password'}
        onClose={() => setModal(null)}
        title="Reset admin password"
        footer={
          <>
            <Button variant="secondary" title="Cancel" onPress={() => setModal(null)} />
            <Button title="Reset" onPress={() => run(() => api(`/superadmin/tenants/${id}/reset-admin-password`, { method: 'POST', body: { password } }), 'Admin password reset')} loading={busy} disabled={password.length < 8} />
          </>
        }>
        <T v="small">New login password for {admin?.name} ({admin?.email}).</T>
        <Field label="New password" hint="Min 8 characters">
          <PasswordInput value={password} onChangeText={setPassword} autoComplete="new-password" />
        </Field>
        {adminOthers.length ? <T v="small" style={{ color: C.violet }}>Same login also opens {adminOthers.join(', ')}: the new password works there too.</T> : null}
      </Sheet>

      <Sheet
        open={modal === 'delete'}
        onClose={() => setModal(null)}
        title="Delete business permanently?"
        footer={
          <>
            <Button variant="secondary" title="Cancel" onPress={() => setModal(null)} />
            <Button variant="danger" title="Delete forever" onPress={remove} loading={busy} disabled={confirmName !== tenant.name} />
          </>
        }>
        <T v="small">This deletes the business, its team, contacts, chats, templates and campaigns. This can not be undone.</T>
        <Field label={`Type "${tenant.name}" to confirm`}>
          <Input value={confirmName} onChangeText={setConfirmName} autoCapitalize="none" autoCorrect={false} />
        </Field>
      </Sheet>
    </Screen>
  );
}
