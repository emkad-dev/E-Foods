import { useRef } from 'react';
import { Redirect, Stack, useLocalSearchParams, usePathname } from 'expo-router';
import LoadingSkeleton from '../../src/components/LoadingSkeleton';
import { useAuth } from '../../src/contexts/AuthContext';
import { resolveAuthRouteRedirect } from '../../src/domain/authRouteAccess';
import { customerTheme } from '../../src/theme/palette';
import { customerScreenOptions } from '../../src/theme/screenChrome';

const AUTH_ROUTES = new Set(['/login', '/register', '/forgot-password', '/reset-password']);
const normalizeRedirectTo = (value: unknown) => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  if (normalized === '/' || AUTH_ROUTES.has(normalized) || normalized === '/payment' || normalized === '/payment/callback') {
    return null;
  }

  return normalized;
};

type CustomerLoadingMode = NonNullable<Parameters<typeof LoadingSkeleton>[0]['mode']>;

const getAuthLoadingMode = (pathname: string | null | undefined): CustomerLoadingMode => {
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
    currentPath.startsWith('/accept-policy') ||
    currentPath.startsWith('/complete-profile')
  ) {
    return currentPath.startsWith('/accept-policy') || currentPath.startsWith('/complete-profile')
      ? 'auth-onboarding'
      : 'auth-recovery';
  }

  return 'auth-login';
};

const renderAuthStack = () => (
  <Stack
    screenOptions={{
      // Every screen in this group used to render the platform default title,
      // so crossing from a customer screen into Terms or Verify Email changed
      // the title's size and weight mid-journey.
      ...customerScreenOptions,
      headerShadowVisible: false,
      contentStyle: { backgroundColor: customerTheme.background },
    }}
  >
    <Stack.Screen name="login" options={{ headerShown: false }} />
    <Stack.Screen
      name="register"
      options={{ headerTitle: () => null, headerTransparent: true, headerBackTitle: 'Back' }}
    />
    <Stack.Screen name="accept-policy" options={{ title: 'Terms' }} />
    <Stack.Screen name="terms" options={{ title: 'Terms of Service' }} />
    <Stack.Screen name="privacy" options={{ title: 'Privacy Policy' }} />
    <Stack.Screen name="forgot-password" options={{ title: 'Reset Password' }} />
    <Stack.Screen name="verify-email" options={{ title: 'Verify Email' }} />
    <Stack.Screen name="reset-password" options={{ title: 'Choose a New Password' }} />
  </Stack>
);

export default function AuthLayout() {
  const params = useLocalSearchParams<{ redirectTo?: string | string[] }>();
  const pathname = usePathname();
  const { loading, policyLoading, policyAccepted, user } = useAuth();
  const redirectTo = normalizeRedirectTo(params.redirectTo);
  const currentPath = pathname || '/login';

  // `loading` is true for the duration of every auth ACTION (signUp, signIn,
  // resetPassword), not only the initial session bootstrap. Returning the
  // full-screen skeleton on it therefore unmounted this whole navigator
  // mid-action: a failed sign-up tore /register down before it could set its
  // inline error, and the stack that remounted afterwards fell back to its
  // initial route (login) while the URL had drifted elsewhere. So latch the
  // skeleton to the first paint only. The screens already render their own
  // in-flight state -- disabled inputs, "Creating account..." button labels --
  // which is what a user mid-action should see.
  const hasBootstrappedRef = useRef(false);
  if (!loading && !policyLoading) {
    hasBootstrappedRef.current = true;
  }

  if ((loading || policyLoading) && !hasBootstrappedRef.current) {
    return <LoadingSkeleton mode={getAuthLoadingMode(pathname)} />;
  }

  // The gate itself lives in src/domain/authRouteAccess.ts: the decision it
  // makes -- in particular that /terms and /privacy are public content the
  // onboarding gates must not swallow -- is the part worth testing, and it
  // cannot be tested from here because this module imports react-native.
  const redirect = resolveAuthRouteRedirect({
    currentPath,
    policyAccepted,
    redirectTo,
    viewer: user
      ? {
          emailVerified: user.emailVerified,
          hasPhoneNumber: Boolean(user.phoneNumber),
          role: user.role,
        }
      : null,
  });

  if (redirect) {
    return <Redirect href={redirect as never} />;
  }

  return renderAuthStack();
}
