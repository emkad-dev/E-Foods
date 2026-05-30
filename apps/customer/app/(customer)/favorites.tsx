import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import RestaurantFavoriteButton from '../../src/components/RestaurantFavoriteButton';
import RestaurantLogoBadge from '../../src/components/RestaurantLogoBadge';
import { useFavorites } from '../../src/contexts/FavoritesContext';
import { getPublishedRestaurants } from '../../src/services/publicRestaurantReadModel';
import { customerTheme } from '../../src/theme/palette';
import type { DiscoveryRestaurant } from '../../src/utils/restaurantAvailability';

type FavoriteRestaurant = DiscoveryRestaurant & {
  image?: string;
  logoImage?: string | null;
  rating?: number;
};

export default function CustomerFavoritesScreen() {
  const router = useRouter();
  const { favoriteRestaurantIds, loading: favoritesLoading, refreshFavorites } = useFavorites();
  const [restaurants, setRestaurants] = useState<FavoriteRestaurant[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadFavorites = useCallback(async () => {
    setLoadingCatalog(true);
    try {
      const [{ restaurants: catalog }] = await Promise.all([getPublishedRestaurants(), refreshFavorites()]);
      setRestaurants(catalog as FavoriteRestaurant[]);
      setError(null);
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : 'Unable to load favorites.';
      setError(message);
    } finally {
      setLoadingCatalog(false);
    }
  }, [refreshFavorites]);

  useEffect(() => {
    void loadFavorites();
  }, [loadFavorites]);

  const favoriteIdSet = useMemo(() => new Set(favoriteRestaurantIds), [favoriteRestaurantIds]);
  const favoriteRestaurants = useMemo(
    () => restaurants.filter((restaurant) => favoriteIdSet.has(restaurant.id)),
    [favoriteIdSet, restaurants]
  );

  if (loadingCatalog || favoritesLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={customerTheme.accentStrong} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {error ? (
        <View style={styles.stateCard}>
          <Text style={styles.stateTitle}>Favorites unavailable</Text>
          <Text style={styles.stateCopy}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={loadFavorites}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {!error && favoriteRestaurants.length === 0 ? (
        <View style={styles.stateCard}>
          <Text style={styles.stateTitle}>No favorites yet</Text>
          <Text style={styles.stateCopy}>Tap the heart on any restaurant.</Text>
        </View>
      ) : null}

      {favoriteRestaurants.map((restaurant) => (
        <TouchableOpacity
          key={restaurant.id}
          activeOpacity={0.92}
          onPress={() => router.push(`/home/restaurant/${restaurant.id}`)}
          style={styles.card}
        >
          {restaurant.image ? (
            <Image source={{ uri: restaurant.image }} style={styles.cardImage} />
          ) : (
            <View style={styles.cardImageFallback}>
              <Text style={styles.cardImageFallbackText}>{restaurant.name.slice(0, 1).toUpperCase()}</Text>
            </View>
          )}
          <RestaurantLogoBadge logoImage={restaurant.logoImage} name={restaurant.name} size={40} style={styles.logoBadge} />
          <View style={styles.cardBody}>
            <View style={styles.cardTitleRow}>
              <Text style={styles.cardTitle} numberOfLines={1}>
                {restaurant.name}
              </Text>
              <RestaurantFavoriteButton restaurantId={restaurant.id} size={14} style={styles.favoriteButton} />
            </View>
            <Text style={styles.cardMeta} numberOfLines={1}>
              {restaurant.cuisine ?? 'Kitchen'} | {restaurant.deliveryTime ?? '25-35 min'}
            </Text>
            <View style={styles.factRow}>
              <Text style={styles.fact}>{restaurant.rating ? `Rated ${restaurant.rating}` : 'New'}</Text>
              <Text style={styles.fact}>{restaurant.isOpen === false ? 'Closed' : 'Open'}</Text>
            </View>
          </View>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: customerTheme.background,
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 96,
  },
  centered: {
    alignItems: 'center',
    backgroundColor: customerTheme.background,
    flex: 1,
    justifyContent: 'center',
  },
  card: {
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 14,
    overflow: 'hidden',
  },
  cardBody: {
    padding: 14,
  },
  cardImage: {
    height: 140,
    width: '100%',
  },
  cardImageFallback: {
    alignItems: 'center',
    backgroundColor: customerTheme.surfaceStrong,
    height: 140,
    justifyContent: 'center',
  },
  cardImageFallbackText: {
    color: customerTheme.accentStrong,
    fontSize: 36,
    fontWeight: '800',
  },
  cardMeta: {
    color: customerTheme.textMuted,
    fontSize: 13,
    marginTop: 6,
  },
  cardTitle: {
    color: customerTheme.text,
    flex: 1,
    fontSize: 18,
    fontWeight: '800',
    marginRight: 10,
  },
  cardTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  fact: {
    color: customerTheme.accentStrong,
    fontSize: 12,
    fontWeight: '800',
    marginRight: 12,
  },
  factRow: {
    flexDirection: 'row',
    marginTop: 10,
  },
  favoriteButton: {
    backgroundColor: customerTheme.surfaceMuted,
    height: 34,
    width: 34,
  },
  logoBadge: {
    left: 14,
    position: 'absolute',
    top: 116,
  },
  retryButton: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: customerTheme.accentStrong,
    borderRadius: 999,
    marginTop: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  retryButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  stateCard: {
    alignItems: 'center',
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
    borderRadius: 18,
    borderWidth: 1,
    padding: 22,
  },
  stateCopy: {
    color: customerTheme.textMuted,
    fontSize: 13,
    marginTop: 8,
    textAlign: 'center',
  },
  stateTitle: {
    color: customerTheme.text,
    fontSize: 18,
    fontWeight: '800',
  },
});
