import { Stack } from 'expo-router';
import AuthHeaderActions from '../../../src/components/AuthHeaderActions';

export default function HomeLayout() {
  return (
    <Stack>
      <Stack.Screen
        name="index"
        options={{
          title: 'Restaurant',
          headerRight: () => <AuthHeaderActions />,
        }}
      />
      <Stack.Screen
        name="restaurant/[id]"
        options={{
          title: 'Restaurant',
          headerRight: () => <AuthHeaderActions />,
        }}
      />
    </Stack>
  );
}
