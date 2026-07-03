import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../../src/contexts/AuthContext';
import { customerTheme } from '../../src/theme/palette';

export default function AuthLayout() {
  const { loading, policyLoading, policyAccepted, user } = useAuth();

  if (loading || policyLoading) {
    return (
      <View
        style={{
          alignItems: 'center',
          backgroundColor: customerTheme.launchBackground,
          flex: 1,
          justifyContent: 'center',
        }}
      >
        <ActivityIndicator color={customerTheme.brandGreen} size="large" />
      </View>
    );
  }

  if (user) {
    let target = '/home';

    if (!user.emailVerified) {
      target = '/verify-email';
    } else if (user.role === 'customer' && !user.phoneNumber) {
      target = '/complete-profile';
    } else if (!policyAccepted) {
      target = '/accept-policy';
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
