import { FontAwesome } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import AuthHeaderActions from '../../src/components/AuthHeaderActions';
import CustomerHeaderBackButton from '../../src/components/CustomerHeaderBackButton';
import { useAuth } from '../../src/contexts/AuthContext';
import { FavoritesProvider } from '../../src/contexts/FavoritesContext';
import { usePushNotifications } from '../../src/hooks/usePushNotifications';
import { customerTheme } from '../../src/theme/palette';

export const unstable_settings = {
  initialRouteName: 'home',
};

const renderTabIcon = (iconName: React.ComponentProps<typeof FontAwesome>['name'], color: string, focused: boolean) => (
  <View style={[styles.tabIconWrap, focused ? styles.tabIconWrapActive : null]}>
    <FontAwesome name={iconName} size={focused ? 21 : 20} color={focused ? '#ffffff' : color} />
  </View>
);

export default function CustomerLayout() {
  const { loading } = useAuth();
  usePushNotifications();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: customerTheme.background }}>
        <ActivityIndicator size="large" color={customerTheme.accent} />
      </View>
    );
  }

  return (
    <FavoritesProvider>
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: customerTheme.accentStrong,
          tabBarInactiveTintColor: customerTheme.textMuted,
          tabBarLabelStyle: { fontSize: 11, fontWeight: '700', paddingBottom: 2 },
          tabBarItemStyle: { paddingVertical: 6 },
          tabBarStyle: {
            backgroundColor: customerTheme.surface,
            borderTopColor: customerTheme.border,
            borderTopWidth: 1,
            borderRadius: 22,
            bottom: 10,
            elevation: 8,
            height: 70,
            left: 10,
            paddingBottom: 10,
            paddingTop: 8,
            position: 'absolute',
            right: 10,
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
          }}
        />
      </Tabs>
    </FavoritesProvider>
  );
}

const styles = StyleSheet.create({
  tabIconWrap: {
    alignItems: 'center',
    borderRadius: 14,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  tabIconWrapActive: {
    backgroundColor: customerTheme.accentSoft,
    borderColor: customerTheme.accent,
    borderWidth: 1,
  },
});
