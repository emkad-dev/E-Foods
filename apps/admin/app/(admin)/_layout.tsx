import { Tabs } from 'expo-router';
import { usePushNotifications } from '../../src/hooks/usePushNotifications';
import { adminTheme } from '../../src/theme/palette';

export default function AdminTabsLayout() {
  usePushNotifications();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: adminTheme.accent,
        tabBarInactiveTintColor: adminTheme.textMuted,
        tabBarStyle: {
          backgroundColor: adminTheme.surface,
          borderTopColor: adminTheme.border,
          height: 70,
          paddingBottom: 8,
          paddingTop: 8,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '700',
        },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Dashboard' }} />
      <Tabs.Screen name="approvals" options={{ title: 'Approvals' }} />
      <Tabs.Screen name="access" options={{ title: 'Access' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}
