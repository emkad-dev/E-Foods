import { FontAwesome } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Keyboard,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../../src/contexts/AuthContext';
import { useCart } from '../../../src/contexts/CartContext';
import RestaurantFavoriteButton from '../../../src/components/RestaurantFavoriteButton';
import { getPublishedRestaurants } from '../../../src/services/publicRestaurantReadModel';
import { trackAnalyticsEvent } from '../../../../../packages/observability/src/analytics';
import {
  type DiscoveryRestaurant,
  getDiscoveryEmptyState,
  getRestaurantAvailability,
  getRestaurantOperatingHoursLabel,
  isRestaurantVisibleToCustomers,
  matchesRestaurantQuery,
  normalizeRestaurantQuery,
} from '../../../src/utils/restaurantAvailability';
import { customerTheme } from '../../../src/theme/palette';

type Restaurant = DiscoveryRestaurant & {
  image: string;
  logoImage?: string | null;
  rating: number;
  deliveryTime: string;
};

type DiscoveryEntry = {
  availability: ReturnType<typeof getRestaurantAvailability>;
  restaurant: Restaurant;
};

type SpotlightSlide = {
  accent: 'amber' | 'hero' | 'cream';
  copy: string;
  cta: string;
  id: string;
  image?: string;
  meta: string;
  restaurantId?: string;
  title: string;
};

const FEATURED_CURATIONS: {
  accent: 'amber' | 'hero' | 'cream';
  copy: string;
  id: string;
  tag: string;
  title: string;
}[] = [
  {
    accent: 'amber',
    copy: 'Jollof trays, stews, and quick lunch picks with short delivery windows.',
    id: 'featured-rice',
    tag: 'Lunch rush',
    title: 'Rice bowls that land fast',
  },
  {
    accent: 'hero',
    copy: 'Warm soups and swallow-friendly kitchens for heavier evening orders.',
    id: 'featured-swallow',
    tag: 'Comfort',
    title: 'Deep soups and swallow picks',
  },
  {
    accent: 'cream',
    copy: 'Small chops, grilled bites, and quick pickup options when the queue is light.',
    id: 'featured-snacks',
    tag: 'Quick bite',
    title: 'Snacks for light cravings',
  },
];

const getCustomerName = (displayName: string | undefined, email: string | undefined) => {
  const rawValue = displayName?.trim() || email?.split('@')[0]?.trim() || 'there';
  return rawValue.charAt(0).toUpperCase() + rawValue.slice(1);
};

const getMealPreview = (restaurant: Restaurant, searchQuery: string) => {
  const normalizedQuery = normalizeRestaurantQuery(searchQuery);
  const seen = new Set<string>();

  (restaurant.menu ?? []).forEach((menuCategory) => {
    (menuCategory.items ?? []).forEach((item) => {
      if (item.isAvailable === false) {
        return;
      }

      if (normalizedQuery) {
        const haystack = [item.name, item.categoryLabel ?? '', menuCategory.category ?? ''].join(' ').toLowerCase();
        if (!haystack.includes(normalizedQuery)) {
          return;
        }
      }

      if (!seen.has(item.name)) {
        seen.add(item.name);
      }
    });
  });

  return Array.from(seen).slice(0, 2);
};

const toShelfEntries = (entries: DiscoveryEntry[], limit?: number) => (limit ? entries.slice(0, limit) : entries);

