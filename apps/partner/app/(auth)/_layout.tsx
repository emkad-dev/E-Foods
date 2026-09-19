import { useRef } from 'react';
import { Redirect, Stack, useLocalSearchParams, usePathname } from 'expo-router';
import LoadingSkeleton from '../../src/components/LoadingSkeleton';
import { useAuth } from '../../src/contexts/AuthContext';
import { useStaffJoinHandoff } from '../../src/state/staffJoinHandoff';
import { partnerTheme } from '../../src/theme/palette';

// `/join` is in here for the same reason as the rest: `redirectTo` must never
// point back into this group. Landing a just-signed-in person on the join
// screen is exactly the loop the handoff below exists to steer out of.
const AUTH_ROUTES = new Set(['/login', '/register', '/forgot-password', '/reset-password', '/join']);
const normalizeRedirectTo = (value: unknown) => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  if (normalized === '/' || AUTH_ROUTES.has(normalized)) {
    return null;
  }

  return normalized;
};

type PartnerLoadingMode = NonNullable<Parameters<typeof LoadingSkeleton>[0]['mode']>;

const getAuthLoadingMode = (pathname: string | null | undefined): PartnerLoadingMode => {
  const currentPath = pathname || '/login';

  if (currentPath.startsWith('/register')) {
    return 'auth-register';
  }

  if (
    currentPath.startsWith('/forgot-password') ||
    currentPath.startsWith('/reset-password') ||
    currentPath.startsWith('/verify-email') ||
    currentPath.startsWith('/terms') ||
    currentPath.startsWith('/privacy') ||
    // Same family: one card on a hero, shown to somebody who does not have a
    // dashboard yet. The login skeleton would promise a form that is not
    // coming.
    currentPath.startsWith('/join')
  ) {
    return 'auth-recovery';
  }

  return 'auth-login';
};

// Anchor the auth group to the login screen. Without this, expo-router falls
// back to the alphabetically-first route in the group ("forgot-password").
export const unstable_settings = {
  initialRouteName: 'login',
};

export default function AuthLayout() {
  const params = useLocalSearchParams<{ redirectTo?: string | string[] }>();
  const pathname = usePathname();
  const { loading, user } = useAuth();
  const staffJoin = useStaffJoinHandoff();
  const redirectTo = normalizeRedirectTo(params.redirectTo);

  // `loading` is true for the duration of every auth ACTION (signUp, signIn,
  // resetPassword), not only the initial session bootstrap. Returning the
  // full-screen skeleton on it therefore unmounted this whole navigator
  // mid-action: a failed sign-up tore /register down before it could set its
  // inline error, and the stack that remounted afterwards fell back to
  // `initialRouteName` (login). So latch the skeleton to the first paint only.
  // The screens already render their own in-flight state -- disabled inputs,
  // "Creating account..." button labels -- which is what a user mid-action
  // should see.
  const hasBootstrappedRef = useRef(false);
  if (!loading) {
    hasBootstrappedRef.current = true;
  }

  if (loading && !hasBootstrappedRef.current) {
    return <LoadingSkeleton mode={getAuthLoadingMode(pathname)} />;
  }

  // Signed-in partners never see the auth screens -- with two exceptions, both
  // of them the staff-join flow, which is the only thing in this group that
  // signs a person in and still has work to do afterwards.
  //
  // HOLDING is handled by falling through to the SAME <Stack> below rather
  // than returning a second one here: two different Stack elements at this
  // position reconcile into a navigator remount, which would tear down the
  // very screen this branch exists to keep alive.
  if (user && staffJoin !== 'holding') {
    // AWAITING-GOOGLE: they left /join to sign in with Google and still owe a
    // redemption. `/(partner)` would send them to the applicant wizard, which
    // is the wrong screen for an invitee and was the original defect; the
    // authenticated join screen is the one that finishes the job. (On web the
    // Google flow is a full-page redirect, so this flag is usually gone by
    // now and they get the wizard's "I was invited" link instead.)
    if (staffJoin === 'awaiting-google') {
      return <Redirect href="/(partner)/join-restaurant" />;
    }

    return <Redirect href={(redirectTo ?? '/(partner)') as never} />;
  }

  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        contentStyle: { backgroundColor: partnerTheme.background },
      }}
    >
      <Stack.Screen name="login" options={{ headerShown: false }} />
      {/* No header, like login: this screen carries its own hero, and the
          person arriving on it has no account to go "back" to. */}
      <Stack.Screen name="join" options={{ headerShown: false }} />
      <Stack.Screen name="register" options={{ title: 'Create Account' }} />
      <Stack.Screen name="forgot-password" options={{ title: 'Reset Password' }} />
      <Stack.Screen name="reset-password" options={{ title: 'Choose a New Password' }} />
      <Stack.Screen name="verify-email" options={{ title: 'Verify Email' }} />
      <Stack.Screen name="terms" options={{ title: 'Terms of Service' }} />
      <Stack.Screen name="privacy" options={{ title: 'Privacy Policy' }} />
    </Stack>
  );
}
