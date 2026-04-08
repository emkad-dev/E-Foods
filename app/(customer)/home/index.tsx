import { FontAwesome } from '@expo/vector-icons';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
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
import { collection, getDocs } from 'firebase/firestore';
import { useCart } from '../../../src/contexts/CartContext';
import { db } from '../../../src/services/firebase/config';
import {
  type DiscoveryRestaurant,
  getDiscoveryEmptyState,
  getRestaurantAvailability,
  matchesRestaurantQuery,
} from '../../../src/utils/restaurantAvailability';

type Restaurant = DiscoveryRestaurant & {
  image: string;
  rating: number;
  deliveryTime: string;
};

const graphicsCardPlaceholders = [
  { id: 'graphics-1', label: 'Slot 01' },
  { id: 'graphics-2', label: 'Slot 02' },
  { id: 'graphics-3', label: 'Slot 03' },
  { id: 'graphics-4', label: 'Slot 04' },
];

const GRAPHICS_CARD_WIDTH = 190;
const GRAPHICS_CARD_GAP = 12;

export default function HomeScreen() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const graphicsScrollRef = useRef<ScrollView | null>(null);
  const graphicsScrollIndexRef = useRef(0);
  const router = useRouter();
  const { deliveryLocation } = useCart();

  useEffect(() => {
    const fetchRestaurants = async () => {
      try {
        const querySnapshot = await getDocs(collection(db, 'restaurants'));
        const list = querySnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Restaurant));
        setRestaurants(list);
      } catch (error) {
        console.error('Error fetching restaurants:', error);
      } finally {
        setLoading(false);
      }
    };

    void fetchRestaurants();
  }, []);

  const discoveryResults = useMemo(
    () =>
      restaurants
        .filter((restaurant) => matchesRestaurantQuery(restaurant, search))
        .map((restaurant) => ({
          restaurant,
          availability: getRestaurantAvailability(restaurant, deliveryLocation),
        })),
    [deliveryLocation, restaurants, search]
  );

  const availableRestaurants = discoveryResults.filter((entry) => entry.availability.isAvailable);
  const unavailableRestaurants = discoveryResults.filter((entry) => !entry.availability.isAvailable);
  const emptyState = getDiscoveryEmptyState({
    availableCount: availableRestaurants.length,
    matchedCount: discoveryResults.length,
    query: search,
    unavailableCount: unavailableRestaurants.length,
    deliveryLocation,
  });

  useEffect(() => {
    if (graphicsCardPlaceholders.length < 2) {
      return;
    }

    const interval = setInterval(() => {
      graphicsScrollIndexRef.current = (graphicsScrollIndexRef.current + 1) % graphicsCardPlaceholders.length;
      graphicsScrollRef.current?.scrollTo({
        x: graphicsScrollIndexRef.current * (GRAPHICS_CARD_WIDTH + GRAPHICS_CARD_GAP),
        animated: true,
      });
    }, 3200);

    return () => clearInterval(interval);
  }, []);

  const handleSearchSubmit = () => {
    setSearch((currentSearch) => currentSearch.trim());
    Keyboard.dismiss();
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#f5b342" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={availableRestaurants}
        keyExtractor={(item) => item.restaurant.id}
        ListHeaderComponent={
          <>
            <Animated.View entering={FadeInDown.delay(200).duration(600)} style={styles.searchContainer}>
              <View style={[styles.searchBar, { borderColor: '#5D3FD3' }]}>
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search food or cuisine"
                  placeholderTextColor="#999"
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
                  <FontAwesome name="arrow-right" size={16} color="#fff" />
                </TouchableOpacity>
              </View>
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(260).duration(600)} style={styles.graphicsSection}>
              <ScrollView
                ref={graphicsScrollRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                snapToAlignment="start"
                snapToInterval={GRAPHICS_CARD_WIDTH + GRAPHICS_CARD_GAP}
                decelerationRate="fast"
                contentContainerStyle={styles.graphicsRow}
                onMomentumScrollEnd={(event) => {
                  graphicsScrollIndexRef.current = Math.round(
                    event.nativeEvent.contentOffset.x / (GRAPHICS_CARD_WIDTH + GRAPHICS_CARD_GAP)
                  );
                }}
              >
                {graphicsCardPlaceholders.map((card, index) => (
                  <Animated.View
                    key={card.id}
                    entering={FadeInDown.delay(320 + index * 80).duration(500)}
                    style={styles.graphicsCard}
                  >
                    <Text style={styles.graphicsCardEyebrow}>Featured space</Text>
                    <Text style={styles.graphicsCardTitle}>Promo Slot</Text>
                    <Text style={styles.graphicsCardCopy}>Ready for ads, offers, or foods from the same category.</Text>
                    <View style={styles.graphicsCardFooter}>
                      <Text style={styles.graphicsCardMeta}>{card.label}</Text>
                      <Text style={styles.graphicsCardMeta}>Auto scroll</Text>
                    </View>
                  </Animated.View>
                ))}
              </ScrollView>
            </Animated.View>

            <View style={styles.restaurantHeader}>
              <Text style={styles.sectionTitle}>Restaurants</Text>
              <Text style={styles.sectionCopy}>Browse nearby kitchens and delivery times.</Text>
            </View>
          </>
        }
        renderItem={({ item, index }) => (
          <Animated.View entering={FadeInDown.delay(300 + index * 100).duration(500)}>
            <TouchableOpacity style={styles.card} onPress={() => router.push(`/home/restaurant/${item.restaurant.id}`)}>
              <Image source={{ uri: item.restaurant.image }} style={styles.image} />
              <View style={styles.info}>
                <Text style={styles.name}>{item.restaurant.name}</Text>
                <Text style={styles.cuisine}>{item.restaurant.cuisine}</Text>
                <View style={styles.details}>
                  <Text style={styles.rating}>Rating {item.restaurant.rating}</Text>
                  <Text style={styles.time}>ETA {item.restaurant.deliveryTime}</Text>
                </View>
              </View>
            </TouchableOpacity>
          </Animated.View>
        )}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>{emptyState.title}</Text>
            <Text style={styles.emptyCopy}>{emptyState.copy}</Text>
          </View>
        }
        ListFooterComponent={
          unavailableRestaurants.length > 0 ? (
            <View style={styles.unavailableSection}>
              <Text style={styles.unavailableTitle}>Not available in your area</Text>
              <Text style={styles.unavailableCopy}>
                These restaurants are outside your current delivery zone. Partner location data will help us improve this.
              </Text>
              {unavailableRestaurants.map(({ restaurant, availability }) => (
                <TouchableOpacity
                  key={restaurant.id}
                  style={styles.unavailableCard}
                  onPress={() => router.push(`/home/restaurant/${restaurant.id}`)}
                >
                  <Image source={{ uri: restaurant.image }} style={styles.unavailableImage} />
                  <View style={styles.info}>
                    <View style={styles.unavailableHeader}>
                      <Text style={styles.name}>{restaurant.name}</Text>
                      <View style={styles.unavailableBadge}>
                        <Text style={styles.unavailableBadgeText}>
                          {availability.reason === 'delivery_disabled' ? 'Pickup only' : 'Out of area'}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.cuisine}>{restaurant.cuisine}</Text>
                    <Text style={styles.unavailableMeta}>
                      {availability.distanceKm && availability.radiusKm
                        ? `${availability.distanceKm.toFixed(1)} km away, outside ${availability.radiusKm.toFixed(0)} km range`
                        : 'Delivery is not available for this restaurant yet'}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f8f8' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { padding: 12, paddingBottom: 28 },
  searchContainer: {
    backgroundColor: '#fff',
    borderRadius: 20,
    marginBottom: 20,
    padding: 16,
  },
  searchBar: {
    alignItems: 'center',
    borderRadius: 24,
    borderWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    height: 44,
    paddingHorizontal: 12,
  },
  searchAction: {
    alignItems: 'center',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  searchActionActive: {
    backgroundColor: '#2563eb',
  },
  searchActionIdle: {
    backgroundColor: '#bfd1ff',
  },
  graphicsSection: { marginBottom: 20 },
  restaurantHeader: { marginBottom: 12 },
  sectionTitle: { color: '#111827', fontSize: 22, fontWeight: '800' },
  sectionCopy: { color: '#6b7280', fontSize: 14, lineHeight: 20, marginTop: 4 },
  graphicsRow: { paddingRight: 12 },
  graphicsCard: {
    backgroundColor: '#fff8e8',
    borderColor: '#f0dbab',
    borderRadius: 18,
    borderWidth: 1,
    marginRight: 12,
    minHeight: 152,
    padding: 16,
    width: GRAPHICS_CARD_WIDTH,
  },
  graphicsCardEyebrow: {
    color: '#8a6442',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  graphicsCardTitle: { color: '#332414', fontSize: 20, fontWeight: '800' },
  graphicsCardCopy: { color: '#6f5b3e', fontSize: 14, lineHeight: 20, marginTop: 8 },
  graphicsCardFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 'auto', paddingTop: 18 },
  graphicsCardMeta: { color: '#8a6442', fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  card: { backgroundColor: '#fff', borderRadius: 12, marginBottom: 16, overflow: 'hidden', elevation: 3 },
  image: { width: '100%', height: 150 },
  info: { padding: 12 },
  name: { fontSize: 18, fontWeight: 'bold', color: '#333' },
  cuisine: { fontSize: 14, color: '#666', marginTop: 4 },
  details: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  rating: { fontSize: 14, color: '#f5b342' },
  time: { fontSize: 14, color: '#666' },
  emptyState: { alignItems: 'center', backgroundColor: '#fff', borderRadius: 18, padding: 24 },
  emptyTitle: { color: '#111827', fontSize: 18, fontWeight: '700' },
  emptyCopy: { color: '#6b7280', fontSize: 14, lineHeight: 20, marginTop: 8, textAlign: 'center' },
  unavailableSection: {
    marginTop: 8,
  },
  unavailableTitle: {
    color: '#111827',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 6,
  },
  unavailableCopy: {
    color: '#6b7280',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 14,
  },
  unavailableCard: {
    backgroundColor: '#fff5f5',
    borderColor: '#fecaca',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 12,
    overflow: 'hidden',
  },
  unavailableImage: {
    height: 104,
    width: 110,
  },
  unavailableHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  unavailableBadge: {
    backgroundColor: '#fee2e2',
    borderRadius: 999,
    marginLeft: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  unavailableBadgeText: {
    color: '#b91c1c',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  unavailableMeta: {
    color: '#991b1b',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
  },
});
