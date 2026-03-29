// app/(customer)/profile/_layout.tsx
import { Stack } from 'expo-router';

export default function ProfileLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Profile' }} />
      {/* Add additional screens here if needed, e.g., edit-profile.tsx */}
    </Stack>
  );
}