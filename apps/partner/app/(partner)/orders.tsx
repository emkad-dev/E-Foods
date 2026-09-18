import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MIN_TAP_TARGET, radius } from '@feasty/design-system';
import { KitchenBoard } from '../../src/components/KitchenBoard';
import { SkeletonListRow, SkeletonScreen } from '../../src/components/Skeleton';
import { useKitchenAlarm } from '../../src/contexts/KitchenAlarmContext';
import { isOrderAlarming, orderNeedsAcceptDecision } from '../../src/domain/kitchenAlarm';
import { formatOrderStatusLabel, formatPaymentStatusLabel } from '../../src/domain/orders';
import { getPartnerStatusColor } from '../../src/theme/statusColors';
import { usePartnerOrders } from '../../src/hooks/usePartnerOrders';
import { partnerTheme } from '../../src/theme/palette';
import { SCREEN_TITLE_SIZE, SCREEN_TITLE_WEIGHT, SCREEN_TOP_INSET } from '../../src/theme/screenChrome';
import {
  formatPartnerMoney,
  getKitchenElapsedLabel,
  getKitchenHistoryBucket,
  getKitchenLane,
  getKitchenSignal,
  getKitchenSignalColors,
} from '../../src/utils/partnerQueue';

// In-store kitchen tablets are the real target here (native Android/iOS, not just
// web), so this deliberately does NOT gate on Platform.OS the way the desktop
// admin-style chrome in index.tsx/_layout.tsx does -- width alone decides.
const KITCHEN_BOARD_BREAKPOINT = 900;

