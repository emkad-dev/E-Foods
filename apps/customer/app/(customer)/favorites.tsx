import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import AuthPromptCard from '../../src/components/AuthPromptCard';
import RemoteImage from '../../src/components/RemoteImage';
import RestaurantFavoriteButton from '../../src/components/RestaurantFavoriteButton';
import RestaurantLogoBadge from '../../src/components/RestaurantLogoBadge';
import ScreenColumn, { screenColumn } from '../../src/components/ScreenColumn';
import { SkeletonCard, SkeletonScreen } from '../../src/components/Skeleton';
import { useAuth } from '../../src/contexts/AuthContext';
import { useCart } from '../../src/contexts/CartContext';
import { useFavorites } from '../../src/contexts/FavoritesContext';
import { getRestaurantList } from '../../src/services/publicRestaurantReadModel';
import { customerTheme } from '../../src/theme/palette';
import { formatDeliveryEta } from '../../src/utils/formatting';
import {
  getRestaurantAvailability,
  getRestaurantCardStatusLabel,
  getRestaurantRatingLabel,
  isRestaurantVisibleToCustomers,
  type DiscoveryRestaurant,
} from '../../src/utils/restaurantAvailability';

type FavoriteRestaurant = DiscoveryRestaurant & {
  image?: string;
  logoImage?: string | null;
  rating?: number;
};

