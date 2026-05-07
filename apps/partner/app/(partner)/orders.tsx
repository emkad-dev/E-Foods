import { useRouter } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatOrderStatusLabel, getOrderStatusColor } from '../../src/domain/orders';
import { usePartnerOrders } from '../../src/hooks/usePartnerOrders';
import { partnerTheme } from '../../src/theme/palette';

export default function PartnerOrdersScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { error, loading, orders, restaurant } = usePartnerOrders();

  if (loading) {
    return (
      <View style={styles.loadingState}>
        <ActivityIndicator size="large" color={partnerTheme.accent} />
        <Text style={styles.loadingCopy}>Loading restaurant orders...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}>
      <Text style={styles.title}>{restaurant?.name ?? 'Orders'}</Text>
      <Text style={styles.copy}>Track incoming, kitchen, and completed orders for this restaurant.</Text>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {!restaurant ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Restaurant profile not linked</Text>
          <Text style={styles.emptyCopy}>We need a matching restaurant record before partner orders can be filtered.</Text>
        </View>
      ) : orders.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No orders yet</Text>
          <Text style={styles.emptyCopy}>Once customers place orders for this store, they will appear here live.</Text>
        </View>
      ) : (
        orders.map((order) => (
          <TouchableOpacity
            key={order.id}
            style={styles.orderCard}
            activeOpacity={0.92}
            onPress={() => router.push(`/(partner)/order/${order.id}`)}
          >
            <View style={styles.orderHeader}>
              <Text style={styles.orderTitle}>Order #{order.id.slice(-6)}</Text>
              <View style={[styles.statusPill, { backgroundColor: `${getOrderStatusColor(order.status)}20` }]}>
                <Text style={[styles.statusText, { color: getOrderStatusColor(order.status) }]}>
                  {formatOrderStatusLabel(order.status)}
                </Text>
              </View>
            </View>
            <Text style={styles.orderMeta}>
              {order.items?.reduce((sum, item) => sum + (item.quantity ?? 0), 0) ?? 0} items {'·'}{' '}
              {(order.fulfillmentType ?? 'delivery').toUpperCase()}
            </Text>
            <Text style={styles.orderMeta}>Total ${(order.pricing?.total ?? order.total ?? 0).toFixed(2)}</Text>
          </TouchableOpacity>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: partnerTheme.background,
    flex: 1,
  },
  content: {
    paddingHorizontal: 18,
    paddingBottom: 30,
  },
  loadingState: {
    alignItems: 'center',
    backgroundColor: partnerTheme.background,
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  loadingCopy: {
    color: partnerTheme.textMuted,
    fontSize: 15,
    marginTop: 12,
  },
  title: {
    color: partnerTheme.text,
    fontSize: 28,
    fontWeight: '800',
  },
  copy: {
    color: partnerTheme.textMuted,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 8,
  },
  errorText: {
    color: partnerTheme.danger,
    fontSize: 13,
    marginTop: 12,
  },
  emptyCard: {
    backgroundColor: partnerTheme.surface,
    borderRadius: 20,
    marginTop: 14,
    padding: 18,
  },
  emptyTitle: {
    color: partnerTheme.text,
    fontSize: 17,
    fontWeight: '800',
  },
  emptyCopy: {
    color: partnerTheme.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
  },
  orderCard: {
    backgroundColor: partnerTheme.surface,
    borderRadius: 20,
    marginTop: 12,
    padding: 18,
  },
  orderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  orderTitle: {
    color: partnerTheme.text,
    fontSize: 17,
    fontWeight: '800',
  },
  orderMeta: {
    color: partnerTheme.textMuted,
    fontSize: 13,
    marginTop: 8,
  },
  statusPill: {
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
});
