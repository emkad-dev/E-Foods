// Tablet kitchen-display board (Task 15 / F1). Rendered by orders.tsx at >=900dp
// width instead of the phone list. Consumes the SAME usePartnerOrders-derived
// order list -- no new fetch, no polling.
//
// The alarm-until-acknowledged behaviour is driven entirely by the pure reducer in
// ../domain/kitchenAlarm.ts via the ../hooks/useKitchenAlarm.ts wiring hook. This
// component only:
//  - maps order status -> column (New / Preparing / Ready);
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
import { normalizeOrderStatus } from '../domain/orders';
import { useKitchenAlarm } from '../hooks/useKitchenAlarm';
import { partnerTheme } from '../theme/palette';
import { formatPartnerMoney, getKitchenElapsedLabel } from '../utils/partnerQueue';

const KITCHEN_ALARM_REPEAT_MS = 20000;
const KITCHEN_ALARM_KEEP_AWAKE_TAG = 'kitchen-board';

const orderItemCount = (order: OrderDocument) => order.items?.reduce((sum, item) => sum + (item.quantity ?? 0), 0) ?? 0;

type KitchenColumn = {
  key: 'scheduled' | 'new' | 'preparing' | 'ready';
  title: string;
  orders: OrderDocument[];
};

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

  const columns = useMemo<KitchenColumn[]>(() => {
    const scheduledOrders: OrderDocument[] = [];
    const newOrders: OrderDocument[] = [];
    const preparingOrders: OrderDocument[] = [];
    const readyOrders: OrderDocument[] = [];

    for (const order of activeOrders) {
      const status = normalizeOrderStatus(order.status);

      // Task 18 (G2): scheduled orders live in their own lane, NOT "New" — the
      // kitchen should not treat a not-yet-released order as a live ticket (and
      // the new-order alarm below keys off the "New" lane only).
      if (status === 'scheduled') {
        scheduledOrders.push(order);
      } else if (status === 'placed') {
        newOrders.push(order);
      } else if (status === 'accepted' || status === 'preparing') {
        preparingOrders.push(order);
      } else if (status === 'ready_for_pickup') {
        readyOrders.push(order);
      }
    }

    return [
      { key: 'scheduled', title: 'Scheduled', orders: scheduledOrders },
      { key: 'new', title: 'New', orders: newOrders },
      { key: 'preparing', title: 'Preparing', orders: preparingOrders },
      { key: 'ready', title: 'Ready', orders: readyOrders },
    ];
  }, [activeOrders]);

  // The new-order alarm keys off the "New" (placed) lane, not scheduled — a
  // scheduled order must not trip the kitchen alarm until it is released.
  const newColumn = useMemo(() => columns.find((column) => column.key === 'new') ?? columns[0], [columns]);
  const newOrderIds = useMemo(() => newColumn.orders.map((order) => order.id), [newColumn]);
  const { state, soundActive, interstitialVisible, acknowledge, setMuted } = useKitchenAlarm(newOrderIds);

  const alarmingOrders = useMemo(
    () => newColumn.orders.filter((order) => state.alarming.has(order.id)),
    [newColumn, state.alarming]
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

      <View style={styles.board}>
        {columns.map((column) => (
          <View key={column.key} style={styles.column}>
            <View style={styles.columnHeader}>
              <Text style={styles.columnTitle}>{column.title}</Text>
              <View style={styles.columnCount}>
                <Text style={styles.columnCountText}>{column.orders.length}</Text>
              </View>
            </View>

            <ScrollView contentContainerStyle={styles.columnList}>
              {column.orders.length === 0 ? (
                <Text style={styles.columnEmpty}>No tickets</Text>
              ) : (
                column.orders.map((order) => (
                  <TouchableOpacity
                    key={order.id}
                    style={styles.ticketCard}
                    activeOpacity={0.9}
                    onPress={() => onSelectOrder(order.id)}
                  >
                    <Text style={styles.ticketNumber}>#{order.id.slice(-6)}</Text>
                    <Text style={styles.ticketMeta}>
                      {orderItemCount(order)} items · {formatPartnerMoney(order.pricing?.total ?? 0)}
                    </Text>
                    <Text style={styles.ticketElapsed}>
                      {column.key === 'scheduled'
                        ? formatScheduledSlot(order.scheduledFor) ?? 'Scheduled'
                        : getKitchenElapsedLabel(order.createdAt)}
                    </Text>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
          </View>
        ))}
      </View>

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
  ticketNumber: {
    color: partnerTheme.text,
    fontSize: 22,
    fontWeight: '800',
  },
  ticketMeta: {
    color: partnerTheme.textMuted,
    fontSize: 16,
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
