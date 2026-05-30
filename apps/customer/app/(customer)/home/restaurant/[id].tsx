import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeInDown, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { FontAwesome } from '@expo/vector-icons';
import RestaurantFavoriteButton from '../../../../src/components/RestaurantFavoriteButton';
import RestaurantLogoBadge from '../../../../src/components/RestaurantLogoBadge';
import { useAuth } from '../../../../src/contexts/AuthContext';
import { useCart } from '../../../../src/contexts/CartContext';
import { customerTheme } from '../../../../src/theme/palette';
import { getPublishedRestaurantDetail } from '../../../../src/services/publicRestaurantReadModel';
import { promptForAuth } from '../../../../src/utils/authPrompt';
import {
  type DiscoveryRestaurant,
  getRestaurantAvailabilityBadge,
  getRestaurantOperatingHoursLabel,
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

export default function RestaurantDetail() {
  const { id } = useLocalSearchParams();
  const [restaurant, setRestaurant] = useState<DiscoveryRestaurant | null>(null);
  const [menu, setMenu] = useState<MenuCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const { user } = useAuth();
  const { addItem, items, restaurantId: cartRestaurantId } = useCart();
  const router = useRouter();

  const [cartButtonScale, setCartButtonScale] = useState(1);
  const cartButtonStyle = useAnimatedStyle(() => ({
    transform: [{ scale: withSpring(cartButtonScale) }],
  }));

  useEffect(() => {
    if (!id || typeof id !== 'string') {
      setLoading(false);
      return;
    }

    let active = true;

    const loadRestaurant = async () => {
      try {
        const { restaurant: nextRestaurant } = await getPublishedRestaurantDetail(id);

        if (!active) {
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

        setRestaurant(nextRestaurant as DiscoveryRestaurant);
        setMenu(filteredMenu);
        setSelectedCategory((current) => (current ? current : filteredMenu.length > 0 ? filteredMenu[0].category : null));
      } catch (error) {
        console.error('Error fetching restaurant:', error);
        Alert.alert('Error', 'Could not load restaurant details');
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void loadRestaurant();
    const interval = setInterval(loadRestaurant, 30000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [id]);

  const handleAddToCart = (item: MenuItem) => {
    if (!user) {
      promptForAuth({
        title: 'Sign in to add items',
        message: 'Create an account or sign in before adding meals to your cart.',
      });
      return;
    }

    if (cartRestaurantId && cartRestaurantId !== id) {
      Alert.alert(
        'Replace cart?',
        'Your cart contains items from another restaurant. Do you want to clear it and start a new order?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Replace',
            onPress: () => {
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
            },
          },
        ]
      );
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
  };

  const visibleMenu = useMemo(() => {
    if (!selectedCategory) {
      return menu;
    }

    return menu.filter((category) => category.category === selectedCategory);
  }, [menu, selectedCategory]);

  const totalItemsInCart = items.reduce((sum, item) => sum + item.quantity, 0);
  const availabilityBadge = restaurant ? getRestaurantAvailabilityBadge({ isAvailable: true } as any) : null;
  const operatingHoursLabel = restaurant ? getRestaurantOperatingHoursLabel(restaurant) : null;
  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace('/(customer)/home');
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={customerTheme.accentStrong} />
      </View>
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
              {restaurant.image ? (
                <Image source={{ uri: restaurant.image }} style={styles.restaurantImage} />
              ) : (
                <View style={styles.restaurantImageFallback}>
                  <Text style={styles.restaurantImageFallbackText}>{restaurant.name?.slice(0, 1)?.toUpperCase() ?? 'R'}</Text>
                </View>
              )}

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
                  <Text style={styles.factPill}>{restaurant.rating ? `Rated ${restaurant.rating}` : 'New'}</Text>
                  <Text style={styles.factPill}>ETA {restaurant.deliveryTime ?? '25-35 min'}</Text>
                  <Text style={styles.factPill}>
                    {restaurant.isOpen === false ? 'Closed' : availabilityBadge ?? 'Open'}
                  </Text>
                  <Text style={styles.factPill}>
                    Delivery {restaurant.deliveryFee ? formatMoney(Number(restaurant.deliveryFee)) : 'Pending'}
                  </Text>
                </View>

                {restaurant.description ? <Text style={styles.description}>{restaurant.description}</Text> : null}

                <View style={styles.metaPanel}>
                  <Text style={styles.metaPanelText}>{restaurant.address ?? 'Address details coming soon'}</Text>
                  <Text style={styles.metaPanelText}>
                    Minimum order {restaurant.minOrder ? formatMoney(Number(restaurant.minOrder)) : 'Not set'}
                  </Text>
                  {operatingHoursLabel ? (
                    <Text style={styles.metaPanelText}>Open daily {operatingHoursLabel}</Text>
                  ) : null}
                </View>

                {restaurant.supportsDelivery === false && restaurant.supportsPickup !== false ? (
                  <Text style={styles.noticeText}>Pickup only is available for this restaurant right now.</Text>
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
              <View key={menuItem.id} style={styles.menuItemCard}>
                <View style={styles.menuItemInfo}>
                  <Text style={styles.itemName}>{menuItem.name}</Text>
                  {menuItem.description ? <Text style={styles.itemDesc}>{menuItem.description}</Text> : null}
                  <Text style={styles.itemPrice}>{formatMoney(menuItem.price)}</Text>
                </View>
                <TouchableOpacity
                  style={[styles.addButton, restaurant.isOpen === false ? styles.addButtonDisabled : null]}
                  onPress={() => handleAddToCart(menuItem)}
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
        <Animated.View style={[styles.cartFooter, cartButtonStyle]}>
          <TouchableOpacity style={styles.viewCartButton} onPress={() => router.push('/cart')}>
            <View>
              <Text style={styles.viewCartLabel}>Cart ready</Text>
              <Text style={styles.viewCartText}>View cart ({totalItemsInCart} items)</Text>
            </View>
            <FontAwesome name="arrow-right" size={16} color="#ffffff" />
          </TouchableOpacity>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: customerTheme.background,
    flex: 1,
  },
  container: {
    paddingBottom: 130,
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
    color: customerTheme.warning,
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
    color: customerTheme.warning,
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
    alignItems: 'center',
    backgroundColor: customerTheme.surface,
    borderRadius: 20,
    flexDirection: 'row',
    marginBottom: 10,
    padding: 16,
  },
  menuItemInfo: {
    flex: 1,
    paddingRight: 12,
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
    backgroundColor: customerTheme.accentStrong,
    borderRadius: 18,
    justifyContent: 'center',
    minWidth: 72,
    paddingHorizontal: 14,
    paddingVertical: 12,
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
    bottom: 20,
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
    fontWeight: '800',
    marginTop: 4,
  },
});
