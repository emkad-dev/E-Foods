import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Image, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../../src/services/firebase/config';

type Restaurant = {
  id: string;
  name: string;
  image: string;
  cuisine: string;
  deliveryTime: string;
};

export default function SearchScreen() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const loadRestaurants = async () => {
      try {
        const snapshot = await getDocs(collection(db, 'restaurants'));
        const results = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Restaurant));
        setRestaurants(results);
      } catch (error) {
        console.error('Error loading restaurants for search:', error);
      } finally {
        setLoading(false);
      }
    };

    void loadRestaurants();
  }, []);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredRestaurants = restaurants.filter((restaurant) => {
    if (!normalizedQuery) return true;

    return (
      restaurant.name.toLowerCase().includes(normalizedQuery) ||
      restaurant.cuisine.toLowerCase().includes(normalizedQuery)
    );
  });

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#f5b342" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.input}
        placeholder="Search by restaurant or cuisine"
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
      />
      <FlatList
        data={filteredRestaurants}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Text style={styles.emptyText}>No restaurants matched your search.</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => router.push(`/home/restaurant/${item.id}`)}>
            <Image source={{ uri: item.image }} style={styles.image} />
            <View style={styles.copy}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.meta}>{item.cuisine}</Text>
              <Text style={styles.meta}>ETA {item.deliveryTime}</Text>
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
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    height: 48,
    marginBottom: 16,
    paddingHorizontal: 16,
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
  copy: {
    flex: 1,
    justifyContent: 'center',
    padding: 12,
  },
  name: {
    color: '#222',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  meta: {
    color: '#666',
    fontSize: 14,
  },
  emptyText: {
    color: '#666',
    paddingTop: 32,
    textAlign: 'center',
  },
});
