import { useMemo, useState } from 'react';
import { radius } from '../../../../packages/design-system/src/tokens/radius';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SkeletonListRow, SkeletonScreen } from '../../src/components/Skeleton';
import { formatOrderStatusLabel, formatPaymentStatusLabel, getOrderStatusColor } from '../../src/domain/orders';
import { useDispatchOrders } from '../../src/hooks/useDispatchOrders';
import { resolveDispatchOfferNotice } from '../../src/utils/routeNotices';
import { dispatchTheme } from '../../src/theme/palette';
import { MIN_TAP_TARGET } from '../../../../packages/design-system/src/tokens/space';
import {
  formatDispatchMoney,
  getDispatchAssignmentLabel,
  getDispatchElapsedLabel,
  getDispatchHistoryBucket,
  getDispatchQueueSignal,
  getDispatchSignalColors,
} from '../../src/utils/dispatchQueue';

export default function DeliveriesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ notice?: string | string[] }>();
  // The offer screen answers accept/decline and then routes here either way, so
  // its refusal has to be rendered on this side of the navigation -- by the
  // time it is known, that screen is unmounted. Previously the rider arrived
  // back at the queue with the offer silently gone.
  const offerNotice = resolveDispatchOfferNotice(params.notice);
  const {
    activeDeliveryOrders,
    completedDeliveryOrders,
    deliveredCount,
    error,
    loading,
    offers,
    refreshing,
    reload,
  } = useDispatchOrders();
  const [selectedView, setSelectedView] = useState<'live' | 'history'>('live');
  const [historyFilter, setHistoryFilter] = useState<'all' | 'delivered' | 'cancelled' | 'failed'>('all');

  const historyCounts = useMemo(
    () => ({
      all: completedDeliveryOrders.length,
      cancelled: completedDeliveryOrders.filter((order) => getDispatchHistoryBucket(order) === 'cancelled').length,
      delivered: completedDeliveryOrders.filter((order) => getDispatchHistoryBucket(order) === 'delivered').length,
      failed: completedDeliveryOrders.filter((order) => getDispatchHistoryBucket(order) === 'failed').length,
    }),
    [completedDeliveryOrders]
  );

  const filteredHistoryOrders = useMemo(() => {
    if (historyFilter === 'all') {
      return completedDeliveryOrders;
    }

    return completedDeliveryOrders.filter((order) => getDispatchHistoryBucket(order) === historyFilter);
  }, [completedDeliveryOrders, historyFilter]);

  const visibleOrders = selectedView === 'live' ? activeDeliveryOrders : filteredHistoryOrders;

  if (loading) {
    return (
      <SkeletonScreen>
        <SkeletonListRow />
        <SkeletonListRow />
        <SkeletonListRow />
        <SkeletonListRow />
        <SkeletonListRow />
      </SkeletonScreen>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}>
      <Text style={styles.title}>Delivery queue</Text>

      {/*
        THE IN-APP ENTRY POINT to the offer screen. Until this existed, `offers`
        was fetched on every queue load and thrown away: the only route to
        /offer/<id> was the push deep-link, so a rider with notifications
        denied, a stale Expo token, or the app already foregrounded on this tab
        never learned an offer existed. The 45s window would lapse with the
        rider sitting right here, idle, looking at the screen the offer should
        have appeared on.

        The data is already on the client, so this costs no extra round trip.
      */}
      {offers.length > 0 ? (
        <View style={styles.offerBanner}>
          <Text style={styles.offerBannerTitle}>
            {offers.length === 1 ? 'New delivery offer' : `${offers.length} delivery offers`}
          </Text>
          {offers.map((offer) => (
            <TouchableOpacity
              key={offer.id}
              style={styles.offerRow}
              onPress={() => router.push(`/offer/${offer.orderId}`)}
            >
              <View style={styles.offerRowText}>
                <Text style={styles.offerRestaurant}>
                  {offer.order?.restaurantName ?? 'Restaurant'}
                </Text>
                <Text style={styles.offerMeta}>
                  Order #{String(offer.orderId).slice(-6).toUpperCase()} - tap to respond
                </Text>
              </View>
              <Text style={styles.offerAction}>View</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
      <Text style={styles.copy}>
        Dispatch orders are now prioritized by rider risk, pickup pressure, and delivery stage instead of simple recency.
      </Text>

      <View style={styles.summaryRow}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryValue}>{activeDeliveryOrders.length}</Text>
          <Text style={styles.summaryLabel}>Live queue</Text>
          <Text style={styles.summaryCopy}>Orders needing assignment, pickup, or rider movement right now.</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryValue}>{historyCounts.delivered || deliveredCount}</Text>
          <Text style={styles.summaryLabel}>Delivered</Text>
          <Text style={styles.summaryCopy}>Completed delivery history in the current operating window.</Text>
        </View>
      </View>

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

      {offerNotice ? (
        <View style={styles.offerNoticeCard}>
          <Text style={styles.offerNoticeTitle}>Offer not available</Text>
          <Text accessibilityLiveRegion="assertive" role="alert" style={styles.offerNoticeText}>
            {offerNotice}
          </Text>
        </View>
      ) : null}

      {error ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>Dispatch queue unavailable</Text>
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
          <Text style={styles.emptyTitle}>
            {selectedView === 'live' ? 'No dispatch queue yet' : 'No completed deliveries yet'}
          </Text>
          <Text style={styles.emptyCopy}>
            {selectedView === 'live'
              ? 'Once customer delivery orders are placed, they will appear here for assignment and tracking.'
              : 'Completed, failed, and cancelled delivery orders will appear here as dispatch history.'}
          </Text>
        </View>
      ) : (
        visibleOrders.map((order) => {
          const queueSignal = getDispatchQueueSignal(order);
          const signalColors = getDispatchSignalColors(queueSignal.tone);
          const assignmentLabel = getDispatchAssignmentLabel(order);

          return (
            <TouchableOpacity
              key={order.id}
              style={styles.card}
              activeOpacity={0.92}
              onPress={() => router.push(`/delivery/${order.id}`)}
            >
              <View style={styles.header}>
                <Text style={styles.orderId}>Order #{order.id.slice(-6)}</Text>
                {/*
                  Was bare coloured text on the card: seven of the eleven
                  `getOrderStatusColor` branches failed AA there (`placed` #f5b342
                  at 1.79:1 on #fbfcfc). The colour was the only thing carrying the
                  status, so it moves to a 12.5% tint — the shape this app's own
                  dashboard already uses — and the label becomes legible `text`.
                */}
                <View style={[styles.priorityPill, { backgroundColor: `${getOrderStatusColor(order.status)}20` }]}>
                  <Text style={styles.priority}>{formatOrderStatusLabel(order.status)}</Text>
                </View>
              </View>

              <View style={styles.signalRow}>
                <View style={[styles.signalChip, { backgroundColor: signalColors.backgroundColor }]}>
                  <Text style={[styles.signalChipText, { color: signalColors.textColor }]}>{queueSignal.label}</Text>
                </View>
                <Text style={styles.elapsedText}>{getDispatchElapsedLabel(order.createdAt)}</Text>
              </View>

              <Text style={styles.route}>{order.restaurantName ?? 'Restaurant'}</Text>
              <Text style={styles.routeArrow}>
                to {order.deliveryLocation?.shortAddress ?? order.deliveryAddress ?? 'Customer address pending'}
              </Text>

              <View style={styles.assignmentRow}>
                <Text style={styles.assignmentLabel}>Rider</Text>
                <Text style={styles.assignmentValue}>{assignmentLabel}</Text>
              </View>

              <View style={styles.metaRow}>
                <Text style={styles.meta}>Items {order.items?.reduce((sum, item) => sum + (item.quantity ?? 0), 0) ?? 0}</Text>
                <Text style={styles.meta}>Total {formatDispatchMoney(order.pricing?.total ?? order.total ?? 0)}</Text>
                <Text style={styles.meta}>
                  Payment {formatPaymentStatusLabel(order.payment?.status, order.payment?.method)}
                </Text>
              </View>

              {order.deliveryLocation?.note ? <Text style={styles.note}>{order.deliveryLocation.note}</Text> : null}
            </TouchableOpacity>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  offerAction: {
    color: dispatchTheme.accentStrong,
    fontSize: 13,
    fontWeight: '700',
  },
  offerBanner: {
    backgroundColor: dispatchTheme.accentTint,
    borderColor: dispatchTheme.accentSoft,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: 14,
    padding: 14,
  },
  offerBannerTitle: {
    color: dispatchTheme.accentStrong,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8,
  },
  offerMeta: {
    color: dispatchTheme.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  offerRestaurant: {
    color: dispatchTheme.text,
    fontSize: 15,
    fontWeight: '600',
  },
  offerRow: {
    minHeight: MIN_TAP_TARGET,
    alignItems: 'center',
    backgroundColor: dispatchTheme.surface,
    borderRadius: radius.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  offerRowText: {
    flex: 1,
  },
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
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 18,
  },
  summaryCard: {
    backgroundColor: dispatchTheme.surface,
    borderColor: dispatchTheme.border,
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: 16,
    width: '48.2%',
  },
  summaryValue: {
    color: dispatchTheme.text,
    fontSize: 28,
    fontWeight: '800',
  },
  summaryLabel: {
    color: dispatchTheme.text,
    fontSize: 14,
    fontWeight: '700',
    marginTop: 6,
  },
  summaryCopy: {
    color: dispatchTheme.textMuted,
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
    justifyContent: 'center',
    minHeight: MIN_TAP_TARGET,
    backgroundColor: dispatchTheme.surfaceMuted,
    borderRadius: radius.pill,
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
    color: dispatchTheme.textOnBrand,
    fontSize: 13,
    fontWeight: '700',
  },
  historyFilterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 10,
  },
  historyFilterChip: {
    justifyContent: 'center',
    minHeight: MIN_TAP_TARGET,
    backgroundColor: dispatchTheme.surface,
    borderColor: dispatchTheme.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    marginRight: 10,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  historyFilterChipActive: {
    backgroundColor: dispatchTheme.hero,
    borderColor: dispatchTheme.hero,
  },
  historyFilterChipText: {
    color: dispatchTheme.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  historyFilterChipActiveText: {
    color: dispatchTheme.textOnBrand,
    fontSize: 12,
    fontWeight: '700',
  },
  // Same shape as errorCard below, which reports a queue that would not load.
  // This one reports an offer that is gone, so it carries no retry button:
  // there is nothing for the rider to retry.
  offerNoticeCard: {
    backgroundColor: dispatchTheme.dangerSoft,
    borderColor: '#efc4bd',
    borderRadius: radius.xl,
    borderWidth: 1,
    marginTop: 14,
    padding: 16,
  },
  offerNoticeTitle: {
    color: dispatchTheme.dangerText,
    fontSize: 15,
    fontWeight: '800',
  },
  offerNoticeText: {
    color: dispatchTheme.dangerText,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
  },
  errorCard: {
    backgroundColor: dispatchTheme.dangerSoft,
    borderColor: '#efc4bd',
    borderRadius: radius.xl,
    borderWidth: 1,
    marginTop: 14,
    padding: 16,
  },
  errorTitle: {
    color: dispatchTheme.dangerText,
    fontSize: 15,
    fontWeight: '800',
  },
  errorText: {
    color: dispatchTheme.dangerText,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
  },
  retryButton: {
    justifyContent: 'center',
    minHeight: MIN_TAP_TARGET,
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: dispatchTheme.danger,
    borderRadius: radius.pill,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  retryButtonDisabled: {
    opacity: 0.7,
  },
  retryButtonText: {
    color: dispatchTheme.textOnBrand,
    fontSize: 13,
    fontWeight: '700',
  },
  card: {
    backgroundColor: dispatchTheme.surface,
    borderRadius: radius['2xl'],
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
  priorityPill: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  priority: {
    color: dispatchTheme.text,
    fontSize: 12,
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
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  signalChipText: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  elapsedText: {
    color: dispatchTheme.textMuted,
    fontSize: 12,
    fontWeight: '700',
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
  assignmentRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  assignmentLabel: {
    color: dispatchTheme.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  assignmentValue: {
    color: dispatchTheme.text,
    fontSize: 13,
    fontWeight: '800',
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
    borderRadius: radius['2xl'],
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
