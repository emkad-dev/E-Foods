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
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../../src/contexts/AuthContext';
import { useCart } from '../../../src/contexts/CartContext';
import RestaurantFavoriteButton from '../../../src/components/RestaurantFavoriteButton';
import RestaurantLogoBadge from '../../../src/components/RestaurantLogoBadge';
import { getPublishedRestaurants } from '../../../src/services/publicRestaurantReadModel';
import {
  type DiscoveryRestaurant,
  getDiscoveryEmptyState,
  getRestaurantAvailability,
  getRestaurantOperatingHoursLabel,
  isRestaurantVisibleToCustomers,
  matchesRestaurantQuery,
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

type CategoryId = 'all' | 'rice' | 'swallow' | 'snacks' | 'drinks';

const CATEGORY_OPTIONS: { icon: React.ComponentProps<typeof FontAwesome>['name']; id: CategoryId; label: string }[] = [
  { icon: 'cutlery', id: 'all', label: 'All' },
  { icon: 'leaf', id: 'rice', label: 'Rice' },
  { icon: 'spoon', id: 'swallow', label: 'Swallow' },
  { icon: 'coffee', id: 'snacks', label: 'Snacks' },
  { icon: 'glass', id: 'drinks', label: 'Drinks' },
];

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

const normalizeMenuCategoryId = (value: string | undefined | null) =>
  value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') ?? '';

const CATEGORY_MATCHES: Record<Exclude<CategoryId, 'all'>, string[]> = {
  drinks: ['drinks'],
  rice: ['rice'],
  snacks: ['snacks', 'proteins'],
  swallow: ['swallow', 'soups'],
};

const matchesCategory = (restaurant: Restaurant, categoryId: CategoryId) => {
  if (categoryId === 'all') {
    return true;
  }

  const acceptedCategoryIds = CATEGORY_MATCHES[categoryId];

  return (
    restaurant.menu?.some((menuCategory) => {
      const categoryFallback = normalizeMenuCategoryId(menuCategory.category);

      return menuCategory.items.some((item) => {
        if (item.isAvailable === false) {
          return false;
        }

        const itemCategoryId =
          normalizeMenuCategoryId(item.categoryId ?? item.categoryLabel) || categoryFallback;
        return acceptedCategoryIds.includes(itemCategoryId);
      });
    }) ?? false
  );
};

const toShelfEntries = (entries: DiscoveryEntry[], limit?: number) => (limit ? entries.slice(0, limit) : entries);

export default function HomeScreen() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshingCatalog, setRefreshingCatalog] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<CategoryId>('all');
  const [expandedShelf, setExpandedShelf] = useState<'nearby' | 'suggested' | 'topRated' | null>(null);
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
        return true;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'The restaurant service is unavailable right now. Please try again.';
        setCatalogError(message);
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
      .filter((restaurant) => matchesCategory(restaurant, selectedCategory))
      .map((restaurant) => ({
        restaurant,
        availability: getRestaurantAvailability(restaurant, deliveryLocation),
      }));
  }, [deliveryLocation, restaurants, search, selectedCategory]);

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

  const suggestedRestaurants = useMemo(() => {
    const topRatedIds = new Set(topRatedRestaurants.slice(0, 4).map((entry) => entry.restaurant.id));
    const remaining = availableRestaurants.filter((entry) => !topRatedIds.has(entry.restaurant.id));
    return remaining.length > 0 ? remaining : availableRestaurants;
  }, [availableRestaurants, topRatedRestaurants]);

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
          cta: spotlight ? 'Open restaurant' : 'See promotions',
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

  const topRatedVisible = toShelfEntries(topRatedRestaurants, expandedShelf === 'topRated' ? undefined : 4);
  const nearbyVisible = toShelfEntries(nearbyRestaurants, expandedShelf === 'nearby' ? undefined : 4);
  const suggestedVisible = toShelfEntries(suggestedRestaurants, expandedShelf === 'suggested' ? undefined : 5);

  const emptyState = getDiscoveryEmptyState({
    availableCount: availableRestaurants.length,
    matchedCount: discoveryResults.length,
    query: search,
    unavailableCount: unavailableRestaurants.length,
    deliveryLocation,
  });

  const handleSearchSubmit = () => {
    setSearch((currentSearch) => currentSearch.trim());
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

      <Animated.View entering={FadeInDown.delay(200).duration(500)} style={styles.categorySection}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
          {CATEGORY_OPTIONS.map((category) => {
            const active = category.id === selectedCategory;
            return (
              <TouchableOpacity
                key={category.id}
                style={[styles.categoryCard, active ? styles.categoryCardActive : null]}
                onPress={() => setSelectedCategory(category.id)}
              >
                <View style={[styles.categoryIconWrap, active ? styles.categoryIconWrapActive : null]}>
                  <FontAwesome name={category.icon} size={16} color={active ? '#ffffff' : customerTheme.accentStrong} />
                </View>
                <Text style={active ? styles.categoryTextActive : styles.categoryText}>{category.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </Animated.View>

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

              return (
                <TouchableOpacity
                  activeOpacity={0.92}
                  style={[styles.featureCard, accentStyle, { width: spotlightWidth }]}
                  onPress={() => {
                    if (item.restaurantId) {
                      router.push(`/home/restaurant/${item.restaurantId}`);
                      return;
                    }

                    router.push('/promotions');
                  }}
                >
                  {item.image ? <Image source={{ uri: item.image }} style={styles.featureImage} /> : null}
                  <View style={styles.featureContent}>
                    <Text style={styles.featureTag}>{item.meta}</Text>
                    <Text style={styles.featureTitle}>{item.title}</Text>
                    <Text style={styles.featureCopy}>{item.copy}</Text>
                    <View style={styles.featureFooter}>
                      <Text style={styles.featureMeta}>{item.cta}</Text>
                      <FontAwesome name="long-arrow-right" size={16} color={customerTheme.text} />
                    </View>
                  </View>
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

      <Animated.View entering={FadeInDown.delay(280).duration(500)} style={styles.sectionBlock}>
        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.sectionTitle}>Top rated bukas</Text>
          </View>
          {topRatedRestaurants.length > 4 ? (
            <TouchableOpacity style={styles.sectionAction} onPress={() => setExpandedShelf(expandedShelf === 'topRated' ? null : 'topRated')}>
              <Text style={styles.sectionActionText}>{expandedShelf === 'topRated' ? 'Show less' : 'See all'}</Text>
              <FontAwesome name="arrow-right" size={12} color={customerTheme.text} />
            </TouchableOpacity>
          ) : null}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.topRatedRow}>
          {topRatedVisible.map(({ restaurant, availability }) => (
            <TouchableOpacity
              key={restaurant.id}
              style={styles.topRatedCard}
              activeOpacity={0.92}
              onPress={() => router.push(`/home/restaurant/${restaurant.id}`)}
            >
              {restaurant.image ? (
                <Image source={{ uri: restaurant.image }} style={styles.topRatedImage} />
              ) : (
                <View style={styles.topRatedImageFallback}>
                  <Text style={styles.topRatedImageFallbackText}>{restaurant.name.slice(0, 1).toUpperCase()}</Text>
                </View>
              )}
              <RestaurantLogoBadge
                logoImage={restaurant.logoImage}
                name={restaurant.name}
                size={42}
                style={styles.topRatedLogoBadge}
              />
              <RestaurantFavoriteButton
                restaurantId={restaurant.id}
                size={15}
                style={styles.topRatedFavoriteButton}
              />
              <View style={styles.topRatedInfo}>
                <Text style={styles.topRatedName} numberOfLines={1}>
                  {restaurant.name}
                </Text>
                <Text style={styles.topRatedMeta} numberOfLines={1}>
                  {restaurant.address ?? 'Local kitchen'}
                </Text>
                {getRestaurantOperatingHoursLabel(restaurant) ? (
                  <Text style={styles.topRatedHours} numberOfLines={1}>
                    Hours {getRestaurantOperatingHoursLabel(restaurant)}
                  </Text>
                ) : null}
                <View style={styles.topRatedFacts}>
                  <Text style={styles.topRatedFact}>Rated {restaurant.rating ?? 4.2}</Text>
                  <Text style={styles.topRatedFact}>
                    {availability.distanceKm ? `${availability.distanceKm.toFixed(1)} km` : restaurant.deliveryTime ?? '25-35 min'}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(320).duration(500)} style={styles.sectionBlock}>
        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.sectionTitle}>Suggested bukas</Text>
          </View>
          {suggestedRestaurants.length > 5 ? (
            <TouchableOpacity style={styles.sectionAction} onPress={() => setExpandedShelf(expandedShelf === 'suggested' ? null : 'suggested')}>
              <Text style={styles.sectionActionText}>{expandedShelf === 'suggested' ? 'Show less' : 'See all'}</Text>
              <FontAwesome name="arrow-right" size={12} color={customerTheme.text} />
            </TouchableOpacity>
          ) : null}
        </View>

        {suggestedVisible.map(({ restaurant, availability }, index) => (
          <Animated.View key={restaurant.id} entering={FadeInDown.delay(360 + index * 70).duration(420)}>
            <TouchableOpacity style={styles.suggestedCard} activeOpacity={0.92} onPress={() => router.push(`/home/restaurant/${restaurant.id}`)}>
              {restaurant.image ? (
                <Image source={{ uri: restaurant.image }} style={styles.suggestedImage} />
              ) : (
                <View style={styles.suggestedImageFallback}>
                  <Text style={styles.suggestedImageFallbackText}>{restaurant.name.slice(0, 1).toUpperCase()}</Text>
                </View>
              )}
              <RestaurantLogoBadge
                logoImage={restaurant.logoImage}
                name={restaurant.name}
                size={38}
                style={styles.suggestedLogoBadge}
              />
              <View style={styles.suggestedInfo}>
                <View style={styles.suggestedTitleRow}>
                  <Text style={styles.suggestedName} numberOfLines={1}>
                    {restaurant.name}
                  </Text>
                  <RestaurantFavoriteButton restaurantId={restaurant.id} size={14} style={styles.suggestedFavoriteButton} />
                </View>
                <Text style={styles.suggestedCuisine} numberOfLines={1}>
                  {restaurant.cuisine ?? 'Cuisine coming soon'}
                </Text>
                <Text style={styles.suggestedAddress} numberOfLines={1}>
                  {restaurant.address ?? deliveryLocation?.shortAddress ?? 'Area details coming soon'}
                </Text>
                {getRestaurantOperatingHoursLabel(restaurant) ? (
                  <Text style={styles.suggestedHours} numberOfLines={1}>
                    Hours {getRestaurantOperatingHoursLabel(restaurant)}
                  </Text>
                ) : null}
                <View style={styles.suggestedFacts}>
                  <Text style={styles.suggestedFact}>
                    {restaurant.rating ? `Rated ${restaurant.rating}` : 'New listing'}
                  </Text>
                  <Text style={styles.suggestedFact}>ETA {restaurant.deliveryTime ?? '25-35 min'}</Text>
                  <Text style={styles.suggestedFact}>
                    {availability.distanceKm ? `${availability.distanceKm.toFixed(1)} km away` : 'Nearby kitchen'}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
          </Animated.View>
        ))}
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
            {nearbyVisible.map(({ restaurant, availability }) => (
              <TouchableOpacity
                key={restaurant.id}
                style={styles.nearbyCard}
                activeOpacity={0.92}
                onPress={() => router.push(`/home/restaurant/${restaurant.id}`)}
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
                {getRestaurantOperatingHoursLabel(restaurant) ? (
                  <Text style={styles.nearbyMeta} numberOfLines={1}>
                    {getRestaurantOperatingHoursLabel(restaurant)}
                  </Text>
                ) : null}
              </TouchableOpacity>
            ))}
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
          {unavailableRestaurants.slice(0, 3).map(({ restaurant, availability }) => (
            <TouchableOpacity
              key={restaurant.id}
              style={styles.unavailableCard}
              onPress={() => router.push(`/home/restaurant/${restaurant.id}`)}
            >
              <Image source={{ uri: restaurant.image }} style={styles.unavailableImage} />
              <View style={styles.unavailableInfo}>
                <View style={styles.unavailableHeader}>
                  <Text style={styles.unavailableName}>{restaurant.name}</Text>
                  <View style={styles.unavailableBadge}>
                    <Text style={styles.unavailableBadgeText}>
                      {availability.reason === 'delivery_disabled'
                        ? 'Pickup only'
                        : availability.reason === 'closed'
                          ? 'Closed'
                          : 'Out of area'}
                    </Text>
                  </View>
                </View>
                <Text style={styles.unavailableCuisine}>{restaurant.cuisine ?? 'Kitchen update pending'}</Text>
                <Text style={styles.unavailableMeta}>
                  {availability.distanceKm && availability.radiusKm
                    ? `${availability.distanceKm.toFixed(1)} km away, outside ${availability.radiusKm.toFixed(0)} km range`
                    : 'Delivery is not available for this restaurant yet'}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
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
  categorySection: {
    marginTop: 14,
    marginBottom: 6,
    position: 'relative',
    zIndex: 3,
  },
  categoryRow: {
    paddingRight: 12,
  },
  categoryCard: {
    alignItems: 'center',
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
    borderRadius: 18,
    borderWidth: 1,
    marginRight: 10,
    minWidth: 78,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  categoryCardActive: {
    backgroundColor: customerTheme.accentStrong,
    borderColor: customerTheme.accentStrong,
  },
  categoryIconWrap: {
    alignItems: 'center',
    backgroundColor: customerTheme.accentTint,
    borderRadius: 14,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  categoryIconWrapActive: {
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  categoryText: {
    color: customerTheme.text,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 8,
  },
  categoryTextActive: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 8,
  },
  featureSection: {
    marginTop: 22,
    zIndex: 1,
  },
  spotlightStack: {
    minHeight: 198,
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
    minHeight: 186,
    overflow: 'hidden',
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
  featureImage: {
    height: 88,
    width: '100%',
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
    marginTop: 10,
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
    marginTop: 20,
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
    minHeight: 96,
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
    marginBottom: 12,
    overflow: 'hidden',
  },
  unavailableImage: {
    height: 100,
    width: 100,
  },
  unavailableInfo: {
    flex: 1,
    padding: 12,
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
  unavailableBadgeText: {
    color: '#9a312c',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  unavailableCuisine: {
    color: customerTheme.textSoft,
    fontSize: 12,
    marginTop: 6,
  },
  unavailableMeta: {
    color: '#9a312c',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 6,
  },
});
