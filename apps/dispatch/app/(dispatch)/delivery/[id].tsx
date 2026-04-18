import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  formatOrderStatusLabel,
  getOrderStatusColor,
  normalizeOrderStatus,
} from '../../../src/domain/orders';
import { useDispatchOrder } from '../../../src/hooks/useDispatchOrder';
import { useDispatchRiders } from '../../../src/hooks/useDispatchRiders';
import {
  acceptDispatchOrder,
  assignDispatchCourier,
  markDispatchOrderDelivered,
  markDispatchOrderPickedUp,
} from '../../../src/services/dispatchOrderActions';
import { dispatchTheme } from '../../../src/theme/palette';

export default function DispatchDeliveryDetailScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { error, loading, order } = useDispatchOrder(id as string);
  const { error: ridersError, loading: ridersLoading, riders } = useDispatchRiders();

  const handleAcceptOrder = async () => {
    if (!order) {
      return;
    }

    try {
      await acceptDispatchOrder(order.id, order.timeline ?? null);
    } catch (nextError: any) {
      Alert.alert('Update failed', nextError.message ?? 'Could not accept this order.');
    }
  };

  const handleAssignRider = async (courier: { id: string; name: string }) => {
    if (!order) {
      return;
    }

    try {
      await assignDispatchCourier(order.id, courier, order.assignment ?? null);
    } catch (nextError: any) {
      Alert.alert('Assignment failed', nextError.message ?? 'Could not assign this rider.');
    }
  };

  const handleMarkPickedUp = async () => {
    if (!order) {
      return;
    }

    try {
      await markDispatchOrderPickedUp(order.id, order.timeline ?? null);
    } catch (nextError: any) {
      Alert.alert('Update failed', nextError.message ?? 'Could not confirm pickup.');
    }
  };

  const handleMarkDelivered = async () => {
    if (!order) {
      return;
    }

    try {
      await markDispatchOrderDelivered(order.id, order.timeline ?? null);
    } catch (nextError: any) {
      Alert.alert('Update failed', nextError.message ?? 'Could not mark this order delivered.');
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={dispatchTheme.accent} />
        <Text style={styles.loadingText}>Loading dispatch order...</Text>
      </View>
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
  const canAccept = normalizedStatus === 'placed';
  const canConfirmPickup = ['accepted', 'preparing', 'ready_for_pickup'].includes(normalizedStatus);
  const canMarkDelivered = ['picked_up', 'on_the_way'].includes(normalizedStatus);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>Dispatch order</Text>
        <Text style={styles.title}>Order #{order.id.slice(-6)}</Text>
        <Text style={styles.heroCopy}>
          {order.restaurantName ?? 'Restaurant'} to{' '}
          {order.deliveryLocation?.shortAddress ?? order.deliveryAddress ?? 'Customer address pending'}
        </Text>
        <View style={[styles.statusPill, { backgroundColor: `${getOrderStatusColor(order.status)}20` }]}>
          <Text style={[styles.statusPillText, { color: getOrderStatusColor(order.status) }]}>
            {formatOrderStatusLabel(order.status)}
          </Text>
        </View>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Order snapshot</Text>
        <Text style={styles.detailLine}>Fulfillment: {order.fulfillmentType ?? 'delivery'}</Text>
        <Text style={styles.detailLine}>
          Total: ${(order.pricing?.total ?? order.total ?? 0).toFixed(2)}
        </Text>
        <Text style={styles.detailLine}>Payment: {order.payment?.status ?? 'pending'}</Text>
        <Text style={styles.detailLine}>Assigned rider: {assignedCourier}</Text>
        <Text style={styles.detailLine}>
          Address: {order.deliveryAddress ?? order.deliveryLocation?.address ?? 'Customer address pending'}
        </Text>
        {order.deliveryLocation?.note ? <Text style={styles.detailNote}>Drop-off note: {order.deliveryLocation.note}</Text> : null}
      </View>

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
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[styles.actionButton, !canAccept ? styles.actionButtonDisabled : null]}
            onPress={handleAcceptOrder}
            disabled={!canAccept}
          >
            <Text style={styles.actionButtonText}>Accept order</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, !canConfirmPickup ? styles.actionButtonDisabled : null]}
            onPress={handleMarkPickedUp}
            disabled={!canConfirmPickup}
          >
            <Text style={styles.actionButtonText}>Confirm pickup</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={[styles.actionButton, styles.deliverButton, !canMarkDelivered ? styles.actionButtonDisabled : null]}
          onPress={handleMarkDelivered}
          disabled={!canMarkDelivered}
        >
          <Text style={styles.actionButtonText}>Mark delivered</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Assign rider</Text>
        <Text style={styles.assignCopy}>Tap a rider to write the assignment into the order document.</Text>
        {ridersError ? <Text style={styles.assignError}>{ridersError}</Text> : null}
        {ridersLoading ? (
          <Text style={styles.assignLoading}>Loading riders...</Text>
        ) : riders.length === 0 ? (
          <Text style={styles.assignEmpty}>
            No rider documents found in `dispatchProfiles` yet.
          </Text>
        ) : (
          riders.map((rider) => {
            const isAssigned = order.assignment?.courierId === rider.id;

            return (
              <TouchableOpacity
                key={rider.id}
                style={[styles.riderCard, isAssigned ? styles.riderCardAssigned : null]}
                onPress={() => handleAssignRider({ id: rider.id, name: rider.name })}
              >
                <View>
                  <Text style={styles.riderName}>{rider.name}</Text>
                  <Text style={styles.riderMeta}>{`${rider.zone} - ${rider.status} - ${rider.vehicleType}`}</Text>
                </View>
                <Text style={styles.riderTrips}>{rider.completedTrips} trips</Text>
              </TouchableOpacity>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: dispatchTheme.background,
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
    borderRadius: 14,
    marginTop: 16,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  backButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  hero: {
    backgroundColor: dispatchTheme.hero,
    borderRadius: 26,
    padding: 22,
  },
  eyebrow: {
    color: dispatchTheme.accentSoft,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  title: {
    color: dispatchTheme.cream,
    fontSize: 30,
    fontWeight: '800',
  },
  heroCopy: {
    color: '#f7ead8',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
  },
  statusPill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    marginTop: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  statusPillText: {
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  sectionCard: {
    backgroundColor: dispatchTheme.surface,
    borderRadius: 22,
    marginTop: 14,
    padding: 18,
  },
  sectionTitle: {
    color: dispatchTheme.text,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 10,
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
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  actionButton: {
    alignItems: 'center',
    backgroundColor: dispatchTheme.accent,
    borderRadius: 16,
    flex: 1,
    marginRight: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  deliverButton: {
    marginRight: 0,
    marginTop: 10,
  },
  actionButtonDisabled: {
    backgroundColor: '#d7c7b7',
  },
  actionButtonText: {
    color: '#ffffff',
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
    color: dispatchTheme.danger,
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
    borderRadius: 18,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    padding: 14,
  },
  riderCardAssigned: {
    backgroundColor: dispatchTheme.accentSoft,
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
});
