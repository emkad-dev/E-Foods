import { useEffect, useMemo } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Slot, useRouter, useSegments } from 'expo-router';
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

// This component held a deep-link handler with exactly two branches,
// /verify-email and /reset-password, whose only job was ferrying `code` /
// `access_token` / `refresh_token` from an emailed link into those screens.
// Email confirmation and password reset are OTP-only now -- the emails carry a
// 6-digit code the rider types, so there is no link and no params to carry --
// which left the handler with nothing to do. It is deleted whole rather than
// left as an empty effect, and with it go the `expo-linking` import and the
// `usePathname`/`pathnameRef` loop guard added in 7f6bfe6, which existed only
// to stop THOSE branches re-navigating to the page they were already on. Half a
// guard with no branches to guard would be worse than none. expo-router still
// resolves both routes from a URL on its own.
function RootLayoutNav() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const segments = useSegments();

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
