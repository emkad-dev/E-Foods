import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useLocalSearchParams } from 'expo-router';
import { useCustomerOrder } from '../../../src/hooks/useCustomerOrder';

const statusSteps = ['pending', 'preparing', 'ready', 'delivered'];

export default function OrderTracking() {
  const { id } = useLocalSearchParams();
  const { order, loading, error } = useCustomerOrder(id as string);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#f5b342" />
      </View>
    );
  }

  if (error || !order) {
    return (
      <View style={styles.centered}>
        <Text>Order not found</Text>
      </View>
    );
  }

  const currentStep = statusSteps.indexOf(order.status);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Order #{order.id.slice(-6)}</Text>
      <Text style={styles.restaurant}>{order.restaurantName}</Text>

      <View style={styles.progressContainer}>
        {statusSteps.map((step, index) => (
          <Animated.View key={step} entering={FadeIn.delay(index * 200)} style={styles.stepWrapper}>
            <View style={[styles.stepCircle, { backgroundColor: index <= currentStep ? '#f5b342' : '#ddd' }]} />
            <Text style={[styles.stepLabel, { color: index <= currentStep ? '#333' : '#999' }]}>{step}</Text>
          </Animated.View>
        ))}
      </View>

      <View style={styles.details}>
        <Text style={styles.total}>Total: ${order.total.toFixed(2)}</Text>
        <Text>Delivery Address: {order.deliveryAddress}</Text>
      </View>

      {order.status === 'delivered' && (
        <Animated.View entering={FadeIn} style={styles.heartContainer}>
          <Text style={styles.heart}>Delivered</Text>
          <Text style={styles.heartText}>Enjoy your meal!</Text>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  container: { flex: 1, padding: 20, backgroundColor: '#fff' },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 8 },
  restaurant: { fontSize: 18, color: '#666', marginBottom: 30 },
  progressContainer: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 30, paddingHorizontal: 10 },
  stepWrapper: { alignItems: 'center' },
  stepCircle: { width: 30, height: 30, borderRadius: 15, marginBottom: 8 },
  stepLabel: { fontSize: 12, textTransform: 'capitalize' },
  details: { marginTop: 40, padding: 16, backgroundColor: '#f8f8f8', borderRadius: 8 },
  total: { fontSize: 18, fontWeight: 'bold', marginBottom: 8, color: '#f5b342' },
  heartContainer: { alignItems: 'center', marginTop: 40 },
  heart: { fontSize: 32, fontWeight: '700' },
  heartText: { fontSize: 20, color: '#00C851', marginTop: 10 },
});
