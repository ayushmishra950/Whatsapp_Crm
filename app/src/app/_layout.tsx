import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ActionMenuHost } from '@/components/action-menu';
import { ToastProvider } from '@/components/toast';
import { Loader } from '@/components/ui';
import { AuthProvider, useAuth } from '@/lib/auth';

SplashScreen.preventAutoHideAsync().catch(() => {});

/** Logged out → login. Business admin / counsellor → the CRM. Super Admin → the Super Admin panel. */
function RootNavigator() {
  const { session, loading } = useAuth();
  useEffect(() => {
    if (!loading) SplashScreen.hideAsync().catch(() => {});
  }, [loading]);
  if (loading) return <Loader />;
  const role = session?.user.role;
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!!session && role !== 'super_admin'}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={role === 'super_admin'}>
        <Stack.Screen name="(admin)" />
      </Stack.Protected>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="login" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <ToastProvider>
          <StatusBar style="dark" />
          <RootNavigator />
          <ActionMenuHost />
        </ToastProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
