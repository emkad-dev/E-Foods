import { FontAwesome } from '@expo/vector-icons';
import { Image, StyleSheet, View } from 'react-native';
import { Badge, Card, Text, brand, space, radius, surface } from '@feasty/design-system';
import RestaurantFavoriteButton from './RestaurantFavoriteButton';

type RestaurantCardProps = {
  id: string;
  name: string;
  image?: string | null;
  cuisine?: string | null;
  rating?: number | null;
  /** e.g. "25-35 min" */
  deliveryTime?: string | null;
  /** e.g. "1.2 km away · Within your zone" */
  metaLine: string;
  hoursLabel?: string | null;
  mealPreview?: string[];
  /** Status pill for out-of-zone / closed / pickup-only cards. */
  statusLabel?: string | null;
  statusTone?: 'warning' | 'danger';
  onPress: () => void;
};

/**
 * The customer-facing restaurant row — the most-repeated unit on the home feed.
 *
 * Domain component (knows what a restaurant is) composed entirely from design-system
 * primitives. Hierarchy is carried by the type scale and colour, not by the old
 * everything-is-weight-800 approach: the name is `title3` (Bricolage 17), the rating is
 * the one bold beat, and metadata recedes to `callout`/`caption` secondary.
 */
export default function RestaurantCard({
  id,
  name,
  image,
  cuisine,
  rating,
  deliveryTime,
  metaLine,
  hoursLabel,
  mealPreview,
  statusLabel,
  statusTone = 'warning',
  onPress,
}: RestaurantCardProps) {
  const hasRating = typeof rating === 'number' && rating > 0;

  return (
    <Card padding="none" radius="lg" elevation="sm" onPress={onPress} style={styles.card}>
      <View style={styles.row}>
        <View style={styles.imageWrap}>
          {image ? (
            <Image source={{ uri: image }} style={styles.image} />
          ) : (
            <View style={styles.imageFallback}>
              <Text variant="title1" tone="onBrand">
                {name.slice(0, 1).toUpperCase()}
              </Text>
            </View>
          )}
          {statusLabel ? (
            <View style={styles.statusOverlay}>
              <Badge label={statusLabel} tone={statusTone === 'danger' ? 'danger' : 'warning'} />
            </View>
          ) : null}
        </View>

        <View style={styles.info}>
          <View style={styles.headerRow}>
            <Text variant="title3" numberOfLines={1} style={styles.name}>
              {name}
            </Text>
            <RestaurantFavoriteButton restaurantId={id} size={13} style={styles.favorite} />
          </View>

          {hasRating || deliveryTime ? (
            <View style={styles.ratingRow}>
              {hasRating ? (
                <>
                  <FontAwesome name="star" size={12} color={brand.accent} />
                  <Text variant="bodyStrong">{rating!.toFixed(1)}</Text>
                </>
              ) : null}
              {hasRating && deliveryTime ? (
                <Text variant="callout" tone="secondary">
                  ·
                </Text>
              ) : null}
              {deliveryTime ? (
                <Text variant="callout" tone="secondary">
                  {deliveryTime}
                </Text>
              ) : null}
            </View>
          ) : null}

          <Text variant="callout" tone="secondary" numberOfLines={1} style={styles.cuisine}>
            {cuisine ?? 'Kitchen update pending'}
          </Text>

          {mealPreview && mealPreview.length > 0 ? (
            <Text variant="caption" tone="primary" numberOfLines={2} style={styles.meals}>
              {mealPreview.join('  ·  ')}
            </Text>
          ) : null}

          <Text variant="caption" tone="secondary" numberOfLines={1} style={styles.meta}>
            {metaLine}
          </Text>

          {hoursLabel ? (
            <Text variant="caption" tone="secondary" numberOfLines={1}>
              {hoursLabel}
            </Text>
          ) : null}
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: space.md,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    minHeight: 124,
  },
  imageWrap: {
    width: 108,
    position: 'relative',
  },
  image: {
    height: '100%',
    width: '100%',
  },
  imageFallback: {
    alignItems: 'center',
    backgroundColor: brand.primary,
    height: '100%',
    justifyContent: 'center',
    width: '100%',
  },
  statusOverlay: {
    bottom: space.sm,
    left: space.sm,
    position: 'absolute',
  },
  info: {
    flex: 1,
    padding: space.md,
    justifyContent: 'center',
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  name: {
    flex: 1,
  },
  favorite: {
    backgroundColor: surface.muted,
    height: 30,
    width: 30,
    borderRadius: radius.pill,
  },
  ratingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space.xs,
    marginTop: space.xs,
  },
  cuisine: {
    marginTop: space.xs,
  },
  meals: {
    marginTop: space.sm,
    lineHeight: 16,
  },
  meta: {
    marginTop: space.xs,
  },
});
