import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { useAuth } from '@/lib/auth';
import { registerForPush } from '@/lib/push';

/**
 * Inside a business: registers this phone for alerts, and opens the right business + screen
 * when an alert is tapped (also when the tap started the app).
 */
export function PushHandler() {
  const { session, switchBusiness } = useAuth();
  const me = session?.user._id;
  const impersonating = session?.impersonating;
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (Platform.OS === 'web' || !me || impersonating) return;
    registerForPush().then((r) => {
      if (!r.ok && r.reason) console.log('[push]', r.reason);
    }).catch((err) => console.log('[push] register failed', err?.message));
  }, [me, impersonating]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const open = async (resp: Notifications.NotificationResponse | null) => {
      if (!resp) return;
      const id = resp.notification.request.identifier;
      if (handled.current === id) return;
      handled.current = id;
      const data = (resp.notification.request.content.data || {}) as { userId?: string; url?: string };
      try {
        // Alert from another business of this login: open that business first
        if (data.userId && data.userId !== me) await switchBusiness(data.userId);
        if (data.url) setTimeout(() => router.push(data.url as Href), 300);
      } catch {
        // business not available any more: stay where we are
      }
    };
    Notifications.getLastNotificationResponseAsync().then(open).catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [me, switchBusiness]);

  return null;
}