export default function HomeScreen() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshingCatalog, setRefreshingCatalog] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [expandedShelf, setExpandedShelf] = useState<'nearby' | null>(null);
  const [activeSpotlightIndex, setActiveSpotlightIndex] = useState(0);
  const catalogRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spotlightRef = useRef<FlatList<SpotlightSlide> | null>(null);
  const isMountedRef = useRef(true);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const { user } = useAuth();
  const { deliveryLocation } = useCart();
  const spotlightWidth = Math.max(screenWidth - 28, 280);

  const loadRestaurants = useCallback(
    async (mode: 'initial' | 'manual' | 'background' = 'initial') => {
      const showSpinner = mode !== 'background';

      if (showSpinner) {
        if (mode === 'initial') {
          setLoading(true);
        } else {
          setRefreshingCatalog(true);
        }
      }

      try {
        const { restaurants: catalog } = await getPublishedRestaurants();
        setRestaurants(catalog.filter((restaurant) => isRestaurantVisibleToCustomers(restaurant)) as Restaurant[]);
        setCatalogError(null);
        trackAnalyticsEvent('customer_catalog_loaded', {
          mode,
          restaurant_count: catalog.length,
        });
        return true;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'The restaurant service is unavailable right now. Please try again.';
        setCatalogError(message);
        trackAnalyticsEvent('customer_catalog_load_failed', {
          mode,
          error_message: message.slice(0, 120),
        });
        return false;
      } finally {
        if (showSpinner) {
          if (mode === 'initial') {
            setLoading(false);
          } else {
            setRefreshingCatalog(false);
          }
        }
      }
    },
    []
  );

  const scheduleCatalogRefresh = useCallback(
    (delayMs: number) => {
      if (!isMountedRef.current) {
        return;
      }

      if (catalogRefreshTimerRef.current) {
        clearTimeout(catalogRefreshTimerRef.current);
      }

      catalogRefreshTimerRef.current = setTimeout(async () => {
        const succeeded = await loadRestaurants('background');
        scheduleCatalogRefresh(succeeded ? 30000 : 120000);
      }, delayMs);
    },
    [loadRestaurants]
  );

  useEffect(() => {
    isMountedRef.current = true;

    const initializeCatalog = async () => {
      const succeeded = await loadRestaurants('initial');
      scheduleCatalogRefresh(succeeded ? 30000 : 120000);
    };

    void initializeCatalog();

    return () => {
      isMountedRef.current = false;
      if (catalogRefreshTimerRef.current) {
        clearTimeout(catalogRefreshTimerRef.current);
      }
    };
  }, [loadRestaurants, scheduleCatalogRefresh]);

  const discoveryResults = useMemo(() => {
    return restaurants
      .filter((restaurant) => matchesRestaurantQuery(restaurant, search))
      .map((restaurant) => ({
        restaurant,
        availability: getRestaurantAvailability(restaurant, deliveryLocation),
      }));
  }, [deliveryLocation, restaurants, search]);

  const availableRestaurants = useMemo(
    () => discoveryResults.filter((entry) => entry.availability.isAvailable),
    [discoveryResults]
  );
  const unavailableRestaurants = useMemo(
    () => discoveryResults.filter((entry) => !entry.availability.isAvailable),
    [discoveryResults]
  );

  const topRatedRestaurants = useMemo(
    () =>
      [...availableRestaurants].sort((left, right) => {
        const ratingDelta = (right.restaurant.rating ?? 0) - (left.restaurant.rating ?? 0);
        if (ratingDelta !== 0) {
          return ratingDelta;
        }

        return left.restaurant.name.localeCompare(right.restaurant.name);
      }),
    [availableRestaurants]
  );

  const nearbyRestaurants = useMemo(
    () =>
      [...availableRestaurants].sort((left, right) => {
        const leftDistance = left.availability.distanceKm ?? Number.MAX_SAFE_INTEGER;
        const rightDistance = right.availability.distanceKm ?? Number.MAX_SAFE_INTEGER;
        return leftDistance - rightDistance;
      }),
    [availableRestaurants]
  );

  const featuredRestaurants = useMemo(
    () => topRatedRestaurants.slice(0, Math.min(topRatedRestaurants.length, FEATURED_CURATIONS.length)),
    [topRatedRestaurants]
  );
  const spotlightSlides = useMemo<SpotlightSlide[]>(
    () =>
      FEATURED_CURATIONS.map((feature, index) => {
        const spotlight = featuredRestaurants[index]?.restaurant;
        return {
          accent: feature.accent,
          copy: spotlight?.cuisine
            ? `${feature.copy} ${spotlight.cuisine} is live on this slot.`
            : feature.copy,
          cta: spotlight ? 'Open restaurant' : 'See deals',
          id: feature.id,
          image: spotlight?.image,
          meta:
            spotlight?.name ??
            'Featured',
          restaurantId: spotlight?.id,
          title: feature.title,
        };
      }),
    [featuredRestaurants]
  );

  useEffect(() => {
    if (spotlightSlides.length <= 1) {
      return;
    }

    const interval = setInterval(() => {
      setActiveSpotlightIndex((currentIndex) => {
        const nextIndex = (currentIndex + 1) % spotlightSlides.length;
        spotlightRef.current?.scrollToIndex({
          animated: true,
          index: nextIndex,
        });
        return nextIndex;
      });
    }, 4200);

    return () => clearInterval(interval);
  }, [spotlightSlides.length]);

  const nearbyVisible = toShelfEntries(nearbyRestaurants, expandedShelf === 'nearby' ? undefined : 4);

  const emptyState = getDiscoveryEmptyState({
    availableCount: availableRestaurants.length,
    matchedCount: discoveryResults.length,
    unavailableReasons: unavailableRestaurants.map((entry) => entry.availability.reason),
    query: search,
    unavailableCount: unavailableRestaurants.length,
    deliveryLocation,
  });

  const handleSearchSubmit = () => {
    setSearch((currentSearch) => {
      const nextSearch = currentSearch.trim();
      trackAnalyticsEvent('customer_restaurant_search_submitted', {
        query_length: nextSearch.length,
      });
      return nextSearch;
    });
    Keyboard.dismiss();
  };

  const handleRetryCatalog = async () => {
    if (catalogRefreshTimerRef.current) {
      clearTimeout(catalogRefreshTimerRef.current);
      catalogRefreshTimerRef.current = null;
    }

    const succeeded = await loadRestaurants('manual');
    scheduleCatalogRefresh(succeeded ? 30000 : 120000);
  };

  const handleSpotlightMomentumEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const nextIndex = Math.round(event.nativeEvent.contentOffset.x / spotlightWidth);

    if (Number.isFinite(nextIndex)) {
      setActiveSpotlightIndex(nextIndex);
    }
  };

  const customerName = getCustomerName(user?.displayName, user?.email);
  const greeting = `HI ${customerName.toUpperCase().slice(0, 18)}`;
  const avatarLabel = customerName.slice(0, 1).toUpperCase();
  const locationLabel = deliveryLocation?.shortAddress ?? 'Set delivery area';

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={customerTheme.accentStrong} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: Math.max(insets.top, 12) + 6 }]}
    >
      <Animated.View entering={FadeInDown.delay(120).duration(500)} style={styles.homeHeader}>
        <View style={styles.headerTopRow}>
          <View style={styles.greetingBlock}>
            <Text style={styles.greetingText} numberOfLines={1}>
              {greeting}
            </Text>
          </View>
          <Text style={styles.headerWordmark} numberOfLines={1}>
            <Text style={styles.headerWordmarkGreen}>FEAST</Text>
            <Text style={styles.headerWordmarkOrange}>Y</Text>
          </Text>
        </View>

        <View style={styles.headerActionRow}>
          <TouchableOpacity style={styles.locationChip} onPress={() => router.push('/delivery-location')}>
            <FontAwesome name="map-marker" size={15} color={customerTheme.brandGreen} />
            <Text style={styles.locationChipLabel} numberOfLines={1}>
              {locationLabel}
            </Text>
            <FontAwesome name="angle-down" size={18} color={customerTheme.brandGreen} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.avatarButton} onPress={() => router.push('/profile')}>
            <Text style={styles.avatarButtonText}>{avatarLabel}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.searchShell}>
          <FontAwesome name="search" size={16} color={customerTheme.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search bukas, cuisines, or cravings"
            placeholderTextColor={customerTheme.textMuted}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
            enablesReturnKeyAutomatically
            onSubmitEditing={handleSearchSubmit}
          />
          <TouchableOpacity
            style={[styles.searchAction, search.trim() ? styles.searchActionActive : styles.searchActionIdle]}
            onPress={handleSearchSubmit}
            disabled={!search.trim()}
          >
            <FontAwesome name="arrow-right" size={15} color="#fff" />
          </TouchableOpacity>
        </View>
      </Animated.View>

      {catalogError ? (
        <Animated.View entering={FadeInDown.delay(160).duration(500)} style={styles.catalogStatusCard}>
          <View style={styles.catalogStatusHeader}>
            <Text style={styles.catalogStatusTitle}>Restaurant service unavailable</Text>
            {refreshingCatalog ? <ActivityIndicator size="small" color={customerTheme.accentStrong} /> : null}
          </View>
          <Text style={styles.catalogStatusCopy}>{catalogError}</Text>
          <TouchableOpacity
            style={[styles.catalogRetryButton, refreshingCatalog ? styles.catalogRetryButtonDisabled : null]}
            onPress={handleRetryCatalog}
            disabled={refreshingCatalog}
          >
            <Text style={styles.catalogRetryButtonText}>{refreshingCatalog ? 'Retrying...' : 'Retry now'}</Text>
          </TouchableOpacity>
        </Animated.View>
      ) : null}

      <Animated.View entering={FadeInDown.delay(240).duration(500)} style={styles.featureSection}>
        <View style={styles.spotlightStack}>
          <View style={styles.spotlightCardBack} />
          <View style={styles.spotlightCardMid} />
          <FlatList
            ref={spotlightRef}
            data={spotlightSlides}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            keyExtractor={(item) => item.id}
            decelerationRate="fast"
            snapToAlignment="start"
            onMomentumScrollEnd={handleSpotlightMomentumEnd}
            getItemLayout={(_, index) => ({
              index,
              length: spotlightWidth,
              offset: spotlightWidth * index,
            })}
            renderItem={({ item }) => {
              const accentStyle =
                item.accent === 'hero'
                  ? styles.featureCardHero
                  : item.accent === 'cream'
                    ? styles.featureCardCream
                    : styles.featureCardAmber;
              const hasImage = Boolean(item.image);

              return (
                <TouchableOpacity
                  activeOpacity={0.92}
                  style={[styles.featureCard, hasImage ? styles.featureCardImage : accentStyle, { width: spotlightWidth }]}
                  onPress={() => {
                    if (item.restaurantId) {
                      trackAnalyticsEvent('customer_spotlight_opened', {
                        destination: 'restaurant',
                      });
                      router.push(`/home/restaurant/${item.restaurantId}`);
                      return;
                    }

                    trackAnalyticsEvent('customer_spotlight_opened', {
                      destination: 'deals',
                    });
                    router.push('/deals');
                  }}
                >
                  {hasImage ? (
                    <>
                      <Image source={{ uri: item.image }} style={styles.featureImageBackdrop} />
                      <LinearGradient
                        colors={['transparent', 'rgba(9,15,29,0.85)']}
                        style={styles.featureImageGradient}
                      />
                      <View style={styles.featureContentOverlay}>
                        <Text style={styles.featureTagLight}>{item.meta}</Text>
                        <Text style={styles.featureTitleLight}>{item.title}</Text>
                        <Text style={styles.featureCopyLight} numberOfLines={2}>
                          {item.copy}
                        </Text>
                        <View style={styles.featureCtaPill}>
                          <Text style={styles.featureCtaPillText}>{item.cta}</Text>
                          <FontAwesome name="long-arrow-right" size={15} color="#ffffff" />
                        </View>
                      </View>
                    </>
                  ) : (
                    <View style={styles.featureContent}>
                      <Text style={styles.featureTag}>{item.meta}</Text>
                      <Text style={styles.featureTitle}>{item.title}</Text>
                      <Text style={styles.featureCopy}>{item.copy}</Text>
                      <View style={styles.featureFooter}>
                        <Text style={styles.featureMeta}>{item.cta}</Text>
                        <FontAwesome name="long-arrow-right" size={16} color={customerTheme.text} />
                      </View>
                    </View>
                  )}
                </TouchableOpacity>
              );
            }}
          />
        </View>
        <View style={styles.spotlightDots}>
          {spotlightSlides.map((slide, index) => (
            <View
              key={slide.id}
              style={[styles.spotlightDot, index === activeSpotlightIndex ? styles.spotlightDotActive : null]}
            />
          ))}
        </View>
      </Animated.View>

      {deliveryLocation ? (
        <Animated.View entering={FadeInDown.delay(360).duration(500)} style={styles.sectionBlock}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>Near your delivery point</Text>
            </View>
            {nearbyRestaurants.length > 4 ? (
              <TouchableOpacity style={styles.sectionAction} onPress={() => setExpandedShelf(expandedShelf === 'nearby' ? null : 'nearby')}>
                <Text style={styles.sectionActionText}>{expandedShelf === 'nearby' ? 'Show less' : 'See all'}</Text>
                <FontAwesome name="arrow-right" size={12} color={customerTheme.text} />
              </TouchableOpacity>
            ) : null}
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.nearbyRow}>
            {nearbyVisible.map(({ restaurant, availability }) => {
              const mealPreview = getMealPreview(restaurant, search);

              return (
                <TouchableOpacity
                  key={restaurant.id}
                  style={styles.nearbyCard}
                  activeOpacity={0.92}
                  onPress={() => {
                    trackAnalyticsEvent('customer_restaurant_opened', {
                      restaurant_id: restaurant.id,
                      source: 'nearby',
                    });
                    router.push(`/home/restaurant/${restaurant.id}`);
                  }}
                >
                  <RestaurantFavoriteButton restaurantId={restaurant.id} size={13} style={styles.nearbyFavoriteButton} />
                  <Text style={styles.nearbyName} numberOfLines={1}>
                    {restaurant.name}
                  </Text>
                  <Text style={styles.nearbyMeta} numberOfLines={1}>
                    {availability.distanceKm ? `${availability.distanceKm.toFixed(1)} km away` : 'Within your zone'}
                  </Text>
                  <Text style={styles.nearbyMeta} numberOfLines={1}>
                    {restaurant.deliveryTime ?? '25-35 min'}
                  </Text>
                  {mealPreview.length > 0 ? (
                    <Text style={styles.nearbyMealPreview} numberOfLines={2}>
                      Meals: {mealPreview.join(' / ')}
                    </Text>
                  ) : null}
                  {getRestaurantOperatingHoursLabel(restaurant) ? (
                    <Text style={styles.nearbyMeta} numberOfLines={1}>
                      {getRestaurantOperatingHoursLabel(restaurant)}
                    </Text>
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </Animated.View>
      ) : null}

      {availableRestaurants.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>{emptyState.title}</Text>
          <Text style={styles.emptyCopy}>{emptyState.copy}</Text>
        </View>
      ) : null}

      {unavailableRestaurants.length > 0 ? (
        <View style={styles.unavailableSection}>
          <Text style={styles.unavailableTitle}>Outside your current delivery zone</Text>
          <Text style={styles.unavailableCopy}>
            These kitchens are visible, but your current delivery point places them outside their supported range.
          </Text>
          {unavailableRestaurants.slice(0, 3).map(({ restaurant, availability }) => {
            const mealPreview = getMealPreview(restaurant, search);
            const isClosed = availability.reason === 'closed';

              return (
                <TouchableOpacity
                  key={restaurant.id}
                  style={[styles.unavailableCard, isClosed ? styles.unavailableCardClosed : null]}
                  onPress={() => {
                    trackAnalyticsEvent('customer_restaurant_opened', {
                      restaurant_id: restaurant.id,
                      source: 'unavailable',
                    });
                    router.push(`/home/restaurant/${restaurant.id}`);
                  }}
                >
                  <Image source={{ uri: restaurant.image }} style={styles.unavailableImage} />
                  <View style={styles.unavailableInfo}>
                  <View style={styles.unavailableHeader}>
                    <Text style={styles.unavailableName}>{restaurant.name}</Text>
                    <View style={[styles.unavailableBadge, isClosed ? styles.unavailableBadgeClosed : null]}>
                      <Text style={[styles.unavailableBadgeText, isClosed ? styles.unavailableBadgeTextClosed : null]}>
                        {availability.reason === 'delivery_disabled'
                          ? 'Pickup only'
                          : availability.reason === 'closed'
                            ? 'Closed'
                            : 'Out of area'}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.unavailableCuisine}>{restaurant.cuisine ?? 'Kitchen update pending'}</Text>
                  {mealPreview.length > 0 ? (
                    <Text style={styles.unavailableMealPreview} numberOfLines={2}>
                      Meals: {mealPreview.join(' • ')}
                    </Text>
                  ) : null}
                  <Text style={styles.unavailableMeta}>
                    {availability.distanceKm && availability.radiusKm
                      ? `${availability.distanceKm.toFixed(1)} km away, outside ${availability.radiusKm.toFixed(0)} km range`
                      : isClosed
                        ? 'This restaurant is published but currently closed.'
                        : 'Delivery is not available for this restaurant yet'}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: customerTheme.background,
    flex: 1,
  },
  content: {
    paddingBottom: 150,
    paddingHorizontal: 14,
    paddingTop: 12,
  },
  centered: {
    alignItems: 'center',
    backgroundColor: customerTheme.background,
    flex: 1,
    justifyContent: 'center',
  },
  homeHeader: {
    backgroundColor: customerTheme.headerBackground,
    borderColor: 'rgba(3, 184, 51, 0.18)',
    borderRadius: 24,
    borderWidth: 1,
    padding: 14,
    shadowColor: customerTheme.text,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
  },
  headerTopRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  greetingBlock: {
    flex: 1,
    alignItems: 'flex-start',
    marginRight: 12,
  },
  greetingText: {
    color: customerTheme.text,
    fontSize: 20,
    fontWeight: '800',
  },
  headerWordmark: {
    flexShrink: 0,
    fontSize: 22,
    fontStyle: 'italic',
    fontWeight: '900',
    letterSpacing: -1,
  },
  headerWordmarkGreen: {
    color: customerTheme.brandGreen,
  },
  headerWordmarkOrange: {
    color: customerTheme.brandOrange,
  },
  headerActionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  locationChip: {
    alignItems: 'center',
    backgroundColor: customerTheme.headerSurface,
    borderColor: 'rgba(3, 184, 51, 0.18)',
    borderRadius: 15,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  locationChipLabel: {
    color: customerTheme.text,
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    marginHorizontal: 10,
  },
  avatarButton: {
    alignItems: 'center',
    backgroundColor: customerTheme.brandGreen,
    borderColor: 'rgba(255, 149, 31, 0.55)',
    borderRadius: 20,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    marginLeft: 10,
    width: 40,
  },
  avatarButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
  searchShell: {
    alignItems: 'center',
    backgroundColor: customerTheme.surface,
    borderColor: 'rgba(255, 149, 31, 0.18)',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  searchInput: {
    color: customerTheme.text,
    flex: 1,
    fontSize: 15,
    height: 40,
    marginLeft: 8,
  },
  searchAction: {
    alignItems: 'center',
    borderRadius: 16,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  searchActionActive: {
    backgroundColor: customerTheme.brandGreen,
  },
  searchActionIdle: {
    backgroundColor: customerTheme.brandOrange,
    opacity: 0.72,
  },
  catalogStatusCard: {
    backgroundColor: customerTheme.warningSoft,
    borderColor: customerTheme.border,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 16,
    padding: 16,
  },
  catalogStatusHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  catalogStatusTitle: {
    color: customerTheme.text,
    fontSize: 16,
    fontWeight: '800',
  },
  catalogStatusCopy: {
    color: customerTheme.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
  },
  catalogRetryButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: customerTheme.accentStrong,
    borderRadius: 999,
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  catalogRetryButtonDisabled: {
    opacity: 0.7,
  },
  catalogRetryButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  featureSection: {
    marginTop: 12,
    zIndex: 1,
  },
  spotlightStack: {
    minHeight: 220,
    position: 'relative',
  },
  spotlightCardBack: {
    backgroundColor: 'rgba(16, 24, 40, 0.08)',
    borderRadius: 22,
    bottom: 0,
    left: 18,
    position: 'absolute',
    right: 18,
    top: 18,
  },
  spotlightCardMid: {
    backgroundColor: 'rgba(16, 24, 40, 0.12)',
    borderRadius: 22,
    bottom: 8,
    left: 10,
    position: 'absolute',
    right: 10,
    top: 10,
  },
  featureCard: {
    borderRadius: 22,
    minHeight: 210,
    overflow: 'hidden',
  },
  featureCardImage: {
    backgroundColor: customerTheme.hero,
  },
  featureCardAmber: {
    backgroundColor: customerTheme.surfaceStrong,
  },
  featureCardHero: {
    backgroundColor: customerTheme.heroSoft,
  },
  featureCardCream: {
    backgroundColor: customerTheme.surface,
  },
  featureImageBackdrop: {
    bottom: 0,
    height: '100%',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    width: '100%',
  },
  featureImageGradient: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  featureContentOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: 18,
  },
  featureTagLight: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
    opacity: 0.92,
    textTransform: 'uppercase',
  },
  featureTitleLight: {
    color: '#ffffff',
    fontSize: 21,
    fontWeight: '900',
    lineHeight: 26,
    marginTop: 8,
  },
  featureCopyLight: {
    color: 'rgba(255,255,255,0.86)',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
  },
  featureCtaPill: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: customerTheme.brandOrange,
    borderRadius: 999,
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  featureCtaPillText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  featureContent: {
    flex: 1,
    padding: 16,
  },
  featureTag: {
    color: customerTheme.accentStrong,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  featureTitle: {
    color: customerTheme.text,
    fontSize: 19,
    fontWeight: '800',
    lineHeight: 24,
    marginTop: 10,
  },
  featureCopy: {
    color: customerTheme.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
  },
  featureFooter: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 'auto',
    paddingTop: 14,
  },
  featureMeta: {
    color: customerTheme.text,
    fontSize: 13,
    fontWeight: '700',
    maxWidth: '82%',
  },
  spotlightDots: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 8,
  },
  spotlightDot: {
    backgroundColor: customerTheme.border,
    borderRadius: 999,
    height: 7,
    marginHorizontal: 4,
    width: 7,
  },
  spotlightDotActive: {
    backgroundColor: customerTheme.accentStrong,
    width: 22,
  },
  sectionBlock: {
    marginTop: 16,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: {
    color: customerTheme.text,
    fontSize: 20,
    fontWeight: '800',
  },
  sectionAction: {
    alignItems: 'center',
    backgroundColor: customerTheme.surface,
    borderRadius: 999,
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  sectionActionText: {
    color: customerTheme.text,
    fontSize: 11,
    fontWeight: '700',
    marginRight: 6,
  },
  topRatedRow: {
    paddingRight: 10,
  },
  topRatedCard: {
    backgroundColor: customerTheme.surface,
    borderRadius: 18,
    marginRight: 12,
    overflow: 'hidden',
    width: 236,
  },
  topRatedImage: {
    height: 132,
    width: '100%',
  },
  topRatedImageFallback: {
    alignItems: 'center',
    backgroundColor: customerTheme.surfaceStrong,
    height: 132,
    justifyContent: 'center',
    width: '100%',
  },
  topRatedImageFallbackText: {
    color: customerTheme.accentStrong,
    fontSize: 34,
    fontWeight: '800',
  },
  topRatedFavoriteButton: {
    position: 'absolute',
    right: 10,
    top: 10,
  },
  topRatedInfo: {
    padding: 12,
  },
  topRatedLogoBadge: {
    left: 12,
    position: 'absolute',
    top: 108,
  },
  topRatedName: {
    color: customerTheme.text,
    fontSize: 16,
    fontWeight: '800',
  },
  topRatedMeta: {
    color: customerTheme.textMuted,
    fontSize: 12,
    marginTop: 4,
  },
  topRatedHours: {
    color: customerTheme.textSoft,
    fontSize: 11,
    marginTop: 6,
  },
  topRatedFacts: {
    flexDirection: 'row',
    marginTop: 8,
  },
  topRatedFact: {
    color: customerTheme.accentStrong,
    fontSize: 11,
    fontWeight: '700',
    marginRight: 10,
  },
  suggestedCard: {
    backgroundColor: customerTheme.surface,
    borderRadius: 18,
    flexDirection: 'row',
    marginBottom: 12,
    overflow: 'hidden',
  },
  suggestedImage: {
    height: 118,
    width: 106,
  },
  suggestedImageFallback: {
    alignItems: 'center',
    backgroundColor: customerTheme.surfaceStrong,
    height: 118,
    justifyContent: 'center',
    width: 106,
  },
  suggestedImageFallbackText: {
    color: customerTheme.accentStrong,
    fontSize: 30,
    fontWeight: '800',
  },
  suggestedFavoriteButton: {
    backgroundColor: customerTheme.surfaceMuted,
    height: 34,
    width: 34,
  },
  suggestedInfo: {
    flex: 1,
    padding: 12,
  },
  suggestedLogoBadge: {
    left: 84,
    position: 'absolute',
    top: 72,
  },
  suggestedTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  suggestedName: {
    color: customerTheme.text,
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
    marginRight: 10,
  },
  availabilityBadge: {
    backgroundColor: customerTheme.accentTint,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  availabilityBadgeText: {
    color: customerTheme.accentStrong,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  suggestedCuisine: {
    color: customerTheme.textMuted,
    fontSize: 12,
    marginTop: 6,
  },
  suggestedAddress: {
    color: customerTheme.textSoft,
    fontSize: 12,
    marginTop: 4,
  },
  suggestedHours: {
    color: customerTheme.textSoft,
    fontSize: 11,
    marginTop: 6,
  },
  suggestedFacts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 10,
  },
  suggestedFact: {
    color: customerTheme.accentStrong,
    fontSize: 11,
    fontWeight: '700',
    marginRight: 10,
    marginTop: 4,
  },
  nearbyRow: {
    paddingRight: 12,
  },
  nearbyCard: {
    backgroundColor: customerTheme.surface,
    borderRadius: 16,
    marginRight: 10,
    minHeight: 126,
    padding: 14,
    width: 158,
  },
  nearbyFavoriteButton: {
    alignSelf: 'flex-end',
    backgroundColor: customerTheme.surfaceMuted,
    height: 30,
    marginBottom: 4,
    width: 30,
  },
  nearbyName: {
    color: customerTheme.text,
    fontSize: 15,
    fontWeight: '800',
  },
  nearbyMeta: {
    color: customerTheme.textMuted,
    fontSize: 12,
    marginTop: 6,
  },
  nearbyMealPreview: {
    color: customerTheme.text,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
    marginTop: 8,
  },
  emptyState: {
    alignItems: 'center',
    backgroundColor: customerTheme.surface,
    borderRadius: 18,
    marginTop: 10,
    padding: 20,
  },
  emptyTitle: {
    color: customerTheme.text,
    fontSize: 16,
    fontWeight: '800',
  },
  emptyCopy: {
    color: customerTheme.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 8,
    textAlign: 'center',
  },
  unavailableSection: {
    marginTop: 20,
  },
  unavailableTitle: {
    color: customerTheme.text,
    fontSize: 18,
    fontWeight: '800',
  },
  unavailableCopy: {
    color: customerTheme.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
    marginTop: 6,
  },
  unavailableCard: {
    backgroundColor: customerTheme.dangerSoft,
    borderColor: '#ebc0b7',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 132,
    marginBottom: 12,
    width: '100%',
    overflow: 'hidden',
  },
  unavailableCardClosed: {
    backgroundColor: '#fdecec',
    borderColor: '#ef4444',
  },
  unavailableImage: {
    height: 132,
    width: 112,
  },
  unavailableInfo: {
    flex: 1,
    padding: 14,
  },
  unavailableHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  unavailableName: {
    color: customerTheme.text,
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
    marginRight: 10,
  },
  unavailableBadge: {
    backgroundColor: '#f7d1ca',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  unavailableBadgeClosed: {
    backgroundColor: '#fee2e2',
  },
  unavailableBadgeText: {
    color: '#9a312c',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  unavailableBadgeTextClosed: {
    color: '#b91c1c',
  },
  unavailableCuisine: {
    color: customerTheme.textSoft,
    fontSize: 12,
    marginTop: 6,
  },
  unavailableMealPreview: {
    color: customerTheme.text,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
    marginTop: 8,
  },
  unavailableMeta: {
    color: '#9a312c',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 6,
  },
});
