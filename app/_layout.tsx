import { useEffect } from 'react';
import * as Linking from 'expo-linking';
import { ActivityIndicator, View } from 'react-native';
import { Slot, useRouter, useSegments } from 'expo-router';
import { CartProvider } from '../src/contexts/CartContext';
import { AuthProvider, useAuth } from '../src/contexts/AuthContext';
import { configureGoogleSignIn } from '../src/services/googleSignIn';

function RootLayoutNav() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    const handleDeepLink = ({ url }: { url: string }) => {
      const { path, queryParams } = Linking.parse(url);

      if (path === 'verify-email') {
        router.replace('/(auth)/verify-email');
      } else if (path === 'reset-password' && queryParams?.oobCode) {
        router.replace({
          pathname: '/(auth)/reset-password',
          params: { oobCode: queryParams.oobCode as string },
        });
      } else if (path?.startsWith('order/')) {
        const orderId = path.split('/')[1];
        router.push(`/orders/${orderId}`);
      }
    };

    Linking.getInitialURL().then((url) => {
      if (url) handleDeepLink({ url });
    });

    const subscription = Linking.addEventListener('url', handleDeepLink);
    return () => subscription.remove();
  }, [router]);

  useEffect(() => {
    if (loading) return;

    const inAuthGroup = segments[0] === '(auth)';
    const inCustomerGroup = segments[0] === '(customer)';
    const currentScreen = segments[1];

    if (!user && !inAuthGroup) {
      router.replace('/(auth)/login');
      return;
    }

    if (!user) return;

    if (!user.emailVerified && currentScreen !== 'verify-email') {
      router.replace('/(auth)/verify-email');
      return;
    }

    if (user.role === 'customer' && !inCustomerGroup) {
      router.replace('/(customer)/home');
    }
  }, [loading, router, segments, user]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#f5b342" />
      </View>
    );
  }

  return <Slot />;
}

export default function RootLayout() {
  // Configure Google Sign-In at app startup
  useEffect(() => {
    const result = configureGoogleSignIn();

    if (!result.ok) {
      console.warn(result.message);
      return;
    }

    console.log('Google Sign-In configured successfully');
  }, []);

  return (
    <AuthProvider>
      <CartProvider>
        <RootLayoutNav />
      </CartProvider>
    </AuthProvider>
  );
}
