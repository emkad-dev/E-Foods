// app/(customer)/orders/_layout.tsx
import { Stack } from 'expo-router';

export default function OrdersLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Orders' }} />
      <Stack.Screen name="[id]" options={{ title: 'Order Details' }} />
    </Stack>
  );
}