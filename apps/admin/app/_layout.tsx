import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Slot, useRouter, useSegments } from 'expo-router';
import { AuthProvider, useAuth } from '../src/contexts/AuthContext';
import { adminTheme } from '../src/theme/palette';

function RootLayoutNav() {
  const { loading, user } = useAuth();
  const router = useRouter();
  const segments = useSegments();

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
