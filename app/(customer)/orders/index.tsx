import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { useAuth } from '../../../src/contexts/AuthContext';
import { db } from '../../../src/services/firebase/config';

type Order = {
  id: string;
  restaurantName: string;
  total: number;
  status: string;
  createdAt: any;
};

export default function OrdersList() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    if (!user) return;

    const ordersQuery = query(
      collection(db, 'orders'),
      where('customerId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(
      ordersQuery,
      (snapshot) => {
        const ordersList = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Order));
        setOrders(ordersList);
        setLoading(false);
      },
      (error) => {
        console.error('Error fetching orders:', error);
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [user]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#f5b342" />
      </View>
    );
  }

  if (orders.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>No orders yet</Text>
      </View>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return '#f5b342';
      case 'preparing':
        return '#5D3FD3';
      case 'ready':
        return '#00C851';
      case 'delivered':
        return '#4CAF50';
      default:
        return '#999';
    }
  };

  return (
    <FlatList
      data={orders}
      keyExtractor={(item) => item.id}
      renderItem={({ item, index }) => (
        <Animated.View entering={FadeInUp.delay(index * 100)}>
          <TouchableOpacity style={styles.orderCard} onPress={() => router.push(`/orders/${item.id}`)}>
            <View style={styles.orderHeader}>
              <Text style={styles.restaurantName}>{item.restaurantName}</Text>
              <Text style={[styles.status, { color: getStatusColor(item.status) }]}>{item.status.toUpperCase()}</Text>
            </View>
            <Text style={styles.total}>${item.total.toFixed(2)}</Text>
            <Text style={styles.date}>
              {item.createdAt?.toDate ? item.createdAt.toDate().toLocaleDateString() : 'Updating...'}
            </Text>
          </TouchableOpacity>
        </Animated.View>
      )}
      contentContainerStyle={styles.list}
    />
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { fontSize: 18, color: '#666' },
  list: { padding: 16 },
  orderCard: { backgroundColor: '#fff', borderRadius: 8, padding: 16, marginBottom: 12, elevation: 2 },
  orderHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  restaurantName: { fontSize: 16, fontWeight: 'bold' },
  status: { fontSize: 14, fontWeight: '600' },
  total: { fontSize: 18, fontWeight: 'bold', marginTop: 8, color: '#f5b342' },
  date: { fontSize: 12, color: '#999', marginTop: 4 },
});
