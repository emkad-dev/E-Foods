import { useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Slot, useRouter, useSegments } from 'expo-router';
import { AuthProvider, useAuth } from '../src/contexts/AuthContext';
import { useDispatchOrders } from '../src/hooks/useDispatchOrders';
import { useRealTimeLocation } from '../src/hooks/useRealTimeLocation';
import { syncDispatchRiderLocation } from '../src/services/dispatchRiderActions';
import { createSentryInitializer } from '../../../packages/observability/src/sentry';
import { FeatureFlagsProvider } from '../src/contexts/FeatureFlagsContext';
import { RiderAvailabilityProvider, useRiderAvailability } from '../src/contexts/RiderAvailabilityContext';
import DispatchComingSoon from '../src/components/DispatchComingSoon';
import { installWebFocusRing } from '../../../packages/design-system/src/a11y/focusRing';
import { dispatchTheme } from '../src/theme/palette';

// Runs once, at module load, so the very first paint already has it. No-ops
// off web; see focusRing.ts for why this is one rule rather than an onFocus
// handler on every control.
installWebFocusRing();

const initializeSentry = createSentryInitializer({
  loadNativeSdk: () => import('@sentry/react-native'),
  loadWebSdk: () => import('@sentry/browser'),
});

// Standalone rider dispatch is shelved for the MVP (restaurants self-provision
// their own delivery). Set to true to bring the full authenticated rider app,
// login, and live location tracking back online — no deleted code to restore.
const DISPATCH_ENABLED = true;

const ACTIVE_LOCATION_INTERVAL_MS = 5000;
const IDLE_HEARTBEAT_INTERVAL_MS = 60000;
const ACTIVE_MIN_ACCURACY_M = 50;
const IDLE_MIN_ACCURACY_M = 200;
// Under the server's 120s freshness window, so a genuinely fresh beat still sends.
const MAX_FIX_AGE_MS = 90000;

function DispatchLocationSyncBridge() {
  const { user } = useAuth();
  // Battery/cost gate: only stream location while this rider is Available or
  // actually holds a live delivery, not just because their queue screen is showing unowned
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
  // Presence: an idle rider who is Available must still ping, otherwise SP-1's
  // 120s freshness gate never sees them and they can never be offered work.
  // Offline + no assignment streams nothing.
  const { isAvailable } = useRiderAvailability();
  const shouldStream = isAvailable || hasActiveAssignment;
  // Cadence: a live delivery keeps the fast beat customer tracking needs; an
  // idle-but-Available rider only needs a slow heartbeat well inside the 120s
  // freshness window (each beat is an edge-function invocation, so no faster).
  // distanceInterval 0 so a parked rider still beats (Android ANDs time+distance).
  const { location } = useRealTimeLocation({
    enabled: user?.role === 'dispatch' && shouldStream,
    highAccuracy: hasActiveAssignment,
    updateInterval: hasActiveAssignment ? ACTIVE_LOCATION_INTERVAL_MS : IDLE_HEARTBEAT_INTERVAL_MS,
    distanceInterval: hasActiveAssignment ? 5 : 0,
    // Idle presence only needs "alive", so tolerate coarse indoor/parked fixes
    // (otherwise they're all dropped, the rider goes stale and never gets work);
    // a live delivery keeps the strict 50m bar customer tracking needs.
    minAccuracy: hasActiveAssignment ? ACTIVE_MIN_ACCURACY_M : IDLE_MIN_ACCURACY_M,
  });

  useEffect(() => {
    if (!user || user.role !== 'dispatch' || !shouldStream || !location) {
      return;
    }

    // The server stamps rider_live_location.updated_at at RECEIPT, not from the
    // client timestamp, so replaying a stale retained fix (e.g. on Offline ->
    // Available) would look fresh at a place the rider left long ago. Skip it;
    // the next real fix syncs.
    if (Date.now() - location.timestamp > MAX_FIX_AGE_MS) {
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
  }, [shouldStream, location, user]);

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
  // `loading` is true for the duration of every auth ACTION (signUp, signIn,
  // resetPassword), not only the initial session bootstrap. Swapping <Slot />
  // for the spinner on it therefore unmounted the whole navigator mid-action:
  // a failed sign-up tore /register down before it could set its inline error,
  // and the stack that remounted afterwards fell back to its initial route. So
  // latch the spinner to the first paint only -- the screens already render
  // their own in-flight state (disabled inputs, "Creating account..." labels).
  const hasBootstrappedRef = useRef(false);
  if (!loading) {
    hasBootstrappedRef.current = true;
  }

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

  if (loading && !hasBootstrappedRef.current) {
    return (
      <View style={{ alignItems: 'center', backgroundColor: dispatchTheme.hero, flex: 1, justifyContent: 'center' }}>
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
        <RiderAvailabilityProvider>
          <RootLayoutNav />
          <DispatchLocationSyncBridge />
        </RiderAvailabilityProvider>
      </FeatureFlagsProvider>
    </AuthProvider>
  );
}
