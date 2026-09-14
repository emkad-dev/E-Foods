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
          headerLeft: () => <CustomerHeaderBackButton href="/home" />,
          headerTitleStyle: { color: customerTheme.text, fontSize: 18, fontWeight: '800' },
          title: 'Profile',
        }}
      />
      <Stack.Screen
        name="edit"
        options={{
          // Back to /profile, not to whatever pushed this screen: the only way
          // in is the identity card's Edit button, and a save ends with a
          // `replace` to /profile, so "back" always means that one place.
          headerLeft: () => <CustomerHeaderBackButton href="/profile" />,
          headerTitleStyle: { color: customerTheme.text, fontSize: 18, fontWeight: '800' },
          title: 'Edit profile',
        }}
      />
    </Stack>
  );
}
