import { Tabs } from 'expo-router';
import { dispatchTheme } from '../../src/theme/palette';

export default function DispatchLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: dispatchTheme.accentStrong,
        tabBarInactiveTintColor: dispatchTheme.textMuted,
        tabBarStyle: {
          backgroundColor: dispatchTheme.tabBackground,
          borderTopColor: dispatchTheme.border,
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
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
        }}
      />
      <Tabs.Screen
        name="deliveries"
        options={{
          title: 'Deliveries',
        }}
      />
      <Tabs.Screen
        name="fleet"
        options={{
          title: 'Fleet',
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Rider',
        }}
      />
      <Tabs.Screen
        name="delivery/[id]"
        options={{
          href: null,
        }}
      />
    </Tabs>
  );
}
