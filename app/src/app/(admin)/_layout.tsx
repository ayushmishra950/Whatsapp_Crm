import { Stack } from 'expo-router';
import { C } from '@/theme';

/** Super Admin panel: businesses, plans, audit log */
export default function AdminLayout() {
  return (
    <Stack
      screenOptions={{
        headerTintColor: C.brand700,
        headerTitleStyle: { color: C.text, fontWeight: '600' },
        contentStyle: { backgroundColor: C.bg },
        headerBackButtonDisplayMode: 'minimal',
      }}
    />
  );
}
