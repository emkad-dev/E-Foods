import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, { FadeIn, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import { useCart } from '../../../../src/contexts/CartContext';
import { db } from '../../../../src/services/firebase/config';

type MenuItem = {
  id: string;
  name: string;
  description: string;
  price: number;
  image?: string;
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
  const { addItem, items, restaurantId: cartRestaurantId } = useCart();
  const router = useRouter();

  const [cartButtonScale, setCartButtonScale] = useState(1);
  const cartButtonStyle = useAnimatedStyle(() => ({
    transform: [{ scale: withSpring(cartButtonScale) }],
  }));

  useEffect(() => {
    const fetchRestaurant = async () => {
      try {
        const docRef = doc(db, 'restaurants', id as string);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          setRestaurant(data);
          setMenu(data.menu || []);
        }
      } catch (error) {
        console.error('Error fetching restaurant:', error);
        Alert.alert('Error', 'Could not load restaurant details');
      } finally {
        setLoading(false);
      }
    };

    void fetchRestaurant();
  }, [id]);

  const handleAddToCart = (item: MenuItem) => {
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

  return (
    <FlatList
      ListHeaderComponent={
        <View>
          <Image source={{ uri: restaurant?.image }} style={styles.restaurantImage} />
          <View style={styles.headerInfo}>
            <Text style={styles.name}>{restaurant?.name}</Text>
            <Text style={styles.cuisine}>{restaurant?.cuisine}</Text>
            <View style={styles.details}>
              <Text style={styles.rating}>Rating {restaurant?.rating}</Text>
              <Text style={styles.time}>ETA {restaurant?.deliveryTime}</Text>
            </View>
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
                <Text style={styles.itemDesc}>{menuItem.description}</Text>
                <Text style={styles.itemPrice}>${menuItem.price.toFixed(2)}</Text>
              </View>
              <TouchableOpacity
                style={[styles.addButton, { backgroundColor: '#f5b342' }]}
                onPress={() => handleAddToCart(menuItem)}
              >
                <Text style={styles.addButtonText}>+</Text>
              </TouchableOpacity>
            </Animated.View>
          ))}
        </View>
      )}
      contentContainerStyle={styles.container}
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
  headerInfo: { padding: 16, backgroundColor: '#fff' },
  name: { fontSize: 24, fontWeight: 'bold', color: '#333' },
  cuisine: { fontSize: 16, color: '#666', marginTop: 4 },
  details: { flexDirection: 'row', marginTop: 8 },
  rating: { fontSize: 14, color: '#f5b342', marginRight: 16 },
  time: { fontSize: 14, color: '#666' },
  categoryContainer: { marginTop: 16, paddingHorizontal: 16 },
  categoryTitle: { fontSize: 20, fontWeight: 'bold', color: '#333', marginBottom: 12 },
  menuItem: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 8, padding: 12, marginBottom: 8, elevation: 2 },
  itemInfo: { flex: 1 },
  itemName: { fontSize: 16, fontWeight: '600', color: '#333' },
  itemDesc: { fontSize: 14, color: '#666', marginTop: 2 },
  itemPrice: { fontSize: 16, fontWeight: 'bold', color: '#f5b342', marginTop: 4 },
  addButton: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginLeft: 8 },
  addButtonText: { fontSize: 24, color: '#fff', fontWeight: 'bold' },
  cartFooter: { backgroundColor: '#5D3FD3', padding: 16, marginTop: 20 },
  viewCartButton: { alignItems: 'center' },
  viewCartText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
});
