import { Pressable, StyleSheet, View } from 'react-native';
import { Card, Text, brand, radius, space, status } from '@feasty/design-system';

type CartLineItemProps = {
  name: string;
  /** Already-formatted unit price, e.g. "₦1,075". */
  unitPrice: string;
  /** Already-formatted line total (unit × quantity), e.g. "₦4,300". */
  lineTotal: string;
  quantity: number;
  onIncrement: () => void;
  onDecrement: () => void;
  onRemove: () => void;
};

/**
 * A single line in the cart. Domain component composed from design-system primitives.
 *
 * The line total is the bold beat (top-right), the unit price recedes to callout
 * secondary. The quantity stepper renders at 32pt visually but carries a hitSlop so the
 * effective tap target clears 44pt on every button.
 */
export default function CartLineItem({
  name,
  unitPrice,
  lineTotal,
  quantity,
  onIncrement,
  onDecrement,
  onRemove,
}: CartLineItemProps) {
  const hit = { top: 8, bottom: 8, left: 8, right: 8 };

  return (
    <Card padding="md" radius="lg" elevation="sm" style={styles.card}>
      <View style={styles.headerRow}>
        <Text variant="title3" numberOfLines={2} style={styles.name}>
          {name}
        </Text>
        <Text variant="bodyStrong">{lineTotal}</Text>
      </View>

      <Text variant="callout" tone="secondary" style={styles.unit}>
        {unitPrice} each
      </Text>

      <View style={styles.actions}>
        <View style={styles.stepper}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Decrease quantity"
            hitSlop={hit}
            onPress={onDecrement}
            style={({ pressed }) => [styles.stepButton, pressed ? styles.pressed : null]}
          >
            <Text variant="title3" tone="onBrand">
              −
            </Text>
          </Pressable>

          <Text variant="bodyStrong" style={styles.qty}>
            {quantity}
          </Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Increase quantity"
            hitSlop={hit}
            onPress={onIncrement}
            style={({ pressed }) => [styles.stepButton, pressed ? styles.pressed : null]}
          >
            <Text variant="title3" tone="onBrand">
              +
            </Text>
          </Pressable>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${name}`}
          hitSlop={hit}
          onPress={onRemove}
          style={styles.remove}
        >
          <Text variant="callout" style={styles.removeText}>
            Remove
          </Text>
        </Pressable>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: space.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space.md,
  },
  name: {
    flex: 1,
  },
  unit: {
    marginTop: space.hair,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: space.md,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepButton: {
    alignItems: 'center',
    backgroundColor: brand.primary,
    borderRadius: radius.md,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  pressed: {
    backgroundColor: brand.primaryStrong,
  },
  qty: {
    marginHorizontal: space.md,
    minWidth: 20,
    textAlign: 'center',
  },
  remove: {
    marginLeft: 'auto',
  },
  removeText: {
    color: status.danger,
  },
});
