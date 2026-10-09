import Ionicons from '@expo/vector-icons/Ionicons';
import type { ColorValue } from 'react-native';
import { Tabs } from 'expo-router/js-tabs';
import { BusinessButton, HeaderActions } from '@/components/header';
import { useCounts } from '@/lib/counts';
import { C } from '@/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
function icon(name: IconName) {
  return function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Ionicons name={name} size={size} color={color as string} />;
  };
}

/** Bottom tabs: what a counsellor uses all day. Everything else is under "More". */
export default function TabsLayout() {
  const { counts } = useCounts();
  const badge = (n?: number) => (n ? (n > 99 ? '99+' : n) : undefined);
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: C.brand600,
        tabBarInactiveTintColor: C.muted,
        headerTitle: '',
        headerLeft: () => <BusinessButton />,
        headerRight: () => <HeaderActions />,
        headerLeftContainerStyle: { paddingLeft: 16 },
        headerRightContainerStyle: { paddingRight: 16 },
        headerStyle: { backgroundColor: '#fff' },
        sceneStyle: { backgroundColor: C.bg },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Today', tabBarIcon: icon('flash'), tabBarBadge: badge((counts.newLeads || 0) + (counts.tasksDue || 0) + (counts.feesDue || 0)) }} />
      <Tabs.Screen name="inbox" options={{ title: 'Inbox', tabBarIcon: icon('chatbubbles'), tabBarBadge: badge(counts.unreadChats), tabBarBadgeStyle: { backgroundColor: C.brand600 } }} />
      <Tabs.Screen name="leads" options={{ title: 'Leads', tabBarIcon: icon('people'), tabBarBadge: badge(counts.newLeads), tabBarBadgeStyle: { backgroundColor: '#f59e0b' } }} />
      <Tabs.Screen name="tasks" options={{ title: 'Tasks', tabBarIcon: icon('checkbox'), tabBarBadge: badge(counts.tasksDue) }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: icon('grid') }} />
    </Tabs>
  );
}
