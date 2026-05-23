import { useEffect } from 'react';
import * as Linking from 'expo-linking';
import { ActivityIndicator, View } from 'react-native';
import { Slot, useRouter, useSegments } from 'expo-router';
import { AuthProvider, useAuth } from '../src/contexts/AuthContext';
import { adminTheme } from '../src/theme/palette';

function RootLayoutNav() {
  const { loading, user } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    const handleDeepLink = ({ url }: { url: string }) => {
      const { hostname, path, queryParams } = Linking.parse(url);
      const targetPath = typeof path === 'string' && path.trim() ? path.trim() : typeof hostname === 'string' ? hostname.trim() : '';

      if (targetPath === 'verify-email') {
        const code = typeof queryParams?.code === 'string' ? queryParams.code : undefined;
        const accessToken = typeof queryParams?.access_token === 'string' ? queryParams.access_token : undefined;
        const refreshToken = typeof queryParams?.refresh_token === 'string' ? queryParams.refresh_token : undefined;

        router.replace({
          pathname: '/(auth)/verify-email',
          params: {
            ...(code ? { code } : null),
            ...(accessToken ? { access_token: accessToken } : null),
            ...(refreshToken ? { refresh_token: refreshToken } : null),
          },
        });
        return;
      }

      if (targetPath === 'reset-password') {
        const code = typeof queryParams?.code === 'string' ? queryParams.code : undefined;
        const accessToken = typeof queryParams?.access_token === 'string' ? queryParams.access_token : undefined;
        const refreshToken = typeof queryParams?.refresh_token === 'string' ? queryParams.refresh_token : undefined;

        router.replace({
          pathname: '/(auth)/reset-password',
          params: {
            ...(code ? { code } : null),
            ...(accessToken ? { access_token: accessToken } : null),
            ...(refreshToken ? { refresh_token: refreshToken } : null),
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
    const inAdminGroup = segments[0] === '(admin)';

    if (!user && !inAuthGroup) {
      router.replace('/(auth)/login');
      return;
    }

    if (user && !inAdminGroup) {
      router.replace('/(admin)');
    }
  }, [loading, router, segments, user]);

  if (loading) {
    return (
      <View
        style={{
          alignItems: 'center',
          backgroundColor: adminTheme.background,
          flex: 1,
          justifyContent: 'center',
        }}
      >
        <ActivityIndicator size="large" color={adminTheme.accent} />
      </View>
    );
  }

  return <Slot />;
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootLayoutNav />
    </AuthProvider>
  );
}
