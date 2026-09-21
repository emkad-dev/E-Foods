import { useEffect, useRef, useState } from 'react';
import * as Linking from 'expo-linking';
import { Animated, Image, StyleSheet, Text, View } from 'react-native';
import { Stack, usePathname, useRouter } from 'expo-router';
import { CartProvider } from '../src/contexts/CartContext';
import { AuthProvider, useAuth } from '../src/contexts/AuthContext';
import { FeatureFlagsProvider } from '../src/contexts/FeatureFlagsContext';
import LoadingSkeleton from '../src/components/LoadingSkeleton';
import { isPublicContentRoute } from '../src/domain/authRouteAccess';
import { normalizeCustomerPaymentCallbackPath } from '../src/services/paymentRouting';
import { initializeAnalytics, trackAnalyticsEvent } from '../../../packages/observability/src/analytics';
import { createSentryInitializer } from '../../../packages/observability/src/sentry';
import { customerTheme } from '../src/theme/palette';
import { installWebFocusRing, useFeastyFonts } from '@feasty/design-system';

// Runs once, at module load, so the very first paint already has it. No-ops
// off web; see focusRing.ts for why this is one rule rather than an onFocus
// handler on every control.
installWebFocusRing();

const initializeSentry = createSentryInitializer({
  loadNativeSdk: () => import('@sentry/react-native'),
  loadWebSdk: () => import('@sentry/browser'),
});

const AUTH_PAGES = new Set([
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
]);
type CustomerLoadingMode = NonNullable<Parameters<typeof LoadingSkeleton>[0]['mode']>;

const getCustomerLoadingMode = (pathname: string | null | undefined): CustomerLoadingMode => {
  const currentPath = pathname || '/home';

  if (
    currentPath.startsWith('/login') ||
    currentPath.startsWith('/register') ||
    currentPath.startsWith('/forgot-password') ||
    currentPath.startsWith('/reset-password') ||
    currentPath.startsWith('/verify-email')
  ) {
    if (currentPath.startsWith('/register')) {
      return 'auth-register';
    }

    if (
      currentPath.startsWith('/forgot-password') ||
      currentPath.startsWith('/reset-password') ||
      currentPath.startsWith('/verify-email')
    ) {
      return 'auth-recovery';
    }

    return 'auth-login';
  }

  if (currentPath.startsWith('/accept-policy') || currentPath.startsWith('/complete-profile')) {
    return 'auth-onboarding';
  }

  if (currentPath.startsWith('/orders')) return 'orders';
  if (currentPath.startsWith('/cart')) return 'cart';
  if (currentPath.startsWith('/profile')) return 'profile';
  if (currentPath.startsWith('/support')) return 'support';

  return 'home';
};

