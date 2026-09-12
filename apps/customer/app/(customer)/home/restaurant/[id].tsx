import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeInDown, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { FontAwesome } from '@expo/vector-icons';
import { useNotice } from '@feasty/design-system';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RESTAURANTS_REALTIME_TOPIC, subscribeToRealtimeChanges } from '../../../../../../packages/auth/src';
import type { RealtimeResourceSubscribe } from '../../../../../../packages/runtime/src';
import { useRealtimeResource } from '../../../../../../packages/runtime/src';
import { useAppStateVisibility } from '../../../../../../packages/runtime/src/useAppStateVisibility';
import RemoteImage from '../../../../src/components/RemoteImage';
import RestaurantFavoriteButton from '../../../../src/components/RestaurantFavoriteButton';
import RestaurantLogoBadge from '../../../../src/components/RestaurantLogoBadge';
import { SkeletonDetail, SkeletonScreen } from '../../../../src/components/Skeleton';
import { useCart } from '../../../../src/contexts/CartContext';
import { useCoverage } from '../../../../src/contexts/CoverageContext';
import {
  resolveDeliveryFeeAmount,
  resolveSelectedCategory,
} from '../../../../src/domain/restaurantMenuView';
import { customerTheme } from '../../../../src/theme/palette';
import { getRestaurantDetail } from '../../../../src/services/publicRestaurantReadModel';
import { supabase } from '../../../../src/services/supabase/config';
import {
  COVERAGE_COMING_SOON_COPY,
  COVERAGE_COMING_SOON_TITLE,
} from '../../../../src/utils/coverageMessaging';
import {
  type DiscoveryRestaurant,
  getRestaurantAvailability,
  getRestaurantAvailabilityBadge,
  getRestaurantOperatingHoursLabel,
  getRestaurantRatingLabel,
  isRestaurantVisibleToCustomers,
} from '../../../../src/utils/restaurantAvailability';

type MenuItem = {
  categoryId?: string;
  categoryLabel?: string;
  id: string;
  name: string;
  description?: string;
  price: number;
  image?: string;
  isAvailable?: boolean;
};

type MenuCategory = {
  category: string;
  items: MenuItem[];
};

const formatMoney = (amount: number) => `₦${amount.toFixed(2)}`;

const formatPlainNumber = (value: number | null | undefined) =>
  value === null || value === undefined ? 'Not set' : Math.round(value).toLocaleString('en-US');

