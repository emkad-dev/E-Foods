import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Redirect, Slot, Tabs, usePathname, useRouter } from 'expo-router';
import { Platform, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { MIN_TAP_TARGET, radius } from '@feasty/design-system';
import FEASTYWordmark from '../../src/components/PartnerWordmark';
import LoadingSkeleton from '../../src/components/LoadingSkeleton';
import { useAuth } from '../../src/contexts/AuthContext';
import { KitchenAlarmProvider } from '../../src/contexts/KitchenAlarmContext';
import { resolvePartnerLandingRoute } from '../../src/contexts/partnerAuthFlow';
import { usePushNotifications } from '../../src/hooks/usePushNotifications';
import { partnerTheme } from '../../src/theme/palette';

const WIDE_BREAKPOINT = 1024;

const NAV_ITEMS = [
  { path: '/', label: 'Dashboard', description: 'Sales & performance' },
  { path: '/orders', label: 'Orders', description: 'Live kitchen queue' },
  { path: '/menu', label: 'Menu', description: 'Items & availability' },
  { path: '/profile', label: 'Store', description: 'Pause, setup & account' },
];

// The Store tab's own sub-screens. They are not tabs (four is the budget, and
// spending a fifth on a screen touched once at setup would push the mid-service
// pause control further away), so they keep Store lit while they are open
// instead of leaving the sidebar with nothing selected.
const STORE_SUB_ROUTES = ['/store-details', '/account'];

const isNavItemActive = (path: string, pathname: string) => {
  if (path === '/') {
    return pathname === '/' || pathname === '';
  }

  if (path === '/orders') {
    return pathname.startsWith('/orders') || pathname.startsWith('/order');
  }

  if (path === '/profile') {
    return pathname.startsWith('/profile') || STORE_SUB_ROUTES.some((route) => pathname.startsWith(route));
  }

  return pathname.startsWith(path);
};

const getActiveNavItem = (pathname: string) =>
  NAV_ITEMS.find((item) => isNavItemActive(item.path, pathname)) ?? NAV_ITEMS[0];

type PartnerLoadingMode = NonNullable<Parameters<typeof LoadingSkeleton>[0]['mode']>;

const getPartnerShellLoadingMode = (pathname: string | null | undefined): PartnerLoadingMode => {
  const currentPath = pathname || '/';

  if (currentPath === '/' || currentPath === '') {
    return 'dashboard';
  }

  if (currentPath.startsWith('/orders') || currentPath.startsWith('/order')) {
    return 'orders';
  }

  if (currentPath.startsWith('/menu')) {
    return 'menu';
  }

  if (currentPath.startsWith('/profile') || STORE_SUB_ROUTES.some((route) => currentPath.startsWith(route))) {
    return 'profile';
  }

  if (currentPath.startsWith('/complete-restaurant-details')) {
    return 'setup';
  }

  if (currentPath.startsWith('/application-under-review')) {
    return 'setup';
  }

  return 'dashboard';
};

const renderTabIcon = (
  iconName: React.ComponentProps<typeof MaterialCommunityIcons>['name'],
  color: string,
  focused: boolean
) => (
  <View style={[styles.tabIconWrap, focused ? styles.tabIconWrapActive : null]}>
    <MaterialCommunityIcons name={iconName} size={focused ? 22 : 21} color={focused ? partnerTheme.textOnBrand : color} />
  </View>
);

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
          <FEASTYWordmark size={34} />
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
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const isWide = Platform.OS === 'web' && width >= WIDE_BREAKPOINT;
  const isCompactMobile = Platform.OS !== 'web' && width < 390;

  if (loading) {
    return <LoadingSkeleton mode={getPartnerShellLoadingMode(pathname)} />;
  }

  // Signed-out users never render the partner shell — send them to login
  // immediately instead of flashing the dashboard.
  if (!user) {
    const redirectTo = pathname && pathname !== '/login' ? pathname : '/';
    return <Redirect href={{ pathname: '/(auth)/login', params: { redirectTo } } as never} />;
  }

  if (user.role !== 'restaurant') {
    const landingRoute = resolvePartnerLandingRoute({
      role: user.role,
      applicationStatus: user.partnerApplicationStatus,
    });
    const targetPath =
      landingRoute === 'under-review' ? '/application-under-review' : '/complete-restaurant-details';

    if (pathname !== targetPath) {
      return <Redirect href={`/(partner)${targetPath}` as never} />;
    }

    return <Slot />;
  }

  // The alarm provider wraps BOTH shells, and sits above the screens rather than
  // inside one of them. Inside KitchenBoard it was unreachable on a phone (that board
  // only mounts at >= 900dp) and it was destroyed every time the orders screen
  // unmounted to show an order's detail. Here it survives navigation between partner
  // screens and covers every width, so the alarm keeps sounding while somebody reads
  // a ticket, and stays silent for orders it has already announced.
  //
  // Mounted only on this branch: a partner still completing onboarding has no
  // restaurant and no kitchen queue, so there is nothing to alarm about and no reason
  // to hold a wake lock or build an audio player for them.
  if (isWide) {
    return (
      <KitchenAlarmProvider>
        <SidebarShell />
      </KitchenAlarmProvider>
    );
  }

  return (
    <KitchenAlarmProvider>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: partnerTheme.accentStrong,
          tabBarInactiveTintColor: partnerTheme.textMuted,
          tabBarItemStyle: {
            paddingBottom: 4,
            paddingTop: 5,
          },
          tabBarLabelStyle: {
            fontSize: isCompactMobile ? 10 : 12,
            fontWeight: '700',
            paddingBottom: 1,
          },
          tabBarStyle: {
            backgroundColor: partnerTheme.surface,
            borderTopColor: partnerTheme.border,
            height: isCompactMobile ? 72 : 74,
            paddingBottom: isCompactMobile ? 8 : 10,
            paddingTop: 8,
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Dashboard',
            tabBarIcon: ({ color, focused }) => renderTabIcon('view-dashboard-outline', color, focused),
          }}
        />
        <Tabs.Screen
          name="orders"
          options={{
            title: 'Orders',
            tabBarIcon: ({ color, focused }) => renderTabIcon('clipboard-text-outline', color, focused),
          }}
        />
        <Tabs.Screen
          name="menu"
          options={{
            title: 'Menu',
            tabBarIcon: ({ color, focused }) => renderTabIcon('silverware-fork-knife', color, focused),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Store',
            tabBarIcon: ({ color, focused }) => renderTabIcon('storefront-outline', color, focused),
          }}
        />
        <Tabs.Screen name="order/[id]" options={{ href: null }} />
        {/* Reached from the Store tab, never from the tab bar - see STORE_SUB_ROUTES. */}
        <Tabs.Screen name="store-details" options={{ href: null }} />
        <Tabs.Screen name="account" options={{ href: null }} />
      </Tabs>
    </KitchenAlarmProvider>
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
    justifyContent: 'center',
    minHeight: MIN_TAP_TARGET,
    alignItems: 'center',
    borderRadius: radius.md,
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
    borderRadius: radius.pill,
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
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    padding: 10,
  },
  storeAvatar: {
    alignItems: 'center',
    backgroundColor: partnerTheme.accent,
    borderRadius: radius.md,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  storeAvatarText: {
    color: partnerTheme.textOnBrand,
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
    justifyContent: 'center',
    minHeight: MIN_TAP_TARGET,
    alignItems: 'center',
    borderColor: partnerTheme.border,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingVertical: 11,
  },
  signOutText: {
    color: partnerTheme.textMuted,
    fontSize: 13,
    fontWeight: '700',
  },
  tabIconWrap: {
    alignItems: 'center',
    borderRadius: radius.lg,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  tabIconWrapActive: {
    backgroundColor: partnerTheme.accentSoft,
    borderColor: partnerTheme.accent,
    borderWidth: 1,
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
    borderRadius: radius.pill,
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
    borderRadius: radius.pill,
    height: 8,
    width: 8,
  },
  mainContent: {
    flex: 1,
    minWidth: 0,
  },
});
