// app/(customer)/search/_layout.tsx
import { Stack } from 'expo-router';
import AuthHeaderActions from '../../../src/components/AuthHeaderActions';

export default function SearchLayout() {
  return (
    <Stack>
      <Stack.Screen
        name="index"
        options={{
          title: 'Search',
          headerRight: () => <AuthHeaderActions />,
        }}
      />
      {/* If you have a results screen, add it here */}
      {/* <Stack.Screen name="results" options={{ title: 'Results' }} /> */}
    </Stack>
  );
}
