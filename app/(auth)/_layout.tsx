import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        contentStyle: { backgroundColor: '#fff' },
      }}
    >
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="register" options={{ title: 'Create Account' }} />
      <Stack.Screen name="forgot-password" options={{ title: 'Reset Password' }} />
      <Stack.Screen name="verify-email" options={{ title: 'Verify Email' }} />
      <Stack.Screen name="reset-password" options={{ title: 'Choose a New Password' }} />
    </Stack>
  );
}
