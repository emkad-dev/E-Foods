import { FontAwesome } from '@expo/vector-icons';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RESTAURANTS_REALTIME_TOPIC, subscribeToRealtimeChanges } from '../../../../../packages/auth/src';
import type { RealtimeResourceSubscribe } from '../../../../../packages/runtime/src';
import { useRealtimeResource } from '../../../../../packages/runtime/src';
import { useAppStateVisibility } from '../../../../../packages/runtime/src/useAppStateVisibility';
import { useAuth } from '../../../src/contexts/AuthContext';
import { useCart } from '../../../src/contexts/CartContext';
import { useCoverage } from '../../../src/contexts/CoverageContext';
import DeliveryLocationChip from '../../../src/components/DeliveryLocationChip';
import RemoteImage from '../../../src/components/RemoteImage';
import RestaurantFavoriteButton from '../../../src/components/RestaurantFavoriteButton';
import { screenColumn } from '../../../src/components/ScreenColumn';
import { Skeleton, SkeletonCard, SkeletonScreen } from '../../../src/components/Skeleton';
import { getRestaurantList } from '../../../src/services/publicRestaurantReadModel';
import { supabase } from '../../../src/services/supabase/config';
import { trackAnalyticsEvent } from '../../../../../packages/observability/src/analytics';
import {
  type DiscoveryRestaurant,
  getDiscoveryEmptyState,
  getDiscoverySections,
  getRestaurantAvailability,
  getRestaurantCardStatusLabel,
  isRestaurantVisibleToCustomers,
  matchesRestaurantQuery,
} from '../../../src/utils/restaurantAvailability';
import {
  COVERAGE_COMING_SOON_COPY,
  COVERAGE_COMING_SOON_TITLE,
  COVERAGE_UNAVAILABLE_TAG,
  describeNearestKitchen,
} from '../../../src/utils/coverageMessaging';
import { customerTheme } from '../../../src/theme/palette';
import { formatDeliveryEta, formatDistanceAway } from '../../../src/utils/formatting';

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

const getCustomerName = (displayName: string | undefined, email: string | undefined) => {
  const rawValue = displayName?.trim() || email?.split('@')[0]?.trim() || 'there';
  return rawValue.charAt(0).toUpperCase() + rawValue.slice(1);
};

const toShelfEntries = (entries: DiscoveryEntry[], limit?: number) => (limit ? entries.slice(0, limit) : entries);

