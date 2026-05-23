// app/(customer)/profile/_layout.tsx
import { Stack } from 'expo-router';
import CustomerHeaderBackButton from '../../../src/components/CustomerHeaderBackButton';
import { customerTheme } from '../../../src/theme/palette';

export default function ProfileLayout() {
  return (
    <Stack>
      <Stack.Screen
        name="index"
        options={{
          headerLeft: () => <CustomerHeaderBackButton href="/(customer)/home" />,
          headerTitleStyle: { color: customerTheme.text, fontSize: 18, fontWeight: '800' },
          title: 'Profile',
        }}
      />
      {/* Add additional screens here if needed, e.g., edit-profile.tsx */}
    </Stack>
  );
}
