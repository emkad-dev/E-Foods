import { useCallback, useEffect, useRef } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Slot, useRouter, useSegments } from 'expo-router';
import { AuthProvider, useAuth } from '../src/contexts/AuthContext';
import { syncDispatchRiderLocation } from '../src/services/dispatchRiderActions';
import {
  canResendFix,
  isForcedSyncDue,
  shouldSyncFix,
  type SyncPoint,
} from '../src/utils/locationSyncThrottle';
import { createSentryInitializer } from '../../../packages/observability/src/sentry';
import { FeatureFlagsProvider } from '../src/contexts/FeatureFlagsContext';
import { RiderAvailabilityProvider } from '../src/contexts/RiderAvailabilityContext';
import { RiderLocationProvider, useRiderLocationStream } from '../src/contexts/RiderLocationContext';
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

// Under the server's freshness windows (ebuy_nearest_riders: 90s), so a
// genuinely fresh beat still sends.
const MAX_FIX_AGE_MS = 90000;

type LocationFix = { accuracy: number; latitude: number; longitude: number; timestamp: number };

function DispatchLocationSyncBridge() {
  // The streaming decision and the single GPS watcher live in
  // RiderLocationProvider so screens can read the same fix.
  const { hasActiveAssignment, isStreaming, location, transitionSignature } = useRiderLocationStream();

  const latestFixRef = useRef<LocationFix | null>(null);
  const lastSyncRef = useRef<SyncPoint | null>(null);
  const inFlightRef = useRef(false);
  // A forced sync requested while another was in flight runs once it lands.
  const pendingForcedRef = useRef(false);

  const sendSync = useCallback((fix: LocationFix) => {
    if (inFlightRef.current) {
      pendingForcedRef.current = true;
      return;
    }

    inFlightRef.current = true;
    void syncDispatchRiderLocation({
      accuracy: fix.accuracy,
      latitude: fix.latitude,
      longitude: fix.longitude,
      timestamp: fix.timestamp,
    })
      .then(() => {
        lastSyncRef.current = { latitude: fix.latitude, longitude: fix.longitude, at: Date.now() };
      })
      .catch((error) => {
        console.warn('Failed to sync dispatch location:', error);
      })
      .finally(() => {
        inFlightRef.current = false;
        if (pendingForcedRef.current) {
          pendingForcedRef.current = false;
          const latest = latestFixRef.current;
          if (latest && canResendFix({ fixTimestamp: latest.timestamp, now: Date.now() })) {
            sendSync(latest);
          }
        }
      });
  }, []);

  // Forced/transition sync of the most recent fix. Re-sending it is truthful:
  // with a 25m distanceInterval the OS reports nothing while the rider moves
  // less than that, and canResendFix refuses a fix too old to vouch for.
  const forceSync = useCallback(() => {
    const latest = latestFixRef.current;
    if (latest && canResendFix({ fixTimestamp: latest.timestamp, now: Date.now() })) {
      sendSync(latest);
    }
  }, [sendSync]);

  useEffect(() => {
    if (!isStreaming) {
      lastSyncRef.current = null;
      latestFixRef.current = null;
    }
  }, [isStreaming]);

  useEffect(() => {
    if (!isStreaming || !location) {
      return;
    }

    // The server stamps rider_live_location.updated_at at RECEIPT, not from the
    // client timestamp, so replaying a stale retained fix (e.g. on Offline ->
    // Available) would look fresh at a place the rider left long ago. Skip it;
    // the next real fix syncs.
    const now = Date.now();
    if (now - location.timestamp > MAX_FIX_AGE_MS) {
      return;
    }

    latestFixRef.current = location;
    if (inFlightRef.current) {
      // At most one sync in flight; the next fix (or the keep-alive) catches up.
      return;
    }

    if (shouldSyncFix({ activeDelivery: hasActiveAssignment, fix: location, lastSync: lastSyncRef.current, now })) {
      sendSync(location);
    }
  }, [hasActiveAssignment, isStreaming, location, sendSync]);

  // Keep-alive while a delivery is active, so a parked rider (no fixes under a
  // 25m distanceInterval) still refreshes at least every 60s.
  useEffect(() => {
    if (!isStreaming || !hasActiveAssignment) {
      return;
    }

    const timer = setInterval(() => {
      if (isForcedSyncDue({ lastSync: lastSyncRef.current, now: Date.now() })) {
        forceSync();
      }
    }, 15000);

    return () => clearInterval(timer);
  }, [forceSync, hasActiveAssignment, isStreaming]);

  const previousSignatureRef = useRef(transitionSignature);
  useEffect(() => {
    if (previousSignatureRef.current === transitionSignature) {
      return;
    }

    previousSignatureRef.current = transitionSignature;
    if (isStreaming && transitionSignature) {
      forceSync();
    }
  }, [forceSync, isStreaming, transitionSignature]);

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
          <RiderLocationProvider>
            <RootLayoutNav />
            <DispatchLocationSyncBridge />
          </RiderLocationProvider>
        </RiderAvailabilityProvider>
      </FeatureFlagsProvider>
    </AuthProvider>
  );
}