export default function HomeScreen() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshingCatalog, setRefreshingCatalog] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [expandedShelf, setExpandedShelf] = useState<'nearby' | null>(null);
  // Distinguishes the very first load (shows the full-screen skeleton) from
  // every later refresh driven by useRealtimeResource -- changed broadcast,
  // reconnect, foreground resume, or the disconnected-only fallback poll --
  // which should refresh quietly (mode: 'background') rather than re-flash
  // the skeleton on the highest-traffic screen in the app.
  const hasLoadedOnceRef = useRef(false);
  const isVisible = useAppStateVisibility();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { deliveryLocation } = useCart();
  const { isCovered, nearestOrderableKm } = useCoverage();

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
        // No coords passed: this screen also needs restaurants outside the
        // customer's delivery radius (the "outside your delivery zone"
        // section below), and the server's coords filter is a hard exclude,
        // not just a sort key — so this stays the default updatedAt-DESC
        // page, filtered client-side by getRestaurantAvailability instead.
        const { restaurants: catalog } = await getRestaurantList();
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

  // First call is 'initial' (full skeleton); every later call -- from
  // useRealtimeResource's changed/reconnect/foreground-resume/fallback-poll
  // triggers -- is 'background' (quiet), matching the old scheduler's
  // initial-vs-recurring split without a second, separate mount fetch.
  const refreshCatalog = useCallback(async () => {
    const mode = hasLoadedOnceRef.current ? 'background' : 'initial';
    hasLoadedOnceRef.current = true;
    await loadRestaurants(mode);
  }, [loadRestaurants]);

  const subscribeToCatalog = useCallback<RealtimeResourceSubscribe>(
    (onChanged, onStatusChange) =>
      subscribeToRealtimeChanges(supabase, [RESTAURANTS_REALTIME_TOPIC], () => onChanged(), onStatusChange),
    []
  );

  // Realtime is the transport (this screen shows every restaurant, so unlike
  // cart.tsx/restaurant/[id].tsx it doesn't filter the topic to one id); the
  // fallback poll only fires while the channel is not confirmed SUBSCRIBED,
  // and only while the app is visible.
  useRealtimeResource({
    subscribe: subscribeToCatalog,
    load: refreshCatalog,
    isVisible,
    fallbackMs: 120000,
  });

  const discoveryResults = useMemo(() => {
    return restaurants
      .filter((restaurant) => matchesRestaurantQuery(restaurant, search))
      .map((restaurant) => ({
        restaurant,
        availability: getRestaurantAvailability(restaurant, deliveryLocation),
      }));
  }, [deliveryLocation, restaurants, search]);

  const availableRestaurants = useMemo(
    () =>
      isCovered
        ? discoveryResults.filter((entry) => entry.availability.isAvailable)
        : discoveryResults,
    [discoveryResults, isCovered]
  );
  const unavailableRestaurants = useMemo(
    () => discoveryResults.filter((entry) => !entry.availability.isAvailable),
    [discoveryResults]
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

  const nearbyVisible = toShelfEntries(nearbyRestaurants, expandedShelf === 'nearby' ? undefined : 4);
  const nearestKitchenDescription = describeNearestKitchen(nearestOrderableKm);

  // One source for both gates. The shelf and the empty state are complements by
  // construction here -- previously the shelf was gated on `deliveryLocation` and
  // the empty state on `availableRestaurants.length === 0`, so a visitor with no
  // pinned address and a non-empty catalogue satisfied neither and got a blank
  // screen with no explanation.
  const { showShelf, shelfTitle, showEmptyState } = getDiscoverySections({
    availableCount: availableRestaurants.length,
    hasDeliveryLocation: Boolean(deliveryLocation),
  });

  const emptyState = getDiscoveryEmptyState({
    availableCount: availableRestaurants.length,
    matchedCount: discoveryResults.length,
    unavailableReasons: unavailableRestaurants.map((entry) => entry.availability.reason),
    query: search,
    unavailableCount: unavailableRestaurants.length,
    // In browse-only mode the banner carries the out-of-area message; passing the pinned
    // location here would repeat it inside the empty state.
    deliveryLocation: isCovered ? deliveryLocation : null,
  });

  const trimmedSearch = search.trim();

  // This screen filters CARD payloads, and a card carries no menu (see
  // supabase/functions/public-catalog/catalog.ts's toRestaurantCard), so
  // matchesRestaurantQuery above can only ever compare a restaurant's name and
  // cuisine. A dish therefore matches nothing here even when several kitchens
  // serve it — so the honest end of the road is the Search tab, which reads the
  // full catalogue meal-first. Offered wherever the name/cuisine filter comes
  // back empty on a real term.
  const canHandOffToMealSearch = trimmedSearch.length > 0 && discoveryResults.length === 0;

  // Submit used to only trim-and-track: filtering already happens on change, so
  // the button and the return key did nothing visible and the customer was left
  // pressing a control with no effect. It now performs the meal-search handoff.
  const handleSearchSubmit = () => {
    if (!trimmedSearch) {
      return;
    }

    Keyboard.dismiss();
    trackAnalyticsEvent('customer_restaurant_search_submitted', {
      query_length: trimmedSearch.length,
    });
    router.push({ pathname: '/search', params: { q: trimmedSearch } });
  };

  const handleRetryCatalog = async () => {
    await loadRestaurants('manual');
  };

  const customerName = getCustomerName(user?.displayName, user?.email);
  const greeting = `HI ${customerName.toUpperCase().slice(0, 18)}`;
  const avatarLabel = customerName.slice(0, 1).toUpperCase();

  if (loading) {
    return (
      <SkeletonScreen>
        <Skeleton width="55%" height={22} />
        <Skeleton width="35%" height={13} style={{ marginBottom: 24, marginTop: 10 }} />
        <Skeleton height={44} radius={22} style={{ marginBottom: 24 }} />
        <SkeletonCard />
        <SkeletonCard />
      </SkeletonScreen>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, screenColumn.feed, { paddingTop: Math.max(insets.top, 12) + 6 }]}
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
          <DeliveryLocationChip fill />
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
            style={[styles.searchAction, trimmedSearch ? styles.searchActionActive : styles.searchActionDisabled]}
            onPress={handleSearchSubmit}
            disabled={!trimmedSearch}
          >
            <FontAwesome name="arrow-right" size={15} color={trimmedSearch ? '#fff' : customerTheme.textMuted} />
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

      {showShelf ? (
        <Animated.View entering={FadeInDown.delay(360).duration(500)} style={styles.sectionBlock}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>{shelfTitle}</Text>
            </View>
            {nearbyRestaurants.length > 4 ? (
              <TouchableOpacity style={styles.sectionAction} onPress={() => setExpandedShelf(expandedShelf === 'nearby' ? null : 'nearby')}>
                <Text style={styles.sectionActionText}>{expandedShelf === 'nearby' ? 'Show less' : 'See all'}</Text>
                <FontAwesome name="arrow-right" size={12} color={customerTheme.text} />
              </TouchableOpacity>
            ) : null}
          </View>

          {!isCovered ? (
            <View style={styles.coverageBanner}>
              <Text style={styles.coverageBannerTitle}>{COVERAGE_COMING_SOON_TITLE}</Text>
              <Text style={styles.coverageBannerCopy}>{COVERAGE_COMING_SOON_COPY}</Text>
              {nearestKitchenDescription ? (
                <Text style={styles.coverageBannerMeta}>{nearestKitchenDescription}</Text>
              ) : null}
            </View>
          ) : null}

          {nearbyVisible.map(({ restaurant, availability }) => {
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
                <RemoteImage uri={restaurant.image} style={styles.nearbyImage} />
                <View style={styles.nearbyInfo}>
                  <View style={styles.nearbyHeader}>
                    <Text style={styles.nearbyName} numberOfLines={1}>
                      {restaurant.name}
                    </Text>
                    <RestaurantFavoriteButton restaurantId={restaurant.id} size={13} style={styles.nearbyFavoriteButton} />
                  </View>
                  <Text style={styles.nearbyCuisine} numberOfLines={1}>
                    {restaurant.cuisine ?? 'Kitchen update pending'}
                  </Text>
                  <Text style={styles.nearbyMeta} numberOfLines={1}>
                    {[
                      availability.distanceKm
                        ? formatDistanceAway(availability.distanceKm)
                        // "Within your zone" only makes sense when we actually have coverage
                        // here — in browse-only (out-of-coverage) mode this card can sit right
                        // under the "not delivering here" banner, so say nothing rather than
                        // contradict it. It equally needs a location to be inside a zone OF:
                        // getPlatformCoverage fails open to isCovered=true when nothing is
                        // pinned, so without this check every card told a visitor who had set
                        // no address that they were inside a delivery zone.
                        : isCovered && deliveryLocation
                          ? 'Within your zone'
                          : null,
                      // Nothing when the partner published no estimate: this list is
                      // already `.filter(Boolean)`ed, so an absent ETA simply drops
                      // out rather than inventing a delivery promise for a kitchen
                      // that never made one.
                      formatDeliveryEta(restaurant.deliveryTime),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                  {!isCovered ? <Text style={styles.coverageCardTag}>{COVERAGE_UNAVAILABLE_TAG}</Text> : null}
                </View>
              </TouchableOpacity>
            );
          })}
        </Animated.View>
      ) : null}

      {showEmptyState ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>{emptyState.title}</Text>
          <Text style={styles.emptyCopy}>{emptyState.copy}</Text>
          {canHandOffToMealSearch ? (
            <TouchableOpacity style={styles.emptyAction} onPress={handleSearchSubmit}>
              <Text style={styles.emptyActionText} numberOfLines={1}>
                Search meals for &quot;{trimmedSearch}&quot;
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {isCovered && unavailableRestaurants.length > 0 ? (
        <View style={styles.unavailableSection}>
          <Text style={styles.unavailableTitle}>Outside your current delivery zone</Text>
          <Text style={styles.unavailableCopy}>
            These kitchens are visible, but your current delivery point places them outside their supported range.
          </Text>
          {unavailableRestaurants.slice(0, 3).map(({ restaurant, availability }) => {
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
                  <RemoteImage uri={restaurant.image} style={styles.unavailableImage} />
                  <View style={styles.unavailableInfo}>
                  <View style={styles.unavailableHeader}>
                    <Text style={styles.unavailableName}>{restaurant.name}</Text>
                    <View style={[styles.unavailableBadge, isClosed ? styles.unavailableBadgeClosed : null]}>
                      <Text style={[styles.unavailableBadgeText, isClosed ? styles.unavailableBadgeTextClosed : null]}>
                        {/* Was a local ternary that labelled `delivery_disabled`
                            "Pickup only" — backwards. That reason is only
                            reached when supportsPickup is ALSO false (the
                            pickup_only branch above it catches the
                            delivery-off/pickup-on case), so it told a customer
                            they could collect from a kitchen that had switched
                            collection off. The shared helper is the one answer
                            all three discovery screens now give. */}
                        {getRestaurantCardStatusLabel(restaurant, availability) ?? 'Out of area'}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.unavailableCuisine}>{restaurant.cuisine ?? 'Kitchen update pending'}</Text>
                  <Text style={styles.unavailableMeta}>
                    {availability.distanceKm && availability.radiusKm
                      ? `${formatDistanceAway(availability.distanceKm)}, outside ${availability.radiusKm.toFixed(0)} km range`
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
  // A disabled control has to LOOK disabled. This was the solid brand orange at
  // 0.72 opacity, which reads as a live button, so an empty field offered a
  // press that silently did nothing.
  searchActionDisabled: {
    backgroundColor: customerTheme.surfaceMuted,
    borderColor: customerTheme.border,
    borderWidth: 1,
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
  nearbyCard: {
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 12,
    minHeight: 132,
    overflow: 'hidden',
    width: '100%',
  },
  nearbyImage: {
    height: 132,
    width: 112,
  },
  nearbyInfo: {
    flex: 1,
    padding: 14,
  },
  nearbyHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  nearbyFavoriteButton: {
    backgroundColor: customerTheme.surfaceMuted,
    height: 30,
    width: 30,
  },
  nearbyName: {
    color: customerTheme.text,
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
    marginRight: 8,
  },
  nearbyCuisine: {
    color: customerTheme.textMuted,
    fontSize: 12,
    marginTop: 4,
  },
  nearbyMeta: {
    color: customerTheme.textMuted,
    fontSize: 12,
    marginTop: 6,
  },
  coverageBanner: {
    backgroundColor: '#ffe0b2',
    borderColor: '#ef6c00',
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 14,
    padding: 14,
  },
  coverageBannerTitle: {
    color: '#7a3c00',
    fontSize: 15,
    fontWeight: '800',
  },
  coverageBannerCopy: {
    color: '#7a3c00',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6,
  },
  coverageBannerMeta: {
    color: '#7a3c00',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 8,
  },
  coverageCardTag: {
    color: '#7a3c00',
    fontSize: 11,
    fontWeight: '800',
    marginTop: 2,
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
  emptyAction: {
    backgroundColor: customerTheme.brandGreen,
    borderRadius: 14,
    marginTop: 14,
    maxWidth: '100%',
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  emptyActionText: {
    color: customerTheme.textOnBrand,
    fontSize: 14,
    fontWeight: '800',
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
  unavailableMeta: {

    color: '#9a312c',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 6,
  },
});
