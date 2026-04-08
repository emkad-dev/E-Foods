// app/(customer)/orders/_layout.tsx
import { Stack } from 'expo-router';
import AuthHeaderActions from '../../../src/components/AuthHeaderActions';

export default function OrdersLayout() {
  return (
    <Stack>
      <Stack.Screen
        name="index"
        options={{
          title: 'Orders',
          headerRight: () => <AuthHeaderActions />,
        }}
      />
      <Stack.Screen
        name="[id]"
        options={{
          title: 'Order Details',
          headerRight: () => <AuthHeaderActions />,
        }}
      />
    </Stack>
  );
}
