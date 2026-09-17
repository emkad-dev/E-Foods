// Tablet kitchen-display board (Task 15 / F1). Rendered by orders.tsx at >=900dp
// width instead of the phone list. Consumes the SAME usePartnerOrders-derived
// order list -- no new fetch, no polling.
//
// LANES, NOT A STATUS SWITCH. This component used to decide placement with an
// if/else chain over five statuses while usePartnerOrders handed it everything
// non-terminal. `escalated`, `picked_up` and `on_the_way` matched no branch and
// were rendered NOWHERE -- no column, no count, no ticket, no warning. Placement
// now comes from `getKitchenLane` in ../utils/partnerQueue.ts, whose exhaustive
// Record makes a new order status a compile error until it is given a lane, and
// the fallback below routes anything unmapped into the attention strip rather
// than dropping it.
//
// THE ALARM IS NO LONGER THIS COMPONENT'S. The audio player, the 20s repeat, the
// keep-awake lock, the seen-ids state and the full-screen interstitial all used to
// live here -- which is why a phone, where orders.tsx never mounts this board, was
// never told an order had arrived at all, and why walking into an order detail and
// back re-armed the alarm for the whole queue. They now live in
// ../contexts/KitchenAlarmContext.tsx, mounted on the (partner) group layout, which
// survives both the width check and the navigation. What is left here is the board's
// own job: routing orders into lanes, and showing per ticket whether its alarm has
// been seen.
import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MIN_TAP_TARGET, radius } from '@feasty/design-system';
import { useKitchenAlarm } from '../contexts/KitchenAlarmContext';
import type { OrderDocument } from '../domain/entities';
import { isOrderAlarming, orderNeedsAcceptDecision } from '../domain/kitchenAlarm';
import { formatOrderStatusLabel } from '../domain/orders';
import { partnerTheme } from '../theme/palette';
import {
  KITCHEN_LANES,
  type KitchenLane,
  countModifiedOrderItems,
  formatPartnerMoney,
  getKitchenElapsedLabel,
  getKitchenLane,
} from '../utils/partnerQueue';

const orderItemCount = (order: OrderDocument) => order.items?.reduce((sum, item) => sum + (item.quantity ?? 0), 0) ?? 0;

/** The four lanes the kitchen actually works out of, in board order. */
const BOARD_COLUMNS: { key: Extract<KitchenLane, 'scheduled' | 'new' | 'preparing' | 'ready'>; title: string }[] = [
  { key: 'scheduled', title: 'Scheduled' },
  { key: 'new', title: 'New' },
  { key: 'preparing', title: 'Preparing' },
  { key: 'ready', title: 'Ready' },
];

// Task 18 (G2): a scheduled order shows its slot, not kitchen-elapsed time —
// the kitchen has not started it yet.
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
    hour: 'numeric',
    minute: '2-digit',
  });
};

type KitchenBoardProps = {
  activeOrders: OrderDocument[];
  restaurantName: string | null;
  onSelectOrder: (orderId: string) => void;
};

