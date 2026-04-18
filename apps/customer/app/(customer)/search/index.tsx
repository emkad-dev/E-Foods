import { FontAwesome } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
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
import { useRouter } from 'expo-router';
import { collection, onSnapshot } from 'firebase/firestore';
import { useCart } from '../../../src/contexts/CartContext';
import { db } from '../../../src/services/firebase/config';
import {
  type DiscoveryRestaurant,
  getRestaurantAvailabilityBadge,
  getDiscoveryEmptyState,
  getRestaurantAvailability,
  isRestaurantVisibleToCustomers,
  matchesRestaurantQuery,
} from '../../../src/utils/restaurantAvailability';

type Restaurant = DiscoveryRestaurant & {
  image?: string;
  deliveryTime?: string;
};

export default function SearchScreen() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const { deliveryLocation } = useCart();

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'restaurants'),
      (snapshot) => {
        const results = snapshot.docs
          .map((doc) => ({ id: doc.id, ...doc.data() } as Restaurant))
          .filter((restaurant) => isRestaurantVisibleToCustomers(restaurant));
        setRestaurants(results);
        setLoading(false);
      },
      (error) => {
        console.error('Error loading restaurants for search:', error);
        setLoading(false);
      }
    );

    return unsubscribe;
  }, []);

  const discoveryResults = useMemo(
    () =>
      restaurants
        .filter((restaurant) => matchesRestaurantQuery(restaurant, query))
        .map((restaurant) => ({
          restaurant,
          availability: getRestaurantAvailability(restaurant, deliveryLocation),
        })),
    [deliveryLocation, query, restaurants]
  );
  const availableRestaurants = discoveryResults.filter((entry) => entry.availability.isAvailable);
  const unavailableRestaurants = discoveryResults.filter((entry) => !entry.availability.isAvailable);
  const emptyState = getDiscoveryEmptyState({
    availableCount: availableRestaurants.length,
    matchedCount: discoveryResults.length,
    query,
    unavailableCount: unavailableRestaurants.length,
    deliveryLocation,
  });

  const handleSearchSubmit = () => {
    setQuery((currentQuery) => currentQuery.trim());
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
      <View style={styles.searchBar}>
        <TextInput
          style={styles.input}
          placeholder="Search food or cuisine"
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          returnKeyType="search"
          enablesReturnKeyAutomatically
          onSubmitEditing={handleSearchSubmit}
        />
        <TouchableOpacity
          style={[styles.searchAction, query.trim() ? styles.searchActionActive : styles.searchActionIdle]}
          onPress={handleSearchSubmit}
          disabled={!query.trim()}
        >
          <FontAwesome name="arrow-right" size={16} color="#fff" />
        </TouchableOpacity>
      </View>
      <FlatList
        data={availableRestaurants}
        keyExtractor={(item) => item.restaurant.id}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>{emptyState.title}</Text>
            <Text style={styles.emptyText}>{emptyState.copy}</Text>
          </View>
        }
        ListFooterComponent={
          unavailableRestaurants.length > 0 ? (
            <View style={styles.unavailableSection}>
              <Text style={styles.unavailableTitle}>Not available in your area</Text>
              <Text style={styles.unavailableCopy}>
                These matches are outside your current delivery zone, so they are shown separately.
              </Text>
              {unavailableRestaurants.map(({ restaurant, availability }) => (
                <TouchableOpacity
                  key={restaurant.id}
                  style={styles.unavailableCard}
                  onPress={() => router.push(`/home/restaurant/${restaurant.id}`)}
                >
                  <Image source={{ uri: restaurant.image }} style={styles.image} />
                  <View style={styles.copy}>
                    <View style={styles.unavailableHeader}>
                      <Text style={styles.name}>{restaurant.name}</Text>
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
                    <Text style={styles.meta}>{restaurant.cuisine ?? 'Cuisine coming soon'}</Text>
                    <Text style={styles.unavailableMeta}>
                      {availability.distanceKm && availability.radiusKm
                        ? `${availability.distanceKm.toFixed(1)} km away, beyond ${availability.radiusKm.toFixed(0)} km coverage`
                        : 'Delivery is not available for this restaurant yet'}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => router.push(`/home/restaurant/${item.restaurant.id}`)}>
            {item.restaurant.image ? (
              <Image source={{ uri: item.restaurant.image }} style={styles.image} />
            ) : (
              <View style={styles.imageFallback}>
                <Text style={styles.imageFallbackText}>{item.restaurant.name.slice(0, 1).toUpperCase()}</Text>
              </View>
            )}
            <View style={styles.copy}>
              <View style={styles.nameRow}>
                <Text style={styles.name}>{item.restaurant.name}</Text>
                {getRestaurantAvailabilityBadge(item.availability) ? (
                  <View style={styles.availabilityBadge}>
                    <Text style={styles.availabilityBadgeText}>{getRestaurantAvailabilityBadge(item.availability)}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.meta}>{item.restaurant.cuisine ?? 'Cuisine coming soon'}</Text>
              <Text style={styles.meta}>ETA {item.restaurant.deliveryTime ?? '25-35 min'}</Text>
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f8f8',
    padding: 16,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    fontSize: 15,
    height: 48,
    paddingHorizontal: 14,
  },
  searchBar: {
    alignItems: 'center',
    backgroundColor: '#fff',
    borderColor: '#ddd',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 16,
    paddingHorizontal: 6,
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
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    flexDirection: 'row',
    marginBottom: 12,
    overflow: 'hidden',
  },
  image: {
    height: 96,
    width: 96,
  },
  imageFallback: {
    alignItems: 'center',
    backgroundColor: '#fdecc8',
    height: 96,
    justifyContent: 'center',
    width: 96,
  },
  imageFallbackText: {
    color: '#8a5a12',
    fontSize: 28,
    fontWeight: '800',
  },
  copy: {
    flex: 1,
    justifyContent: 'center',
    padding: 12,
  },
  nameRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  name: {
    color: '#222',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  availabilityBadge: {
    backgroundColor: '#fff3d4',
    borderRadius: 999,
    marginLeft: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  availabilityBadgeText: {
    color: '#8a5a12',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  meta: {
    color: '#666',
    fontSize: 14,
  },
  emptyText: {
    color: '#666',
    lineHeight: 20,
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 24,
  },
  emptyTitle: {
    color: '#111827',
    fontSize: 18,
    fontWeight: '700',
    paddingTop: 32,
  },
  unavailableSection: {
    marginTop: 16,
    paddingBottom: 24,
  },
  unavailableTitle: {
    color: '#111827',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  unavailableCopy: {
    color: '#6b7280',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  unavailableCard: {
    backgroundColor: '#fff5f5',
    borderColor: '#fecaca',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 12,
    overflow: 'hidden',
  },
  unavailableHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  unavailableBadge: {
    backgroundColor: '#fee2e2',
    borderRadius: 999,
    marginLeft: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  unavailableBadgeText: {
    color: '#b91c1c',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  unavailableMeta: {
    color: '#991b1b',
    fontSize: 12,
    lineHeight: 18,
  },
});
