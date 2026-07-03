import { useEffect, useRef, useState } from 'react';
import * as Linking from 'expo-linking';
import { ActivityIndicator, Animated, StyleSheet, Text, View } from 'react-native';
import { Slot, useRouter, useSegments } from 'expo-router';
import { CartProvider } from '../src/contexts/CartContext';
import { AuthProvider, useAuth } from '../src/contexts/AuthContext';
import { configureGoogleSignIn, hasGoogleSignInConfig } from '../src/services/googleSignIn';
import { customerTheme } from '../src/theme/palette';

function FeastyLaunchScreen() {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.timing(opacity, {
        duration: 260,
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.delay(520),
      Animated.timing(opacity, {
        duration: 300,
        toValue: 0,
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity]);

  return (
    <View style={styles.launchScreen}>
      <Animated.Text style={[styles.launchWordmark, { opacity }]}>
        <Text style={styles.launchWordmarkGreen}>FEAST</Text>
        <Text style={styles.launchWordmarkOrange}>Y</Text>
      </Animated.Text>
    </View>
  );
}

function RootLayoutNav() {
  const { user, loading, policyAccepted, policyLoading } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  const [showLaunch, setShowLaunch] = useState(false);

  useEffect(() => {
    const handleDeepLink = ({ url }: { url: string }) => {
      const { hostname, path, queryParams } = Linking.parse(url);
      const targetPath =
        typeof path === 'string' && path.trim() ? path.trim() : typeof hostname === 'string' ? hostname.trim() : '';

      if (targetPath === 'verify-email') {
        router.replace({
          pathname: '/(auth)/verify-email',
          params: {
            ...(typeof queryParams?.code === 'string' ? { code: queryParams.code } : null),
            ...(typeof queryParams?.access_token === 'string' ? { access_token: queryParams.access_token } : null),
            ...(typeof queryParams?.refresh_token === 'string' ? { refresh_token: queryParams.refresh_token } : null),
          },
        });
      } else if (targetPath === 'reset-password') {
        router.replace({
          pathname: '/(auth)/reset-password',
          params: {
            ...(typeof queryParams?.code === 'string' ? { code: queryParams.code } : null),
            ...(typeof queryParams?.access_token === 'string' ? { access_token: queryParams.access_token } : null),
            ...(typeof queryParams?.refresh_token === 'string' ? { refresh_token: queryParams.refresh_token } : null),
          },
        });
      } else if (targetPath.startsWith('order/')) {
        const orderId = targetPath.split('/')[1];
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
    // Wait until <Slot /> is mounted; a replace dispatched while the loading
    // screen is up has no navigator to handle it.
    if (loading || policyLoading) return;

    const inCustomerGroup = segments[0] === '(customer)';
    const currentScreen = segments[1];
    const inAuthGroup = segments[0] === '(auth)';
    const isPublicAuthScreen =
      inAuthGroup &&
      ['accept-policy', 'forgot-password', 'login', 'privacy', 'register', 'reset-password', 'terms', 'verify-email'].includes(currentScreen ?? '');

    if (!user) {
      if (!isPublicAuthScreen) {
        router.replace('/(auth)/login');
      }
      return;
    }

    if (!user.emailVerified && currentScreen !== 'verify-email') {
      router.replace('/(auth)/verify-email');
      return;
    }

    if (!policyAccepted && currentScreen !== 'accept-policy' && currentScreen !== 'terms' && currentScreen !== 'privacy') {
      router.replace('/(auth)/accept-policy');
      return;
    }

    if (user.role === 'customer' && !inCustomerGroup) {
      router.replace('/(customer)/home');
    }
  }, [loading, policyAccepted, policyLoading, router, segments, user]);

  useEffect(() => {
    if (loading || policyLoading || user?.role !== 'customer' || !user.emailVerified || !policyAccepted) {
      setShowLaunch(false);
      return;
    }

    setShowLaunch(true);
    const timer = setTimeout(() => setShowLaunch(false), 1150);

    return () => clearTimeout(timer);
  }, [loading, policyAccepted, policyLoading, user?.emailVerified, user?.role, user?.uid]);

  if (loading || policyLoading) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator size="large" color={customerTheme.brandGreen} />
      </View>
    );
  }

  // Keep <Slot /> mounted while the launch wordmark shows, otherwise the
  // auth redirect fires with no navigator to handle it.
  return (
    <View style={styles.appShell}>
      <Slot />
      {showLaunch ? (
        <View style={styles.launchOverlay}>
          <FeastyLaunchScreen />
        </View>
      ) : null}
    </View>
  );
}

export default function RootLayout() {
  useEffect(() => {
    if (!hasGoogleSignInConfig()) {
      return;
    }

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

const styles = StyleSheet.create({
  appShell: {
    flex: 1,
  },
  launchOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  launchScreen: {
    alignItems: 'center',
    backgroundColor: customerTheme.launchBackground,
    flex: 1,
    justifyContent: 'center',
  },
  launchWordmark: {
    fontSize: 54,
    fontStyle: 'italic',
    fontWeight: '900',
    letterSpacing: -2,
  },
  launchWordmarkGreen: {
    color: customerTheme.brandGreen,
  },
  launchWordmarkOrange: {
    color: customerTheme.brandOrange,
  },
  loadingScreen: {
    alignItems: 'center',
    backgroundColor: customerTheme.launchBackground,
    flex: 1,
    justifyContent: 'center',
  },
});
