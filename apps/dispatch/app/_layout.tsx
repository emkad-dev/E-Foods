import { useEffect, useMemo, useRef } from 'react';
import * as Linking from 'expo-linking';
import { ActivityIndicator, View } from 'react-native';
import { Slot, usePathname, useRouter, useSegments } from 'expo-router';
import { AuthProvider, useAuth } from '../src/contexts/AuthContext';
import { useDispatchOrders } from '../src/hooks/useDispatchOrders';
import { useRealTimeLocation } from '../src/hooks/useRealTimeLocation';
import { syncDispatchRiderLocation } from '../src/services/dispatchRiderActions';
import { createSentryInitializer } from '../../../packages/observability/src/sentry';
import { FeatureFlagsProvider } from '../src/contexts/FeatureFlagsContext';
import DispatchComingSoon from '../src/components/DispatchComingSoon';
import { dispatchTheme } from '../src/theme/palette';

const initializeSentry = createSentryInitializer({
  loadNativeSdk: () => import('@sentry/react-native'),
  loadWebSdk: () => import('@sentry/browser'),
});

// Standalone rider dispatch is shelved for the MVP (restaurants self-provision
// their own delivery). Set to true to bring the full authenticated rider app,
// login, and live location tracking back online — no deleted code to restore.
const DISPATCH_ENABLED = false;

function DispatchLocationSyncBridge() {
  const { user } = useAuth();
  // Battery/cost gate: only stream location while this rider actually holds
  // a live delivery, not just because their queue screen is showing unowned
  // manual-queue work they could self-assign. `activeDeliveryOrders` (from
  // useDispatchOrders) is deliberately broader than that for a `dispatch`
  // role - dispatchGetDeliveryQueue surfaces both this rider's own assigned
  // orders AND unowned orders any dispatcher could pick up (see
  // isUnownedDispatchableOrder in _shared/domains/dispatch.ts) - so gating on
  // its length alone would keep GPS running for every rider whenever ANY
  // order anywhere is sitting unclaimed. `assignment.courierId === user.uid`
  // narrows it to orders this specific rider is actually the assigned
  // courier for.
  const { activeDeliveryOrders } = useDispatchOrders();
  const hasActiveAssignment = useMemo(
    () => activeDeliveryOrders.some((order) => order.assignment?.courierId === user?.uid),
    [activeDeliveryOrders, user?.uid]
  );
  const { location } = useRealTimeLocation({
    enabled: user?.role === 'dispatch' && hasActiveAssignment,
    highAccuracy: true,
    updateInterval: 5000,
  });

  useEffect(() => {
    if (!user || user.role !== 'dispatch' || !hasActiveAssignment || !location) {
      return;
    }

    void syncDispatchRiderLocation({
      accuracy: location.accuracy,
      latitude: location.latitude,
      longitude: location.longitude,
      timestamp: location.timestamp,
    }).catch((error) => {
      console.warn('Failed to sync dispatch location:', error);
    });
  }, [hasActiveAssignment, location, user]);

  return null;
}

function RootLayoutNav() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  const pathname = usePathname();
  // Live pathname for the deep-link guard below, held in a ref so the listener
  // does not resubscribe on every navigation.
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  useEffect(() => {
    const handleDeepLink = ({ url }: { url: string }) => {
      const { hostname, path, queryParams } = Linking.parse(url);
      const targetPath =
        typeof path === 'string' && path.trim() ? path.trim() : typeof hostname === 'string' ? hostname.trim() : '';

      // On web `Linking.getInitialURL()` resolves to the page we are ALREADY on,
      // so parsing it and dispatching a navigation to that same route re-enters
      // this effect and loops: the root remounts, getInitialURL returns the same
      // URL, and the main thread never yields. /reset-password and /verify-email
      // -- the two screens reachable only from an email link -- would hang the
      // whole app. /login never showed it because it matches no branch here.
      // Same defect and same fix as apps/customer/app/_layout.tsx.
      //
      // Compared against the RESOLVED url path, not the group-qualified target
      // passed to router.replace: expo-router route groups like (auth) are not
      // part of the URL, so usePathname() reports '/verify-email', never
      // '/(auth)/verify-email'. Comparing against the latter would never match
      // and the guard would silently do nothing.
      //
      // A ref-once guard is NOT sufficient: each replace remounts the root,
      // which resets refs. Comparing against the current path is what breaks the
      // cycle, and it stays correct on native, where the initial URL is a custom
      // scheme and the pathname is never already the target.
      const isAlreadyOn = (resolvedPath: string) => pathnameRef.current === resolvedPath;

      if (targetPath === 'verify-email') {
        if (isAlreadyOn('/verify-email')) {
          return;
        }

        router.replace({
          pathname: '/(auth)/verify-email' as never,
          params: {
            ...(typeof queryParams?.code === 'string' ? { code: queryParams.code } : null),
            ...(typeof queryParams?.access_token === 'string' ? { access_token: queryParams.access_token } : null),
            ...(typeof queryParams?.refresh_token === 'string' ? { refresh_token: queryParams.refresh_token } : null),
          },
        });
        return;
      }

      if (targetPath === 'reset-password') {
        if (isAlreadyOn('/reset-password')) {
          return;
        }

        router.replace({
          pathname: '/(auth)/reset-password' as never,
          params: {
            ...(typeof queryParams?.code === 'string' ? { code: queryParams.code } : null),
            ...(typeof queryParams?.access_token === 'string' ? { access_token: queryParams.access_token } : null),
            ...(typeof queryParams?.refresh_token === 'string' ? { refresh_token: queryParams.refresh_token } : null),
          },
        });
      }
    };

    Linking.getInitialURL().then((url) => {
      if (url) {
        handleDeepLink({ url });
      }
    });

    const subscription = Linking.addEventListener('url', handleDeepLink);
    return () => subscription.remove();
  }, [router]);

  useEffect(() => {
    if (loading) {
      return;
    }

    const inAuthGroup = segments[0] === '(auth)';
    const inDispatchGroup = segments[0] === '(dispatch)';

    if (!user && !inAuthGroup) {
      router.replace('/(auth)/login');
      return;
    }

    if (user && !inDispatchGroup) {
      router.replace('/(dispatch)');
    }
  }, [loading, router, segments, user]);

  if (loading) {
    return (
      <View style={{ alignItems: 'center', backgroundColor: '#111315', flex: 1, justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={dispatchTheme.accent} />
      </View>
    );
  }

  return <Slot />;
}

export default function RootLayout() {
  useEffect(() => {
    void initializeSentry('dispatch');
  }, []);

  // While dispatch is shelved, render only the coming-soon screen. Auth, live
  // location tracking, and the rider routes are never mounted (login disabled).
  if (!DISPATCH_ENABLED) {
    return <DispatchComingSoon />;
  }

  return (
    <AuthProvider>
      <FeatureFlagsProvider>
        <RootLayoutNav />
        <DispatchLocationSyncBridge />
      </FeatureFlagsProvider>
    </AuthProvider>
  );
}
