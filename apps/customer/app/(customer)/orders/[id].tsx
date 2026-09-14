import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useLocalSearchParams } from 'expo-router';
import { useConfirm } from '@feasty/design-system';
import AuthPromptCard from '../../../src/components/AuthPromptCard';
import CustomerLiveMap from '../../../src/components/CustomerLiveMap';
import { SkeletonDetail, SkeletonScreen } from '../../../src/components/Skeleton';
import { useAuth } from '../../../src/contexts/AuthContext';
import { computeEtaRangeBetween, formatEtaRange, shouldShowLiveMap } from '../../../src/domain/tracking';
import { useRiderPositionRealtime, type RiderPosition } from '../../../src/hooks/useRiderPositionRealtime';
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
import { toDialablePhoneNumber } from '../../../src/utils/phoneLinking';
import {
  describeExternalLinkFailure,
  openExternalLink,
} from '../../../../../packages/runtime/src/externalLink';
import { buildOrderTrackingSummary } from '../../../src/utils/orderTrackingSummary';

const formatMoney = (amount: number) => `₦${amount.toFixed(2)}`;

// Task 18 (G2): render the scheduled slot on the tracking screen.
const formatScheduledSlot = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
};

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
  const { confirm, confirmDialog } = useConfirm();
  const [cancelling, setCancelling] = useState(false);
  // Rendered inline rather than through Alert: `Alert` is a no-op on the web
  // build (app.feasty.com.ng), so the cancellation outcome — including the
  // refund percentage actually applied — used to vanish entirely there.
  const [cancelNotice, setCancelNotice] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [refreshingPayment, setRefreshingPayment] = useState(false);
  // Same inline treatment as the cancellation pair above, and for the same
  // reason: this button exists only to report an answer, and through `Alert`
  // that answer was invisible on app.feasty.com.ng.
  const [paymentNotice, setPaymentNotice] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  // Failure of an external hand-off (phone app, maps). Rendered beside the
  // buttons that raise it, because Alert shows nothing on the web build.
  const [linkError, setLinkError] = useState<string | null>(null);
  // Live rider position pushed over the order-<id> broadcast. Subscribed only
  // while the order is out for delivery (picked_up / on_the_way); the hook is
  // a no-op when passed a null orderId. Called before the early returns below
  // so hook order stays stable across renders.
  const [livePosition, setLivePosition] = useState<RiderPosition | null>(null);
  const liveMapEligible = shouldShowLiveMap(order?.status);
  useRiderPositionRealtime(liveMapEligible && order ? order.id : null, setLivePosition);

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
      <SkeletonScreen>
        <SkeletonDetail />
      </SkeletonScreen>
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
  const groupSummary = buildOrderTrackingSummary(order);
  const checkoutTotal = groupSummary?.total ?? order.pricing?.total ?? order.total;
  const restaurantTotal = order.pricing?.total ?? order.total;
  const paymentTotalLabel = groupSummary ? 'Shared checkout total' : 'Total';
  const paymentStatus = formatPaymentStatusLabel(order.payment?.status, order.payment?.method);
  const paymentMethod = formatPaymentMethodLabel(order.payment?.method);
  const canCancel = canCustomerCancelOrder(order.status);
  const refundPolicy = getCustomerRefundPolicyLabel(order.status);
  const scheduledSlotLabel = formatScheduledSlot(order.scheduledFor);
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
  // Live map inputs: prefer the just-broadcast rider position, fall back to the
  // last-known coordinates from the order snapshot. Delivery + restaurant pins
  // come straight off the snapshot.
  const riderMapPoint = livePosition
    ? { latitude: livePosition.latitude, longitude: livePosition.longitude }
    : hasCourierCoordinates
      ? { latitude: courierLatitude as number, longitude: courierLongitude as number }
      : null;
  const deliveryMapPoint =
    order.deliveryLocation &&
    typeof order.deliveryLocation.latitude === 'number' &&
    typeof order.deliveryLocation.longitude === 'number'
      ? { latitude: order.deliveryLocation.latitude, longitude: order.deliveryLocation.longitude }
      : null;
  const restaurantMapPoint =
    typeof order.restaurantLatitude === 'number' && typeof order.restaurantLongitude === 'number'
      ? { latitude: order.restaurantLatitude, longitude: order.restaurantLongitude }
      : null;
  const etaRange = computeEtaRangeBetween(riderMapPoint, deliveryMapPoint, order.averageSpeedKmh ?? null);
  const liveMapVisible = liveMapEligible && !!riderMapPoint && !!deliveryMapPoint;
  const etaSummary = liveMapVisible
    ? etaRange
    : order.eta
      ? {
          ...order.eta,
          minutes: Math.round((order.eta.minMinutes + order.eta.maxMinutes) / 2),
        }
      : null;
  const etaSummaryLabel = liveMapVisible ? 'Live rider ETA' : 'Estimated delivery';
  const etaSummaryHint = liveMapVisible
    ? 'Updates with the rider position.'
    : 'Includes kitchen prep time and delivery distance.';
  const liveLocationUpdatedAt = formatRelativeAge(livePosition?.updatedAt ?? order.assignment?.courierUpdatedAt);
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

    setCancelNotice(null);
    setCancelError(null);

    try {
      await confirm({
        title: 'Cancel order?',
        // The refund policy verbatim: this dialog is the money disclosure, so
        // the copy shown here must stay identical to the policy card's.
        paragraphs: [refundCopy],
        confirmLabel: 'Cancel order',
        cancelLabel: 'Keep order',
        destructive: true,
        // Held inside the dialog so both buttons stay disabled for the whole
        // round trip; a double tap cannot fire two cancellations against a
        // live order.
        onConfirm: async () => {
          setCancelling(true);

          try {
            const result = await cancelCustomerOrder(order.id);
            const refundPercent = Math.round(result.refundRate * 100);
            setCancelNotice(
              refundPercent > 0
                ? `Order cancelled. Your refund policy is ${refundPercent}%.`
                : 'Order cancelled. No refund was due for this cancellation.'
            );
          } finally {
            setCancelling(false);
          }
        },
      });
    } catch (nextError: any) {
      setCancelError(nextError?.message ?? 'We could not cancel this order right now.');
    }
  };

  const handleRefreshPayment = async () => {
    if (!order || refreshingPayment) {
      return;
    }

    setPaymentNotice(null);
    setPaymentError(null);

    try {
      setRefreshingPayment(true);
      const result = await refreshCustomerPaymentStatus(order.id);
      setPaymentNotice(
        `Payment status updated. Current payment state: ${formatPaymentStatusLabel(
          result.paymentStatus,
          order.payment?.method
        )}.`
      );
    } catch (nextError: any) {
      setPaymentError(nextError?.message ?? 'We could not verify this payment right now.');
    } finally {
      setRefreshingPayment(false);
    }
  };

  // Both of these used to report failure through Alert, which is an empty
  // function under react-native-web -- and the map one could not report failure
  // at all, because Linking.openURL resolves even when the browser blocks the
  // popup (react-native-web never checks what window.open returned). So a
  // blocked map window was completely silent. openExternalLink returns the
  // result instead of throwing; see packages/runtime/src/externalLinkPolicy.ts.
  const handleCallRider = async () => {
    if (!courierPhone) {
      return;
    }

    setLinkError(null);

    const dialable = toDialablePhoneNumber(courierPhone);
    if (!dialable) {
      // A stored value like "N/A" passes the truthiness check above but strips
      // to nothing, which is the one case the old guard missed.
      setLinkError(`The rider's number is not dialable. Shown on this page: ${courierPhone}`);
      return;
    }

    const result = await openExternalLink(`tel:${dialable}`);
    if (!result.ok) {
      setLinkError(describeExternalLinkFailure(result.reason, 'the phone app'));
    }
  };

  const handleOpenRiderMap = async () => {
    if (!hasCourierCoordinates) {
      return;
    }

    setLinkError(null);

    const result = await openExternalLink(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        `${courierLatitude},${courierLongitude}`
      )}`
    );

    if (!result.ok) {
      // The coordinates are already on screen just above this button, so a
      // blocked popup still leaves the customer something to work with.
      setLinkError(describeExternalLinkFailure(result.reason, 'the map'));
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
          {/*
            Status hue in the fill, not the label — same correction as the orders
            list. On the badge's former fixed green tint (#e8f5e9) nine of the
            eleven `getOrderStatusColor` branches failed AA, `placed` (#f5b342) at
            1.64:1. The 12.5% tint keeps the hue and the label is plain `text`.
          */}
          <View style={[styles.statusBadge, { backgroundColor: `${getOrderStatusColor(order.status)}20` }]}>
            <Text style={styles.statusBadgeText}>{formatOrderStatusLabel(order.status)}</Text>
          </View>
        </View>
        {scheduledSlotLabel ? (
          <View style={styles.scheduledBanner}>
            <Text style={styles.scheduledBannerLabel}>Scheduled for</Text>
            <Text style={styles.scheduledBannerValue}>{scheduledSlotLabel}</Text>
          </View>
        ) : null}
        {courierPhone ? (
          <TouchableOpacity style={styles.callButton} onPress={handleCallRider}>
            <Text style={styles.callButtonText}>Call rider</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {groupSummary ? (
        <View style={styles.groupCard}>
          <Text style={styles.sectionTitle}>{groupSummary.title}</Text>
          <Text style={styles.groupSubtitle}>{groupSummary.subtitle}</Text>
          <View style={styles.groupTotalRow}>
            <Text style={styles.groupTotalLabel}>{groupSummary.totalLabel}</Text>
            <Text style={styles.groupTotalValue}>{formatMoney(groupSummary.total)}</Text>
          </View>
          {groupSummary.lines.map((line) => (
            <View key={line.id} style={styles.groupLine}>
              <View style={styles.groupLineCopy}>
                <Text style={styles.groupLineTitle}>{line.restaurantName}</Text>
                <Text style={styles.groupLineMeta}>
                  {line.itemCount} {line.itemCount === 1 ? 'item' : 'items'}
                  {line.isPrimary ? ' · primary order' : ''}
                </Text>
              </View>
              <Text style={styles.groupLineAmount}>{formatMoney(line.subtotal)}</Text>
            </View>
          ))}
        </View>
      ) : null}

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
        <Text style={styles.total}>
          {paymentTotalLabel}: {formatMoney(checkoutTotal)}
        </Text>
        {etaSummary ? (
          <View style={styles.etaSummaryCard}>
            <View style={styles.etaSummaryRow}>
              <Text style={styles.etaSummaryLabel}>{etaSummaryLabel}</Text>
              <Text style={styles.etaSummaryValue}>{formatEtaRange(etaSummary)}</Text>
            </View>
            <Text style={styles.etaSummaryHint}>{etaSummaryHint}</Text>
          </View>
        ) : null}
        {groupSummary ? <Text style={styles.detailLine}>Restaurant order total: {formatMoney(restaurantTotal)}</Text> : null}
        <Text style={styles.detailLine}>
          {groupSummary ? 'Restaurant delivery fee' : 'Delivery fee'}: {formatMoney(order.pricing?.deliveryFee ?? 0)}
        </Text>
        {order.pricing?.serviceFee ? (
          <Text style={styles.detailLine}>
            {groupSummary ? 'Restaurant service fee' : 'Service fee'}: {formatMoney(order.pricing.serviceFee)}
          </Text>
        ) : null}
        <Text style={styles.detailLine}>{groupSummary ? 'Restaurant tip' : 'Tip'}: {formatMoney(order.pricing?.tip ?? 0)}</Text>
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
        {paymentNotice ? (
          <Text accessibilityLiveRegion="polite" role="status" style={styles.cancelNoticeText}>
            {paymentNotice}
          </Text>
        ) : null}
        {paymentError ? (
          <Text accessibilityLiveRegion="assertive" role="alert" style={styles.cancelErrorText}>
            {paymentError}
          </Text>
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
              <Text style={styles.liveBadgeText}>{liveMapVisible ? 'Live' : courierLocationStatus}</Text>
            </View>
          </View>

          {liveMapVisible ? (
            <>
              <View style={styles.etaRow}>
                <Text style={styles.etaLabel}>Estimated arrival</Text>
                <Text style={styles.etaValue}>{formatEtaRange(etaRange)}</Text>
              </View>
              <CustomerLiveMap rider={riderMapPoint} delivery={deliveryMapPoint} restaurant={restaurantMapPoint} />
              <Text style={styles.riderMeta}>Live position {liveLocationUpdatedAt}</Text>
            </>
          ) : null}

          {!liveMapVisible && hasCourierCoordinates ? (
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

          {linkError ? (
            <Text accessibilityLiveRegion="assertive" role="alert" style={styles.cancelErrorText}>
              {linkError}
            </Text>
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
        {cancelNotice ? (
          <Text accessibilityLiveRegion="polite" role="alert" style={styles.cancelNoticeText}>
            {cancelNotice}
          </Text>
        ) : null}
        {cancelError ? (
          <Text accessibilityLiveRegion="polite" role="alert" style={styles.cancelErrorText}>
            {cancelError}
          </Text>
        ) : null}
      </View>

      {normalizedStatus === 'delivered' ? (
        <Animated.View entering={FadeIn} style={styles.deliveryCard}>
          <Text style={styles.deliveryTitle}>Delivered</Text>
          <Text style={styles.deliveryCopy}>Enjoy your meal.</Text>
        </Animated.View>
      ) : null}

      {confirmDialog}
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
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  statusBadgeText: {
    color: customerTheme.text,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  scheduledBanner: {
    backgroundColor: customerTheme.accentTint,
    borderRadius: 14,
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  scheduledBannerLabel: {
    color: customerTheme.accentStrong,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  scheduledBannerValue: {
    color: customerTheme.text,
    fontSize: 15,
    fontWeight: '700',
    marginTop: 2,
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
  groupCard: {
    backgroundColor: customerTheme.accentTint,
    borderColor: customerTheme.border,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 12,
    padding: 18,
  },
  groupSubtitle: {
    color: customerTheme.textMuted,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 4,
  },
  groupTotalRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  groupTotalLabel: {
    color: customerTheme.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  groupTotalValue: {
    color: customerTheme.accentStrong,
    fontSize: 17,
    fontWeight: '800',
  },
  groupLine: {
    alignItems: 'flex-start',
    borderTopColor: customerTheme.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 12,
  },
  groupLineCopy: {
    flex: 1,
    paddingRight: 12,
  },
  groupLineTitle: {
    color: customerTheme.text,
    fontSize: 14,
    fontWeight: '700',
  },
  groupLineMeta: {
    color: customerTheme.textMuted,
    fontSize: 12,
    marginTop: 4,
  },
  groupLineAmount: {
    color: customerTheme.text,
    fontSize: 14,
    fontWeight: '800',
  },
  total: {
    color: customerTheme.accentStrong,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 8,
  },
  etaSummaryCard: {
    backgroundColor: customerTheme.accentTint,
    borderColor: customerTheme.border,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 12,
    padding: 14,
  },
  etaSummaryRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  etaSummaryLabel: {
    color: customerTheme.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  etaSummaryValue: {
    color: customerTheme.accentStrong,
    fontSize: 16,
    fontWeight: '800',
  },
  etaSummaryHint: {
    color: customerTheme.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
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
  etaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  etaLabel: {
    color: customerTheme.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  etaValue: {
    color: customerTheme.accentStrong,
    fontSize: 16,
    fontWeight: '800',
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
  cancelNoticeText: {
    color: customerTheme.text,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 19,
    marginTop: 10,
  },
  cancelErrorText: {
    color: customerTheme.dangerText,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 10,
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
