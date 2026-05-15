import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, { FadeIn, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../../../src/contexts/AuthContext';
import { useCart } from '../../../../src/contexts/CartContext';
import { getPublishedRestaurantDetail } from '../../../../src/services/publicRestaurantReadModel';
import { promptForAuth } from '../../../../src/utils/authPrompt';
import {
  type DiscoveryRestaurant,
  isRestaurantVisibleToCustomers,
} from '../../../../src/utils/restaurantAvailability';

type MenuItem = {
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

export default function RestaurantDetail() {
  const { id } = useLocalSearchParams();
  const [restaurant, setRestaurant] = useState<any>(null);
  const [menu, setMenu] = useState<MenuCategory[]>([]);
  const [loading, setLoading] = useState(true);
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

        setRestaurant(nextRestaurant as DiscoveryRestaurant);
        setMenu(nextMenu.filter((category) => category.items.length > 0));
      } catch (error) {
        console.error('Error fetching restaurant:', error);
        Alert.alert('Error', 'Could not load restaurant details');
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    loadRestaurant();
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
                  restaurantName: restaurant?.name,
                },
                id as string,
                restaurant?.name
              );
              setCartButtonScale(1.3);
              setTimeout(() => setCartButtonScale(1), 200);
            },
          },
        ]
      );
    } else {
      addItem(
        {
          id: item.id,
          name: item.name,
          price: item.price,
          quantity: 1,
          restaurantId: id as string,
          restaurantName: restaurant?.name,
        },
        id as string,
        restaurant?.name
      );
      setCartButtonScale(1.3);
      setTimeout(() => setCartButtonScale(1), 200);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#f5b342" />
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
    <FlatList
      ListHeaderComponent={
        <View>
          {restaurant?.image ? (
            <Image source={{ uri: restaurant.image }} style={styles.restaurantImage} />
          ) : (
            <View style={styles.restaurantImageFallback}>
              <Text style={styles.restaurantImageFallbackText}>{restaurant?.name?.slice(0, 1)?.toUpperCase() ?? 'R'}</Text>
            </View>
          )}
          <View style={styles.headerInfo}>
            <Text style={styles.name}>{restaurant?.name}</Text>
            <Text style={styles.cuisine}>{restaurant?.cuisine ?? 'Cuisine coming soon'}</Text>
            <View style={styles.details}>
              <Text style={styles.rating}>Rating {restaurant?.rating ?? 'New'}</Text>
              <Text style={styles.time}>ETA {restaurant?.deliveryTime ?? '25-35 min'}</Text>
            </View>
            {restaurant?.description ? <Text style={styles.description}>{restaurant.description}</Text> : null}
            {restaurant?.isOpen === false ? <Text style={styles.closedNotice}>Currently closed</Text> : null}
            {restaurant?.supportsDelivery === false && restaurant?.supportsPickup !== false ? (
              <Text style={styles.pickupNotice}>Pickup only available for this restaurant</Text>
            ) : null}
          </View>
        </View>
      }
      data={menu}
      keyExtractor={(item) => item.category}
      renderItem={({ item: category }) => (
        <View style={styles.categoryContainer}>
          <Text style={styles.categoryTitle}>{category.category}</Text>
          {category.items.map((menuItem) => (
            <Animated.View key={menuItem.id} entering={FadeIn.duration(400)} style={styles.menuItem}>
              <View style={styles.itemInfo}>
                <Text style={styles.itemName}>{menuItem.name}</Text>
                {menuItem.description ? <Text style={styles.itemDesc}>{menuItem.description}</Text> : null}
                <Text style={styles.itemPrice}>₦{menuItem.price.toFixed(2)}</Text>
              </View>
              <TouchableOpacity
                style={[
                  styles.addButton,
                  { backgroundColor: restaurant?.isOpen === false ? '#d1d5db' : '#f5b342' },
                ]}
                onPress={() => handleAddToCart(menuItem)}
                disabled={restaurant?.isOpen === false}
              >
                <Text style={styles.addButtonText}>+</Text>
              </TouchableOpacity>
            </Animated.View>
          ))}
        </View>
      )}
      contentContainerStyle={styles.container}
      ListEmptyComponent={
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>Menu coming soon</Text>
          <Text style={styles.emptyCopy}>This restaurant has not published any available meals yet.</Text>
        </View>
      }
      ListFooterComponent={
        items.length > 0 ? (
          <Animated.View style={[styles.cartFooter, cartButtonStyle]}>
            <TouchableOpacity style={styles.viewCartButton} onPress={() => router.push('/cart')}>
              <Text style={styles.viewCartText}>
                View Cart ({items.reduce((sum, item) => sum + item.quantity, 0)} items)
              </Text>
            </TouchableOpacity>
          </Animated.View>
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  container: { paddingBottom: 80 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  restaurantImage: { width: '100%', height: 200 },
  restaurantImageFallback: {
    alignItems: 'center',
    backgroundColor: '#fdecc8',
    height: 200,
    justifyContent: 'center',
    width: '100%',
  },
  restaurantImageFallbackText: {
    color: '#8a5a12',
    fontSize: 56,
    fontWeight: '800',
  },
  headerInfo: { padding: 16, backgroundColor: '#fff' },
  name: { fontSize: 24, fontWeight: 'bold', color: '#333' },
  cuisine: { fontSize: 16, color: '#666', marginTop: 4 },
  details: { flexDirection: 'row', marginTop: 8 },
  rating: { fontSize: 14, color: '#f5b342', marginRight: 16 },
  time: { fontSize: 14, color: '#666' },
  description: { color: '#6b7280', fontSize: 14, lineHeight: 20, marginTop: 10 },
  closedNotice: { color: '#b45309', fontSize: 13, fontWeight: '700', marginTop: 10, textTransform: 'uppercase' },
  pickupNotice: { color: '#8a5a12', fontSize: 13, fontWeight: '700', marginTop: 10, textTransform: 'uppercase' },
  categoryContainer: { marginTop: 16, paddingHorizontal: 16 },
  categoryTitle: { fontSize: 20, fontWeight: 'bold', color: '#333', marginBottom: 12 },
  menuItem: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 8, padding: 12, marginBottom: 8, elevation: 2 },
  itemInfo: { flex: 1 },
  itemName: { fontSize: 16, fontWeight: '600', color: '#333' },
  itemDesc: { fontSize: 14, color: '#666', marginTop: 2 },
  itemPrice: { fontSize: 16, fontWeight: 'bold', color: '#f5b342', marginTop: 4 },
  addButton: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginLeft: 8 },
  addButtonText: { fontSize: 24, color: '#fff', fontWeight: 'bold' },
  emptyState: { alignItems: 'center', backgroundColor: '#fff', borderRadius: 16, marginHorizontal: 16, marginTop: 20, padding: 24 },
  emptyTitle: { color: '#111827', fontSize: 18, fontWeight: '700' },
  emptyCopy: { color: '#6b7280', fontSize: 14, lineHeight: 20, marginTop: 8, textAlign: 'center' },
  cartFooter: { backgroundColor: '#5D3FD3', padding: 16, marginTop: 20 },
  viewCartButton: { alignItems: 'center' },
  viewCartText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
});
