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
// The alarm-until-acknowledged behaviour is driven entirely by the pure reducer in
// ../domain/kitchenAlarm.ts via the ../hooks/useKitchenAlarm.ts wiring hook. This
// component only:
//  - routes each order into its lane (Needs attention / Scheduled / New /
//    Preparing / Ready / Handed off);
//  - renders the full-screen interstitial + per-order Acknowledge button;
//  - drives the 20s repeat chime and keep-awake as side effects off the hook's
//    derived `soundActive` boolean and the screen's foreground state -- neither of
//    which is logic that belongs in the reducer.
//
// Web guard: expo-audio and expo-keep-awake both ship web implementations, but
// browser autoplay policy can block/throw on player.play() without a prior user
// gesture, and Wake Lock has limited browser support. Every call into either
// module is wrapped so a failure there degrades to "no sound / no keep-awake"
// without breaking the board -- the interstitial and columns still work on web.
import { useEffect, useMemo, useRef } from 'react';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useAudioPlayer } from 'expo-audio';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAppStateVisibility } from '../../../../packages/runtime/src/useAppStateVisibility';
import type { OrderDocument } from '../domain/entities';
import { formatOrderStatusLabel } from '../domain/orders';
import { useKitchenAlarm } from '../hooks/useKitchenAlarm';
import { partnerTheme } from '../theme/palette';
import {
  KITCHEN_LANES,
  type KitchenLane,
  countModifiedOrderItems,
  formatPartnerMoney,
  getKitchenElapsedLabel,
  getKitchenLane,
} from '../utils/partnerQueue';

const KITCHEN_ALARM_REPEAT_MS = 20000;
const KITCHEN_ALARM_KEEP_AWAKE_TAG = 'kitchen-board';

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
  const isForeground = useAppStateVisibility();

  // Task 18 (G2): scheduled orders live in their own lane, NOT "New" — the
  // kitchen should not treat a not-yet-released order as a live ticket (and the
  // new-order alarm below keys off the "New" lane only).
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

  // The new-order alarm keys off the "New" (placed) lane only.
  const newOrderIds = useMemo(() => lanes.new.map((order) => order.id), [lanes]);
  const { state, soundActive, interstitialVisible, acknowledge, setMuted } = useKitchenAlarm(newOrderIds);

  const alarmingOrders = useMemo(
    () => lanes.new.filter((order) => state.alarming.has(order.id)),
    [lanes, state.alarming]
  );

  // expo-audio's web implementation is present, but browser autoplay policy can
  // still block an unprompted play() call -- that failure is caught below and the
  // board simply stays visual-only until the tab has had a user gesture.
  const alarmPlayer = useAudioPlayer(require('../../assets/sounds/kitchen-alarm.wav'));
  const alarmPlayerRef = useRef(alarmPlayer);
  alarmPlayerRef.current = alarmPlayer;

  const playAlarmTone = () => {
    const player = alarmPlayerRef.current;
    if (!player) {
      return;
    }

    try {
      const seekResult = player.seekTo(0);
      Promise.resolve(seekResult)
        .catch(() => {})
        .finally(() => {
          try {
            player.play();
          } catch {
            // Autoplay blocked (web) or player not ready -- interstitial still shows.
          }
        });
    } catch {
      // Ignore -- sound is a courtesy on top of the always-visible interstitial.
    }
  };

  // Repeat cadence lives here, not in the reducer: while anything is alarming and
  // unmuted, chime immediately and then every 20s until acknowledge/mute/mute-off
  // changes `soundActive`, at which point the effect tears the interval down.
  useEffect(() => {
    if (!soundActive) {
      return;
    }

    playAlarmTone();
    const intervalId = setInterval(playAlarmTone, KITCHEN_ALARM_REPEAT_MS);

    return () => clearInterval(intervalId);
  }, [soundActive]);

  // Keep-awake only while this board is mounted AND the app is foregrounded --
  // deactivating on cleanup covers both background and unmount, so a tablet left
  // idle overnight is not held awake by a hidden/unmounted screen.
  useEffect(() => {
    if (!isForeground) {
      return;
    }

    activateKeepAwakeAsync(KITCHEN_ALARM_KEEP_AWAKE_TAG).catch(() => {
      // Web Wake Lock has limited support / requires a secure context -- degrade silently.
    });

    return () => {
      deactivateKeepAwake(KITCHEN_ALARM_KEEP_AWAKE_TAG).catch(() => {});
    };
  }, [isForeground]);

  // One ticket shape for the columns and both strips, so a lane cannot quietly
  // grow its own reduced version that omits the overdue badge or the modifiers.
  const renderTicket = (order: OrderDocument, lane: KitchenLane) => {
    const modifiedItems = countModifiedOrderItems(order);

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

      {interstitialVisible ? (
        <View style={styles.interstitial}>
          <Text style={styles.interstitialTitle}>
            {alarmingOrders.length > 1 ? `${alarmingOrders.length} new orders` : 'New order'}
          </Text>

          <ScrollView contentContainerStyle={styles.interstitialList}>
            {alarmingOrders.map((order) => (
              <View key={order.id} style={styles.interstitialCard}>
                <Text style={styles.interstitialOrderNumber}>#{order.id.slice(-6)}</Text>
                <Text style={styles.interstitialOrderMeta}>
                  {orderItemCount(order)} items · {formatPartnerMoney(order.pricing?.total ?? 0)}
                </Text>
                <TouchableOpacity style={styles.acknowledgeButton} onPress={() => acknowledge(order.id)}>
                  <Text style={styles.acknowledgeButtonText}>Acknowledge</Text>
                </TouchableOpacity>
              </View>
            ))}
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
    backgroundColor: partnerTheme.accentSoft,
    borderRadius: 999,
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
    borderRadius: 20,
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
    borderRadius: 20,
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
    borderRadius: 20,
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
    borderRadius: 999,
    minWidth: 36,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  columnCountText: {
    color: '#ffffff',
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
    borderRadius: 16,
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
    borderRadius: 999,
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
  interstitial: {
    alignItems: 'center',
    backgroundColor: 'rgba(13, 21, 34, 0.96)',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    padding: 24,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  interstitialTitle: {
    color: '#ffffff',
    fontSize: 44,
    fontWeight: '900',
    marginBottom: 24,
    textAlign: 'center',
  },
  interstitialList: {
    alignItems: 'center',
    gap: 16,
    paddingBottom: 24,
  },
  interstitialCard: {
    alignItems: 'center',
    backgroundColor: partnerTheme.surface,
    borderRadius: 24,
    minWidth: 320,
    padding: 28,
  },
  interstitialOrderNumber: {
    color: partnerTheme.text,
    fontSize: 34,
    fontWeight: '900',
  },
  interstitialOrderMeta: {
    color: partnerTheme.textMuted,
    fontSize: 18,
    marginTop: 10,
  },
  acknowledgeButton: {
    backgroundColor: partnerTheme.accent,
    borderRadius: 999,
    marginTop: 20,
    paddingHorizontal: 32,
    paddingVertical: 16,
  },
  acknowledgeButtonText: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '800',
  },
});
