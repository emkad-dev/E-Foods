import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { MIN_TAP_TARGET, radius } from '@feasty/design-system';
import { customerTheme } from '../theme/palette';

type OrderConfirmationPromptProps = {
  fulfillmentType?: 'delivery' | 'pickup' | null;
  orderId: string;
  restaurantName: string;
};

/**
 * Home-screen nudge for an order the restaurant has completed but the customer
 * has not answered. The whole card is the tap target; the answer itself is given
 * on the order screen.
 */
export default function OrderConfirmationPrompt({
  fulfillmentType,
  orderId,
  restaurantName,
}: OrderConfirmationPromptProps) {
  const router = useRouter();
  const isPickup = fulfillmentType === 'pickup';

  return (
    <TouchableOpacity
      accessibilityRole="button"
      style={styles.card}
      onPress={() => router.push(`/orders/${orderId}` as never)}
    >
      <Text style={styles.title}>
        {isPickup ? `Collected your order from ${restaurantName}?` : `Did your order from ${restaurantName} arrive?`}
      </Text>
      <Text style={styles.copy}>Tap to confirm, or tell us if something went wrong.</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: customerTheme.accentTint,
    borderColor: customerTheme.border,
    borderRadius: radius.xl,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: 12,
    minHeight: MIN_TAP_TARGET,
    padding: 16,
  },
  title: {
    color: customerTheme.text,
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 20,
  },
  copy: {
    color: customerTheme.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
});
