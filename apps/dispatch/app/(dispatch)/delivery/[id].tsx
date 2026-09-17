import { useMemo } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
// Imported by module path, not from the '@feasty/design-system' barrel, on
// purpose: the barrel re-exports useFeastyFonts, which pulls expo-font and six
// @expo-google-fonts faces into the bundle. This app has not adopted the design
// system and does not declare those dependencies, so it takes the one primitive
// it needs. Customer and partner, which already load the fonts, import it by
// package name. See the same note in ../profile.tsx.
import { useNotice } from '../../../../../packages/design-system/src/primitives/Notice';
import { SkeletonDetail, SkeletonScreen } from '../../../src/components/Skeleton';
import {
  formatOrderStatusLabel,
  getOrderStatusColor,
  normalizeOrderStatus,
} from '../../../src/domain/orders';
import { useDispatchOrder } from '../../../src/hooks/useDispatchOrder';
import { useDispatchRiders } from '../../../src/hooks/useDispatchRiders';
import {
  assignDispatchCourier,
  escalateDispatchOrder,
  markDispatchOrderFailed,
  markDispatchOrderDelivered,
  markDispatchOrderOnTheWay,
  markDispatchOrderPickedUp,
} from '../../../src/services/dispatchOrderActions';
import { dispatchTheme } from '../../../src/theme/palette';
import { radius } from '../../../../../packages/design-system/src/tokens/radius';
import { calculateDistanceKm } from '../../../src/utils/deliveryDistance';
import { toDialablePhoneNumber } from '../../../src/utils/phoneLinking';
import {
  describeExternalLinkFailure,
  openExternalLink,
} from '../../../../../packages/runtime/src/externalLink';

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

export default function DispatchDeliveryDetailScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { error, loading, order } = useDispatchOrder(id as string);
  const { error: ridersError, loading: ridersLoading, riders } = useDispatchRiders();
  // Every action on this screen reported failure through `Alert`, which is
  // `class Alert { static alert() {} }` under react-native-web. `error` above
  // belongs to `useDispatchOrder` and carries LOAD failures only (the early
  // return below consumes it), so a failed Assign, Confirm pickup or Escalate
  // moved no status chip and printed no message: from the dispatcher's side it
  // was indistinguishable from a slow network, and they either retried or
  // assumed the update had landed.
  //
  // Floating rather than inline: these actions fire from arbitrary rows of a
  // long scrolling page -- the rider list can run to dozens of entries -- so an
  // inline notice would routinely render somewhere the dispatcher is not
  // looking. The offset clears the 70px tab bar, which is still mounted here
  // (this route is a `href: null` Tabs.Screen in ../_layout.tsx); a notice
  // hidden behind chrome is the same silence it replaces.
  const { notice, showNotice } = useNotice({
    placement: 'floating',
    offsetBottom: insets.bottom + 86,
  });

  // Each action reports its own failure through the one banner. Sticky (errors
  // default to `durationMs: null`): the status chip has not moved and this is
  // the only thing saying why.
  const reportFailure = (title: string, message: string) => {
    showNotice({ tone: 'error', title, message });
  };
  const rawDeliveryLocation = order?.deliveryLocation as
    | { latitude?: number; longitude?: number; address?: string | null; shortAddress?: string | null; note?: string | null }
    | null
    | undefined;
  const deliveryCoordinates = useMemo(
    () =>
      typeof rawDeliveryLocation?.latitude === 'number' && typeof rawDeliveryLocation?.longitude === 'number'
        ? {
            latitude: rawDeliveryLocation.latitude,
            longitude: rawDeliveryLocation.longitude,
          }
        : null,
    [rawDeliveryLocation?.latitude, rawDeliveryLocation?.longitude]
  );
  const courierPhone = order?.assignment?.courierPhone ?? null;
  const courierLatitude = order?.assignment?.courierLatitude ?? null;
  const courierLongitude = order?.assignment?.courierLongitude ?? null;
  const hasCourierCoordinates =
    typeof courierLatitude === 'number' &&
    Number.isFinite(courierLatitude) &&
    typeof courierLongitude === 'number' &&
    Number.isFinite(courierLongitude);
  const courierLocationUpdatedAt = formatRelativeAge(order?.assignment?.courierUpdatedAt);
  const courierLocationStatus = hasCourierCoordinates ? 'Live' : courierPhone ? 'Assigned' : 'Waiting';
  const courierLocationCopy = hasCourierCoordinates
    ? 'Live rider coordinates mirror the backend snapshot.'
    : courierPhone
      ? 'The rider is assigned. Live coordinates will appear once GPS sync is available.'
      : 'Assign a rider to see live location data here.';
  const ridersByDistance = useMemo(
    () =>
      [...riders]
        .map((rider) => {
          const distanceKm =
            deliveryCoordinates && rider.hasPreciseLocation
              ? calculateDistanceKm(
                  { latitude: rider.latitude, longitude: rider.longitude },
                  deliveryCoordinates
                )
              : null;

          return {
            ...rider,
            distanceKm,
          };
        })
        .sort((left, right) => {
          if (left.distanceKm === null && right.distanceKm === null) {
            return left.name.localeCompare(right.name);
          }

          if (left.distanceKm === null) {
            return 1;
          }

          if (right.distanceKm === null) {
            return -1;
          }

          return left.distanceKm - right.distanceKm;
        }),
    [deliveryCoordinates, riders]
  );

  const handleAssignRider = async (courier: { id: string; name: string }) => {
    if (!order) {
      return;
    }

    try {
      await assignDispatchCourier(order.id, courier, order.assignment ?? null);
    } catch (nextError: any) {
      reportFailure('Assignment failed', nextError.message ?? 'Could not assign this rider.');
    }
  };

  const handleMarkPickedUp = async () => {
    if (!order) {
      return;
    }

    try {
      await markDispatchOrderPickedUp(order.id, order.timeline ?? null);
    } catch (nextError: any) {
      reportFailure('Update failed', nextError.message ?? 'Could not confirm pickup.');
    }
  };

  const handleMarkDelivered = async () => {
    if (!order) {
      return;
    }

    try {
      await markDispatchOrderDelivered(order.id, order.timeline ?? null);
    } catch (nextError: any) {
      reportFailure('Update failed', nextError.message ?? 'Could not mark this order delivered.');
    }
  };

  const handleMarkOnTheWay = async () => {
    if (!order) {
      return;
    }

    try {
      await markDispatchOrderOnTheWay(order.id, order.timeline ?? null);
    } catch (nextError: any) {
      reportFailure('Update failed', nextError.message ?? 'Could not mark this order on the way.');
    }
  };

  const handleMarkFailed = async () => {
    if (!order) {
      return;
    }

    try {
      await markDispatchOrderFailed(order.id, order.timeline ?? null);
    } catch (nextError: any) {
      reportFailure('Update failed', nextError.message ?? 'Could not mark this delivery as failed.');
    }
  };

  const handleEscalate = async () => {
    if (!order) {
      return;
    }

    try {
      await escalateDispatchOrder(order.id, order.timeline ?? null);
    } catch (nextError: any) {
      reportFailure('Escalation failed', nextError.message ?? 'Could not escalate this delivery.');
    }
  };

  // These used to catch a rejection from Linking.openURL, which for a blocked
  // popup never comes -- react-native-web resolves regardless, because it never
  // checks what window.open returned. The catch was therefore dead code on web.
  // openExternalLink returns the outcome instead. The previous pass left these
  // two on Alert, noting they should move the day this app grew a notice
  // surface; it has one now (above), so they report through it like every
  // other site on this screen.
  const handleCallCustomer = async () => {
    if (!order?.customerPhone) {
      return;
    }

    // Stripped rather than trusted: a stored placeholder like "N/A" is truthy
    // but reduces to an empty string, and handing `tel:` an empty number opens
    // nothing while looking like a working button.
    const dialable = toDialablePhoneNumber(order.customerPhone);
    if (!dialable) {
      reportFailure('Call failed', `That number is not dialable: ${order.customerPhone}`);
      return;
    }

    const result = await openExternalLink(`tel:${dialable}`);
    if (!result.ok) {
      reportFailure('Call failed', describeExternalLinkFailure(result.reason, 'the phone app'));
    }
  };

  const handleOpenRiderMap = async () => {
    if (!hasCourierCoordinates) {
      return;
    }

    const result = await openExternalLink(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        `${courierLatitude},${courierLongitude}`
      )}`
    );

    if (!result.ok) {
      reportFailure('Map unavailable', describeExternalLinkFailure(result.reason, 'the map'));
    }
  };

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
        <Text style={styles.errorTitle}>Order not found</Text>
        <Text style={styles.errorCopy}>{error ?? 'This dispatch order could not be loaded.'}</Text>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const normalizedStatus = normalizeOrderStatus(order.status);
  const assignedCourier = order.assignment?.courierName ?? 'Not assigned yet';
  const hasAssignedCourier = Boolean(order.assignment?.courierId);
  const canAssignRider = ['accepted', 'preparing', 'ready_for_pickup'].includes(normalizedStatus);
  const canConfirmPickup = normalizedStatus === 'ready_for_pickup' && hasAssignedCourier;
  const canMarkOnTheWay = normalizedStatus === 'picked_up' && hasAssignedCourier;
  const canMarkDelivered = ['picked_up', 'on_the_way'].includes(normalizedStatus) && hasAssignedCourier;
  const canMarkFailed = ['picked_up', 'on_the_way'].includes(normalizedStatus) && hasAssignedCourier;
  const canEscalate = !['cancelled', 'delivered', 'failed_delivery', 'rejected'].includes(normalizedStatus);
  const assignmentHelperCopy =
    normalizedStatus === 'placed'
      ? 'Wait for the restaurant to accept this order before assigning a rider.'
      : ['accepted', 'preparing', 'ready_for_pickup'].includes(normalizedStatus)
        ? deliveryCoordinates
          ? 'Assign a rider once dispatch is ready. Riders closest to this drop-off are shown first.'
          : 'Assign a rider once dispatch is ready to cover this delivery.'
        : hasAssignedCourier
          ? 'Courier assignment is locked once pickup has been confirmed.'
          : 'Courier assignment is unavailable for this delivery state.';
  const pickupHelperCopy = !hasAssignedCourier
    ? 'Assign a rider before confirming pickup.'
    : normalizedStatus !== 'ready_for_pickup'
      ? 'Pickup stays locked until the restaurant marks the order ready.'
      : 'Confirm pickup once the assigned rider has collected the order.';
  return (
    // Wrapped rather than used as the root because the floating notice
    // positions itself absolutely: inside a ScrollView that would anchor it to
    // the bottom of the CONTENT and let it scroll away.
    <View style={styles.screen}>
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>Dispatch order</Text>
          <Text style={styles.title}>Order #{order.id.slice(-6)}</Text>
          <Text style={styles.heroCopy}>
            {order.restaurantName ?? 'Restaurant'} to{' '}
            {order.deliveryLocation?.shortAddress ?? order.deliveryAddress ?? 'Customer address pending'}
          </Text>
          {/*
            This pill sits on the dark hero, so the label is `textOnInverse` and the
            tint carries the status hue. The status colours are built for a light
            card: as text on their own 12.5% tint over #0d1522, five of the eleven
            branches failed AA (`preparing` #5D3FD3 at 2.51:1). The stylesheet's
            `accentStrong` default was no better — it never applied, because the
            inline colour always won.
          */}
          <View style={[styles.statusPill, { backgroundColor: `${getOrderStatusColor(order.status)}20` }]}>
            <Text style={styles.statusPillText}>{formatOrderStatusLabel(order.status)}</Text>
        </View>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Order snapshot</Text>
          <Text style={styles.detailLine}>Fulfillment: {order.fulfillmentType ?? 'delivery'}</Text>
          <Text style={styles.detailLine}>
            Total: ${(order.pricing?.total ?? order.total ?? 0).toFixed(2)}
          </Text>
          <Text style={styles.detailLine}>
            Payment: {order.payment?.method ?? 'cash'} | {order.payment?.status ?? 'pending'}
          </Text>
          <Text style={styles.detailLine}>Assigned rider: {assignedCourier}</Text>
          <Text style={styles.detailLine}>
            Address: {order.deliveryAddress ?? order.deliveryLocation?.address ?? 'Customer address pending'}
          </Text>
          {order.deliveryLocation?.note ? <Text style={styles.detailNote}>Drop-off note: {order.deliveryLocation.note}</Text> : null}
          {order.customerPhone ? (
            <TouchableOpacity style={styles.callButton} onPress={handleCallCustomer}>
              <Text style={styles.callButtonText}>Call customer</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {order.fulfillmentType !== 'pickup' ? (
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Live rider location</Text>
            <View style={[styles.liveBadge, hasCourierCoordinates ? styles.liveBadgeActive : null]}>
              <Text style={styles.liveBadgeText}>{courierLocationStatus}</Text>
            </View>
            <Text style={styles.actionHelper}>{courierLocationCopy}</Text>

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
                <Text style={styles.detailLine}>Live position {courierLocationUpdatedAt}</Text>
                <TouchableOpacity style={styles.mapButton} onPress={handleOpenRiderMap}>
                  <Text style={styles.mapButtonText}>Open rider on maps</Text>
                </TouchableOpacity>
              </>
            ) : null}
        </View>
        ) : null}

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Items</Text>
          {order.items?.map((item) => (
            <View key={item.id ?? item.name} style={styles.itemRow}>
              <View>
                <Text style={styles.itemName}>{item.name ?? 'Order item'}</Text>
                <Text style={styles.itemMeta}>Qty {item.quantity ?? 0}</Text>
              </View>
              <Text style={styles.itemPrice}>${(((item.price ?? 0) * (item.quantity ?? 0)) || 0).toFixed(2)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Dispatch actions</Text>
          <Text style={styles.actionHelper}>{pickupHelperCopy}</Text>
          <TouchableOpacity
            style={[styles.actionButton, !canConfirmPickup ? styles.actionButtonDisabled : null]}
            onPress={handleMarkPickedUp}
            disabled={!canConfirmPickup}
          >
            <Text style={styles.actionButtonText}>Confirm pickup</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, !canMarkOnTheWay ? styles.actionButtonDisabled : null]}
            onPress={handleMarkOnTheWay}
            disabled={!canMarkOnTheWay}
          >
            <Text style={styles.actionButtonText}>Mark on the way</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.deliverButton, !canMarkDelivered ? styles.actionButtonDisabled : null]}
            onPress={handleMarkDelivered}
            disabled={!canMarkDelivered}
          >
            <Text style={styles.actionButtonText}>Mark delivered</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.warningButton, !canMarkFailed ? styles.actionButtonDisabled : null]}
            onPress={handleMarkFailed}
            disabled={!canMarkFailed}
          >
            <Text style={styles.actionButtonText}>Mark failed delivery</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.escalateButton, !canEscalate ? styles.actionButtonDisabled : null]}
            onPress={handleEscalate}
            disabled={!canEscalate}
          >
            <Text style={styles.actionButtonText}>Escalate for manual intervention</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Assign rider</Text>
          <Text style={styles.assignCopy}>{assignmentHelperCopy}</Text>
          {ridersError ? <Text style={styles.assignError}>{ridersError}</Text> : null}
          {ridersLoading ? (
            <Text style={styles.assignLoading}>Loading riders...</Text>
          ) : ridersByDistance.length === 0 ? (
            <Text style={styles.assignEmpty}>
              No rider records are available yet. Create riders from the dispatch management side first.
            </Text>
          ) : (
            ridersByDistance.map((rider) => {
              const isAssigned = order.assignment?.courierId === rider.id;

              return (
                <TouchableOpacity
                  key={rider.id}
                  style={[
                    styles.riderCard,
                    isAssigned ? styles.riderCardAssigned : null,
                    !canAssignRider ? styles.riderCardDisabled : null,
                  ]}
                  onPress={() => handleAssignRider({ id: rider.id, name: rider.name })}
                  disabled={!canAssignRider}
                >
                  <View>
                    <Text style={styles.riderName}>{rider.name}</Text>
                    <Text style={styles.riderMeta}>
                      {`${rider.zone} - ${rider.status} - ${rider.vehicleType}`}
                      {rider.distanceKm !== null ? ` - ${rider.distanceKm.toFixed(1)} km away` : ''}
                    </Text>
                  </View>
                  <Text style={styles.riderTrips}>{rider.completedTrips} trips</Text>
                </TouchableOpacity>
              );
            })
          )}
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Delivery event history</Text>
          {order.events && order.events.length > 0 ? (
            order.events.map((event) => (
              <View key={event.id} style={styles.eventRow}>
                <Text style={styles.eventTitle}>{event.eventType.replace(/_/g, ' ')}</Text>
                <Text style={styles.eventMeta}>{event.createdAt ?? 'Time pending sync'}</Text>
                {event.note ? <Text style={styles.eventNote}>{event.note}</Text> : null}
              </View>
            ))
          ) : (
            <Text style={styles.assignEmpty}>No dispatch events have been recorded yet.</Text>
          )}
        </View>
      </ScrollView>
      {notice}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: dispatchTheme.background,
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 18,
    paddingBottom: 30,
  },
  centered: {
    alignItems: 'center',
    backgroundColor: dispatchTheme.background,
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  loadingText: {
    color: dispatchTheme.textMuted,
    fontSize: 15,
    marginTop: 12,
  },
  errorTitle: {
    color: dispatchTheme.text,
    fontSize: 22,
    fontWeight: '800',
  },
  errorCopy: {
    color: dispatchTheme.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
    textAlign: 'center',
  },
  backButton: {
    backgroundColor: dispatchTheme.accent,
    borderRadius: radius.lg,
    marginTop: 16,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  backButtonText: {
    color: dispatchTheme.textOnBrand,
    fontSize: 14,
    fontWeight: '700',
  },
  hero: {
    backgroundColor: dispatchTheme.hero,
    borderColor: dispatchTheme.border,
    borderRadius: radius['2xl'],
    borderWidth: 1,
    padding: 22,
  },
  eyebrow: {
    color: dispatchTheme.accentSoft,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.9,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  title: {
    color: dispatchTheme.cream,
    fontSize: 30,
    fontWeight: '800',
  },
  heroCopy: {
    color: dispatchTheme.textOnInverseMuted,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
  },
  statusPill: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    marginTop: 16,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  statusPillText: {
    color: dispatchTheme.textOnInverse,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  sectionCard: {
    backgroundColor: dispatchTheme.surface,
    borderColor: dispatchTheme.border,
    borderRadius: radius.xl,
    borderWidth: 1,
    marginTop: 14,
    padding: 18,
  },
  sectionTitle: {
    color: dispatchTheme.text,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '800',
    letterSpacing: 0.2,
    marginBottom: 8,
  },
  detailLine: {
    color: dispatchTheme.textMuted,
    fontSize: 14,
    lineHeight: 22,
    marginTop: 4,
  },
  detailNote: {
    color: dispatchTheme.accentStrong,
    fontSize: 14,
    lineHeight: 22,
    marginTop: 8,
  },
  liveBadge: {
    alignSelf: 'flex-start',
    backgroundColor: dispatchTheme.surfaceMuted,
    borderRadius: radius.pill,
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  liveBadgeActive: {
    backgroundColor: `${dispatchTheme.accent}20`,
  },
  liveBadgeText: {
    color: dispatchTheme.accentStrong,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  coordinateGrid: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  coordinateChip: {
    backgroundColor: dispatchTheme.cream,
    borderColor: dispatchTheme.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flex: 1,
    padding: 12,
  },
  coordinateLabel: {
    color: dispatchTheme.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  coordinateValue: {
    color: dispatchTheme.text,
    fontSize: 15,
    fontWeight: '800',
    marginTop: 6,
  },
  mapButton: {
    alignItems: 'center',
    backgroundColor: dispatchTheme.hero,
    borderRadius: radius.lg,
    marginTop: 14,
    paddingVertical: 13,
  },
  mapButtonText: {
    color: dispatchTheme.textOnBrand,
    fontSize: 13,
    fontWeight: '900',
  },
  callButton: {
    alignItems: 'center',
    backgroundColor: dispatchTheme.accent,
    borderRadius: radius.lg,
    marginTop: 14,
    paddingVertical: 13,
  },
  callButtonText: {
    color: dispatchTheme.textOnBrand,
    fontSize: 13,
    fontWeight: '900',
  },
  itemRow: {
    alignItems: 'center',
    borderTopColor: dispatchTheme.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  itemName: {
    color: dispatchTheme.text,
    fontSize: 15,
    fontWeight: '700',
  },
  itemMeta: {
    color: dispatchTheme.textMuted,
    fontSize: 13,
    marginTop: 4,
  },
  itemPrice: {
    color: dispatchTheme.accentStrong,
    fontSize: 15,
    fontWeight: '800',
  },
  actionHelper: {
    color: dispatchTheme.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 10,
  },
  actionButton: {
    alignItems: 'center',
    backgroundColor: dispatchTheme.accent,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  deliverButton: {
    marginTop: 10,
  },
  warningButton: {
    backgroundColor: '#b45309',
    marginTop: 10,
  },
  escalateButton: {
    backgroundColor: '#7c2d12',
    marginTop: 10,
  },
  actionButtonDisabled: {
    backgroundColor: '#d7c7b7',
  },
  actionButtonText: {
    color: dispatchTheme.textOnBrand,
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
  },
  assignCopy: {
    color: dispatchTheme.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  assignError: {
    color: dispatchTheme.dangerText,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 8,
  },
  assignLoading: {
    color: dispatchTheme.textMuted,
    fontSize: 14,
    marginTop: 4,
  },
  assignEmpty: {
    color: dispatchTheme.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
  },
  riderCard: {
    alignItems: 'center',
    backgroundColor: dispatchTheme.cream,
    borderRadius: radius.xl,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    padding: 14,
  },
  riderCardAssigned: {
    backgroundColor: dispatchTheme.accentSoft,
  },
  riderCardDisabled: {
    opacity: 0.5,
  },
  riderName: {
    color: dispatchTheme.text,
    fontSize: 15,
    fontWeight: '800',
  },
  riderMeta: {
    color: dispatchTheme.textMuted,
    fontSize: 13,
    marginTop: 4,
  },
  riderTrips: {
    color: dispatchTheme.accentStrong,
    fontSize: 13,
    fontWeight: '800',
  },
  eventRow: {
    borderTopColor: dispatchTheme.border,
    borderTopWidth: 1,
    paddingVertical: 12,
  },
  eventTitle: {
    color: dispatchTheme.text,
    fontSize: 14,
    fontWeight: '800',
    textTransform: 'capitalize',
  },
  eventMeta: {
    color: dispatchTheme.textMuted,
    fontSize: 12,
    marginTop: 4,
  },
  eventNote: {
    color: dispatchTheme.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },
});
