import { FontAwesome } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import AuthHeaderActions from '../../src/components/AuthHeaderActions';
import CustomerHeaderBackButton from '../../src/components/CustomerHeaderBackButton';
import { useAuth } from '../../src/contexts/AuthContext';
import { FavoritesProvider } from '../../src/contexts/FavoritesContext';
import { usePushNotifications } from '../../src/hooks/usePushNotifications';
import { customerTheme } from '../../src/theme/palette';

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
          tabBarItemStyle: { paddingVertical: 4 },
          tabBarStyle: {
            backgroundColor: customerTheme.surface,
            borderTopColor: 'transparent',
            borderRadius: 22,
            bottom: 10,
            elevation: 6,
            height: 62,
            left: 10,
            paddingTop: 4,
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
            tabBarIcon: ({ color }) => <FontAwesome name="home" size={24} color={color} />,
          }}
        />
        <Tabs.Screen
          name="favorites"
          options={{
            title: 'Favorites',
            headerShown: true,
            headerLeft: () => <CustomerHeaderBackButton href="/(customer)/home" />,
            headerTitleStyle: { color: customerTheme.text, fontSize: 18, fontWeight: '800' },
            tabBarIcon: ({ color }) => <FontAwesome name="heart" size={22} color={color} />,
          }}
        />
        <Tabs.Screen
          name="cart"
          options={{
            title: 'Cart',
            headerShown: true,
            headerLeft: () => <CustomerHeaderBackButton href="/(customer)/home" />,
            headerTitleStyle: { color: customerTheme.text, fontSize: 18, fontWeight: '800' },
            tabBarStyle: { display: 'none' },
            tabBarIcon: ({ color }) => <FontAwesome name="shopping-cart" size={22} color={color} />,
          }}
        />
        <Tabs.Screen
          name="orders"
          options={{
            title: 'Order',
            headerShown: false,
            tabBarStyle: { display: 'none' },
            tabBarIcon: ({ color }) => <FontAwesome name="list" size={22} color={color} />,
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profile',
            headerShown: false,
            tabBarStyle: { display: 'none' },
            tabBarIcon: ({ color }) => <FontAwesome name="user" size={22} color={color} />,
          }}
        />
        <Tabs.Screen
          name="promotions"
          options={{
            href: null,
            headerShown: true,
            title: 'Promotions',
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
