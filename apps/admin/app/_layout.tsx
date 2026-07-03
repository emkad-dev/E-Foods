import { useEffect } from 'react';
import * as Linking from 'expo-linking';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { Slot, useRouter, useSegments } from 'expo-router';
import { AuthProvider, useAuth } from '../src/contexts/AuthContext';
import { initializeSentry } from '../../../packages/observability/src/sentry';
import { adminTheme } from '../src/theme/palette';

function NativeUnsupportedScreen() {
  return (
    <View style={styles.nativeOnlyScreen}>
      <View style={styles.nativeOnlyCard}>
        <Text style={styles.nativeOnlyEyebrow}>Web only</Text>
        <Text style={styles.nativeOnlyTitle}>FEASTY Admin opens in the browser</Text>
        <Text style={styles.nativeOnlyCopy}>
          This console is restricted to the web surface for team access. Open the browser console from a trusted
          desktop session.
        </Text>
      </View>
    </View>
  );
}

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
  useEffect(() => {
    void initializeSentry('admin');
  }, []);

  if (Platform.OS !== 'web') {
    return <NativeUnsupportedScreen />;
  }

  return (
    <AuthProvider>
      <RootLayoutNav />
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  nativeOnlyScreen: {
    alignItems: 'center',
    backgroundColor: adminTheme.background,
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  nativeOnlyCard: {
    backgroundColor: adminTheme.surface,
    borderColor: adminTheme.border,
    borderRadius: 24,
    borderWidth: 1,
    maxWidth: 440,
    padding: 22,
    width: '100%',
  },
  nativeOnlyEyebrow: {
    color: adminTheme.accentStrong,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  nativeOnlyTitle: {
    color: adminTheme.text,
    fontSize: 26,
    fontWeight: '800',
    marginTop: 10,
  },
  nativeOnlyCopy: {
    color: adminTheme.textMuted,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
  },
});
