import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Slot, useRouter, useSegments } from 'expo-router';
import { AuthProvider, useAuth } from '../src/contexts/AuthContext';

function RootLayoutNav() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (loading) {
      return;
    }

    const inAuthGroup = segments[0] === '(auth)';
    const inPartnerGroup = segments[0] === '(partner)';

    if (!user && !inAuthGroup) {
      router.replace('/(auth)/login');
      return;
    }

    if (user && !inPartnerGroup) {
      router.replace('/(partner)');
    }
  }, [loading, router, segments, user]);

  if (loading) {
    return (
      <View style={{ alignItems: 'center', backgroundColor: '#fffaf0', flex: 1, justifyContent: 'center' }}>
        <ActivityIndicator size="large" color="#f5b342" />
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
