import { Redirect, Slot, Tabs, usePathname, useRouter } from 'expo-router';
import { ActivityIndicator, Platform, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import FeastyWordmark from '../../src/components/FeastyWordmark';
import { useAuth } from '../../src/contexts/AuthContext';
import { usePushNotifications } from '../../src/hooks/usePushNotifications';
import { partnerTheme } from '../../src/theme/palette';

const WIDE_BREAKPOINT = 1024;

const NAV_ITEMS = [
  { path: '/', label: 'Dashboard', description: 'Sales & performance' },
  { path: '/orders', label: 'Orders', description: 'Live kitchen queue' },
  { path: '/menu', label: 'Menu', description: 'Items & availability' },
  { path: '/profile', label: 'Store', description: 'Profile & delivery' },
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

const getActiveNavItem = (pathname: string) =>
  NAV_ITEMS.find((item) => isNavItemActive(item.path, pathname)) ?? NAV_ITEMS[0];

function SidebarShell() {
  const pathname = usePathname();
  const router = useRouter();
  const { signOut, user } = useAuth();

  const activeItem = getActiveNavItem(pathname);
  const storeName = user?.restaurantName?.trim() || 'Your store';
  const storeEmail = user?.email?.trim() ?? '';
  const storeInitial = (storeName[0] ?? 'F').toUpperCase();

  return (
    <View style={styles.shell}>
      <View style={styles.sidebar}>
        <View style={styles.logoBlock}>
          <FeastyWordmark size={34} />
          <Text style={styles.logoSub}>Partner</Text>
        </View>
        <View style={styles.nav}>
          <Text style={styles.navSectionLabel}>Manage</Text>
          {NAV_ITEMS.map((item) => {
            const active = isNavItemActive(item.path, pathname);

            return (
              <TouchableOpacity
                key={item.path}
                style={[styles.navLink, active ? styles.navLinkActive : null]}
                onPress={() => router.push(item.path as never)}
              >
                <View style={[styles.navDot, active ? styles.navDotActive : null]} />
                <View style={styles.navLinkTextBlock}>
                  <Text style={[styles.navLinkText, active ? styles.navLinkTextActive : null]}>{item.label}</Text>
                  <Text style={styles.navLinkDescription}>{item.description}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={styles.sidebarFooter}>
          <View style={styles.storeCard}>
            <View style={styles.storeAvatar}>
              <Text style={styles.storeAvatarText}>{storeInitial}</Text>
            </View>
            <View style={styles.storeCardText}>
              <Text style={styles.storeCardName} numberOfLines={1}>
                {storeName}
              </Text>
              {storeEmail ? (
                <Text style={styles.storeCardEmail} numberOfLines={1}>
                  {storeEmail}
                </Text>
              ) : null}
            </View>
          </View>
          <TouchableOpacity style={styles.signOutButton} onPress={() => void signOut()}>
            <Text style={styles.signOutText}>Sign out</Text>
          </TouchableOpacity>
        </View>
      </View>
      <View style={styles.mainArea}>
        <View style={styles.topBar}>
          <View style={styles.topBarText}>
            <Text style={styles.topBarEyebrow}>{activeItem.description}</Text>
            <Text style={styles.topBarTitle}>{activeItem.label}</Text>
          </View>
          <View style={styles.topBarStore}>
            <Text style={styles.topBarStoreName} numberOfLines={1}>
              {storeName}
            </Text>
            <View style={styles.topBarStatusDot} />
          </View>
        </View>
        <View style={styles.mainContent}>
          <Slot />
        </View>
      </View>
    </View>
  );
}

export default function PartnerStackLayout() {
  const { loading, user } = useAuth();
  usePushNotifications();
  const { width } = useWindowDimensions();
  const isWide = Platform.OS === 'web' && width >= WIDE_BREAKPOINT;

  if (loading) {
    return (
      <View style={{ alignItems: 'center', backgroundColor: partnerTheme.background, flex: 1, justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={partnerTheme.accent} />
      </View>
    );
  }

  // Signed-out users never render the partner shell — send them to login
  // immediately instead of flashing the dashboard.
  if (!user) {
    return <Redirect href={'/(auth)/login' as never} />;
  }

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
    paddingHorizontal: 16,
    paddingVertical: 26,
    width: 264,
  },
  logoBlock: {
    paddingBottom: 26,
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
  navSectionLabel: {
    color: partnerTheme.textSoft,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.1,
    marginBottom: 10,
    paddingHorizontal: 12,
    textTransform: 'uppercase',
  },
  navLink: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  navLinkActive: {
    backgroundColor: partnerTheme.accentSoft,
  },
  navDot: {
    backgroundColor: partnerTheme.border,
    borderRadius: 999,
    height: 8,
    width: 8,
  },
  navDotActive: {
    backgroundColor: partnerTheme.accent,
  },
  navLinkTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  navLinkText: {
    color: partnerTheme.textMuted,
    fontSize: 14,
    fontWeight: '700',
  },
  navLinkTextActive: {
    color: partnerTheme.accentStrong,
  },
  navLinkDescription: {
    color: partnerTheme.textSoft,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 1,
  },
  sidebarFooter: {
    gap: 12,
  },
  storeCard: {
    alignItems: 'center',
    backgroundColor: partnerTheme.background,
    borderColor: partnerTheme.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    padding: 10,
  },
  storeAvatar: {
    alignItems: 'center',
    backgroundColor: partnerTheme.accent,
    borderRadius: 10,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  storeAvatarText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
  storeCardText: {
    flex: 1,
    minWidth: 0,
  },
  storeCardName: {
    color: partnerTheme.text,
    fontSize: 13,
    fontWeight: '800',
  },
  storeCardEmail: {
    color: partnerTheme.textSoft,
    fontSize: 11,
    marginTop: 1,
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
  topBar: {
    alignItems: 'center',
    backgroundColor: partnerTheme.surface,
    borderBottomColor: partnerTheme.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    height: 68,
    justifyContent: 'space-between',
    paddingHorizontal: 28,
  },
  topBarText: {
    flex: 1,
    minWidth: 0,
  },
  topBarEyebrow: {
    color: partnerTheme.textSoft,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  topBarTitle: {
    color: partnerTheme.text,
    fontSize: 19,
    fontWeight: '800',
    marginTop: 2,
  },
  topBarStore: {
    alignItems: 'center',
    backgroundColor: partnerTheme.background,
    borderColor: partnerTheme.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    maxWidth: 260,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  topBarStoreName: {
    color: partnerTheme.textMuted,
    fontSize: 13,
    fontWeight: '700',
  },
  topBarStatusDot: {
    backgroundColor: partnerTheme.success,
    borderRadius: 999,
    height: 8,
    width: 8,
  },
  mainContent: {
    flex: 1,
    minWidth: 0,
  },
});
