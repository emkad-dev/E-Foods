import { Slot, Tabs } from 'expo-router';
import { Platform, View } from 'react-native';
import AdminSidebar from '../../src/components/AdminSidebar';
import { AdminSidebarPrefsProvider, useSidebarPrefs } from '../../src/components/AdminSidebarPrefsContext';
import { usePushNotifications } from '../../src/hooks/usePushNotifications';
import { adminTheme } from '../../src/theme/palette';

function AdminWebShell() {
  const { side } = useSidebarPrefs();

  const sidebar = <AdminSidebar key="sidebar" />;
  const content = (
    // minHeight:0 + overflow:hidden lets the inner ScrollView own the scroll
    // instead of the whole page growing (react-native-web flexbox requirement).
    <View key="content" style={{ flex: 1, minHeight: 0 as any, overflow: 'hidden' as any }}>
      <Slot />
    </View>
  );

  const row = side === 'right' ? [content, sidebar] : [sidebar, content];

  // Fixed viewport height so the sidebar stays put and the content pane scrolls.
  return (
    <View style={{ flexDirection: 'row', height: '100vh' as any, overflow: 'hidden' as any }}>{row}</View>
  );
}

export default function AdminTabsLayout() {
  usePushNotifications();

  if (Platform.OS === 'web') {
    return (
      <AdminSidebarPrefsProvider>
        <AdminWebShell />
      </AdminSidebarPrefsProvider>
    );
  }

  return (
    <AdminSidebarPrefsProvider>
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
        <Tabs.Screen name="users" options={{ title: 'Users' }} />
        <Tabs.Screen name="orders" options={{ title: 'Orders' }} />
        <Tabs.Screen name="dispatch" options={{ title: 'Dispatch' }} />
        <Tabs.Screen name="approvals" options={{ title: 'Approvals' }} />
        <Tabs.Screen name="access" options={{ title: 'Access' }} />
        <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
      </Tabs>
    </AdminSidebarPrefsProvider>
  );
}
