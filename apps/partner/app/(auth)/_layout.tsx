import { Redirect, Stack, useLocalSearchParams, usePathname } from 'expo-router';
import LoadingSkeleton from '../../src/components/LoadingSkeleton';
import { useAuth } from '../../src/contexts/AuthContext';
import { partnerTheme } from '../../src/theme/palette';

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
    currentPath.startsWith('/privacy')
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
  const redirectTo = normalizeRedirectTo(params.redirectTo);

  if (loading) {
    return <LoadingSkeleton mode={getAuthLoadingMode(pathname)} />;
  }

  // Signed-in partners never see the auth screens.
  if (user) {
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
      <Stack.Screen name="register" options={{ title: 'Create Account' }} />
      <Stack.Screen name="forgot-password" options={{ title: 'Reset Password' }} />
      <Stack.Screen name="reset-password" options={{ title: 'Choose a New Password' }} />
      <Stack.Screen name="verify-email" options={{ title: 'Verify Email' }} />
      <Stack.Screen name="terms" options={{ title: 'Terms of Service' }} />
      <Stack.Screen name="privacy" options={{ title: 'Privacy Policy' }} />
    </Stack>
  );
}