export default function RestaurantDetail() {
  const { id, highlight } = useLocalSearchParams<{ id: string; highlight?: string }>();
  const highlightId = typeof highlight === 'string' && highlight ? highlight : null;
  const [restaurant, setRestaurant] = useState<DiscoveryRestaurant | null>(null);
  const [menu, setMenu] = useState<MenuCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const { addItem, deliveryLocation, items } = useCart();
  const { isCovered } = useCoverage();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const totalItemsInCart = items.reduce((sum, item) => sum + item.quantity, 0);
  // Floating rather than inline: Add lives on an arbitrary row of a long menu,
  // so an inline notice would land wherever that row happens to be. See the
  // PLACEMENT note in `Notice.tsx`. The offset clears the floating tab bar, and
  // the cart button on top of it once there is something in the cart — a notice
  // hidden behind chrome would be the same silence this replaces.
  const { notice, showNotice } = useNotice({
    placement: 'floating',
    offsetBottom: insets.bottom + 92 + (totalItemsInCart > 0 ? 76 : 0),
  });

  const [cartButtonScale, setCartButtonScale] = useState(1);
  const cartButtonStyle = useAnimatedStyle(() => ({
    transform: [{ scale: withSpring(cartButtonScale) }],
  }));

  const hasValidId = Boolean(id && typeof id === 'string');
  const isVisible = useAppStateVisibility();
  const activeRef = useRef(false);

  useEffect(() => {
    if (!hasValidId) {
      setLoading(false);
      return;
    }

    activeRef.current = true;

    return () => {
      activeRef.current = false;
    };
  }, [hasValidId, id]);

  const loadRestaurant = useCallback(async () => {
    if (!id || typeof id !== 'string') {
      return;
    }

    try {
      const { restaurant: nextRestaurant } = await getRestaurantDetail(id);

      if (!activeRef.current) {
        return;
      }

      if (!nextRestaurant || !isRestaurantVisibleToCustomers(nextRestaurant as DiscoveryRestaurant)) {
        setRestaurant(null);
        setMenu([]);
        return;
      }

      const nextMenu = (((nextRestaurant.menu as MenuCategory[] | undefined) ?? []).map((category) => ({
        category: category.category,
        items: (category.items ?? []).filter((item) => item.isAvailable !== false),
      })));

      const filteredMenu = nextMenu.filter((category) => category.items.length > 0);

      // When arriving from a meal search, open the category that holds the
      // matched item so the highlighted card is on screen immediately.
      const highlightedCategory = highlightId
        ? filteredMenu.find((category) => category.items.some((item) => item.id === highlightId))?.category ?? null
        : null;

      setRestaurant(nextRestaurant as DiscoveryRestaurant);
      setMenu(filteredMenu);
      // Re-validated against the menu that just arrived, not merely defaulted:
      // a partner renaming or emptying the open category used to leave a stale
      // selection that filtered the menu down to nothing.
      setSelectedCategory((current) =>
        resolveSelectedCategory(current, filteredMenu, highlightedCategory)
      );
    } catch (error) {
      console.error('Error fetching restaurant:', error);
      // Was Alert.alert, i.e. nothing at all on app.feasty.com.ng. This screen
      // reloads itself from Realtime, so the failure that matters is a REFETCH
      // failing while a restaurant is already on screen: the customer keeps
      // reading stale prices and an out-of-date menu with no hint anything is
      // wrong. Sticky, because there is no other signal and a glance would miss it.
      showNotice({
        tone: 'error',
        title: 'Could not refresh this restaurant',
        message: 'You may be seeing out-of-date prices or items. Check your connection and pull to refresh.',
        durationMs: null,
      });
    } finally {
      if (activeRef.current) {
        setLoading(false);
      }
    }
  }, [id, highlightId, showNotice]);

  const subscribeToRestaurant = useCallback<RealtimeResourceSubscribe>(
    (onChanged, onStatusChange) =>
      subscribeToRealtimeChanges(
        supabase,
        [RESTAURANTS_REALTIME_TOPIC],
        (payload) => {
          // The topic is global; skip refetches for other restaurants when tagged.
          const changedRestaurantId = typeof payload.restaurantId === 'string' ? payload.restaurantId : null;
          if (changedRestaurantId && id && changedRestaurantId !== id) {
            return;
          }

          onChanged();
        },
        onStatusChange
      ),
    [id]
  );

  // Realtime is the transport; the fallback poll only fires while the
  // channel is not confirmed SUBSCRIBED, and only while the app is visible.
  useRealtimeResource({
    subscribe: subscribeToRestaurant,
    load: loadRestaurant,
    isVisible,
    fallbackMs: 120000,
    enabled: hasValidId,
  });

  const handleAddToCart = (item: MenuItem) => {
    if (!isCovered) {
      // Was `Alert.alert`, i.e. nothing at all on app.feasty.com.ng: the tap
      // added no item, moved no cart badge and explained nothing, so Add read
      // as a broken button. Sticky, because this is the only explanation the
      // customer gets and it is longer than a glance.
      showNotice({
        tone: 'info',
        title: COVERAGE_COMING_SOON_TITLE,
        message: COVERAGE_COMING_SOON_COPY,
        durationMs: null,
      });
      return;
    }

    addItem(
      {
        id: item.id,
        name: item.name,
        price: item.price,
        quantity: 1,
        restaurantId: id as string,
        restaurantName: restaurant?.name ?? 'Restaurant',
      },
      id as string,
      restaurant?.name ?? 'Restaurant'
    );
    setCartButtonScale(1.25);
    setTimeout(() => setCartButtonScale(1), 180);
    showNotice({
      tone: 'success',
      title: 'Added to cart',
      message: 'Item saved. You can keep browsing or open your cart.',
    });
  };

  const visibleMenu = useMemo(() => {
    if (!selectedCategory) {
      return menu;
    }

    return menu.filter((category) => category.category === selectedCategory);
  }, [menu, selectedCategory]);

  const availability = restaurant ? getRestaurantAvailability(restaurant, deliveryLocation) : null;
  const availabilityBadge = availability ? getRestaurantAvailabilityBadge(availability) : null;
  const operatingHoursLabel = restaurant ? getRestaurantOperatingHoursLabel(restaurant) : null;
  // Parsed, not truthiness-tested: a restaurant offering FREE delivery has a
  // deliveryFee of 0, which the old `deliveryFee ? … : 'Pending'` rendered as
  // "Delivery Pending" while the cart and the server both charged nothing.
  const deliveryFeeAmount = restaurant ? resolveDeliveryFeeAmount(restaurant.deliveryFee) : null;
  const cartFooterBottom = insets.bottom + 92;
  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace('/home' as never);
  };

  if (loading) {
    return (
      <SkeletonScreen>
        <SkeletonDetail />
      </SkeletonScreen>
    );
  }

  if (!restaurant) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyTitle}>Restaurant not found</Text>
        <Text style={styles.emptyCopy}>This store is no longer available or has not been published yet.</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <FlatList
        ListHeaderComponent={
          <View>
            <View style={styles.heroShell}>
              <RemoteImage
                uri={restaurant.image}
                style={styles.restaurantImage}
                fallback={
                  <View style={styles.restaurantImageFallback}>
                    <Text style={styles.restaurantImageFallbackText}>{restaurant.name?.slice(0, 1)?.toUpperCase() ?? 'R'}</Text>
                  </View>
                }
              />

              <View style={styles.heroOverlay}>
                <TouchableOpacity style={styles.heroBackButton} onPress={handleBack}>
                  <FontAwesome name="arrow-left" size={16} color="#ffffff" />
                </TouchableOpacity>
              </View>

              <Animated.View entering={FadeInDown.delay(120).duration(500)} style={styles.summaryCard}>
                <RestaurantLogoBadge
                  logoImage={restaurant.logoImage}
                  name={restaurant.name}
                  size={56}
                  style={styles.summaryLogo}
                />
                <View style={styles.summaryHeader}>
                  <View style={styles.summaryHeaderCopy}>
                    <Text style={styles.name}>{restaurant.name}</Text>
                    <Text style={styles.cuisine}>{restaurant.cuisine ?? 'Cuisine coming soon'}</Text>
                  </View>
                  <RestaurantFavoriteButton restaurantId={restaurant.id} style={styles.summaryFavoriteButton} />
                </View>

                <View style={styles.factsRow}>
                  <Text style={styles.factPill}>{getRestaurantRatingLabel(restaurant)}</Text>
                  <Text style={styles.factPill}>ETA {restaurant.deliveryTime ?? '25-35 min'}</Text>
                  <Text
                    style={[
                      styles.factPill,
                      availabilityBadge === 'Closed' ? styles.closedBadge : null,
                      availabilityBadge === 'Closed' ? styles.closedBadgeText : null,
                    ]}
                  >
                    {restaurant.isOpen === false ? 'Closed' : availabilityBadge ?? 'Open'}
                  </Text>
                  <Text style={styles.factPill}>
                    {restaurant.supportsDelivery === true
                      ? `Delivery ${deliveryFeeAmount === null ? 'Pending' : formatMoney(deliveryFeeAmount)}`
                      : 'Delivery coming soon'}
                  </Text>
                </View>

                {restaurant.description ? <Text style={styles.description}>{restaurant.description}</Text> : null}

                <View style={styles.metaPanel}>
                  <Text style={styles.metaPanelText}>{restaurant.address ?? 'Address details coming soon'}</Text>
                  <Text style={styles.metaPanelText}>
                    Minimum order {formatPlainNumber(restaurant.minOrder)}
                  </Text>
                  {operatingHoursLabel ? (
                    <Text style={styles.metaPanelText}>Open daily {operatingHoursLabel}</Text>
                  ) : null}
                </View>

                {restaurant.supportsDelivery !== true && restaurant.supportsPickup !== false ? (
                  <Text style={styles.noticeText}>Pickup only for now — delivery is coming soon.</Text>
                ) : null}
              </Animated.View>
            </View>

            {menu.length > 0 ? (
              <Animated.View entering={FadeInDown.delay(180).duration(500)} style={styles.categorySection}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
                  {menu.map((category) => {
                    const active = selectedCategory === category.category;
                    return (
                      <TouchableOpacity
                        key={category.category}
                        style={[styles.categoryChip, active ? styles.categoryChipActive : null]}
                        onPress={() => setSelectedCategory(category.category)}
                      >
                        <Text style={active ? styles.categoryChipActiveText : styles.categoryChipText}>{category.category}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </Animated.View>
            ) : null}
          </View>
        }
        data={visibleMenu}
        keyExtractor={(item) => item.category}
        renderItem={({ item: category, index }) => (
          <Animated.View entering={FadeIn.delay(120 + index * 80).duration(350)} style={styles.categoryContainer}>
            <View style={styles.categoryHeader}>
              <Text style={styles.categoryTitle}>{category.category}</Text>
              <Text style={styles.categoryCount}>{category.items.length} meals</Text>
            </View>
            {category.items.map((menuItem) => (
              <View
                key={menuItem.id}
                style={[styles.menuItemCard, menuItem.id === highlightId ? styles.menuItemCardHighlighted : null]}
              >
                <RemoteImage
                  uri={menuItem.image}
                  style={styles.menuItemImage}
                  fallback={
                    <View style={[styles.menuItemImage, styles.menuItemImagePlaceholder]}>
                      <FontAwesome name="cutlery" size={20} color={customerTheme.textSoft} />
                    </View>
                  }
                />
                <View style={styles.menuItemInfo}>
                  {menuItem.id === highlightId ? (
                    <View style={styles.matchTag}>
                      <FontAwesome name="search" size={10} color="#ffffff" />
                      <Text style={styles.matchTagText}>Your search match</Text>
                    </View>
                  ) : null}
                  <Text style={styles.itemName}>{menuItem.name}</Text>
                  {menuItem.description ? <Text style={styles.itemDesc}>{menuItem.description}</Text> : null}
                  <Text style={styles.itemPrice}>{formatMoney(menuItem.price)}</Text>
                </View>
                <TouchableOpacity
                  style={[
                    styles.addButton,
                    restaurant.isOpen === false || !isCovered ? styles.addButtonDisabled : null,
                  ]}
                  onPress={() => handleAddToCart(menuItem)}
                  // Intentionally NOT `restaurant.isOpen === false || !isCovered` here: a
                  // disabled TouchableOpacity swallows the press entirely, so an out-of-coverage
                  // customer must still be able to tap Add and receive handleAddToCart's
                  // COVERAGE_COMING_SOON explanation, rather than hit a dead button with no
                  // feedback. The disabled STYLE reflects both conditions; `disabled` itself
                  // stays keyed only on isOpen.
                  disabled={restaurant.isOpen === false}
                >
                  <Text style={styles.addButtonText}>Add</Text>
                </TouchableOpacity>
              </View>
            ))}
          </Animated.View>
        )}
        contentContainerStyle={styles.container}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>Menu coming soon</Text>
            <Text style={styles.emptyCopy}>This restaurant has not published any available meals yet.</Text>
          </View>
        }
      />

      {totalItemsInCart > 0 ? (
        <Animated.View style={[styles.cartFooter, { bottom: cartFooterBottom }, cartButtonStyle]}>
          <TouchableOpacity style={styles.viewCartButton} onPress={() => router.push('/cart')}>
            <View>
              <Text style={styles.viewCartLabel}>Cart ready</Text>
              <Text style={styles.viewCartText}>View cart ({totalItemsInCart} items)</Text>
            </View>
            <FontAwesome name="arrow-right" size={16} color="#ffffff" />
          </TouchableOpacity>
        </Animated.View>
      ) : null}

      {notice}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: customerTheme.background,
    flex: 1,
  },
  container: {
    paddingBottom: 220,
  },
  centered: {
    alignItems: 'center',
    backgroundColor: customerTheme.background,
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  heroShell: {
    marginBottom: 12,
  },
  restaurantImage: {
    height: 248,
    width: '100%',
  },
  restaurantImageFallback: {
    alignItems: 'center',
    backgroundColor: customerTheme.surfaceStrong,
    height: 248,
    justifyContent: 'center',
    width: '100%',
  },
  restaurantImageFallbackText: {
    color: customerTheme.accentStrong,
    fontSize: 62,
    fontWeight: '800',
  },
  heroOverlay: {
    left: 18,
    position: 'absolute',
    top: 18,
  },
  heroBackButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(22,36,51,0.52)',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  summaryCard: {
    backgroundColor: customerTheme.surface,
    borderRadius: 28,
    marginHorizontal: 16,
    marginTop: -32,
    padding: 20,
    paddingTop: 34,
  },
  summaryFavoriteButton: {
    backgroundColor: customerTheme.surfaceMuted,
  },
  summaryLogo: {
    left: 20,
    position: 'absolute',
    top: -28,
  },
  summaryHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  summaryHeaderCopy: {
    flex: 1,
    marginRight: 12,
  },
  name: {
    color: customerTheme.text,
    fontSize: 28,
    fontWeight: '800',
  },
  cuisine: {
    color: customerTheme.textMuted,
    fontSize: 15,
    marginTop: 6,
  },
  availabilityBadge: {
    backgroundColor: customerTheme.accentTint,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  availabilityBadgeText: {
    color: customerTheme.accentStrong,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  closedBadge: {
    backgroundColor: customerTheme.warningSoft,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  closedBadgeText: {
    color: customerTheme.warningText,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  factsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 14,
  },
  factPill: {
    backgroundColor: customerTheme.surfaceMuted,
    borderRadius: 999,
    color: customerTheme.accentStrong,
    fontSize: 12,
    fontWeight: '700',
    marginRight: 10,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  description: {
    color: customerTheme.textMuted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 14,
  },
  metaPanel: {
    backgroundColor: customerTheme.surfaceMuted,
    borderRadius: 18,
    marginTop: 16,
    padding: 14,
  },
  metaPanelText: {
    color: customerTheme.textSoft,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 3,
  },
  noticeText: {
    color: customerTheme.warningText,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 19,
    marginTop: 14,
  },
  categorySection: {
    marginTop: 8,
  },
  categoryRow: {
    paddingHorizontal: 16,
    paddingRight: 28,
  },
  categoryChip: {
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
    borderRadius: 999,
    borderWidth: 1,
    marginRight: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  categoryChipActive: {
    backgroundColor: customerTheme.accentStrong,
    borderColor: customerTheme.accentStrong,
  },
  categoryChipText: {
    color: customerTheme.text,
    fontSize: 13,
    fontWeight: '700',
  },
  categoryChipActiveText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  categoryContainer: {
    marginTop: 18,
    paddingHorizontal: 16,
  },
  categoryHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  categoryTitle: {
    color: customerTheme.text,
    fontSize: 22,
    fontWeight: '800',
  },
  categoryCount: {
    color: customerTheme.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  menuItemCard: {
    alignItems: 'stretch',
    backgroundColor: customerTheme.surface,
    borderRadius: 20,
    flexDirection: 'row',
    marginBottom: 10,
    overflow: 'hidden',
  },
  menuItemCardHighlighted: {
    borderColor: customerTheme.accentStrong,
    borderWidth: 2,
  },
  matchTag: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: customerTheme.accentStrong,
    borderRadius: 999,
    flexDirection: 'row',
    gap: 5,
    marginBottom: 8,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  matchTagText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  menuItemImage: {
    alignSelf: 'stretch',
    backgroundColor: customerTheme.surfaceMuted,
    width: 104,
  },
  menuItemImagePlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuItemInfo: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 16,
  },
  itemName: {
    color: customerTheme.text,
    fontSize: 17,
    fontWeight: '700',
  },
  itemDesc: {
    color: customerTheme.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
  },
  itemPrice: {
    color: customerTheme.accentStrong,
    fontSize: 16,
    fontWeight: '800',
    marginTop: 10,
  },
  addButton: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: customerTheme.accentStrong,
    borderRadius: 18,
    justifyContent: 'center',
    marginRight: 10,
    minWidth: 72,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 80,
  },
  addButtonDisabled: {
    backgroundColor: '#b9b0a0',
  },
  addButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  emptyState: {
    alignItems: 'center',
    backgroundColor: customerTheme.surface,
    borderRadius: 22,
    marginHorizontal: 16,
    marginTop: 20,
    padding: 24,
  },
  emptyTitle: {
    color: customerTheme.text,
    fontSize: 18,
    fontWeight: '800',
  },
  emptyCopy: {
    color: customerTheme.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
    textAlign: 'center',
  },
  cartFooter: {
    backgroundColor: customerTheme.hero,
    borderRadius: 24,
    left: 14,
    padding: 14,
    position: 'absolute',
    right: 14,
    shadowColor: '#3b2912',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
  },
  viewCartButton: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  viewCartLabel: {
    color: customerTheme.accentSoft,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  viewCartText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 4,
  },
});
