import { Stack, router } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { BusinessSwitcher } from '@/components/business-switcher';
import { InstagramSettings } from '@/components/instagram-settings';
import { FacebookSettings } from '@/components/social';
import {
  BusinessProfileSheet,
  ChangePasswordSheet,
  CoachingPackSheet,
  LeadFlowSheet,
  MessageInfoSheet,
  QuietHoursSheet,
  ReferralSheet,
  WaRatesSheet,
  WalkInTemplateSheet,
  WhatsAppSheet,
  type SettingsData,
} from '@/components/settings-forms';
import { KeywordRulesSheet, keywordRulesSummary } from '@/components/settings-keywords';
import { ContactFieldsSheet, LeadStatusesSheet } from '@/components/settings-lists';
import { useToast } from '@/components/toast';
import { Avatar, Badge, Card, Divider, InfoLine, ListRow, Loader, Row, Screen, T, Toggle, type IconName } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { DEFAULT_LEAD_STATUSES } from '@/lib/business';
import { fmtDate, fmtNum, fmtPhone } from '@/lib/format';
import { C, S, TONES } from '@/theme';

type SheetKey = 'profile' | 'whatsapp' | 'quiet' | 'flow' | 'walkin' | 'rates' | 'info' | 'referral' | 'statuses' | 'fields' | 'keywords' | 'coaching' | 'password' | '';

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <T v="tiny" style={{ textTransform: 'uppercase', fontWeight: '700', marginLeft: 4 }}>{title}</T>
      {children}
    </View>
  );
}

type Item = { key: SheetKey; icon: IconName; title: string; subtitle?: string; right?: ReactNode; show?: boolean };
function Items({ items, onOpen }: { items: Item[]; onOpen: (k: SheetKey) => void }) {
  const shown = items.filter((i) => i.show !== false);
  if (!shown.length) return null;
  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      {shown.map((i, k) => (
        <View key={i.key}>
          {k ? <Divider style={{ marginLeft: 62 }} /> : null}
          <ListRow icon={i.icon} title={i.title} subtitle={i.subtitle} right={i.right} onPress={() => onOpen(i.key)} />
        </View>
      ))}
    </Card>
  );
}

