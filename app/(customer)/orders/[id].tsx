import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useLocalSearchParams } from 'expo-router';
import AuthPromptCard from '../../../src/components/AuthPromptCard';
import { useAuth } from '../../../src/contexts/AuthContext';
import {
  formatOrderStatusLabel,
  getOrderStatusColor,
  getTrackingSteps,
  normalizeOrderStatus,
} from '../../../src/domain/orders';
import { useCustomerOrder } from '../../../src/hooks/useCustomerOrder';

export default function OrderTracking() {
  const { id } = useLocalSearchParams();
  const { user } = useAuth();
  const { order, loading, error } = useCustomerOrder(id as string, user?.uid ?? null);

  if (!user) {
    return (
      <View style={styles.promptContainer}>
        <AuthPromptCard
          title="Sign in to view order details"
          message="Order tracking becomes available as soon as you sign in."
        />
      </View>
    );
  }

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

  const fulfillmentType = order.fulfillmentType ?? 'delivery';
  const trackingSteps = getTrackingSteps(fulfillmentType);
  const normalizedStatus = normalizeOrderStatus(order.status);
  const currentStep = trackingSteps.indexOf(normalizedStatus);
  const total = order.pricing?.total ?? order.total;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <Text style={styles.title}>Order #{order.id.slice(-6)}</Text>
      <Text style={styles.restaurant}>{order.restaurantName}</Text>
      <View style={styles.badgesRow}>
        <View style={[styles.badge, { backgroundColor: '#fff5df' }]}>
          <Text style={styles.badgeText}>{fulfillmentType === 'pickup' ? 'Pickup' : 'Delivery'}</Text>
        </View>
        <View style={[styles.badge, { backgroundColor: '#eef5ff' }]}>
          <Text style={[styles.badgeText, { color: getOrderStatusColor(order.status) }]}>
            {formatOrderStatusLabel(order.status)}
          </Text>
        </View>
      </View>

      <View style={styles.progressContainer}>
        {trackingSteps.map((step, index) => (
          <Animated.View key={step} entering={FadeIn.delay(index * 200)} style={styles.stepWrapper}>
            <View style={[styles.stepCircle, { backgroundColor: index <= currentStep ? '#f5b342' : '#ddd' }]} />
            <Text style={[styles.stepLabel, { color: index <= currentStep ? '#333' : '#999' }]}>
              {formatOrderStatusLabel(step)}
            </Text>
          </Animated.View>
        ))}
      </View>

      <View style={styles.details}>
        <Text style={styles.total}>Total: ${total.toFixed(2)}</Text>
        <Text style={styles.detailLine}>
          {fulfillmentType === 'pickup'
            ? 'Pickup at the restaurant counter'
            : `Delivery address: ${order.deliveryAddress ?? order.deliveryLocation?.address ?? 'Updating...'}`}
        </Text>
        {order.deliveryLocation?.shortAddress ? (
          <Text style={styles.detailLine}>Pinned area: {order.deliveryLocation.shortAddress}</Text>
        ) : null}
        {order.deliveryLocation?.note ? (
          <Text style={styles.note}>Drop-off note: {order.deliveryLocation.note}</Text>
        ) : null}
      </View>

      {normalizedStatus === 'delivered' && (
        <Animated.View entering={FadeIn} style={styles.heartContainer}>
          <Text style={styles.heart}>Delivered</Text>
          <Text style={styles.heartText}>Enjoy your meal!</Text>
        </Animated.View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: '#fff', flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  container: { flexGrow: 1, padding: 20, backgroundColor: '#fff' },
  promptContainer: { flex: 1, justifyContent: 'center', padding: 20 },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 8 },
  restaurant: { fontSize: 18, color: '#666', marginBottom: 30 },
  badgesRow: { flexDirection: 'row', marginBottom: 18 },
  badge: { borderRadius: 999, marginRight: 10, paddingHorizontal: 12, paddingVertical: 8 },
  badgeText: { color: '#7a5b23', fontSize: 13, fontWeight: '700' },
  progressContainer: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 30, paddingHorizontal: 10 },
  stepWrapper: { alignItems: 'center' },
  stepCircle: { width: 30, height: 30, borderRadius: 15, marginBottom: 8 },
  stepLabel: { fontSize: 12, textAlign: 'center' },
  details: { marginTop: 40, padding: 16, backgroundColor: '#f8f8f8', borderRadius: 8 },
  total: { fontSize: 18, fontWeight: 'bold', marginBottom: 8, color: '#f5b342' },
  detailLine: { color: '#374151', lineHeight: 22 },
  note: { marginTop: 8 },
  heartContainer: { alignItems: 'center', marginTop: 40 },
  heart: { fontSize: 32, fontWeight: '700' },
  heartText: { fontSize: 20, color: '#00C851', marginTop: 10 },
});
