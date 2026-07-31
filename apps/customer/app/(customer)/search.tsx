import { FontAwesome } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Keyboard,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCart } from '../../src/contexts/CartContext';
import RestaurantLogoBadge from '../../src/components/RestaurantLogoBadge';
import { getPublishedRestaurants } from '../../src/services/publicRestaurantReadModel';
import { trackAnalyticsEvent } from '../../../../packages/observability/src/analytics';
import {
  type DiscoveryRestaurant,
  isRestaurantVisibleToCustomers,
} from '../../src/utils/restaurantAvailability';
import {
  type MealSearchResult,
  buildMealSearchResults,
  getPopularMealCategories,
} from '../../src/utils/mealSearch';
import { customerTheme } from '../../src/theme/palette';

const formatMoney = (amount: number) => `₦${Number(amount ?? 0).toFixed(2)}`;

// Meal-first, location-aware status line. Distance is only known once the
// customer has pinned a delivery point AND the kitchen has coordinates.
const getResultStatus = (
  result: MealSearchResult,
  hasLocation: boolean
): { label: string; tone: 'ok' | 'warn' } => {
  const { availability } = result;
  const distanceLabel =
    availability.distanceKm != null ? `${availability.distanceKm.toFixed(1)} km away` : null;

  switch (availability.reason) {
    case 'available':
      if (distanceLabel) {
        return { label: distanceLabel, tone: 'ok' };
      }
      return { label: hasLocation ? 'In your delivery zone' : 'Set location to sort by distance', tone: 'ok' };
    case 'pickup_only':
      return { label: distanceLabel ? `${distanceLabel} · Pickup only` : 'Pickup only', tone: 'ok' };
    case 'out_of_area':
      return {
        label:
          availability.distanceKm != null && availability.radiusKm != null
            ? `${availability.distanceKm.toFixed(1)} km · outside ${availability.radiusKm.toFixed(0)} km range`
            : 'Outside delivery range',
        tone: 'warn',
      };
    case 'delivery_disabled':
      return { label: 'Delivery unavailable', tone: 'warn' };
    case 'closed':
      return { label: 'Closed right now', tone: 'warn' };
    default:
      return { label: 'Unavailable', tone: 'warn' };
  }
};

