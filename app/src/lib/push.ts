import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from './api';

/**
 * Phone notifications (new customer messages, hot leads, tasks…) through the Expo push service.
 * The token is saved on the login, so one phone gets the alerts of all businesses of that login.
 * Needs a real phone and an EAS project id (app.json → extra.eas.projectId, set by `eas init`).
 */
let currentToken: string | null = null;

if (Platform.OS !== 'web') {
  // Show alerts while the app is open too (WhatsApp-like)
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }),
  });
}

export const projectId = (): string | undefined =>
  (Constants.expoConfig?.extra as any)?.eas?.projectId || (Constants as any).easConfig?.projectId || undefined;

/** Ask permission, get this phone's push token and save it on the login. Returns why it could not, if not. */
export async function registerForPush(): Promise<{ ok: boolean; reason?: string }> {
  if (Platform.OS === 'web') return { ok: false, reason: 'web' };
  if (!Device.isDevice) return { ok: false, reason: 'Push notifications need a real phone (not a simulator).' };
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', { name: 'CRM alerts', importance: Notifications.AndroidImportance.HIGH, sound: 'default', vibrationPattern: [0, 200, 120, 200] });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return { ok: false, reason: 'Notifications are turned off for this app in the phone settings.' };
  const pid = projectId();
  if (!pid) return { ok: false, reason: 'App is not linked to an EAS project yet (run `eas init`).' };
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: pid });
  currentToken = token;
  await api('/auth/push-token', { method: 'POST', body: { token, platform: Platform.OS, device: Device.modelName || '' } });
  return { ok: true };
}

/** Before logout: this phone stops getting this login's alerts */
export async function unregisterPush() {
  if (!currentToken) return;
  const token = currentToken;
  currentToken = null;
  await api('/auth/push-token', { method: 'DELETE', body: { token } }).catch(() => {});
}
