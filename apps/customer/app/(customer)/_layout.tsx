import { FontAwesome } from '@expo/vector-icons';
import { Redirect, Tabs, usePathname } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import AuthHeaderActions from '../../src/components/AuthHeaderActions';
import CustomerHeaderBackButton from '../../src/components/CustomerHeaderBackButton';
import LoadingSkeleton from '../../src/components/LoadingSkeleton';
import PromoBanner from '../../src/components/PromoBanner';
import { useAuth } from '../../src/contexts/AuthContext';
import { CoverageProvider } from '../../src/contexts/CoverageContext';
import { FavoritesProvider } from '../../src/contexts/FavoritesContext';
import { usePushNotifications } from '../../src/hooks/usePushNotifications';
import { customerTheme } from '../../src/theme/palette';

export const unstable_settings = {
  initialRouteName: 'home',
};

const TAB_BAR_MAX_WIDTH = 380;
const TAB_BAR_SIDE_INSET = 24;

/**
 * Routes a signed-out visitor may browse. Everything else still bounces to
 * login carrying a redirectTo, so the sign-in prompt lands at the point of
 * action (adding to cart, checking out) rather than at the front door.
 */
const PUBLIC_PREFIXES = ['/home', '/search', '/deals', '/delivery-location', '/cart'];

const isPublicRoute = (pathname: string | null | undefined) => {
  const currentPath = pathname || '/home';

  return PUBLIC_PREFIXES.some(
    (prefix) => currentPath === prefix || currentPath.startsWith(`${prefix}/`)
  );
};


const renderTabIcon = (iconName: React.ComponentProps<typeof FontAwesome>['name'], color: string, focused: boolean) => (
  <View style={[styles.tabIconWrap, focused ? styles.tabIconWrapActive : null]}>
    <FontAwesome name={iconName} size={focused ? 19 : 18} color={focused ? '#ffffff' : color} />
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
  const { loading, user } = useAuth();
  const pathname = usePathname();
  usePushNotifications();

  if (loading) {
    return <LoadingSkeleton mode={getCustomerShellLoadingMode(pathname)} />;
  }

  if (!user && !isPublicRoute(pathname)) {
    const redirectTo = pathname && pathname !== '/login' ? pathname : '/home';

    return <Redirect href={{ pathname: '/login', params: { redirectTo } } as never} />;
  }

  return (
    <FavoritesProvider>
      <CoverageProvider>
        <PromoBanner />
        <Tabs
          screenOptions={{
            tabBarActiveTintColor: customerTheme.accentStrong,
            tabBarInactiveTintColor: customerTheme.textMuted,
            tabBarLabelStyle: { fontSize: 10, fontWeight: '700', paddingBottom: 0 },
            tabBarItemStyle: { paddingVertical: 2 },
            tabBarStyle: {
              backgroundColor: customerTheme.surface,
              borderTopColor: customerTheme.border,
              borderTopWidth: 1,
              borderRadius: 20,
              bottom: 12,
              left: TAB_BAR_SIDE_INSET,
              elevation: 8,
              height: 58,
              right: TAB_BAR_SIDE_INSET,
              paddingBottom: 6,
              paddingTop: 6,
              position: 'absolute',
              shadowColor: '#684612',
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.14,
              shadowRadius: 14,
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
              headerTitleStyle: { color: customerTheme.text, fontSize: 18, fontWeight: '800' },
              tabBarIcon: ({ color, focused }) => renderTabIcon('heart', color, focused),
            }}
          />
          <Tabs.Screen
            name="cart"
            options={{
              title: 'Cart',
              headerShown: true,
              headerLeft: () => <CustomerHeaderBackButton href="/home" />,
              headerTitleStyle: { color: customerTheme.text, fontSize: 18, fontWeight: '800' },
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
              tabBarStyle: { display: 'none' },
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
        </Tabs>
      </CoverageProvider>
    </FavoritesProvider>
  );
}

const styles = StyleSheet.create({
  tabIconWrap: {
    alignItems: 'center',
    borderRadius: 12,
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