export default function SearchScreen() {
  const [restaurants, setRestaurants] = useState<DiscoveryRestaurant[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const submittedRef = useRef(false);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { deliveryLocation } = useCart();

  const loadRestaurants = useCallback(async () => {
    setLoading(true);
    try {
      const { restaurants: catalog } = await getPublishedRestaurants();
      setRestaurants(catalog.filter((restaurant) => isRestaurantVisibleToCustomers(restaurant)));
      setCatalogError(null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'The restaurant service is unavailable right now. Please try again.';
      setCatalogError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRestaurants();
  }, [loadRestaurants]);

  const results = useMemo(
    () => buildMealSearchResults(restaurants, query, deliveryLocation),
    [restaurants, query, deliveryLocation]
  );

  const popularCategories = useMemo(() => getPopularMealCategories(restaurants), [restaurants]);

  const trimmedQuery = query.trim();
  const hasLocation = Boolean(deliveryLocation?.latitude && deliveryLocation?.longitude);
  const locationLabel = deliveryLocation?.shortAddress ?? 'Set delivery area';

  const handleSubmit = () => {
    Keyboard.dismiss();
    if (submittedRef.current) {
      return;
    }
    submittedRef.current = true;
    trackAnalyticsEvent('customer_meal_search_submitted', {
      query_length: trimmedQuery.length,
      result_count: results.length,
    });
  };

  const handleOpenResult = (result: MealSearchResult) => {
    trackAnalyticsEvent('customer_meal_result_opened', {
      restaurant_id: result.restaurant.id,
      is_available: result.availability.isAvailable,
    });
    router.push({
      pathname: '/home/restaurant/[id]',
      params: { id: result.restaurant.id, highlight: result.itemId },
    });
  };

  const renderResult = ({ item }: { item: MealSearchResult }) => {
    const status = getResultStatus(item, hasLocation);

    return (
      <TouchableOpacity style={styles.resultCard} activeOpacity={0.9} onPress={() => handleOpenResult(item)}>
        {item.itemImage ? (
          <Image source={{ uri: item.itemImage }} style={styles.resultImage} />
        ) : (
          <View style={[styles.resultImage, styles.resultImagePlaceholder]}>
            <FontAwesome name="cutlery" size={20} color={customerTheme.textSoft} />
          </View>
        )}
        <View style={styles.resultInfo}>
          <Text style={styles.resultName} numberOfLines={1}>
            {item.itemName}
          </Text>
          <View style={styles.resultRestaurantRow}>
            <RestaurantLogoBadge
              logoImage={item.restaurant.logoImage}
              name={item.restaurant.name}
              size={18}
              style={styles.resultRestaurantBadge}
            />
            <Text style={styles.resultRestaurant} numberOfLines={1}>
              {item.restaurant.name}
            </Text>
          </View>
          <View style={styles.resultMetaRow}>
            <Text style={styles.resultPrice}>{formatMoney(item.price)}</Text>
            <Text style={styles.resultDot}>·</Text>
            <Text style={status.tone === 'warn' ? styles.resultStatusWarn : styles.resultStatusOk} numberOfLines={1}>
              {status.label}
            </Text>
          </View>
        </View>
        <FontAwesome name="angle-right" size={20} color={customerTheme.textMuted} />
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, 12) + 6 }]}>
      <Animated.View entering={FadeInDown.duration(400)} style={styles.header}>
        <Text style={styles.title}>Search meals</Text>
        <TouchableOpacity style={styles.locationChip} onPress={() => router.push('/delivery-location')}>
          <FontAwesome name="map-marker" size={14} color={customerTheme.brandGreen} />
          <Text style={styles.locationChipLabel} numberOfLines={1}>
            {locationLabel}
          </Text>
          <FontAwesome name="angle-down" size={16} color={customerTheme.brandGreen} />
        </TouchableOpacity>

        <View style={styles.searchShell}>
          <FontAwesome name="search" size={16} color={customerTheme.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Try jollof, shawarma, pepper soup…"
            placeholderTextColor={customerTheme.textMuted}
            value={query}
            onChangeText={(next) => {
              submittedRef.current = false;
              setQuery(next);
            }}
            autoFocus
            returnKeyType="search"
            onSubmitEditing={handleSubmit}
          />
          {trimmedQuery.length > 0 ? (
            <TouchableOpacity style={styles.clearButton} onPress={() => setQuery('')}>
              <FontAwesome name="times-circle" size={18} color={customerTheme.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>
      </Animated.View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={customerTheme.accentStrong} />
        </View>
      ) : catalogError ? (
        <View style={styles.centered}>
          <Text style={styles.emptyTitle}>Search is unavailable</Text>
          <Text style={styles.emptyCopy}>{catalogError}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => void loadRestaurants()}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : trimmedQuery.length === 0 ? (
        <View style={styles.promptBlock}>
          <Text style={styles.promptTitle}>What are you craving?</Text>
          <Text style={styles.promptCopy}>
            Search a dish or category and we&apos;ll show every kitchen serving it, nearest first.
          </Text>
          {popularCategories.length > 0 ? (
            <>
              <Text style={styles.promptSubheading}>Popular categories</Text>
              <View style={styles.chipRow}>
                {popularCategories.map((category) => (
                  <TouchableOpacity key={category} style={styles.categoryChip} onPress={() => setQuery(category)}>
                    <Text style={styles.categoryChipText}>{category}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          ) : null}
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.key}
          renderItem={renderResult}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            results.length > 0 ? (
              <Text style={styles.resultCountLabel}>
                {results.length} {results.length === 1 ? 'meal' : 'meals'} found
              </Text>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text style={styles.emptyTitle}>No meals found</Text>
              <Text style={styles.emptyCopy}>
                We couldn&apos;t find &quot;{trimmedQuery}&quot; on any menu yet. Try another dish or category.
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: customerTheme.background,
    flex: 1,
    paddingHorizontal: 14,
  },
  header: {
    marginBottom: 4,
  },
  title: {
    color: customerTheme.text,
    fontSize: 24,
    fontWeight: '800',
  },
  locationChip: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: customerTheme.headerSurface,
    borderColor: 'rgba(3, 184, 51, 0.18)',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    marginTop: 10,
    maxWidth: '100%',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  locationChipLabel: {
    color: customerTheme.text,
    fontSize: 12,
    fontWeight: '700',
    marginHorizontal: 8,
  },
  searchShell: {
    alignItems: 'center',
    backgroundColor: customerTheme.surface,
    borderColor: 'rgba(255, 149, 31, 0.18)',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  searchInput: {
    color: customerTheme.text,
    flex: 1,
    fontSize: 15,
    height: 42,
    marginLeft: 8,
  },
  clearButton: {
    alignItems: 'center',
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 48,
  },
  promptBlock: {
    paddingTop: 24,
  },
  promptTitle: {
    color: customerTheme.text,
    fontSize: 18,
    fontWeight: '800',
  },
  promptCopy: {
    color: customerTheme.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
  },
  promptSubheading: {
    color: customerTheme.text,
    fontSize: 13,
    fontWeight: '800',
    marginTop: 24,
    textTransform: 'uppercase',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 12,
  },
  categoryChip: {
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
    borderRadius: 999,
    borderWidth: 1,
    marginBottom: 10,
    marginRight: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  categoryChipText: {
    color: customerTheme.text,
    fontSize: 13,
    fontWeight: '700',
  },
  listContent: {
    paddingBottom: 150,
    paddingTop: 12,
  },
  resultCountLabel: {
    color: customerTheme.textMuted,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  resultCard: {
    alignItems: 'center',
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 10,
    overflow: 'hidden',
    paddingRight: 12,
  },
  resultImage: {
    height: 78,
    width: 78,
  },
  resultImagePlaceholder: {
    alignItems: 'center',
    backgroundColor: customerTheme.surfaceMuted,
    justifyContent: 'center',
  },
  resultInfo: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  resultName: {
    color: customerTheme.text,
    fontSize: 16,
    fontWeight: '800',
  },
  resultRestaurantRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginTop: 5,
  },
  resultRestaurantBadge: {
    marginRight: 6,
  },
  resultRestaurant: {
    color: customerTheme.textMuted,
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
  },
  resultMetaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginTop: 6,
  },
  resultPrice: {
    color: customerTheme.accentStrong,
    fontSize: 14,
    fontWeight: '800',
  },
  resultDot: {
    color: customerTheme.textMuted,
    fontSize: 14,
    marginHorizontal: 6,
  },
  resultStatusOk: {
    color: customerTheme.textMuted,
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
  },
  resultStatusWarn: {
    color: customerTheme.warning,
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
  },
  emptyTitle: {
    color: customerTheme.text,
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
  },
  emptyCopy: {
    color: customerTheme.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: customerTheme.accentStrong,
    borderRadius: 999,
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  retryButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
});