export default function PartnerOrdersScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isBoardLayout = width >= KITCHEN_BOARD_BREAKPOINT;
  const {
    activeOrders,
    completedToday,
    error,
    historyOrders,
    incomingOrders,
    loading,
    missingRestaurantLink,
    preparingOrders,
    refreshing,
    reload,
    restaurant,
  } = usePartnerOrders();
  const [selectedView, setSelectedView] = useState<'live' | 'history'>('live');
  const [historyFilter, setHistoryFilter] = useState<'all' | 'delivered' | 'cancelled' | 'failed'>('all');
  const { state: alarmState, syncNewOrders } = useKitchenAlarm();

  // The alarm keys off the "New" lane only, exactly as the board's columns do --
  // `getKitchenLane` rather than a `status === 'placed'` test, so a scheduled order
  // (not yet released to the kitchen) cannot set an alarm off, and a future status
  // cannot start alarming by accident.
  const newLaneOrders = useMemo(
    () => activeOrders.filter((order) => getKitchenLane(order.status) === 'new'),
    [activeOrders]
  );

  // THIS screen feeds the alarm, at BOTH widths, and the alarm state itself lives on
  // the (partner) layout. That split is the fix for two separate defects: the phone
  // branch below never mounted KitchenBoard, so nothing armed the alarm at all under
  // 900dp; and the state used to be local to the board, so opening a ticket unmounted
  // it and coming back re-announced every order in the queue.
  useEffect(() => {
    syncNewOrders(newLaneOrders);
  }, [newLaneOrders, syncNewOrders]);

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
      <SkeletonScreen>
        <SkeletonListRow />
        <SkeletonListRow />
        <SkeletonListRow />
        <SkeletonListRow />
        <SkeletonListRow />
      </SkeletonScreen>
    );
  }

  // ONE error card for both layouts. It used to exist only in the phone branch,
  // so a kitchen tablet — the device a service is actually run from — showed a
  // failed queue with no message and no way to retry but a full app restart.
  const queueErrorCard = error ? (
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
  ) : null;

  // `missingRestaurantLink`, not `!restaurant`. Both layouts used to branch on
  // `!restaurant` before ever reaching an error card, and the hook nulled the
  // restaurant on ANY load failure — so a dropped connection accused the partner
  // of an unlinked profile. That claim is now made only when a fetch completed
  // and genuinely came back without a restaurant.
  const notLinkedCard = (
    <View style={styles.emptyCard}>
      <Text style={styles.emptyTitle}>Restaurant profile not linked</Text>
      <Text style={styles.emptyCopy}>We need a matching restaurant record before partner orders can be filtered.</Text>
    </View>
  );

  if (isBoardLayout) {
    return (
      <View style={[styles.boardScreen, { paddingTop: insets.top + SCREEN_TOP_INSET }]}>
        {queueErrorCard}
        {restaurant ? (
          <KitchenBoard
            activeOrders={activeOrders}
            restaurantName={restaurant.name}
            onSelectOrder={(orderId) => router.push(`/(partner)/order/${orderId}`)}
          />
        ) : missingRestaurantLink ? (
          notLinkedCard
        ) : null}
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingTop: insets.top + SCREEN_TOP_INSET }]}>
      <Text style={styles.title}>{restaurant?.name ?? 'Orders'}</Text>
      <Text style={styles.copy}>
        Kitchen work is now split into live queue and history so new tickets, cooking orders, and handoff pressure stay visible.
      </Text>

      {!restaurant ? (
        <>
          {queueErrorCard}
          {missingRestaurantLink ? notLinkedCard : null}
        </>
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

          {queueErrorCard}

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
                    {/*
                      The tint carries the status hue; the label is `text`, not the
                      status colour. Colouring the label made each status sit on a
                      12.5% wash of itself, where six of the seven branches failed AA
                      (escalated/placed bottomed out at 2.40:1). Same rule as
                      order/[id].tsx and as the `Badge` primitive.
                    */}
                    <View style={[styles.statusPill, { backgroundColor: `${getPartnerStatusColor(order.status)}20` }]}>
                      <Text style={styles.statusText}>{formatOrderStatusLabel(order.status)}</Text>
                    </View>
                  </View>

                  <View style={styles.signalRow}>
                    <View style={[styles.signalChip, { backgroundColor: signalColors.backgroundColor }]}>
                      <Text style={[styles.signalChipText, { color: signalColors.textColor }]}>{kitchenSignal.label}</Text>
                    </View>
                    <Text style={styles.elapsedText}>{getKitchenElapsedLabel(order.createdAt)}</Text>
                  </View>

                  {/*
                    Same distinction the board draws, on the phone list: an order that
                    has been acknowledged but not yet accepted reads differently from
                    one nobody has looked at. Without it both say only "placed", and
                    the kitchen cannot tell what it has already handled.
                  */}
                  {getKitchenLane(order.status) === 'new' && orderNeedsAcceptDecision(alarmState, order.id) ? (
                    <View
                      style={[
                        styles.alarmChip,
                        isOrderAlarming(alarmState, order.id) ? styles.alarmChipUnseen : styles.alarmChipSeen,
                      ]}
                    >
                      <Text
                        style={[
                          styles.alarmChipText,
                          isOrderAlarming(alarmState, order.id)
                            ? styles.alarmChipUnseenText
                            : styles.alarmChipSeenText,
                        ]}
                      >
                        {isOrderAlarming(alarmState, order.id) ? 'Unseen · alarming' : 'Seen · not accepted'}
                      </Text>
                    </View>
                  ) : null}

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
  boardScreen: {
    backgroundColor: partnerTheme.background,
    flex: 1,
    paddingBottom: 18,
    paddingHorizontal: 18,
  },
  content: {
    alignSelf: 'center',
    maxWidth: 1100,
    paddingHorizontal: 18,
    paddingBottom: 30,
    width: '100%',
  },
  title: {
    color: partnerTheme.text,
    fontSize: SCREEN_TITLE_SIZE,
    fontWeight: SCREEN_TITLE_WEIGHT,
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
    borderRadius: radius.xl,
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
    justifyContent: 'center',
    minHeight: MIN_TAP_TARGET,
    backgroundColor: partnerTheme.surfaceMuted,
    borderRadius: radius.pill,
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
    color: partnerTheme.textOnBrand,
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
    backgroundColor: partnerTheme.surface,
    borderColor: partnerTheme.border,
    borderRadius: radius.pill,
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
    color: partnerTheme.textOnBrand,
    fontSize: 12,
    fontWeight: '700',
  },
  errorCard: {
    backgroundColor: partnerTheme.dangerSoft,
    borderColor: '#efc4bd',
    borderRadius: radius.xl,
    borderWidth: 1,
    marginTop: 14,
    padding: 16,
  },
  errorTitle: {
    color: partnerTheme.dangerText,
    fontSize: 15,
    fontWeight: '800',
  },
  errorText: {
    color: partnerTheme.dangerText,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
  },
  retryButton: {
    justifyContent: 'center',
    minHeight: MIN_TAP_TARGET,
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: partnerTheme.danger,
    borderRadius: radius.pill,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  retryButtonDisabled: {
    opacity: 0.7,
  },
  retryButtonText: {
    color: partnerTheme.textOnBrand,
    fontSize: 13,
    fontWeight: '700',
  },
  emptyCard: {
    backgroundColor: partnerTheme.surface,
    borderRadius: radius.xl,
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
    borderRadius: radius.xl,
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
    borderRadius: radius.lg,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  statusText: {
    color: partnerTheme.text,
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
    color: partnerTheme.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  orderMeta: {
    color: partnerTheme.textMuted,
    fontSize: 13,
    marginTop: 8,
  },
  alarmChip: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  alarmChipUnseen: {
    backgroundColor: partnerTheme.accentSoft,
  },
  alarmChipSeen: {
    backgroundColor: partnerTheme.surfaceMuted,
  },
  alarmChipText: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  alarmChipUnseenText: {
    color: partnerTheme.accentStrong,
  },
  alarmChipSeenText: {
    color: partnerTheme.textMuted,
  },
});
