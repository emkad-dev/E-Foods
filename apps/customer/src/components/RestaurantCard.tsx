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
  /** Status pill for out-of-zone / closed / pickup-only cards. */
  statusLabel?: string | null;
  statusTone?: 'warning' | 'danger';
  onPress: () => void;
};

/**
 * The customer-facing restaurant row — the most-repeated unit on the home feed.
 *
 * Domain component (knows what a restaurant is) composed entirely from design-system
 * primitives. Every card is a fixed height so the feed reads as an even grid; the name
 * is `title3` (Bricolage 17), metadata (distance · delivery time) recedes to secondary,
 * and the overall rating is pinned to the bottom-right as the one bold beat.
 */
export default function RestaurantCard({
  id,
  name,
  image,
  cuisine,
  rating,
  deliveryTime,
  metaLine,
  statusLabel,
  statusTone = 'warning',
  onPress,
}: RestaurantCardProps) {
  const hasRating = typeof rating === 'number' && rating > 0;
  const metaText = [metaLine, deliveryTime].filter(Boolean).join('  ·  ');

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
          <View>
            <View style={styles.headerRow}>
              <Text variant="title3" numberOfLines={1} style={styles.name}>
                {name}
              </Text>
              <RestaurantFavoriteButton restaurantId={id} size={13} style={styles.favorite} />
            </View>

            <Text variant="callout" tone="secondary" numberOfLines={1} style={styles.cuisine}>
              {cuisine ?? 'Kitchen update pending'}
            </Text>
          </View>

          <View style={styles.footerRow}>
            <Text variant="caption" tone="secondary" numberOfLines={1} style={styles.meta}>
              {metaText}
            </Text>
            {hasRating ? (
              <View style={styles.rating}>
                <FontAwesome name="star" size={12} color={brand.accent} />
                <Text variant="bodyStrong">{rating!.toFixed(1)}</Text>
              </View>
            ) : null}
          </View>
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
    height: 116,
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
    justifyContent: 'space-between',
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
  cuisine: {
    marginTop: space.xs,
  },
  footerRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  meta: {
    flex: 1,
  },
  rating: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space.xs,
  },
});
