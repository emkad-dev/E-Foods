import { Slot, Tabs, usePathname, useRouter } from 'expo-router';
import { Platform, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import FeastyWordmark from '../../src/components/FeastyWordmark';
import { useAuth } from '../../src/contexts/AuthContext';
import { usePushNotifications } from '../../src/hooks/usePushNotifications';
import { partnerTheme } from '../../src/theme/palette';

const WIDE_BREAKPOINT = 1024;

const NAV_ITEMS = [
  { path: '/', label: 'Dashboard' },
  { path: '/orders', label: 'Orders' },
  { path: '/menu', label: 'Menu' },
  { path: '/profile', label: 'Store' },
];

const isNavItemActive = (path: string, pathname: string) => {
  if (path === '/') {
    return pathname === '/' || pathname === '';
  }

  if (path === '/orders') {
    return pathname.startsWith('/orders') || pathname.startsWith('/order');
  }

  return pathname.startsWith(path);
};

function SidebarShell() {
  const pathname = usePathname();
  const router = useRouter();
  const { signOut } = useAuth();

  return (
    <View style={styles.shell}>
      <View style={styles.sidebar}>
        <View style={styles.logoBlock}>
          <FeastyWordmark size={34} />
          <Text style={styles.logoSub}>Partner</Text>
        </View>
        <View style={styles.nav}>
          {NAV_ITEMS.map((item) => {
            const active = isNavItemActive(item.path, pathname);

            return (
              <TouchableOpacity
                key={item.path}
                style={[styles.navLink, active ? styles.navLinkActive : null]}
                onPress={() => router.push(item.path as never)}
              >
                <Text style={[styles.navLinkText, active ? styles.navLinkTextActive : null]}>{item.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <TouchableOpacity style={styles.signOutButton} onPress={() => void signOut()}>
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.mainArea}>
        <Slot />
      </View>
    </View>
  );
}

export default function PartnerStackLayout() {
  usePushNotifications();
  const { width } = useWindowDimensions();
  const isWide = Platform.OS === 'web' && width >= WIDE_BREAKPOINT;

  if (isWide) {
    return <SidebarShell />;
  }

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

const styles = StyleSheet.create({
  shell: {
    backgroundColor: partnerTheme.background,
    flex: 1,
    flexDirection: 'row',
  },
  sidebar: {
    backgroundColor: partnerTheme.surface,
    borderRightColor: partnerTheme.border,
    borderRightWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 24,
    width: 232,
  },
  logoBlock: {
    paddingBottom: 24,
    paddingHorizontal: 12,
  },
  logoSub: {
    color: partnerTheme.textSoft,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginTop: 2,
    textTransform: 'uppercase',
  },
  nav: {
    flex: 1,
  },
  navLink: {
    borderLeftColor: 'transparent',
    borderLeftWidth: 3,
    borderRadius: 10,
    marginBottom: 2,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  navLinkActive: {
    backgroundColor: partnerTheme.accentSoft,
    borderLeftColor: partnerTheme.accent,
  },
  navLinkText: {
    color: partnerTheme.textMuted,
    fontSize: 14,
    fontWeight: '600',
  },
  navLinkTextActive: {
    color: partnerTheme.accentStrong,
  },
  signOutButton: {
    alignItems: 'center',
    borderColor: partnerTheme.border,
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 11,
  },
  signOutText: {
    color: partnerTheme.textMuted,
    fontSize: 13,
    fontWeight: '700',
  },
  mainArea: {
    flex: 1,
    minWidth: 0,
  },
});
