import { useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatOrderStatusLabel, formatPaymentStatusLabel } from '../../src/domain/orders';
import { getPartnerStatusColor } from '../../src/theme/statusColors';
import { usePartnerOrders } from '../../src/hooks/usePartnerOrders';
import { partnerTheme } from '../../src/theme/palette';
import {
  formatPartnerMoney,
  getKitchenElapsedLabel,
  getKitchenHistoryBucket,
  getKitchenSignal,
  getKitchenSignalColors,
} from '../../src/utils/partnerQueue';

export default function PartnerOrdersScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    activeOrders,
    completedToday,
    error,
    historyOrders,
    incomingOrders,
    loading,
    preparingOrders,
    refreshing,
    reload,
    restaurant,
  } = usePartnerOrders();
  const [selectedView, setSelectedView] = useState<'live' | 'history'>('live');
  const [historyFilter, setHistoryFilter] = useState<'all' | 'delivered' | 'cancelled' | 'failed'>('all');

  const historyCounts = useMemo(
    () => ({
      all: historyOrders.length,
      cancelled: historyOrders.filter((order) => getKitchenHistoryBucket(order) === 'cancelled').length,
      delivered: historyOrders.filter((order) => getKitchenHistoryBucket(order) === 'delivered').length,
      failed: historyOrders.filter((order) => getKitchenHistoryBucket(order) === 'failed').length,
    }),
    [historyOrders]
  );

  const filteredHistoryOrders = useMemo(() => {
    if (historyFilter === 'all') {
      return historyOrders;
    }

    return historyOrders.filter((order) => getKitchenHistoryBucket(order) === historyFilter);
  }, [historyFilter, historyOrders]);

  const visibleOrders = selectedView === 'live' ? activeOrders : filteredHistoryOrders;

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
      <Text style={styles.copy}>
        Kitchen work is now split into live queue and history so new tickets, cooking orders, and handoff pressure stay visible.
      </Text>

      {!restaurant ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Restaurant profile not linked</Text>
          <Text style={styles.emptyCopy}>We need a matching restaurant record before partner orders can be filtered.</Text>
        </View>
      ) : (
        <>
          <View style={styles.summaryRow}>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryValue}>{incomingOrders.length}</Text>
              <Text style={styles.summaryLabel}>New tickets</Text>
              <Text style={styles.summaryCopy}>Fresh orders waiting for kitchen acceptance.</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryValue}>{preparingOrders.length}</Text>
              <Text style={styles.summaryLabel}>Kitchen active</Text>
              <Text style={styles.summaryCopy}>{completedToday} delivered today from this store.</Text>
            </View>
          </View>

          <View style={styles.filterRow}>
            <TouchableOpacity
              style={[styles.filterChip, selectedView === 'live' ? styles.filterChipActive : null]}
              onPress={() => setSelectedView('live')}
            >
              <Text style={selectedView === 'live' ? styles.filterChipActiveText : styles.filterChipText}>
                Live ({activeOrders.length})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.filterChip, selectedView === 'history' ? styles.filterChipActive : null]}
              onPress={() => setSelectedView('history')}
            >
              <Text style={selectedView === 'history' ? styles.filterChipActiveText : styles.filterChipText}>
                History ({historyOrders.length})
              </Text>
            </TouchableOpacity>
          </View>

          {selectedView === 'history' ? (
            <View style={styles.historyFilterRow}>
              {([
                ['all', `All (${historyCounts.all})`],
                ['delivered', `Delivered (${historyCounts.delivered})`],
                ['cancelled', `Cancelled (${historyCounts.cancelled})`],
                ['failed', `Failed (${historyCounts.failed})`],
              ] as const).map(([value, label]) => (
                <TouchableOpacity
                  key={value}
                  style={[styles.historyFilterChip, historyFilter === value ? styles.historyFilterChipActive : null]}
                  onPress={() => setHistoryFilter(value)}
                >
                  <Text style={historyFilter === value ? styles.historyFilterChipActiveText : styles.historyFilterChipText}>
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}

          {error ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorTitle}>Kitchen queue unavailable</Text>
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity
                style={[styles.retryButton, refreshing ? styles.retryButtonDisabled : null]}
                onPress={reload}
                disabled={refreshing}
              >
                <Text style={styles.retryButtonText}>{refreshing ? 'Retrying...' : 'Retry queue'}</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {visibleOrders.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>{selectedView === 'live' ? 'No live kitchen orders' : 'No order history yet'}</Text>
              <Text style={styles.emptyCopy}>
                {selectedView === 'live'
                  ? 'New tickets will appear here first, followed by cooking and handoff work.'
                  : 'Delivered, cancelled, and failed orders will appear here once the restaurant starts trading.'}
              </Text>
            </View>
          ) : (
            visibleOrders.map((order) => {
              const kitchenSignal = getKitchenSignal(order);
              const signalColors = getKitchenSignalColors(kitchenSignal.tone);

              return (
                <TouchableOpacity
                  key={order.id}
                  style={styles.orderCard}
                  activeOpacity={0.92}
                  onPress={() => router.push(`/(partner)/order/${order.id}`)}
                >
                  <View style={styles.orderHeader}>
                    <Text style={styles.orderTitle}>Order #{order.id.slice(-6)}</Text>
                    <View style={[styles.statusPill, { backgroundColor: `${getPartnerStatusColor(order.status)}20` }]}>
                      <Text style={[styles.statusText, { color: getPartnerStatusColor(order.status) }]}>
                        {formatOrderStatusLabel(order.status)}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.signalRow}>
                    <View style={[styles.signalChip, { backgroundColor: signalColors.backgroundColor }]}>
                      <Text style={[styles.signalChipText, { color: signalColors.textColor }]}>{kitchenSignal.label}</Text>
                    </View>
                    <Text style={styles.elapsedText}>{getKitchenElapsedLabel(order.createdAt)}</Text>
                  </View>

                  <Text style={styles.orderMeta}>
                    {order.items?.reduce((sum, item) => sum + (item.quantity ?? 0), 0) ?? 0} items ·{' '}
                    {(order.fulfillmentType ?? 'delivery').toUpperCase()}
                  </Text>
                  <Text style={styles.orderMeta}>Total {formatPartnerMoney(order.pricing?.total ?? order.total ?? 0)}</Text>
                  <Text style={styles.orderMeta}>
                    Payment {formatPaymentStatusLabel(order.payment?.status, order.payment?.method)}
                  </Text>
                </TouchableOpacity>
              );
            })
          )}
        </>
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
    alignSelf: 'center',
    maxWidth: 1100,
    paddingHorizontal: 18,
    paddingBottom: 30,
    width: '100%',
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
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 18,
  },
  summaryCard: {
    backgroundColor: partnerTheme.surface,
    borderColor: partnerTheme.border,
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    width: '48.2%',
  },
  summaryValue: {
    color: partnerTheme.text,
    fontSize: 28,
    fontWeight: '800',
  },
  summaryLabel: {
    color: partnerTheme.text,
    fontSize: 14,
    fontWeight: '700',
    marginTop: 6,
  },
  summaryCopy: {
    color: partnerTheme.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 16,
  },
  filterChip: {
    backgroundColor: partnerTheme.surfaceMuted,
    borderRadius: 999,
    marginRight: 10,
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  filterChipActive: {
    backgroundColor: partnerTheme.accent,
  },
  filterChipText: {
    color: partnerTheme.textMuted,
    fontSize: 13,
    fontWeight: '700',
  },
  filterChipActiveText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  historyFilterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 10,
  },
  historyFilterChip: {
    backgroundColor: partnerTheme.surface,
    borderColor: partnerTheme.border,
    borderRadius: 999,
    borderWidth: 1,
    marginRight: 10,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  historyFilterChipActive: {
    backgroundColor: partnerTheme.hero,
    borderColor: partnerTheme.hero,
  },
  historyFilterChipText: {
    color: partnerTheme.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  historyFilterChipActiveText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  errorCard: {
    backgroundColor: partnerTheme.dangerSoft,
    borderColor: '#efc4bd',
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 14,
    padding: 16,
  },
  errorTitle: {
    color: partnerTheme.danger,
    fontSize: 15,
    fontWeight: '800',
  },
  errorText: {
    color: partnerTheme.danger,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
  },
  retryButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: partnerTheme.danger,
    borderRadius: 999,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  retryButtonDisabled: {
    opacity: 0.7,
  },
  retryButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
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
  signalRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  signalChip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  signalChipText: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  elapsedText: {
    color: partnerTheme.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  orderMeta: {
    color: partnerTheme.textMuted,
    fontSize: 13,
    marginTop: 8,
  },
});
