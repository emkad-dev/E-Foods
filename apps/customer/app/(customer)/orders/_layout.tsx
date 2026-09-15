// app/(customer)/orders/_layout.tsx
import { Stack } from 'expo-router';
import CustomerHeaderBackButton from '../../../src/components/CustomerHeaderBackButton';
import { customerScreenOptions } from '../../../src/theme/screenChrome';

export default function OrdersLayout() {
  return (
    <Stack screenOptions={customerScreenOptions}>
      <Stack.Screen
        name="index"
        options={{
          headerLeft: () => <CustomerHeaderBackButton href="/home" />,
          title: 'Orders',
        }}
      />
      <Stack.Screen
        name="[id]"
        options={{
          title: 'Order Details',
        }}
      />
    </Stack>
  );
}
