import { useRef } from 'react';
import { FontAwesome } from '@expo/vector-icons';
import { Tabs, usePathname } from 'expo-router';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { elevation, radius } from '@feasty/design-system';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AuthHeaderActions from '../../src/components/AuthHeaderActions';
import CustomerHeaderBackButton from '../../src/components/CustomerHeaderBackButton';
import LoadingSkeleton from '../../src/components/LoadingSkeleton';
import PromoBanner from '../../src/components/PromoBanner';
import RatingPromptCard from '../../src/components/RatingPromptCard';
import { useAuth } from '../../src/contexts/AuthContext';
import { CoverageProvider } from '../../src/contexts/CoverageContext';
import { FavoritesProvider } from '../../src/contexts/FavoritesContext';
import { usePushNotifications } from '../../src/hooks/usePushNotifications';
import { customerTheme } from '../../src/theme/palette';
import { customerScreenOptions } from '../../src/theme/screenChrome';

export const unstable_settings = {
  initialRouteName: 'home',
};

const TAB_BAR_MAX_WIDTH = 380;
const TAB_BAR_SIDE_INSET = 24;

// The focused icon takes the `color` the navigator hands it, same as the idle
// one. It used to be forced to white, which sat on tabIconWrapActive's
// accentSoft fill (#c8e6c9) at 1.34:1 — the active tab, the one thing in the
// bar that has to be legible, was the least legible thing in it. The navigator
// already supplies accentStrong as the active tint, which is 5.85:1 on that
// same fill, so the override was not only unreadable but redundant.
const renderTabIcon = (iconName: React.ComponentProps<typeof FontAwesome>['name'], color: string, focused: boolean) => (
  <View style={[styles.tabIconWrap, focused ? styles.tabIconWrapActive : null]}>
    <FontAwesome name={iconName} size={focused ? 19 : 18} color={color} />
  </View>
);

type CustomerLoadingMode = NonNullable<Parameters<typeof LoadingSkeleton>[0]['mode']>;

const getCustomerShellLoadingMode = (pathname: string | null | undefined): CustomerLoadingMode => {
  const currentPath = pathname || '/home';

  if (currentPath.startsWith('/orders')) return 'orders';
  if (currentPath.startsWith('/cart')) return 'cart';
  if (currentPath.startsWith('/profile')) return 'profile';
  if (currentPath.startsWith('/support')) return 'support';

  return 'home';
};

