import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../../src/contexts/AuthContext';
import { partnerTheme } from '../../src/theme/palette';

// Anchor the auth group to the login screen. Without this, expo-router falls
// back to the alphabetically-first route in the group ("forgot-password").
export const unstable_settings = {
  initialRouteName: 'login',
};

export default function AuthLayout() {
  const { loading, user } = useAuth();

  if (loading) {
    return (
      <View style={{ alignItems: 'center', backgroundColor: partnerTheme.background, flex: 1, justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={partnerTheme.accent} />
      </View>
    );
  }

  // Signed-in partners never see the auth screens.
  if (user) {
    return <Redirect href={'/(partner)' as never} />;
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
