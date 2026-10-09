import Ionicons from '@expo/vector-icons/Ionicons';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth';
import { fmtDate } from '@/lib/format';
import { C } from '@/theme';

/** Subscription ended: sending is paused — say so on every screen (like the web), so nobody wonders why messages fail */
export function SubscriptionBanner() {
  const { session } = useAuth();
  const insets = useSafeAreaInsets();
  const tenant = session?.tenant;
  if (!tenant || tenant.subscriptionActive !== false || session?.impersonating) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 12, right: 12, bottom: insets.bottom + 62, zIndex: 40 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fef2f2', borderColor: '#fecaca', borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 }}>
        <Ionicons name="warning" size={16} color={C.red} />
        <Text style={{ flex: 1, color: '#991b1b', fontSize: 12 }}>
          Subscription ended on {fmtDate(tenant.subscription?.currentPeriodEnd)}. Sending messages is paused — contact your provider to renew.
        </Text>
      </View>
    </View>
  );
}
