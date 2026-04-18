// app/(customer)/profile/_layout.tsx
import { Stack } from 'expo-router';
import AuthHeaderActions from '../../../src/components/AuthHeaderActions';

export default function ProfileLayout() {
  return (
    <Stack>
      <Stack.Screen
        name="index"
        options={{
          title: 'Profile',
          headerRight: () => <AuthHeaderActions />,
        }}
      />
      {/* Add additional screens here if needed, e.g., edit-profile.tsx */}
    </Stack>
  );
}