export function KitchenBoard({ activeOrders, restaurantName, onSelectOrder }: KitchenBoardProps) {
  const { setMuted, state } = useKitchenAlarm();

  // Task 18 (G2): scheduled orders live in their own lane, NOT "New" — the
  // kitchen should not treat a not-yet-released order as a live ticket (and the
  // new-order alarm keys off the "New" lane only -- orders.tsx feeds exactly this
  // lane to the alarm provider).
  //
  // activeOrders arrives already sorted by usePartnerOrders
  // (sortLiveKitchenOrders), so grouping in order preserves that ordering inside
  // every lane — escalated first in the attention strip, oldest ticket first in
  // each column.
  const lanes = useMemo(() => {
    const grouped = Object.fromEntries(KITCHEN_LANES.map((lane) => [lane, [] as OrderDocument[]])) as Record<
      KitchenLane,
      OrderDocument[]
    >;

    for (const order of activeOrders) {
      // `?? 'attention'` is the last line of defence, not dead code: a terminal
      // status reaching this list (getKitchenLane returns null for those) would
      // otherwise be dropped exactly the way escalated/picked_up/on_the_way were.
      // Nothing handed to this board may go unrendered — show it loudly instead.
      grouped[getKitchenLane(order.status) ?? 'attention'].push(order);
    }

    return grouped;
  }, [activeOrders]);

  // One ticket shape for the columns and both strips, so a lane cannot quietly
  // grow its own reduced version that omits the overdue badge or the modifiers.
  const renderTicket = (order: OrderDocument, lane: KitchenLane) => {
    const modifiedItems = countModifiedOrderItems(order);
    // "I have seen this" and "I have accepted this" are different facts, and the
    // board used to render them identically: every ticket in New looked equally
    // fresh, so an order somebody had already walked over to and acknowledged was
    // indistinguishable from one that had just landed. The reducer has always
    // tracked both -- `alarming` (announced, unacknowledged) and `acknowledged`
    // (seen, still undecided) -- and these two predicates were exported and tested
    // with nothing calling them. This is the difference, on the ticket.
    const alarming = isOrderAlarming(state, order.id);
    const awaitingDecision = orderNeedsAcceptDecision(state, order.id);

    return (
      <TouchableOpacity
        key={order.id}
        style={[
          styles.ticketCard,
          lane === 'attention' || lane === 'handedOff' ? styles.ticketCardStrip : null,
          lane === 'attention' ? styles.ticketCardAttention : null,
        ]}
        activeOpacity={0.9}
        onPress={() => onSelectOrder(order.id)}
      >
        <Text style={styles.ticketNumber}>#{order.id.slice(-6)}</Text>

        {/*
          The acceptance deadline made visible at last. The sweep leaves this
          order 'placed' and only raises needsAttention, so the status chip alone
          cannot tell the kitchen its clock already ran out — and it is the
          restaurant that pays for the miss. No countdown is shown: the deadline
          length lives in PlatformSettings and is never sent to this app, so a
          timer here would be invented rather than measured.
        */}
        {order.needsAttention === true ? (
          <View style={styles.ticketOverdue}>
            <Text style={styles.ticketOverdueText}>Acceptance overdue</Text>
          </View>
        ) : null}

        {lane === 'new' && awaitingDecision ? (
          <View style={[styles.ticketAlarm, alarming ? styles.ticketAlarmUnseen : styles.ticketAlarmSeen]}>
            <Text style={[styles.ticketAlarmText, alarming ? styles.ticketAlarmUnseenText : styles.ticketAlarmSeenText]}>
              {alarming ? 'Unseen · alarming' : 'Seen · not accepted'}
            </Text>
          </View>
        ) : null}

        <Text style={styles.ticketMeta}>
          {orderItemCount(order)} items · {formatPartnerMoney(order.pricing?.total ?? 0)}
        </Text>

        {/*
          Only when something is actually modified. The kitchen reads this board
          at a glance, and a line that is present-but-empty on the 90% of tickets
          with no modifiers trains people to stop reading it — which is the same
          way the modifiers got missed when there was no line at all.
        */}
        {modifiedItems > 0 ? (
          <Text style={styles.ticketModifiers}>
            {modifiedItems === 1 ? '1 item has options' : `${modifiedItems} items have options`}
          </Text>
        ) : null}

        <Text style={styles.ticketElapsed}>
          {lane === 'scheduled'
            ? formatScheduledSlot(order.scheduledFor) ?? 'Scheduled'
            : lane === 'attention' || lane === 'handedOff'
              ? `${formatOrderStatusLabel(order.status)} · ${getKitchenElapsedLabel(order.createdAt)}`
              : getKitchenElapsedLabel(order.createdAt)}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.screen}>
      <View style={styles.topBar}>
        <Text style={styles.title}>{restaurantName ?? 'Kitchen display'}</Text>
        <TouchableOpacity
          style={[styles.muteButton, state.muted ? styles.muteButtonMuted : null]}
          onPress={() => setMuted(!state.muted)}
        >
          <Text style={[styles.muteButtonText, state.muted ? styles.muteButtonTextMuted : null]}>
            {state.muted ? 'Sound off' : 'Sound on'}
          </Text>
        </TouchableOpacity>
      </View>

      {/*
        ABOVE the columns and loud: an escalated order is one dispatch pulled out
        of the flow, and every partner action on it is disabled — the kitchen
        cannot fix it, but somebody must see it. Rendered only when occupied, so
        the ordinary board is unchanged.
      */}
      {lanes.attention.length > 0 ? (
        <View style={styles.attentionStrip}>
          <Text style={styles.attentionTitle}>Needs attention · {lanes.attention.length}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.stripList}>
            {lanes.attention.map((order) => renderTicket(order, 'attention'))}
          </ScrollView>
        </View>
      ) : null}

      <View style={styles.board}>
        {BOARD_COLUMNS.map((column) => (
          <View key={column.key} style={styles.column}>
            <View style={styles.columnHeader}>
              <Text style={styles.columnTitle}>{column.title}</Text>
              <View style={styles.columnCount}>
                <Text style={styles.columnCountText}>{lanes[column.key].length}</Text>
              </View>
            </View>

            <ScrollView contentContainerStyle={styles.columnList}>
              {lanes[column.key].length === 0 ? (
                <Text style={styles.columnEmpty}>No tickets</Text>
              ) : (
                lanes[column.key].map((order) => renderTicket(order, column.key))
              )}
            </ScrollView>
          </View>
        ))}
      </View>

      {/*
        BELOW the columns and quiet: a rider has this food, so it is no longer
        the kitchen's work — but it is not finished either, and it used to vanish
        outright. Present, countable, tappable; not competing with the lanes
        someone is cooking out of.
      */}
      {lanes.handedOff.length > 0 ? (
        <View style={styles.handoffStrip}>
          <Text style={styles.handoffTitle}>Handed off · {lanes.handedOff.length}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.stripList}>
            {lanes.handedOff.map((order) => renderTicket(order, 'handedOff'))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 16,
    paddingHorizontal: 4,
  },
  title: {
    color: partnerTheme.text,
    fontSize: 30,
    fontWeight: '800',
  },
  muteButton: {
    justifyContent: 'center',
    minHeight: MIN_TAP_TARGET,
    backgroundColor: partnerTheme.accentSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  muteButtonMuted: {
    backgroundColor: partnerTheme.dangerSoft,
  },
  muteButtonText: {
    color: partnerTheme.accentStrong,
    fontSize: 16,
    fontWeight: '800',
  },
  muteButtonTextMuted: {
    color: partnerTheme.dangerText,
  },
  attentionStrip: {
    backgroundColor: partnerTheme.dangerSoft,
    borderRadius: radius.xl,
    marginBottom: 16,
    paddingBottom: 14,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  attentionTitle: {
    color: partnerTheme.dangerText,
    fontSize: 20,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  handoffStrip: {
    backgroundColor: partnerTheme.surfaceMuted,
    borderRadius: radius.xl,
    marginTop: 16,
    paddingBottom: 14,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  handoffTitle: {
    color: partnerTheme.textMuted,
    fontSize: 18,
    fontWeight: '800',
  },
  stripList: {
    flexDirection: 'row',
    gap: 12,
    paddingTop: 12,
  },
  board: {
    flex: 1,
    flexDirection: 'row',
    gap: 16,
  },
  column: {
    backgroundColor: partnerTheme.surface,
    borderColor: partnerTheme.border,
    borderRadius: radius.xl,
    borderWidth: 1,
    flex: 1,
    overflow: 'hidden',
  },
  columnHeader: {
    alignItems: 'center',
    backgroundColor: partnerTheme.surfaceMuted,
    borderBottomColor: partnerTheme.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 18,
  },
  columnTitle: {
    color: partnerTheme.text,
    fontSize: 24,
    fontWeight: '800',
  },
  columnCount: {
    backgroundColor: partnerTheme.hero,
    borderRadius: radius.pill,
    minWidth: 36,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  columnCountText: {
    color: partnerTheme.textOnBrand,
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  columnList: {
    padding: 14,
  },
  columnEmpty: {
    color: partnerTheme.textMuted,
    fontSize: 16,
    padding: 12,
    textAlign: 'center',
  },
  ticketCard: {
    backgroundColor: partnerTheme.background,
    borderRadius: radius.lg,
    marginBottom: 12,
    padding: 16,
  },
  ticketCardStrip: {
    // Strips lay tickets out horizontally, so the column's bottom gap becomes a
    // width floor instead.
    marginBottom: 0,
    minWidth: 240,
  },
  ticketCardAttention: {
    // The strip's own fill is already dangerSoft, so the card needs a border to
    // stay a distinct ticket rather than melting into the band behind it.
    borderColor: partnerTheme.danger,
    borderWidth: 2,
  },
  ticketNumber: {
    color: partnerTheme.text,
    fontSize: 22,
    fontWeight: '800',
  },
  ticketOverdue: {
    alignSelf: 'flex-start',
    backgroundColor: partnerTheme.dangerSoft,
    borderRadius: radius.pill,
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  ticketOverdueText: {
    // `dangerText` on `dangerSoft`, not the saturated fill red — the pairing
    // partnerQueue's getKitchenSignalColors settled on for the same surface.
    color: partnerTheme.dangerText,
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  ticketAlarm: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  ticketAlarmUnseen: {
    backgroundColor: partnerTheme.accentSoft,
  },
  ticketAlarmSeen: {
    backgroundColor: partnerTheme.surfaceMuted,
  },
  ticketAlarmText: {
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  ticketAlarmUnseenText: {
    color: partnerTheme.accentStrong,
  },
  ticketAlarmSeenText: {
    // Deliberately quiet: an acknowledged ticket has already had its moment and
    // must not keep competing with the one that has not been seen yet.
    color: partnerTheme.textMuted,
  },
  ticketMeta: {
    color: partnerTheme.textMuted,
    fontSize: 16,
    marginTop: 6,
  },
  ticketModifiers: {
    color: partnerTheme.accentStrong,
    fontSize: 14,
    fontWeight: '700',
    marginTop: 6,
  },
  ticketElapsed: {
    color: partnerTheme.textSoft,
    fontSize: 14,
    fontWeight: '700',
    marginTop: 8,
  },
});
