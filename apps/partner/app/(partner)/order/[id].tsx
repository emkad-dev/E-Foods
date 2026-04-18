import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatOrderStatusLabel, getOrderStatusColor, normalizeOrderStatus } from '../../../src/domain/orders';
import { usePartnerOrder } from '../../../src/hooks/usePartnerOrder';
import {
  acceptPartnerOrder,
  markPartnerOrderPreparing,
  markPartnerOrderReady,
  rejectPartnerOrder,
} from '../../../src/services/partnerOrderActions';
import { partnerTheme } from '../../../src/theme/palette';

export default function PartnerOrderDetailScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { error, loading, order } = usePartnerOrder(id as string);

  const handleAccept = async () => {
    if (!order) return;

    try {
      await acceptPartnerOrder(order.id, order.timeline ?? null);
    } catch (nextError: any) {
      Alert.alert('Update failed', nextError.message ?? 'Unable to accept this order.');
    }
  };

  const handlePreparing = async () => {
    if (!order) return;

    try {
      await markPartnerOrderPreparing(order.id, order.timeline ?? null);
    } catch (nextError: any) {
      Alert.alert('Update failed', nextError.message ?? 'Unable to mark this order as preparing.');
    }
  };

  const handleReady = async () => {
    if (!order) return;

    try {
      await markPartnerOrderReady(order.id, order.timeline ?? null);
    } catch (nextError: any) {
      Alert.alert('Update failed', nextError.message ?? 'Unable to mark this order ready.');
    }
  };

  const handleReject = async () => {
    if (!order) return;

    try {
      await rejectPartnerOrder(order.id, order.timeline ?? null);
      router.back();
    } catch (nextError: any) {
      Alert.alert('Update failed', nextError.message ?? 'Unable to reject this order.');
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingState}>
        <ActivityIndicator size="large" color={partnerTheme.accent} />
        <Text style={styles.loadingCopy}>Loading order details...</Text>
      </View>
    );
  }

  if (!order || error) {
    return (
      <View style={styles.loadingState}>
        <Text style={styles.errorTitle}>Order unavailable</Text>
        <Text style={styles.errorCopy}>{error ?? 'We could not load this order right now.'}</Text>
      </View>
    );
  }

  const normalizedStatus = normalizeOrderStatus(order.status);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>Kitchen flow</Text>
        <Text style={styles.title}>Order #{order.id.slice(-6)}</Text>
        <Text style={styles.copy}>
          {(order.items?.reduce((sum, item) => sum + (item.quantity ?? 0), 0) ?? 0)} items ·{' '}
          {(order.fulfillmentType ?? 'delivery').toUpperCase()} · ${(order.pricing?.total ?? order.total ?? 0).toFixed(2)}
        </Text>
        <View style={[styles.statusPill, { backgroundColor: `${getOrderStatusColor(order.status)}20` }]}>
          <Text style={[styles.statusText, { color: getOrderStatusColor(order.status) }]}>
            {formatOrderStatusLabel(order.status)}
          </Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Order items</Text>
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

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Handoff notes</Text>
        <Text style={styles.metaLine}>Payment: {order.payment?.status ?? 'pending'}</Text>
        <Text style={styles.metaLine}>
          Pickup/delivery point: {order.deliveryLocation?.shortAddress ?? order.deliveryAddress ?? 'Pending'}
        </Text>
        <Text style={styles.metaLine}>Assigned rider: {order.assignment?.courierName ?? 'Not assigned yet'}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Actions</Text>
        <TouchableOpacity
          style={[styles.actionButton, normalizedStatus !== 'placed' ? styles.actionButtonDisabled : null]}
          disabled={normalizedStatus !== 'placed'}
          onPress={handleAccept}
        >
          <Text style={styles.actionButtonText}>Accept order</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.actionButton,
            !['accepted', 'placed'].includes(normalizedStatus) ? styles.actionButtonDisabled : null,
          ]}
          disabled={!['accepted', 'placed'].includes(normalizedStatus)}
          onPress={handlePreparing}
        >
          <Text style={styles.actionButtonText}>Start preparing</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.actionButton,
            !['accepted', 'preparing'].includes(normalizedStatus) ? styles.actionButtonDisabled : null,
          ]}
          disabled={!['accepted', 'preparing'].includes(normalizedStatus)}
          onPress={handleReady}
        >
          <Text style={styles.actionButtonText}>Mark ready for pickup</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.rejectButton,
            !['placed', 'accepted'].includes(normalizedStatus) ? styles.actionButtonDisabled : null,
          ]}
          disabled={!['placed', 'accepted'].includes(normalizedStatus)}
          onPress={handleReject}
        >
          <Text style={styles.rejectButtonText}>Reject order</Text>
        </TouchableOpacity>
      </View>
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
  errorTitle: {
    color: partnerTheme.text,
    fontSize: 24,
    fontWeight: '800',
  },
  errorCopy: {
    color: partnerTheme.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
    textAlign: 'center',
  },
  hero: {
    backgroundColor: partnerTheme.hero,
    borderRadius: 26,
    padding: 22,
  },
  eyebrow: {
    color: partnerTheme.textSoft,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  title: {
    color: partnerTheme.text,
    fontSize: 30,
    fontWeight: '800',
  },
  copy: {
    color: partnerTheme.textMuted,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
  },
  statusPill: {
    alignSelf: 'flex-start',
    borderRadius: 16,
    marginTop: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  card: {
    backgroundColor: partnerTheme.surface,
    borderRadius: 20,
    marginTop: 14,
    padding: 18,
  },
  cardTitle: {
    color: partnerTheme.text,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 8,
  },
  itemRow: {
    alignItems: 'center',
    borderTopColor: partnerTheme.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  itemName: {
    color: partnerTheme.text,
    fontSize: 15,
    fontWeight: '700',
  },
  itemMeta: {
    color: partnerTheme.textMuted,
    fontSize: 13,
    marginTop: 4,
  },
  itemPrice: {
    color: partnerTheme.accentStrong,
    fontSize: 15,
    fontWeight: '800',
  },
  metaLine: {
    color: partnerTheme.textMuted,
    fontSize: 14,
    lineHeight: 22,
    marginTop: 4,
  },
  actionButton: {
    alignItems: 'center',
    backgroundColor: partnerTheme.accent,
    borderRadius: 16,
    marginTop: 10,
    paddingVertical: 14,
  },
  actionButtonDisabled: {
    backgroundColor: '#d7d2c7',
  },
  actionButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  rejectButton: {
    alignItems: 'center',
    backgroundColor: partnerTheme.danger,
    borderRadius: 16,
    marginTop: 10,
    paddingVertical: 14,
  },
  rejectButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
});
