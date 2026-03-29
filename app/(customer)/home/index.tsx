import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Image, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../../src/services/firebase/config';

type Restaurant = {
  id: string;
  name: string;
  image: string;
  cuisine: string;
  rating: number;
  deliveryTime: string;
};

export default function HomeScreen() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [filtered, setFiltered] = useState<Restaurant[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const fetchRestaurants = async () => {
      try {
        const querySnapshot = await getDocs(collection(db, 'restaurants'));
        const list = querySnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Restaurant));
        setRestaurants(list);
        setFiltered(list);
      } catch (error) {
        console.error('Error fetching restaurants:', error);
      } finally {
        setLoading(false);
      }
    };

    void fetchRestaurants();
  }, []);

  useEffect(() => {
    if (search) {
      setFiltered(restaurants.filter((restaurant) => restaurant.name.toLowerCase().includes(search.toLowerCase())));
    } else {
      setFiltered(restaurants);
    }
  }, [restaurants, search]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#f5b342" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Animated.View entering={FadeInDown.delay(200).duration(600)} style={styles.searchContainer}>
        <TextInput
          style={[styles.searchInput, { borderColor: '#5D3FD3' }]}
          placeholder="Search restaurants..."
          placeholderTextColor="#999"
          value={search}
          onChangeText={setSearch}
        />
      </Animated.View>
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <Animated.View entering={FadeInDown.delay(300 + index * 100).duration(500)}>
            <TouchableOpacity style={styles.card} onPress={() => router.push(`/home/restaurant/${item.id}`)}>
              <Image source={{ uri: item.image }} style={styles.image} />
              <View style={styles.info}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.cuisine}>{item.cuisine}</Text>
                <View style={styles.details}>
                  <Text style={styles.rating}>Rating {item.rating}</Text>
                  <Text style={styles.time}>ETA {item.deliveryTime}</Text>
                </View>
              </View>
            </TouchableOpacity>
          </Animated.View>
        )}
        contentContainerStyle={styles.list}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f8f8' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  searchContainer: { padding: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#ddd' },
  searchInput: { height: 44, borderWidth: 1, borderRadius: 22, paddingHorizontal: 16, fontSize: 16, backgroundColor: '#fff' },
  list: { padding: 12 },
  card: { backgroundColor: '#fff', borderRadius: 12, marginBottom: 16, overflow: 'hidden', elevation: 3 },
  image: { width: '100%', height: 150 },
  info: { padding: 12 },
  name: { fontSize: 18, fontWeight: 'bold', color: '#333' },
  cuisine: { fontSize: 14, color: '#666', marginTop: 4 },
  details: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  rating: { fontSize: 14, color: '#f5b342' },
  time: { fontSize: 14, color: '#666' },
});
