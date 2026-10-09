import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useAuth } from '@/lib/auth';
import { useCounts } from '@/lib/counts';
import { C, F } from '@/theme';
import { BusinessLogo, BusinessSwitcher, useBusinesses } from './business-switcher';
import { IconButton } from './ui';
import { WalkInSheet } from './walk-in';

/** Header left: business logo + name; tap = switch business (shows a dot when another business has work waiting) */
export function BusinessButton() {
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const many = (session?.businessCount || 1) > 1;
  const { data } = useBusinesses(many);
  const tenant = session?.tenant;
  if (!tenant) return null;
  const waiting = (data?.items || []).some((b) => b.userId !== data?.current && ((b.unread || 0) > 0 || (b.tasksDue || 0) > 0));
  return (
    <>
      <Pressable onPress={() => setOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: 210 }} accessibilityLabel="Switch business" hitSlop={6}>
        <BusinessLogo name={tenant.name} logo={tenant.logo} size={30} />
        <View style={{ flexShrink: 1 }}>
          <Text style={{ fontWeight: '700', fontSize: F.md, color: C.text }} numberOfLines={1}>{tenant.name}</Text>
          <Text style={{ fontSize: F.xs, color: C.muted }}>{session?.user.role === 'admin' ? 'Admin' : 'Counsellor'}{many ? ' · switch ▾' : ''}</Text>
        </View>
        {waiting ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.red, marginLeft: -4, marginTop: -14 }} /> : null}
      </Pressable>
      <BusinessSwitcher open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/** Header right: walk-in (+) and the bell */
export function HeaderActions() {
  const { counts, reload } = useCounts();
  const [walkIn, setWalkIn] = useState(false);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
      <Pressable onPress={() => setWalkIn(true)} accessibilityLabel="New walk-in / enquiry" hitSlop={8} style={{ backgroundColor: C.brand600, borderRadius: 16, width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="person-add" size={16} color="#fff" />
      </Pressable>
      <IconButton name="notifications-outline" badge={counts.notifications} onPress={() => router.push('/notifications')} label="Notifications" />
      <WalkInSheet open={walkIn} onClose={() => setWalkIn(false)} onAdded={reload} />
    </View>
  );
}
