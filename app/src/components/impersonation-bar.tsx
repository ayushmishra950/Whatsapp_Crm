import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth';
import { C } from '@/theme';
import { useToast } from './toast';

/** Super Admin viewing a business as its admin: always-visible "Exit" */
export function ImpersonationBar() {
  const { session, stopImpersonating } = useAuth();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  if (!session?.impersonating) return null;
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom + 62, alignItems: 'center', zIndex: 50 }}>
      <Pressable
        onPress={() => stopImpersonating().catch(toast.error)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.amber900, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, elevation: 4 }}>
        <Text style={{ color: '#fff', fontSize: 12 }} numberOfLines={1}>👁 Viewing {session.tenant?.name} as Super Admin</Text>
        <Text style={{ color: '#fde68a', fontSize: 12, fontWeight: '700' }}>Exit</Text>
      </Pressable>
    </View>
  );
}
