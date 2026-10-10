import { Stack } from 'expo-router';
import { ImpersonationBar } from '@/components/impersonation-bar';
import { SubscriptionBanner } from '@/components/subscription-banner';
import { PushHandler } from '@/components/push-handler';
import { CountsProvider } from '@/lib/counts';
import { C } from '@/theme';

/** Inside a business: the tabs, and every detail screen on top of them */
export default function AppLayout() {
  return (
    <CountsProvider>
      <PushHandler />
      <Stack
        screenOptions={{
          headerTintColor: C.brand700,
          headerTitleStyle: { color: C.text, fontWeight: '600' },
          headerStyle: { backgroundColor: '#fff' },
          contentStyle: { backgroundColor: C.bg },
          headerBackButtonDisplayMode: 'minimal',
        }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        {/* Titles while a screen is still loading (each screen sets its own once it has data) */}
        <Stack.Screen name="lead/[id]" options={{ title: 'Lead' }} />
        <Stack.Screen name="chat/[id]" options={{ title: 'Chat' }} />
        <Stack.Screen name="templates/index" options={{ title: 'Templates' }} />
        <Stack.Screen name="templates/[id]" options={{ title: 'Template' }} />
        <Stack.Screen name="campaigns/index" options={{ title: 'Bulk campaigns' }} />
        <Stack.Screen name="campaigns/new" options={{ title: 'New campaign' }} />
        <Stack.Screen name="campaigns/[id]" options={{ title: 'Campaign' }} />
        <Stack.Screen name="drips/index" options={{ title: 'Drips & automations' }} />
        <Stack.Screen name="drips/[id]" options={{ title: 'Drip' }} />
        <Stack.Screen name="disk-files" options={{ title: 'Files on server disk' }} />
        <Stack.Screen name="social/index" options={{ title: 'Facebook / Insta posts' }} />
        <Stack.Screen name="social/comments" options={{ title: 'Comments' }} />
      </Stack>
      <SubscriptionBanner />
      <ImpersonationBar />
    </CountsProvider>
  );
}
