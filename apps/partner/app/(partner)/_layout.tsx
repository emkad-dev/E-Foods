import { Tabs } from 'expo-router';
import { partnerTheme } from '../../src/theme/palette';

export default function PartnerStackLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: partnerTheme.accentStrong,
        tabBarInactiveTintColor: partnerTheme.textMuted,
        tabBarStyle: {
          backgroundColor: partnerTheme.surface,
          borderTopColor: partnerTheme.border,
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
      <Tabs.Screen name="orders" options={{ title: 'Orders' }} />
      <Tabs.Screen name="menu" options={{ title: 'Menu' }} />
      <Tabs.Screen name="profile" options={{ title: 'Store' }} />
      <Tabs.Screen name="order/[id]" options={{ href: null }} />
    </Tabs>
  );
}