function FEASTYLaunchScreen() {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.timing(opacity, {
        duration: 320,
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.delay(4320),
      Animated.timing(opacity, {
        duration: 360,
        toValue: 0,
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity]);

  return (
    <View style={styles.launchScreen}>
      <Animated.View style={[styles.launchBrand, { opacity }]}>
        <Image source={require('../assets/images/feasty-pizza.png')} style={styles.launchMark} resizeMode="contain" />
        <Text style={styles.launchWordmark}>
          <Text style={styles.launchWordmarkGreen}>FEAST</Text>
          <Text style={styles.launchWordmarkOrange}>Y</Text>
        </Text>
        <Text style={styles.launchSubtitle}>Feast You deserve.</Text>
      </Animated.View>
    </View>
  );
}

function RootLayoutNav() {
  const { user, loading, policyAccepted, policyLoading } = useAuth();
  const { fontsReady } = useFeastyFonts();
  const router = useRouter();
  const pathname = usePathname();
  const [showLaunch, setShowLaunch] = useState(false);
  // Live pathname for the deep-link guard below, held in a ref so the listener
  // does not resubscribe on every navigation.
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const launchShownForUserRef = useRef<string | null>(null);

  useEffect(() => {
    // Read the live pathname without making it a dependency: adding it here
    // would resubscribe the listener on every navigation.
    const handleDeepLink = ({ url }: { url: string }) => {
      const { hostname, path, queryParams } = Linking.parse(url);
      const targetPath =
        typeof path === 'string' && path.trim() ? path.trim() : typeof hostname === 'string' ? hostname.trim() : '';
      const normalizedPaymentPath = normalizeCustomerPaymentCallbackPath(url);

      // On web `Linking.getInitialURL()` resolves to the page we are ALREADY on,
      // so parsing it and dispatching a navigation to that same route re-enters
      // this effect and loops -- app_opened fired every ~20ms and the main thread
      // never yielded. /payment/callback (where Paystack returns a paying
      // customer) and /orders/<id> deep links both have that shape. /login never
      // showed it only because it matches no branch here.
      //
      // A ref-once guard would not have been enough: each replace remounted the
      // root, which resets refs. Comparing against the current path is what
      // actually breaks the cycle, and it stays correct on native, where the
      // initial URL is a custom scheme and the pathname is never already the
      // target. Params are unaffected on web because they are already in the URL
      // the screen reads.
      //
      // /verify-email and /reset-password used to have branches here, purely to
      // ferry `code` / `access_token` / `refresh_token` from an emailed link into
      // those screens. Email confirmation and password reset are OTP-only now --
      // there is no link and no params to carry -- so the branches are gone. The
      // guard below is still load-bearing for the two branches that remain.
      const isAlreadyOn = (target: string) => pathnameRef.current === target;

      if (targetPath === 'payment/callback' || normalizedPaymentPath === 'payment/callback') {
        if (isAlreadyOn('/payment/callback')) {
          return;
        }

        router.replace(
          {
            pathname: '/payment/callback',
            params: {
              ...(typeof queryParams?.orderId === 'string' ? { orderId: queryParams.orderId } : null),
              ...(typeof queryParams?.reference === 'string' ? { reference: queryParams.reference } : null),
              ...(typeof queryParams?.trxref === 'string' ? { trxref: queryParams.trxref } : null),
              ...(typeof queryParams?.status === 'string' ? { status: queryParams.status } : null),
            },
          } as never
        );
      } else if (targetPath.startsWith('order/')) {
        const orderId = targetPath.split('/')[1];
        if (isAlreadyOn(`/orders/${orderId}`)) {
          return;
        }
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
    // Wait until the Stack is mounted; a replace dispatched while the loading
    // screen is up has no navigator to handle it.
    if (loading || policyLoading) return;

    const currentPath = pathname || '/';
    const isAuthRoute = AUTH_PAGES.has(currentPath);

    // Public content (Terms, Privacy) is exempt from every gate below, not just
    // the policy one. It used to be listed only on the policy check, so a
    // signed-in user who had not yet verified their email or added a phone
    // number was still bounced off /terms -- the two documents an app-store
    // reviewer reads first, and the only ones a user has a legal reason to read
    // BEFORE finishing onboarding.
    if (!user || isAuthRoute || isPublicContentRoute(currentPath)) {
      return;
    }

    if (!user.emailVerified && currentPath !== '/verify-email') {
      router.replace('/verify-email');
      return;
    }

    if (user.role === 'customer' && !user.phoneNumber && currentPath !== '/complete-profile') {
      router.replace('/complete-profile' as never);
      return;
    }

    if (!policyAccepted && currentPath !== '/accept-policy' && currentPath !== '/complete-profile') {
      router.replace('/accept-policy' as never);
      return;
    }

  }, [loading, pathname, policyAccepted, policyLoading, router, user]);

  useEffect(() => {
    if (loading || policyLoading || user?.role !== 'customer' || !user.emailVerified || !policyAccepted) {
      setShowLaunch(false);
      launchShownForUserRef.current = null;
      return;
    }

    if (launchShownForUserRef.current === user.uid) {
      return;
    }

    launchShownForUserRef.current = user.uid;
    setShowLaunch(true);
    const timer = setTimeout(() => setShowLaunch(false), 5000);

    return () => clearTimeout(timer);
  }, [loading, policyAccepted, policyLoading, user?.emailVerified, user?.role, user?.uid]);

  // Holding on `fontsReady` here avoids a flash of unstyled text. `useFeastyFonts`
  // reports ready even on a load failure, so a font error degrades to the system
  // face instead of hanging the app on the skeleton.
  //
  // The auth half of that condition is latched to the FIRST paint. `loading` is
  // true for the duration of every auth action, not just the initial session
  // bootstrap, so an unlatched gate here tore the entire navigator down in the
  // middle of a sign-up or sign-in: a failed attempt lost the screen the user
  // was on, taking its inline error with it. Once the session has resolved once,
  // later action-driven loading is the screens' own business -- they all render
  // busy state themselves -- and the navigator stays mounted.
  const hasBootstrappedRef = useRef(false);
  if (!loading && !policyLoading) {
    hasBootstrappedRef.current = true;
  }

  if (!fontsReady || ((loading || policyLoading) && !hasBootstrappedRef.current)) {
    return <LoadingSkeleton mode={getCustomerLoadingMode(pathname)} />;
  }

  // Keep the Stack mounted while the launch wordmark shows, otherwise the
  // auth redirect fires with no navigator to handle it.
  return (
    <View style={styles.appShell}>
      <Stack
        screenOptions={{
          headerShown: false,
        }}
      >
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(customer)" />
        <Stack.Screen name="payment/index" options={{ presentation: 'modal' }} />
        <Stack.Screen name="payment/callback" options={{ headerShown: false }} />
        <Stack.Screen name="+not-found" />
      </Stack>
      {showLaunch ? (
        <View style={styles.launchOverlay}>
          <FEASTYLaunchScreen />
        </View>
      ) : null}
    </View>
  );
}

export default function RootLayout() {
  useEffect(() => {
    void initializeSentry('customer');
    initializeAnalytics('customer');
    trackAnalyticsEvent('app_opened', {
      surface: 'customer',
    });
  }, []);

  return (
    <AuthProvider>
      <FeatureFlagsProvider>
        <CartProvider>
          <RootLayoutNav />
        </CartProvider>
      </FeatureFlagsProvider>
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
  launchBrand: {
    alignItems: 'center',
  },
  launchMark: {
    height: 108,
    width: 120,
  },
  launchWordmark: {
    fontSize: 54,
    fontStyle: 'italic',
    fontWeight: '900',
    letterSpacing: -2,
    lineHeight: 56,
    marginTop: 10,
  },
  launchWordmarkGreen: {
    color: customerTheme.brandGreen,
  },
  launchWordmarkOrange: {
    color: customerTheme.brandOrange,
  },
  launchSubtitle: {
    color: customerTheme.textMuted,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginTop: 6,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
});
