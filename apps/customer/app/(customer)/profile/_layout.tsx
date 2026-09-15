// app/(customer)/profile/_layout.tsx
import { Stack } from 'expo-router';
import CustomerHeaderBackButton from '../../../src/components/CustomerHeaderBackButton';
import { customerScreenOptions } from '../../../src/theme/screenChrome';

export default function ProfileLayout() {
  return (
    <Stack screenOptions={customerScreenOptions}>
      <Stack.Screen
        name="index"
        options={{
          headerLeft: () => <CustomerHeaderBackButton href="/home" />,
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
          title: 'Edit profile',
        }}
      />
    </Stack>
  );
}