export default function CustomerFavoritesScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { favoriteRestaurantIds, loading: favoritesLoading, refreshFavorites } = useFavorites();
  const { deliveryLocation } = useCart();
  const [restaurants, setRestaurants] = useState<FavoriteRestaurant[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Tracks whether a catalog fetch has been attempted-and-settled (success
  // OR failure) for the CURRENT favoriteRestaurantIds -- see catalogPending
  // below. settledForIds is reset the moment favoriteRestaurantIds changes
  // reference, synchronously during render rather than in an effect: an
  // effect-based reset would still lag a paint behind (the same lag that
  // caused the original "No favorites yet" flash this component used to
  // have), so it has to happen in the same commit that receives the new ids.
  const [settledForIds, setSettledForIds] = useState(favoriteRestaurantIds);
  const [catalogSettled, setCatalogSettled] = useState(false);
  if (favoriteRestaurantIds !== settledForIds) {
    setSettledForIds(favoriteRestaurantIds);
    setCatalogSettled(false);
  }

  // refreshFavorites() only updates FavoritesContext's own state and resolves to void --
  // it does not hand back the refreshed ids. Reading the context's favoriteRestaurantIds
  // here (instead of trusting a return value that doesn't exist) also avoids shadowing
  // the context value of the same name, which previously crashed with a TypeError on
  // every load. The catalog fetch itself is driven by the effect below, which reacts to
  // favoriteRestaurantIds once the context has re-rendered with the fresh list.
  const loadFavorites = useCallback(async () => {
    try {
      await refreshFavorites();
      setError(null);
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : 'Unable to load favorites.';
      setError(message);
    }
  }, [refreshFavorites]);

  useEffect(() => {
    void loadFavorites();
  }, [loadFavorites]);

  useEffect(() => {
    if (favoriteRestaurantIds.length === 0) {
      setRestaurants([]);
      setError(null);
      setLoadingCatalog(false);
      setCatalogSettled(true);
      return;
    }

    let cancelled = false;
    setLoadingCatalog(true);

    // Cards only — this screen renders image/logoImage/name/cuisine/deliveryTime
    // plus the availability inputs (isOpen/coordinates/radius/supportsDelivery),
    // all of which are on the card; it never needed the full menu. What a card
    // does NOT carry is the operating window, which is why the status label
    // below has to be allowed to say nothing.
    getRestaurantList()
      .then(({ restaurants: catalog }) => {
        if (!cancelled) {
          // The same visibility gate home and search apply. Without it a
          // favorite that the partner later unpublished stayed on this list
          // and tapped through to "Restaurant not found" -- the favorite id
          // outlives the listing, so the catalogue is what decides.
          setRestaurants(
            catalog.filter((restaurant) => isRestaurantVisibleToCustomers(restaurant)) as FavoriteRestaurant[]
          );
          setError(null);
        }
      })
      .catch((nextError) => {
        if (!cancelled) {
          const message = nextError instanceof Error ? nextError.message : 'Unable to load favorites.';
          setError(message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingCatalog(false);
          // Marks this fetch attempt as settled (success OR failure) for
          // the ids it was resolved for. catalogPending below reads this
          // instead of restaurants.length === 0, otherwise a catalog that
          // legitimately resolves empty (nothing published) would look
          // indistinguishable from "still loading" and hang on the
          // skeleton forever.
          setCatalogSettled(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [favoriteRestaurantIds]);

  const favoriteIdSet = useMemo(() => new Set(favoriteRestaurantIds), [favoriteRestaurantIds]);
  const favoriteRestaurants = useMemo(
    () => restaurants.filter((restaurant) => favoriteIdSet.has(restaurant.id)),
    [favoriteIdSet, restaurants]
  );

  // On cold start / post-login / deep link, this component can mount and
  // paint once before the catalog-fetch effect (above) has had a chance to
  // flip loadingCatalog back to true for a non-empty favorites list --
  // React 18 flushes passive effects after paint, so relying on effect
  // ordering alone lets that first paint render "No favorites yet" for a
  // user who actually has favorites. catalogSettled is reset synchronously
  // during render (see above) rather than in that effect, so it already
  // reads false by the time this paints, closing the gap without touching
  // the effect's own timing.
  const catalogPending = favoriteRestaurantIds.length > 0 && !catalogSettled;

  // Saved kitchens exist, but none of them are listed any more (the visibility
  // filter above removed them all). "No favorites yet -- tap the heart" would be
  // advice for the wrong problem: they did tap the heart, and the restaurant
  // left the catalogue afterwards.
  const hasOnlyUnlistedFavorites = favoriteRestaurantIds.length > 0 && favoriteRestaurants.length === 0;

  // Signed-out visitors used to land on "No favorites yet / Tap the heart on
  // any restaurant" — advice that could not work, since favorites are a
  // signed-in feature. Checked before the loading branch: there is nothing to
  // load for a visitor with no session, so a skeleton here would only delay the
  // one thing worth showing.
  if (!user) {
    return (
      <View style={styles.promptContainer}>
        <ScreenColumn>
          <AuthPromptCard
            title="Sign in to save favorites"
            message="Your favorite kitchens live here once you sign in. Browsing stays open either way."
          />
        </ScreenColumn>
      </View>
    );
  }

  if (loadingCatalog || favoritesLoading || catalogPending) {
    return (
      <SkeletonScreen>
        <SkeletonCard />
        <SkeletonCard />
      </SkeletonScreen>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, screenColumn.feed]}>
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
          <Text style={styles.stateTitle}>
            {hasOnlyUnlistedFavorites ? 'Your saved kitchens are not listed' : 'No favorites yet'}
          </Text>
          <Text style={styles.stateCopy}>
            {hasOnlyUnlistedFavorites
              ? 'They are unavailable on FEASTY right now. They will show up here again if they come back.'
              : 'Tap the heart on any restaurant.'}
          </Text>
        </View>
      ) : null}

      {favoriteRestaurants.map((restaurant) => {
        // The same answer home and search give, from the same helper: a raw
        // `isOpen` read here was a third, weaker opinion -- it knew nothing
        // about operating hours, delivery range or pickup-only kitchens, and
        // printed "Open" for every one of them.
        const statusLabel = getRestaurantCardStatusLabel(
          restaurant,
          getRestaurantAvailability(restaurant, deliveryLocation)
        );

        return (
          <TouchableOpacity
            key={restaurant.id}
            activeOpacity={0.92}
            onPress={() => router.push(`/home/restaurant/${restaurant.id}`)}
            style={styles.card}
          >
            <RemoteImage
              uri={restaurant.image}
              style={styles.cardImage}
              fallback={
                <View style={styles.cardImageFallback}>
                  <Text style={styles.cardImageFallbackText}>{restaurant.name.slice(0, 1).toUpperCase()}</Text>
                </View>
              }
            />
            <RestaurantLogoBadge logoImage={restaurant.logoImage} name={restaurant.name} size={40} style={styles.logoBadge} />
            <View style={styles.cardBody}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {restaurant.name}
                </Text>
                <RestaurantFavoriteButton restaurantId={restaurant.id} size={14} style={styles.favoriteButton} />
              </View>
              <Text style={styles.cardMeta} numberOfLines={1}>
                {/* The ETA is dropped, not defaulted. `?? '25-35 min'` gave every
                    kitchen that had published no estimate the same invented
                    delivery promise - the claim class this app has been removing. */}
                {[restaurant.cuisine ?? 'Kitchen', formatDeliveryEta(restaurant.deliveryTime)]
                  .filter(Boolean)
                  .join(' | ')}
              </Text>
              <View style={styles.factRow}>
                <Text style={styles.fact}>{getRestaurantRatingLabel(restaurant)}</Text>
                {/* Nothing at all when the payload cannot support a claim: a card
                    carries no opening/closing time, and guessing "Open" from its
                    absence is what made the feed contradict the restaurant page. */}
                {statusLabel ? <Text style={styles.fact}>{statusLabel}</Text> : null}
              </View>
            </View>
          </TouchableOpacity>
        );
      })}
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
  promptContainer: {
    backgroundColor: customerTheme.background,
    flex: 1,
    justifyContent: 'center',
    padding: 16,
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
