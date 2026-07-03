import { Stack } from 'expo-router';
import { partnerTheme } from '../../src/theme/palette';

// Anchor the auth group to the login screen. Without this, expo-router falls
// back to the alphabetically-first route in the group ("forgot-password"), so
// any time the navigator remounts (e.g. the AuthContext toggles `loading` when
// the browser tab regains focus and Supabase re-emits an auth event) the panel
// jumps to /forgot-password instead of staying on login.
export const unstable_settings = {
  initialRouteName: 'login',
};

export default function AuthLayout() {
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