export default function CustomerLayout() {
  const { loading } = useAuth();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  usePushNotifications();

  // Keep the floating bar off the screen edges, and stop it stretching across wide web
  // viewports. Insetting both edges by the same amount centres the pill against whatever
  // the navigator actually measures, so it stays centred even when `width` (the window)
  // is wider than the container, e.g. while a scrollbar is showing on web.
  const tabBarWidth = Math.min(width - TAB_BAR_SIDE_INSET * 2, TAB_BAR_MAX_WIDTH);
  const tabBarSideInset = Math.max((width - tabBarWidth) / 2, TAB_BAR_SIDE_INSET);

  // Latched to the first paint, for the same reason as the (auth) layout: this
  // `loading` is true for the duration of every auth ACTION, not just the initial
  // bootstrap. Unlatched, signing in from the cart's "Sign in to check out" or the
  // profile prompt blanked this entire tab shell mid-action -- including the
  // basket the visitor was looking at -- and remounted it afterwards.
  //
  // Safe here precisely because of the note below: this shell is built to render
  // with a null user, so keeping it mounted while one arrives is the state it
  // already handles, not a new one.
  const hasBootstrappedRef = useRef(false);
  if (!loading) {
    hasBootstrappedRef.current = true;
  }

  if (loading && !hasBootstrappedRef.current) {
    return <LoadingSkeleton mode={getCustomerShellLoadingMode(pathname)} />;
  }

  // No auth gate here on purpose: signed-out visitors browse the catalogue, and
  // sign-in is prompted at the point of action instead. Every screen behind this
  // shell already handles a null user - cart offers "Sign in to check out",
  // profile offers "Sign in to manage your account", orders guards its reads,
  // and FavoritesProvider, RatingPromptCard and usePushNotifications all no-op
  // without one. A redirect here contradicted all of that and made the front
  // door a wall.

  return (
    <FavoritesProvider>
      <CoverageProvider>
        <PromoBanner />
        <RatingPromptCard />
        <Tabs
          screenOptions={{
            // Applied to the navigator, not per screen: `deals`, `support` and
            // `promo/[id]` all show a native header and each used to miss the
            // per-screen copy, so they rendered the platform default title.
            ...customerScreenOptions,
            tabBarActiveTintColor: customerTheme.accentStrong,
            tabBarInactiveTintColor: customerTheme.textMuted,
            tabBarLabelStyle: { fontSize: 10, fontWeight: '700', paddingBottom: 0 },
            // The pill is 58pt tall but the PRESSABLE inside it was 41pt: the
            // bar owned the vertical padding, so the top and bottom 8pt of every
            // tab looked tappable and was not. Measured on the running web build
            // at 375pt -- all five items came back 65x41, under the 44pt floor
            // this repo already enforces in partner and dispatch.
            //
            // The padding moves from the bar to the item. Same pixels in the same
            // places; the difference is that they now belong to the button.
            // No paddingVertical: expo-router renders each tab as an <a>, and
            // tabBarItemStyle lands on the WRAPPER around it. Padding here shrinks
            // the anchor -- which is the thing that actually takes the tap -- back
            // below the floor. Height on the wrapper, centring inside it, no padding.
            tabBarItemStyle: { height: "100%" },
            tabBarStyle: {
              ...elevation.lg,
              backgroundColor: customerTheme.surface,
              borderTopColor: customerTheme.border,
              borderTopWidth: 1,
              borderRadius: radius.xl,
              // Float the pill above the device's bottom safe area (home indicator /
              // gesture bar) on mobile; falls back to 12 on web where the inset is 0.
              bottom: Math.max(insets.bottom, 12),
              // BottomTabBar pins itself with `start: 0` / `end: 0`, and those logical edges
              // beat `left`/`right` in Yoga, so the inset has to be written the same way or
              // the pill snaps back to the screen edge instead of sitting centred.
              end: tabBarSideInset,
              height: 58,
              // Zero, deliberately: see tabBarItemStyle above. Padding here
              // shrinks the touch target instead of the content.
              paddingBottom: 0,
              paddingTop: 0,
              position: 'absolute',
              start: tabBarSideInset,
            },
            headerShown: false,
          }}
        >
          <Tabs.Screen
            name="home"
            options={{
              title: 'Home',
              tabBarIcon: ({ color, focused }) => renderTabIcon('home', color, focused),
            }}
          />
          <Tabs.Screen
            name="search"
            options={{
              title: 'Search',
              tabBarIcon: ({ color, focused }) => renderTabIcon('search', color, focused),
            }}
          />
          <Tabs.Screen
            name="favorites"
            options={{
              title: 'Favorites',
              headerShown: true,
              headerLeft: () => <CustomerHeaderBackButton href="/home" />,
              tabBarIcon: ({ color, focused }) => renderTabIcon('heart', color, focused),
            }}
          />
          <Tabs.Screen
            name="cart"
            options={{
              title: 'Cart',
              headerShown: true,
              headerLeft: () => <CustomerHeaderBackButton href="/home" />,
              tabBarStyle: { display: 'none' },
              tabBarIcon: ({ color, focused }) => renderTabIcon('shopping-cart', color, focused),
            }}
          />
          <Tabs.Screen
            name="orders"
            options={{
              // Order history now lives inside Profile, so keep the route mounted
              // (Profile links to it) but drop it from the tab bar.
              href: null,
              title: 'Order',
              headerShown: false,
              tabBarStyle: { display: 'none' },
            }}
          />
          <Tabs.Screen
            name="profile"
            options={{
              title: 'Profile',
              headerShown: false,
              tabBarStyle: { display: 'none' },
              tabBarIcon: ({ color, focused }) => renderTabIcon('user', color, focused),
            }}
          />
          <Tabs.Screen
            name="deals"
            options={{
              href: null,
              headerShown: true,
              title: 'Deals',
              headerRight: () => <AuthHeaderActions />,
            }}
          />
          <Tabs.Screen
            name="delivery-location"
            options={{
              href: null,
              headerShown: false,
            }}
          />
          <Tabs.Screen
            name="support"
            options={{
              href: null,
              headerShown: true,
              title: 'Help & Support',
              headerLeft: () => <CustomerHeaderBackButton href="/profile" />,
              tabBarStyle: { display: 'none' },
            }}
          />
          <Tabs.Screen
            name="promo/[id]"
            options={{
              href: null,
              headerShown: true,
              title: 'Deal',
              headerLeft: () => <CustomerHeaderBackButton href="/deals" />,
              tabBarStyle: { display: 'none' },
            }}
          />
        </Tabs>
      </CoverageProvider>
    </FavoritesProvider>
  );
}

const styles = StyleSheet.create({
  tabIconWrap: {
    alignItems: 'center',
    borderRadius: radius.md,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  tabIconWrapActive: {
    backgroundColor: customerTheme.accentSoft,
    borderColor: customerTheme.accent,
    borderWidth: 1,
  },
});
