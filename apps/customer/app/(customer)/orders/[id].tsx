import React, { useState } from 'react';
import { ActivityIndicator, Alert, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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
import { customerTheme } from '../../../src/theme/palette';
import { openPhoneDialer } from '../../../src/utils/phoneLinking';

const formatMoney = (amount: number) => `₦${amount.toFixed(2)}`;

const formatRelativeAge = (value?: string | null) => {
  if (!value) {
    return 'updated recently';
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return 'updated recently';
  }

  const elapsedMinutes = Math.max(1, Math.round((Date.now() - timestamp) / 60000));
  if (elapsedMinutes < 60) {
    return `updated ${elapsedMinutes} min ago`;
  }

  const elapsedHours = Math.round(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return `updated ${elapsedHours}h ago`;
  }

  const elapsedDays = Math.round(elapsedHours / 24);
  return `updated ${elapsedDays}d ago`;
};

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
        <ActivityIndicator size="large" color={customerTheme.accentStrong} />
      </View>
    );
  }

  if (error || !order) {
    return (
      <View style={styles.centered}>
        <Text style={styles.notFoundText}>Order not found</Text>
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
  const courierPhone = order.assignment?.courierPhone ?? null;
  const courierLatitude = order.assignment?.courierLatitude ?? null;
  const courierLongitude = order.assignment?.courierLongitude ?? null;
  const hasCourierCoordinates =
    typeof courierLatitude === 'number' &&
    Number.isFinite(courierLatitude) &&
    typeof courierLongitude === 'number' &&
    Number.isFinite(courierLongitude);
  const courierLocationUpdatedAt = formatRelativeAge(order.assignment?.courierUpdatedAt);
  const courierLocationStatus = hasCourierCoordinates ? 'Live' : courierPhone ? 'Assigned' : 'Waiting';
  const courierLocationCopy = hasCourierCoordinates
    ? 'Live rider coordinates mirror the backend snapshot.'
    : courierPhone
      ? 'The rider is assigned. Live coordinates will appear once GPS sync is available.'
      : 'Assign a rider to see live location data here.';
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

    Alert.alert('Cancel order?', refundCopy, [
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
    ]);
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

  const handleCallRider = async () => {
    if (!courierPhone) {
      return;
    }

    try {
      await openPhoneDialer(courierPhone);
    } catch (nextError: any) {
      Alert.alert('Call failed', nextError.message ?? 'Could not open the phone app.');
    }
  };

  const handleOpenRiderMap = async () => {
    if (!hasCourierCoordinates) {
      return;
    }

    try {
      await Linking.openURL(
        `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
          `${courierLatitude},${courierLongitude}`
        )}`
      );
    } catch (nextError: any) {
      Alert.alert('Map unavailable', nextError.message ?? 'Could not open maps right now.');
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <View style={styles.heroCard}>
        <Text style={styles.eyebrow}>Order detail</Text>
        <Text style={styles.title}>Order #{order.id.slice(-6)}</Text>
        <Text style={styles.restaurant}>{order.restaurantName}</Text>
        <View style={styles.badgesRow}>
          <View style={styles.fulfillmentBadge}>
            <Text style={styles.fulfillmentBadgeText}>{fulfillmentType === 'pickup' ? 'Pickup' : 'Delivery'}</Text>
          </View>
          <View style={styles.statusBadge}>
            <Text style={[styles.statusBadgeText, { color: getOrderStatusColor(order.status) }]}>
              {formatOrderStatusLabel(order.status)}
            </Text>
          </View>
        </View>
        {courierPhone ? (
          <TouchableOpacity style={styles.callButton} onPress={handleCallRider}>
            <Text style={styles.callButtonText}>Call rider</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.progressCard}>
        <Text style={styles.sectionTitle}>Tracking</Text>
        {trackingSteps.map((step, index) => {
          const active = index <= currentStep;
          const current = index === currentStep;

          return (
            <Animated.View key={step} entering={FadeIn.delay(index * 120)} style={styles.stepRow}>
              <View style={[styles.stepCircle, active ? styles.stepCircleActive : null, current ? styles.stepCircleCurrent : null]} />
              <Text style={[styles.stepLabel, active ? styles.stepLabelActive : null]}>{formatOrderStatusLabel(step)}</Text>
            </Animated.View>
          );
        })}
      </View>

      <View style={styles.detailCard}>
        <Text style={styles.sectionTitle}>Payment and delivery</Text>
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
        {order.deliveryLocation?.note ? <Text style={styles.note}>Drop-off note: {order.deliveryLocation.note}</Text> : null}
        {isPendingPrepaidPayment ? (
          <TouchableOpacity style={styles.refreshButton} onPress={handleRefreshPayment} disabled={refreshingPayment}>
            <Text style={styles.refreshButtonText}>
              {refreshingPayment ? 'Refreshing payment...' : 'Refresh payment status'}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {fulfillmentType === 'delivery' ? (
        <View style={styles.riderCard}>
          <View style={styles.riderHeader}>
            <View>
          <Text style={styles.sectionTitle}>Live rider location</Text>
          <Text style={styles.riderName}>{order.assignment?.courierName ?? 'Your rider'}</Text>
            </View>
            <View style={styles.liveBadge}>
              <Text style={styles.liveBadgeText}>{courierLocationStatus}</Text>
            </View>
          </View>

          {hasCourierCoordinates ? (
            <>
              <View style={styles.coordinateGrid}>
                <View style={styles.coordinateChip}>
                  <Text style={styles.coordinateLabel}>Latitude</Text>
                  <Text style={styles.coordinateValue}>{courierLatitude?.toFixed(5)}</Text>
                </View>
                <View style={styles.coordinateChip}>
                  <Text style={styles.coordinateLabel}>Longitude</Text>
                  <Text style={styles.coordinateValue}>{courierLongitude?.toFixed(5)}</Text>
                </View>
              </View>
              <Text style={styles.riderMeta}>Live position {courierLocationUpdatedAt}</Text>
              <TouchableOpacity style={styles.mapButton} onPress={handleOpenRiderMap}>
                <Text style={styles.mapButtonText}>Open rider on maps</Text>
              </TouchableOpacity>
            </>
          ) : (
            <Text style={styles.riderEmptyState}>{courierLocationCopy}</Text>
          )}

          {courierPhone ? (
            <TouchableOpacity style={[styles.callButton, styles.riderCallButton]} onPress={handleCallRider}>
              <Text style={styles.callButtonText}>Call rider</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

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

      {normalizedStatus === 'delivered' ? (
        <Animated.View entering={FadeIn} style={styles.deliveryCard}>
          <Text style={styles.deliveryTitle}>Delivered</Text>
          <Text style={styles.deliveryCopy}>Enjoy your meal.</Text>
        </Animated.View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: customerTheme.background,
    flex: 1,
  },
  centered: {
    alignItems: 'center',
    backgroundColor: customerTheme.background,
    flex: 1,
    justifyContent: 'center',
  },
  notFoundText: {
    color: customerTheme.textMuted,
    fontSize: 15,
    fontWeight: '700',
  },
  container: {
    padding: 14,
    paddingBottom: 30,
  },
  promptContainer: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  heroCard: {
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
    borderRadius: 20,
    borderWidth: 1,
    padding: 18,
  },
  eyebrow: {
    color: customerTheme.accentStrong,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  title: {
    color: customerTheme.text,
    fontSize: 22,
    fontWeight: '800',
    marginTop: 8,
  },
  restaurant: {
    color: customerTheme.textMuted,
    fontSize: 14,
    marginTop: 4,
  },
  badgesRow: {
    flexDirection: 'row',
    marginTop: 14,
  },
  fulfillmentBadge: {
    backgroundColor: customerTheme.surfaceStrong,
    borderRadius: 999,
    marginRight: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  fulfillmentBadgeText: {
    color: customerTheme.accentStrong,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  statusBadge: {
    backgroundColor: customerTheme.accentTint,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  callButton: {
    alignItems: 'center',
    backgroundColor: customerTheme.accentStrong,
    borderRadius: 14,
    marginTop: 14,
    paddingVertical: 12,
  },
  callButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },
  progressCard: {
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 12,
    padding: 18,
  },
  sectionTitle: {
    color: customerTheme.text,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '800',
    letterSpacing: 0.2,
    marginBottom: 8,
  },
  stepRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginTop: 10,
  },
  stepCircle: {
    backgroundColor: customerTheme.border,
    borderRadius: 8,
    height: 16,
    marginRight: 10,
    width: 16,
  },
  stepCircleActive: {
    backgroundColor: customerTheme.accentStrong,
  },
  stepCircleCurrent: {
    borderColor: customerTheme.hero,
    borderWidth: 2,
  },
  stepLabel: {
    color: customerTheme.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  stepLabelActive: {
    color: customerTheme.text,
  },
  detailCard: {
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 12,
    padding: 18,
  },
  total: {
    color: customerTheme.accentStrong,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 8,
  },
  detailLine: {
    color: customerTheme.textMuted,
    fontSize: 13,
    lineHeight: 20,
  },
  note: {
    color: customerTheme.text,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 8,
  },
  refreshButton: {
    alignItems: 'center',
    backgroundColor: customerTheme.hero,
    borderRadius: 12,
    marginTop: 14,
    paddingVertical: 12,
  },
  refreshButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
  },
  riderCard: {
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 12,
    padding: 18,
  },
  riderHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  riderName: {
    color: customerTheme.textMuted,
    fontSize: 13,
    marginTop: 4,
  },
  liveBadge: {
    alignSelf: 'flex-start',
    backgroundColor: customerTheme.accentTint,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  liveBadgeText: {
    color: customerTheme.accentStrong,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  coordinateGrid: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  coordinateChip: {
    backgroundColor: customerTheme.background,
    borderColor: customerTheme.border,
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    padding: 12,
  },
  coordinateLabel: {
    color: customerTheme.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  coordinateValue: {
    color: customerTheme.text,
    fontSize: 15,
    fontWeight: '800',
    marginTop: 6,
  },
  riderMeta: {
    color: customerTheme.textMuted,
    fontSize: 12,
    marginTop: 10,
  },
  riderEmptyState: {
    color: customerTheme.textMuted,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 10,
  },
  mapButton: {
    alignItems: 'center',
    backgroundColor: customerTheme.hero,
    borderRadius: 12,
    marginTop: 14,
    paddingVertical: 12,
  },
  mapButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
  },
  riderCallButton: {
    marginTop: 10,
  },
  policyCard: {
    backgroundColor: customerTheme.warningSoft,
    borderColor: customerTheme.border,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 12,
    padding: 18,
  },
  policyTitle: {
    color: '#8a4f12',
    fontSize: 15,
    fontWeight: '800',
  },
  policyCopy: {
    color: '#7c5a2a',
    fontSize: 13,
    lineHeight: 20,
    marginTop: 8,
  },
  cancelButton: {
    alignItems: 'center',
    backgroundColor: customerTheme.danger,
    borderRadius: 12,
    marginTop: 14,
    paddingVertical: 13,
  },
  cancelButtonDisabled: {
    backgroundColor: '#d1d5db',
  },
  cancelButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
  },
  deliveryCard: {
    alignItems: 'center',
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 12,
    padding: 18,
  },
  deliveryTitle: {
    color: customerTheme.text,
    fontSize: 20,
    fontWeight: '800',
  },
  deliveryCopy: {
    color: customerTheme.textMuted,
    fontSize: 13,
    marginTop: 6,
  },
});
