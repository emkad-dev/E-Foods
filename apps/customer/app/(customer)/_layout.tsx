import { FontAwesome } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { ActivityIndicator, StyleSheet, useWindowDimensions, View } from 'react-native';
import AuthHeaderActions from '../../src/components/AuthHeaderActions';
import CustomerHeaderBackButton from '../../src/components/CustomerHeaderBackButton';
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

const renderTabIcon = (iconName: React.ComponentProps<typeof FontAwesome>['name'], color: string, focused: boolean) => (
  <View style={[styles.tabIconWrap, focused ? styles.tabIconWrapActive : null]}>
    <FontAwesome name={iconName} size={focused ? 19 : 18} color={focused ? '#ffffff' : color} />
  </View>
);

export default function CustomerLayout() {
  const { loading } = useAuth();
  const { width } = useWindowDimensions();
  usePushNotifications();

  // Keep the floating bar off the screen edges, and stop it stretching across wide web viewports.
  const tabBarWidth = Math.min(width - TAB_BAR_SIDE_INSET * 2, TAB_BAR_MAX_WIDTH);
  const tabBarLeft = Math.max((width - tabBarWidth) / 2, TAB_BAR_SIDE_INSET);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: customerTheme.background }}>
        <ActivityIndicator size="large" color={customerTheme.accent} />
      </View>
    );
  }

  return (
    <FavoritesProvider>
      <CoverageProvider>
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
              elevation: 8,
              height: 58,
              left: tabBarLeft,
              paddingBottom: 6,
              paddingTop: 6,
              position: 'absolute',
              shadowColor: '#684612',
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.14,
              shadowRadius: 14,
              width: tabBarWidth,
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
              title: 'Order',
              headerShown: false,
              tabBarStyle: { display: 'none' },
              tabBarIcon: ({ color, focused }) => renderTabIcon('list', color, focused),
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
