// app/(customer)/orders/_layout.tsx
import { Stack } from 'expo-router';
import CustomerHeaderBackButton from '../../../src/components/CustomerHeaderBackButton';
import { customerTheme } from '../../../src/theme/palette';

export default function OrdersLayout() {
  return (
    <Stack>
      <Stack.Screen
        name="index"
        options={{
          headerLeft: () => <CustomerHeaderBackButton href="/(customer)/home" />,
          headerTitleStyle: { color: customerTheme.text, fontSize: 18, fontWeight: '800' },
          title: 'Orders',
        }}
      />
      <Stack.Screen
        name="[id]"
        options={{
          headerTitleStyle: { color: customerTheme.text, fontSize: 18, fontWeight: '800' },
          title: 'Order Details',
        }}
      />
    </Stack>
  );
}
