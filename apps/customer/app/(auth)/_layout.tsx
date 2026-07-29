import { Redirect, Stack, useLocalSearchParams, usePathname } from 'expo-router';
import LoadingSkeleton from '../../src/components/LoadingSkeleton';
import { useAuth } from '../../src/contexts/AuthContext';
import { customerTheme } from '../../src/theme/palette';

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

export default function AuthLayout() {
  const params = useLocalSearchParams<{ redirectTo?: string | string[] }>();
  const pathname = usePathname();
  const { loading, policyLoading, policyAccepted, user } = useAuth();
  const redirectTo = normalizeRedirectTo(params.redirectTo);

  if (loading || policyLoading) {
    return <LoadingSkeleton mode={getAuthLoadingMode(pathname)} />;
  }

  if (user) {
    let target = '/home';

    if (!user.emailVerified) {
      target = '/verify-email';
    } else if (user.role === 'customer' && !user.phoneNumber) {
      target = '/complete-profile';
    } else if (!policyAccepted) {
      target = '/accept-policy';
    } else if (redirectTo) {
      target = redirectTo;
    }

    return <Redirect href={target as never} />;
  }

  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        contentStyle: { backgroundColor: customerTheme.background },
      }}
    >
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="register" options={{ title: 'Create Account' }} />
      <Stack.Screen name="accept-policy" options={{ title: 'Terms' }} />
      <Stack.Screen name="terms" options={{ title: 'Terms of Service' }} />
      <Stack.Screen name="privacy" options={{ title: 'Privacy Policy' }} />
      <Stack.Screen name="forgot-password" options={{ title: 'Reset Password' }} />
      <Stack.Screen name="verify-email" options={{ title: 'Verify Email' }} />
      <Stack.Screen name="reset-password" options={{ title: 'Choose a New Password' }} />
    </Stack>
  );
}
