import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { AuthProvider } from '../src/contexts/AuthContext';
import { installWebFocusRing, useFeastyFonts } from '@feasty/design-system';
import { FeatureFlagsProvider } from '../src/contexts/FeatureFlagsContext';
import { createSentryInitializer } from '../../../packages/observability/src/sentry';

// Runs once, at module load, so the very first paint already has it. No-ops
// off web; see focusRing.ts for why this is one rule rather than an onFocus
// handler on every control.
installWebFocusRing();

const initializeSentry = createSentryInitializer({
  loadNativeSdk: () => import('@sentry/react-native'),
  loadWebSdk: () => import('@sentry/browser'),
});

// This component held a deep-link handler whose ONLY two branches ferried
// `code` / `access_token` / `refresh_token` from an emailed link into
// /verify-email and /reset-password. Email confirmation and password reset are
// OTP-only now — the emails carry a 6-digit code the partner types, there is no
// link and no params to carry — so the handler, its `expo-linking` import and
// the router it navigated with are all gone rather than left as an empty
// effect. expo-router still resolves those two routes from a URL on its own.
function RootLayoutNav() {
  // The navigator stays mounted across auth/loading changes. Previously this
  // returned a spinner in place of the navigator whenever `loading` toggled,
  // which unmounted the whole tree on every Supabase auth event and made the
  // panel thrash and fall back to the auth group's first route. The (auth) and
  // (partner) group layouts now own their loading + redirect guards.
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(partner)" />
    </Stack>
  );
}

export default function RootLayout() {
  useEffect(() => {
    void initializeSentry('partner');
  }, []);

  // Deliberately NOT gated on `fontsReady`, unlike the customer app: per the note
  // above, swapping the navigator out on a state change unmounts the whole tree and
  // makes the panel thrash. Partner accepts a brief fallback-face render instead.
  useFeastyFonts();

  return (
    <AuthProvider>
      <FeatureFlagsProvider>
        <RootLayoutNav />
      </FeatureFlagsProvider>
    </AuthProvider>
  );
}
