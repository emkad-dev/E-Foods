import { useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatOrderStatusLabel, getOrderStatusColor, isTerminalOrderStatus } from '../../src/domain/orders';
import { useDispatchOrders } from '../../src/hooks/useDispatchOrders';
import { dispatchTheme } from '../../src/theme/palette';

export default function DeliveriesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { activeDeliveryOrders, deliveredCount, error, loading, orders } = useDispatchOrders();
  const [selectedView, setSelectedView] = useState<'live' | 'history'>('live');
  const completedDeliveryOrders = useMemo(
    () =>
      orders.filter(
        (order) => (order.fulfillmentType ?? 'delivery') === 'delivery' && isTerminalOrderStatus(order.status)
      ),
    [orders]
  );
  const visibleOrders = selectedView === 'live' ? activeDeliveryOrders : completedDeliveryOrders;

  if (loading) {
    return (
      <View style={styles.loadingState}>
        <ActivityIndicator size="large" color={dispatchTheme.accent} />
        <Text style={styles.loadingCopy}>Loading live deliveries...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}>
      <Text style={styles.title}>Delivery queue</Text>
      <Text style={styles.copy}>
        A warmer working queue for dispatchers to spot late pickups, handoff risk, and rider load at a glance.
      </Text>

      <View style={styles.filterRow}>
        <TouchableOpacity
          style={[styles.filterChip, selectedView === 'live' ? styles.filterChipActive : null]}
          onPress={() => setSelectedView('live')}
        >
          <Text style={selectedView === 'live' ? styles.filterChipActiveText : styles.filterChipText}>
            Live now ({activeDeliveryOrders.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterChip, selectedView === 'history' ? styles.filterChipActive : null]}
          onPress={() => setSelectedView('history')}
        >
          <Text style={selectedView === 'history' ? styles.filterChipActiveText : styles.filterChipText}>
            History ({completedDeliveryOrders.length || deliveredCount})
          </Text>
        </TouchableOpacity>
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {visibleOrders.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>{selectedView === 'live' ? 'No dispatch queue yet' : 'No completed deliveries yet'}</Text>
          <Text style={styles.emptyCopy}>
            {selectedView === 'live'
              ? 'Once customer delivery orders hit Firestore, they will appear here for assignment and tracking.'
              : 'Completed, failed, and cancelled delivery orders will appear here as dispatch history.'}
          </Text>
        </View>
        ) : (
        visibleOrders.map((order) => (
          <TouchableOpacity
            key={order.id}
            style={styles.card}
            activeOpacity={0.92}
            onPress={() => router.push(`/delivery/${order.id}`)}
          >
            <View style={styles.header}>
              <Text style={styles.orderId}>Order #{order.id.slice(-6)}</Text>
              <Text style={[styles.priority, { color: getOrderStatusColor(order.status) }]}>
                {formatOrderStatusLabel(order.status)}
              </Text>
            </View>
            <Text style={styles.route}>{order.restaurantName ?? 'Restaurant'}</Text>
            <Text style={styles.routeArrow}>
              to {order.deliveryLocation?.shortAddress ?? order.deliveryAddress ?? 'Customer address pending'}
            </Text>
            <View style={styles.metaRow}>
              <Text style={styles.meta}>
                Items {order.items?.reduce((sum, item) => sum + (item.quantity ?? 0), 0) ?? 0}
              </Text>
              <Text style={styles.meta}>Total ${(order.pricing?.total ?? order.total ?? 0).toFixed(2)}</Text>
              <Text style={styles.meta}>Payment {order.payment?.status ?? 'pending'}</Text>
            </View>
            {order.deliveryLocation?.note ? <Text style={styles.note}>{order.deliveryLocation.note}</Text> : null}
          </TouchableOpacity>
        ))
      )}
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
  loadingState: {
    alignItems: 'center',
    backgroundColor: dispatchTheme.background,
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  loadingCopy: {
    color: dispatchTheme.textMuted,
    fontSize: 15,
    marginTop: 12,
    textAlign: 'center',
  },
  title: {
    color: dispatchTheme.text,
    fontSize: 30,
    fontWeight: '800',
  },
  copy: {
    color: dispatchTheme.textMuted,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 8,
  },
  errorText: {
    color: dispatchTheme.danger,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 12,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 18,
  },
  filterChip: {
    backgroundColor: dispatchTheme.surfaceMuted,
    borderRadius: 999,
    marginRight: 10,
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  filterChipActive: {
    backgroundColor: dispatchTheme.accent,
  },
  filterChipText: {
    color: dispatchTheme.textMuted,
    fontSize: 13,
    fontWeight: '700',
  },
  filterChipActiveText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  card: {
    backgroundColor: dispatchTheme.surface,
    borderRadius: 22,
    marginTop: 14,
    padding: 18,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  orderId: {
    color: dispatchTheme.text,
    fontSize: 18,
    fontWeight: '800',
  },
  priority: {
    color: '#b91c1c',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  route: {
    color: dispatchTheme.text,
    fontSize: 15,
    fontWeight: '700',
    marginTop: 10,
  },
  routeArrow: {
    color: dispatchTheme.textMuted,
    fontSize: 14,
    marginTop: 4,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 12,
  },
  meta: {
    color: dispatchTheme.accentStrong,
    fontSize: 13,
    fontWeight: '700',
    marginRight: 14,
    marginTop: 4,
  },
  note: {
    color: dispatchTheme.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 12,
  },
  emptyCard: {
    backgroundColor: dispatchTheme.surface,
    borderRadius: 22,
    marginTop: 14,
    padding: 20,
  },
  emptyTitle: {
    color: dispatchTheme.text,
    fontSize: 18,
    fontWeight: '800',
  },
  emptyCopy: {
    color: dispatchTheme.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
  },
});
