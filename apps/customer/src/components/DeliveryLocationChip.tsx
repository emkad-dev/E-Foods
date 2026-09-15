import { FontAwesome } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyleProp, StyleSheet, Text, TouchableOpacity, ViewStyle } from 'react-native';
import { radius, space } from '@feasty/design-system';
import { useCart } from '../contexts/CartContext';
import { customerTheme } from '../theme/palette';

type DeliveryLocationChipProps = {
  /**
   * The chip stretches to fill its row (the home header, where it shares a row
   * with the avatar button). Left off, it sizes to its label — which is what the
   * search header needs, and why the label's flex is tied to this flag: a
   * `flex: 1` label inside a shrink-to-fit row collapses to zero width.
   */
  fill?: boolean;
  /** Screen-specific placement only (margins, alignSelf). Not chip geometry. */
  style?: StyleProp<ViewStyle>;
};

/**
 * "Where are we delivering?" control in the home and search headers.
 *
 * These were two hand-built copies of the same control that had drifted apart —
 * radius 15 vs 14, label 13 vs 12, icons 15/18 vs 14/16 — so the same chip
 * changed size as the customer moved between two adjacent tabs. Geometry now
 * lives here once, on the design-system scale; the screens supply only their own
 * placement.
 */
export default function DeliveryLocationChip({ fill = false, style }: DeliveryLocationChipProps) {
  const router = useRouter();
  const { deliveryLocation } = useCart();
  const label = deliveryLocation?.shortAddress ?? 'Set delivery area';

  return (
    <TouchableOpacity
      style={[styles.chip, fill ? styles.chipFill : null, style]}
      onPress={() => router.push('/delivery-location')}
    >
      <FontAwesome name="map-marker" size={15} color={customerTheme.brandGreen} />
      <Text style={[styles.label, fill ? styles.labelFill : null]} numberOfLines={1}>
        {label}
      </Text>
      <FontAwesome name="angle-down" size={18} color={customerTheme.brandGreen} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignItems: 'center',
    backgroundColor: customerTheme.headerSurface,
    borderColor: 'rgba(3, 184, 51, 0.18)',
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  chipFill: {
    flex: 1,
  },
  label: {
    color: customerTheme.text,
    fontSize: 13,
    fontWeight: '700',
    marginHorizontal: space.sm,
  },
  labelFill: {
    flex: 1,
  },
});