/** Business, WhatsApp, automation, lead flow, statuses, fields and password (agents: password + their login) */
export default function SettingsScreen() {
  const toast = useToast();
  const { session, epoch, refresh } = useAuth();
  const isAdmin = session?.user.role === 'admin';
  const coaching = session?.tenant?.businessType === 'coaching';
  const [s, setS] = useState<SettingsData | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [sheet, setSheet] = useState<SheetKey>('');
  const [switching, setSwitching] = useState(false);
  const [toggling, setToggling] = useState('');

  const load = useCallback(
    () =>
      api<SettingsData>('/settings')
        .then(setS)
        .catch(toast.error)
        .finally(() => setRefreshing(false)),
    [toast]
  );
  useEffect(() => {
    load();
  }, [load, epoch]);

  const reloadAll = useCallback(() => Promise.all([load(), refresh()]), [load, refresh]);

  /** PATCH /settings, then reload this page and the session (session.tenant.settings) */
  const save = useCallback(
    async (body: Record<string, unknown>, message = 'Settings saved') => {
      try {
        await api('/settings', { method: 'PATCH', body });
        toast.success(message);
        await reloadAll();
        return true;
      } catch (err) {
        toast.error(err);
        return false;
      }
    },
    [toast, reloadAll]
  );

  const flip = async (key: string, value: boolean) => {
    setToggling(key);
    await save({ settings: { [key]: value } });
    setToggling('');
  };

  if (!s) return <Loader />;
  const st = s.settings || {};
  const a = st.automation || {};
  const live = s.whatsapp.mode === 'live';
  const statuses = st.leadStatuses?.length ? st.leadStatuses : DEFAULT_LEAD_STATUSES;
  const close = () => setSheet('');
  const many = (session?.businessCount || 1) > 1;

  return (
    <Screen refreshing={refreshing} onRefresh={() => { setRefreshing(true); reloadAll().finally(() => setRefreshing(false)); }}>
      <Stack.Screen options={{ title: 'Settings' }} />

      <Group title="Your login">
        <Card style={{ gap: S.sm }}>
          <Row gap={S.md}>
            <Avatar name={session?.user.name} />
            <View style={{ flex: 1 }}>
              <T style={{ fontWeight: '600', color: C.text }}>{session?.user.name}</T>
              <T v="small">{session?.user.email}</T>
            </View>
            <Badge tone={isAdmin ? 'purple' : 'gray'}>{isAdmin ? 'Admin' : 'Counsellor'}</Badge>
          </Row>
          <T v="tiny">{many ? `This login opens ${session?.businessCount} businesses.` : `Business: ${session?.tenant?.name || s.name}`}</T>
        </Card>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <ListRow icon="key-outline" title="Change password" subtitle={many ? `Applies to all ${session?.businessCount} businesses of this login` : undefined} onPress={() => setSheet('password')} />
          <Divider style={{ marginLeft: 62 }} />
          <ListRow icon="swap-horizontal-outline" title="Your businesses" subtitle="Switch business, or add one that has a different login" onPress={() => setSwitching(true)} />
        </Card>
      </Group>

      {isAdmin && (
        <Group title="Business">
          <Items
            onOpen={setSheet}
            items={[
              { key: 'profile', icon: 'business-outline', title: 'Business profile', subtitle: [s.name, s.email, s.phone].filter(Boolean).join(' · ') },
              {
                key: 'whatsapp',
                icon: 'logo-whatsapp',
                title: 'WhatsApp number',
                subtitle: live ? `${fmtPhone(s.whatsapp.displayPhoneNumber)} · since ${fmtDate(s.whatsapp.connectedAt)}` : 'Not connected — sandbox mode',
                right: live ? <Badge tone="green">Live</Badge> : <Badge tone="yellow">Sandbox</Badge>,
              },
            ]}
          />
          <Card style={{ gap: 2 }}>
            <T v="h3" style={{ marginBottom: 4 }}>Plan & usage</T>
            <InfoLine label="Plan" value={`${s.plan?.name || '—'}${s.plan?.priceMonthly != null ? ` (₹${s.plan.priceMonthly}/month)` : ''}`} />
            <InfoLine label="Subscription" value={<SubscriptionBadge status={s.subscriptionActive ? s.subscription?.status : 'expired'} />} />
            <InfoLine label="Valid till" value={fmtDate(s.subscription?.currentPeriodEnd)} />
            <InfoLine label="Agents" value={`${s.usage.agents} / ${s.plan?.limits?.agents ?? '∞'}`} />
            <InfoLine label="Contacts" value={`${fmtNum(s.usage.contacts)} / ${s.plan?.limits?.contacts != null ? fmtNum(s.plan.limits.contacts) : '∞'}`} />
            <InfoLine label="Messages this month" value={`${fmtNum(s.usage.messagesThisMonth)} / ${s.plan?.limits?.monthlyMessages != null ? fmtNum(s.plan.limits.monthlyMessages) : '∞'}`} />
            <T v="tiny" style={{ marginTop: 4 }}>To upgrade or renew, contact the platform administrator.</T>
          </Card>
        </Group>
      )}

      {!isAdmin && (
        <Group title="Business">
          <Card style={{ gap: 2 }}>
            <InfoLine label="WhatsApp number" value={live ? fmtPhone(s.whatsapp.displayPhoneNumber) : 'Not connected — sandbox mode'} />
            <InfoLine label="Plan" value={s.plan?.name || '—'} />
            <InfoLine label="Subscription" value={<SubscriptionBadge status={s.subscriptionActive ? s.subscription?.status : 'expired'} />} />
            <InfoLine label="Valid till" value={fmtDate(s.subscription?.currentPeriodEnd)} />
            <T v="tiny" style={{ marginTop: 4 }}>Only the admin can change business settings.</T>
          </Card>
        </Group>
      )}

      {isAdmin && (
        <Group title="Automation & permissions">
          <Card style={{ gap: S.lg }}>
            <Toggle value={!!st.autoAssign} disabled={!!toggling} onChange={(v) => flip('autoAssign', v)} label="Auto-assign new chats" description="New customer chats are given to agents one by one (round-robin)." />
            <Toggle value={!!st.agentsCanBroadcast} disabled={!!toggling} onChange={(v) => flip('agentsCanBroadcast', v)} label="Agents can send bulk campaigns" description="By default only the admin can send bulk messages." />
            <Toggle
              value={st.autoLeadStatus !== false}
              disabled={!!toggling}
              onChange={(v) => flip('autoLeadStatus', v)}
              label="Auto lead status from chat"
              description={'Customer writes "interested" → Interested, "not interested" / "interest nahi hai" → Not interested. Converted leads are never changed.'}
            />
          </Card>
          <Items
            onOpen={setSheet}
            items={[
              { key: 'quiet', icon: 'moon-outline', title: 'Quiet hours & limits', subtitle: `${a.quietStart ?? '21:00'}–${a.quietEnd ?? '09:00'} · max ${a.maxPerContactPerDay ?? 2}/day · opt-out keywords` },
              {
                key: 'flow',
                icon: 'git-network-outline',
                title: 'Lead follow-up rules',
                subtitle: [a.oneDripAtATime !== false && 'one drip at a time', a.alertOnReply !== false && 'reply alerts', coaching && a.feeReminders !== false && 'fee reminders', a.dailyReportTime !== '' && `report ${a.dailyReportTime ?? '09:00'}`].filter(Boolean).join(' · ') || 'Drips, alerts, morning report',
              },
              { key: 'walkin', icon: 'walk-outline', title: 'Walk-in welcome message', subtitle: a.walkInTemplateId ? 'Your chosen template' : 'Default (walkin_welcome)' },
              { key: 'rates', icon: 'pricetag-outline', title: 'WhatsApp rates', subtitle: `Marketing ₹${st.waRates?.marketing ?? 0.86} · utility ₹${st.waRates?.utility ?? 0.115}` },
              { key: 'info', icon: 'information-circle-outline', title: 'Message info', subtitle: 'Review link, address, payment details…' },
              { key: 'referral', icon: 'gift-outline', title: 'Refer & earn', subtitle: st.referral?.enabled === false ? 'Off' : 'On' },
            ]}
          />
        </Group>
      )}

      <Group title="Instagram">
        <InstagramSettings ig={s.instagram} isAdmin={isAdmin} onChanged={reloadAll} />
      </Group>

      {s.facebook ? (
        <Group title="Facebook Page & posts">
          <FacebookSettings fb={s.facebook} igCanPost={s.instagram?.canPost !== false} isAdmin={isAdmin} onChanged={reloadAll} />
        </Group>
      ) : null}

      {isAdmin && (
        <Group title="Files">
          <DiskFilesRow epoch={epoch} />
        </Group>
      )}

      {isAdmin && (
        <Group title="Leads">
          <Card style={{ gap: S.sm }}>
            <T v="h3">Lead statuses</T>
            <Row wrap gap={6}>
              {statuses.map((x: any) => (
                <Badge key={x.key} tone={TONES[x.color] ? x.color : 'gray'}>{x.label}</Badge>
              ))}
            </Row>
          </Card>
          <Items
            onOpen={setSheet}
            items={[
              { key: 'statuses', icon: 'list-outline', title: 'Edit lead statuses', subtitle: `${statuses.length} statuses · stages & time limits` },
              { key: 'keywords', icon: 'flash-outline', title: 'Keyword rules', subtitle: keywordRulesSummary(st.automationRules) },
              { key: 'fields', icon: 'albums-outline', title: 'Contact fields', subtitle: (st.contactFields || []).map((f: any) => f.label).join(', ') || 'Course, City… (extra lead details)' },
              { key: 'coaching', icon: 'school-outline', title: 'Coaching industry pack', subtitle: 'Templates, drips, sample courses', show: coaching },
            ]}
          />
        </Group>
      )}

      {!isAdmin && (
        <Card>
          <T v="small">Business settings (WhatsApp number, lead statuses, automation) are managed by your admin.</T>
        </Card>
      )}

      {sheet === 'profile' && <BusinessProfileSheet s={s} onClose={close} onSave={save} />}
      {sheet === 'whatsapp' && <WhatsAppSheet s={s} isAdmin={isAdmin} onClose={close} onDone={reloadAll} />}
      {sheet === 'quiet' && <QuietHoursSheet s={s} onClose={close} onSave={save} />}
      {sheet === 'flow' && <LeadFlowSheet s={s} onClose={close} onSave={save} />}
      {sheet === 'walkin' && <WalkInTemplateSheet s={s} onClose={close} onSave={save} />}
      {sheet === 'rates' && <WaRatesSheet s={s} onClose={close} onSave={save} />}
      {sheet === 'info' && <MessageInfoSheet s={s} coaching={coaching} onClose={close} onSave={save} />}
      {sheet === 'referral' && <ReferralSheet s={s} onClose={close} onSave={save} />}
      {sheet === 'statuses' && <LeadStatusesSheet initial={statuses} coaching={coaching} onClose={close} onSaved={reloadAll} />}
      {sheet === 'keywords' && <KeywordRulesSheet initial={st.automationRules} onClose={close} onSaved={reloadAll} />}
      {sheet === 'fields' && <ContactFieldsSheet onClose={close} onSaved={reloadAll} />}
      {sheet === 'coaching' && <CoachingPackSheet onClose={close} onDone={reloadAll} />}
      {sheet === 'password' && <ChangePasswordSheet onClose={close} />}
      <BusinessSwitcher open={switching} onClose={() => setSwitching(false)} />
    </Screen>
  );
}

const SUB_TONE: Record<string, string> = { active: 'green', trialing: 'blue', trial: 'blue', past_due: 'yellow', expired: 'red', cancelled: 'red', canceled: 'red' };
function SubscriptionBadge({ status }: { status?: string }) {
  return <Badge tone={SUB_TONE[status || ''] || 'gray'}>{status || '—'}</Badge>;
}

/** Chat files waiting on the server disk because Cloudinary failed (opens the list) */
function DiskFilesRow({ epoch }: { epoch: number }) {
  const [usage, setUsage] = useState<{ files: number; failed: number } | null>(null);
  useEffect(() => {
    api('/settings/disk-files').then((d) => setUsage(d.usage)).catch(() => {});
  }, [epoch]);
  const n = usage?.files || 0;
  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <ListRow
        icon="server-outline"
        title="Files on server disk"
        subtitle={!usage ? 'Checking…' : n ? `${n} waiting for Cloudinary${usage.failed ? ` · ${usage.failed} need you` : ''}` : 'All files are on Cloudinary'}
        right={n ? <Badge tone={usage?.failed ? 'red' : 'yellow'}>{String(n)}</Badge> : undefined}
        onPress={() => router.push('/disk-files')}
      />
    </Card>
  );
}
