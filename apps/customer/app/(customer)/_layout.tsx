import { FontAwesome } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import AuthHeaderActions from '../../src/components/AuthHeaderActions';
import { useAuth } from '../../src/contexts/AuthContext';
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
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: customerTheme.accentStrong,
        tabBarInactiveTintColor: customerTheme.textMuted,
        tabBarStyle: { backgroundColor: customerTheme.surface, borderTopColor: customerTheme.border },
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
        name="cart"
        options={{
          title: 'Cart',
          headerShown: true,
          headerRight: () => <AuthHeaderActions />,
          tabBarIcon: ({ color }) => <FontAwesome name="shopping-cart" size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: 'Order',
          tabBarIcon: ({ color }) => <FontAwesome name="list" size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => <FontAwesome name="user" size={24} color={color} />,
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
  );
}
