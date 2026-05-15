import React, { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useLocalSearchParams } from 'expo-router';
import AuthPromptCard from '../../../src/components/AuthPromptCard';
import { useAuth } from '../../../src/contexts/AuthContext';
import {
  canCustomerCancelOrder,
  formatOrderStatusLabel,
  formatPaymentMethodLabel,
  formatPaymentStatusLabel,
  getCustomerRefundPolicyLabel,
  getOrderStatusColor,
  getTrackingSteps,
  isPrepaidPaymentMethod,
  normalizeOrderStatus,
} from '../../../src/domain/orders';
import { useCustomerOrder } from '../../../src/hooks/useCustomerOrder';
import { cancelCustomerOrder, refreshCustomerPaymentStatus } from '../../../src/services/customerOrderActions';

const formatMoney = (amount: number) => `₦${amount.toFixed(2)}`;

export default function OrderTracking() {
  const { id } = useLocalSearchParams();
  const { user } = useAuth();
  const { order, loading, error } = useCustomerOrder(id as string, user?.uid ?? null);
  const [cancelling, setCancelling] = useState(false);
  const [refreshingPayment, setRefreshingPayment] = useState(false);

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
  const paymentStatus = formatPaymentStatusLabel(order.payment?.status, order.payment?.method);
  const paymentMethod = formatPaymentMethodLabel(order.payment?.method);
  const canCancel = canCustomerCancelOrder(order.status);
  const refundPolicy = getCustomerRefundPolicyLabel(order.status);
  const hasCapturedPrepaidAmount =
    isPrepaidPaymentMethod(order.payment?.method) && ['paid', 'refunded'].includes(order.payment?.status ?? '');
  const isPendingPrepaidPayment =
    isPrepaidPaymentMethod(order.payment?.method) && (order.payment?.status ?? 'pending') === 'pending';
  const refundCopy = !canCancel
    ? 'This order has moved too far along for self-service cancellation.'
    : !isPrepaidPaymentMethod(order.payment?.method)
      ? `${refundPolicy}. No charge has been captured yet for this order.`
      : !hasCapturedPrepaidAmount
        ? 'Payment confirmation is still pending, so there is no captured prepaid charge to refund yet.'
        : `${refundPolicy} will be applied to your prepaid amount if you cancel now.`;

  const handleCancelOrder = async () => {
    if (!order || cancelling) {
      return;
    }

    Alert.alert(
      'Cancel order?',
      refundCopy,
      [
        { text: 'Keep order', style: 'cancel' },
        {
          text: cancelling ? 'Cancelling...' : 'Cancel order',
          style: 'destructive',
          onPress: async () => {
            try {
              setCancelling(true);
              const result = await cancelCustomerOrder(order.id);
              const refundPercent = Math.round(result.refundRate * 100);
              Alert.alert(
                'Order cancelled',
                refundPercent > 0 ? `Your refund policy is ${refundPercent}%.` : 'No refund was due for this cancellation.'
              );
            } catch (nextError: any) {
              Alert.alert('Cancellation failed', nextError.message ?? 'We could not cancel this order right now.');
            } finally {
              setCancelling(false);
            }
          },
        },
      ]
    );
  };

  const handleRefreshPayment = async () => {
    if (!order || refreshingPayment) {
      return;
    }

    try {
      setRefreshingPayment(true);
      const result = await refreshCustomerPaymentStatus(order.id);
      Alert.alert(
        'Payment status updated',
        `Current payment state: ${formatPaymentStatusLabel(result.paymentStatus, order.payment?.method)}.`
      );
    } catch (nextError: any) {
      Alert.alert('Refresh failed', nextError.message ?? 'We could not verify this payment right now.');
    } finally {
      setRefreshingPayment(false);
    }
  };

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
        <Text style={styles.total}>Total: {formatMoney(total)}</Text>
        <Text style={styles.detailLine}>Subtotal: {formatMoney(order.pricing?.subtotal ?? total)}</Text>
        <Text style={styles.detailLine}>Delivery fee: {formatMoney(order.pricing?.deliveryFee ?? 0)}</Text>
        <Text style={styles.detailLine}>Service fee: {formatMoney(order.pricing?.serviceFee ?? 0)}</Text>
        <Text style={styles.detailLine}>Tip: {formatMoney(order.pricing?.tip ?? 0)}</Text>
        <Text style={styles.detailLine}>Payment method: {paymentMethod}</Text>
        <Text style={styles.detailLine}>Payment status: {paymentStatus}</Text>
        {order.payment?.reference ? <Text style={styles.detailLine}>Reference: {order.payment.reference}</Text> : null}
        {typeof order.payment?.refundAmount === 'number' && order.payment.refundAmount > 0 ? (
          <Text style={styles.detailLine}>Refund amount: {formatMoney(order.payment.refundAmount)}</Text>
        ) : null}
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
        {isPendingPrepaidPayment ? (
          <TouchableOpacity style={styles.refreshButton} onPress={handleRefreshPayment} disabled={refreshingPayment}>
            <Text style={styles.refreshButtonText}>
              {refreshingPayment ? 'Refreshing payment...' : 'Refresh payment status'}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.policyCard}>
        <Text style={styles.policyTitle}>Cancellation policy</Text>
        <Text style={styles.policyCopy}>{refundCopy}</Text>
        <TouchableOpacity
          style={[styles.cancelButton, !canCancel || cancelling ? styles.cancelButtonDisabled : null]}
          disabled={!canCancel || cancelling}
          onPress={handleCancelOrder}
        >
          <Text style={styles.cancelButtonText}>{cancelling ? 'Cancelling...' : 'Cancel order'}</Text>
        </TouchableOpacity>
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
  refreshButton: { marginTop: 14, backgroundColor: '#111827', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  refreshButtonText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  policyCard: { marginTop: 18, padding: 16, backgroundColor: '#fff7ed', borderRadius: 12, borderWidth: 1, borderColor: '#fed7aa' },
  policyTitle: { color: '#9a3412', fontSize: 16, fontWeight: '700' },
  policyCopy: { color: '#7c2d12', lineHeight: 21, marginTop: 8 },
  cancelButton: { marginTop: 14, backgroundColor: '#dc2626', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  cancelButtonDisabled: { backgroundColor: '#d1d5db' },
  cancelButtonText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  heartContainer: { alignItems: 'center', marginTop: 40 },
  heart: { fontSize: 32, fontWeight: '700' },
  heartText: { fontSize: 20, color: '#00C851', marginTop: 10 },
});
