import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { BusinessLogo, BusinessSwitcher } from '@/components/business-switcher';
import { Card, CountBadge, Divider, ListRow, Screen, T, confirm, type IconName } from '@/components/ui';
import { useAuth, useIsCoaching } from '@/lib/auth';
import { useCounts } from '@/lib/counts';
import { C, S } from '@/theme';

type Item = { icon: IconName; title: string; subtitle?: string; href: string; badge?: number; show?: boolean };

/** Everything that is not a bottom tab (same sections as the web sidebar) */
export default function MoreScreen() {
  const { session, logout } = useAuth();
  const coaching = useIsCoaching();
  const { counts } = useCounts();
  const [switching, setSwitching] = useState(false);
  const isAdmin = session?.user.role === 'admin';
  const tenant = session?.tenant;
  const canBroadcast = isAdmin || !!tenant?.settings?.agentsCanBroadcast;
  const chatbotInPlan = tenant?.plan?.modules?.chatbot !== false;

  const groups: { title: string; items: Item[] }[] = [
    {
      title: 'Work',
      items: [
        { icon: 'speedometer-outline', title: 'Dashboard', subtitle: 'Leads, chats, customers & WhatsApp cost', href: '/dashboard' },
        { icon: 'cash-outline', title: 'Fees', subtitle: 'Due, overdue, collected this month', href: '/fees', badge: counts.feesDue, show: coaching },
        { icon: 'notifications-outline', title: 'Notifications', href: '/notifications', badge: counts.notifications },
      ],
    },
    {
      title: 'Marketing',
      items: [
        { icon: 'megaphone-outline', title: 'Bulk campaigns', subtitle: 'Send a template to many leads', href: '/campaigns', show: canBroadcast },
        { icon: 'git-branch-outline', title: 'Drips & automations', subtitle: 'Automatic follow-up series', href: '/drips', show: isAdmin },
        { icon: 'locate-outline', title: 'Ads', subtitle: 'Leads from Facebook / Instagram ads', href: '/ads' },
        { icon: 'gift-outline', title: 'Refer & earn', href: '/referrals', show: isAdmin },
        { icon: 'document-text-outline', title: 'Templates', subtitle: 'WhatsApp message templates', href: '/templates' },
      ],
    },
    {
      title: 'Setup',
      items: [
        { icon: 'school-outline', title: 'Courses', subtitle: 'Course list, fees, batches', href: '/courses', show: coaching },
        { icon: 'hardware-chip-outline', title: 'Chatbot', subtitle: 'Menu, course questions, answers', href: '/chatbot', show: isAdmin && chatbotInPlan },
        { icon: 'people-circle-outline', title: 'Team', subtitle: 'Counsellors and logins', href: '/team', show: isAdmin },
        { icon: 'settings-outline', title: 'Settings', subtitle: 'Business, WhatsApp, lead flow, password', href: '/settings' },
      ],
    },
  ];

  return (
    <Screen>
      {tenant ? (
        <Card onPress={() => setSwitching(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: S.md }}>
          <BusinessLogo name={tenant.name} logo={tenant.logo} size={44} />
          <View style={{ flex: 1 }}>
            <T v="h3" numberOfLines={1}>{tenant.name}</T>
            <T v="small">{session?.user.name} · {isAdmin ? 'Admin' : 'Counsellor'} · {tenant.plan?.name || ''}</T>
            <T v="tiny" style={{ color: C.brand700 }}>{(session?.businessCount || 1) > 1 ? `Switch business (${session?.businessCount}) ▾` : 'Your businesses ▾'}</T>
          </View>
        </Card>
      ) : null}
      {groups.map((g) => {
        const items = g.items.filter((i) => i.show !== false);
        if (!items.length) return null;
        return (
          <View key={g.title} style={{ gap: 6 }}>
            <T v="tiny" style={{ textTransform: 'uppercase', fontWeight: '700', marginLeft: 4 }}>{g.title}</T>
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {items.map((i, k) => (
                <View key={i.href}>
                  {k ? <Divider style={{ marginLeft: 62 }} /> : null}
                  <ListRow icon={i.icon} title={i.title} subtitle={i.subtitle} right={<CountBadge n={i.badge} />} onPress={() => router.push(i.href as Href)} />
                </View>
              ))}
            </Card>
          </View>
        );
      })}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <ListRow icon="log-out-outline" title="Log out" danger onPress={async () => (await confirm('Log out?', `You will need ${session?.user.email} and your password to log in again.`, { ok: 'Log out', danger: true })) && logout()} />
      </Card>
      <T v="tiny" style={{ textAlign: 'center' }}>WhatsApp CRM · {session?.user.email}</T>
      <BusinessSwitcher open={switching} onClose={() => setSwitching(false)} />
    </Screen>
  );
}
