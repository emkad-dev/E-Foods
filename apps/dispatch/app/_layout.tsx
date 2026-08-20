import { useEffect, useMemo } from 'react';
import * as Linking from 'expo-linking';
import { ActivityIndicator, View } from 'react-native';
import { Slot, useRouter, useSegments } from 'expo-router';
import { AuthProvider, useAuth } from '../src/contexts/AuthContext';
import { useDispatchOrders } from '../src/hooks/useDispatchOrders';
import { useRealTimeLocation } from '../src/hooks/useRealTimeLocation';
import { syncDispatchRiderLocation } from '../src/services/dispatchRiderActions';
import { initializeSentry } from '../../../packages/observability/src/sentry';
import DispatchComingSoon from '../src/components/DispatchComingSoon';
import { dispatchTheme } from '../src/theme/palette';

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

  useEffect(() => {
    const handleDeepLink = ({ url }: { url: string }) => {
      const { hostname, path, queryParams } = Linking.parse(url);
      const targetPath =
        typeof path === 'string' && path.trim() ? path.trim() : typeof hostname === 'string' ? hostname.trim() : '';

      if (targetPath === 'verify-email') {
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
      <RootLayoutNav />
      <DispatchLocationSyncBridge />
    </AuthProvider>
  );
}
