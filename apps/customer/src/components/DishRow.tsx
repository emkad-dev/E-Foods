import { FontAwesome } from '@expo/vector-icons';
import { Image, StyleSheet, View } from 'react-native';
import { Button, Card, Text, brand, space, surface, text as textColor } from '@feasty/design-system';

type DishRowProps = {
  name: string;
  description?: string | null;
  /** Already-formatted price, e.g. "₦4,300". */
  price: string;
  image?: string | null;
  disabled?: boolean;
  onAdd: () => void;
};

/**
 * A single menu item on the restaurant page — the unit a customer acts on to build an
 * order. Domain component composed from design-system primitives.
 *
 * Name is `title3`, description recedes to `callout` secondary, and the price is the
 * one brand-green beat (primaryStrong, 7.87:1). The Add control is the Button primitive,
 * so it inherits the 44pt minimum tap target for free.
 */
export default function DishRow({ name, description, price, image, disabled = false, onAdd }: DishRowProps) {
  return (
    <Card padding="none" radius="lg" elevation="sm" style={styles.card}>
      <View style={styles.row}>
        {image ? (
          <Image source={{ uri: image }} style={styles.image} />
        ) : (
          <View style={[styles.image, styles.placeholder]}>
            <FontAwesome name="cutlery" size={20} color={textColor.secondary} />
          </View>
        )}

        <View style={styles.info}>
          <Text variant="title3" numberOfLines={1}>
            {name}
          </Text>
          {description ? (
            <Text variant="callout" tone="secondary" numberOfLines={2} style={styles.desc}>
              {description}
            </Text>
          ) : null}
          <Text variant="bodyStrong" style={styles.price}>
            {price}
          </Text>
        </View>

        <View style={styles.action}>
          <Button label="Add" variant="primary" size="sm" disabled={disabled} onPress={onAdd} />
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: space.sm,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  image: {
    alignSelf: 'stretch',
    backgroundColor: surface.muted,
    width: 100,
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: {
    flex: 1,
    paddingHorizontal: space.md,
    paddingVertical: space.lg,
  },
  desc: {
    marginTop: space.xs,
  },
  price: {
    color: brand.primaryStrong,
    marginTop: space.sm,
  },
  action: {
    alignSelf: 'center',
    paddingRight: space.md,
  },
});
