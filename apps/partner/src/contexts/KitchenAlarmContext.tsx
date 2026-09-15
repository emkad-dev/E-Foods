// The kitchen alarm, hoisted out of the kitchen board.
//
// WHY THIS IS A PROVIDER ON THE (partner) GROUP LAYOUT AND NOT A HOOK IN A SCREEN.
// Both the reducer state and the "ids I have already seen" ref used to be local to
// `useKitchenAlarm`, which was called by KitchenBoard, which is mounted by the orders
// screen. Tapping a ticket navigates to `order/[id]`, which unmounts the orders
// screen -- so the state reset to `initialKitchenAlarmState` and the seen-ids set
// emptied. Pressing back re-mounted the screen, every `placed` order looked brand new,
// and the alarm re-armed and re-sounded for orders somebody was already standing over.
// "Which orders have I announced" is a fact about the restaurant's queue for this
// session, not about one screen's mount. The (partner) layout stays mounted across
// every partner screen, so the state now outlives the navigation that used to reset it.
//
// WHY THE AUDIO AND KEEP-AWAKE LIVE HERE TOO. They were welded to KitchenBoard, and
// orders.tsx only mounts that board at >= 900dp. Staff running a shift from a phone got
// no sound, no alert, no keep-awake -- nothing told them an order had arrived at all.
// None of this mechanism is width-dependent, so it moved up here and every layout,
// phone included, is alerted by the same code.
//
// WHAT IS DELIBERATELY *NOT* HERE: a second order feed. This provider is fed by
// whichever screen is showing the queue (`syncNewOrders`), rather than running its own
// `usePartnerOrders`. A duplicate subscription + fallback poll would double app-rpc
// invocations for every partner, and invocations are what this project's Supabase cost
// is bound by. The cost is that while you sit on a non-queue screen nothing new can
// arrive into the alarm; what is already alarming keeps sounding and stays on screen.
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useAudioPlayer } from 'expo-audio';
import { Platform, StyleSheet, View } from 'react-native';
import { useAppStateVisibility } from '../../../../packages/runtime/src/useAppStateVisibility';
import { KitchenAlarmBanner } from '../components/KitchenAlarmBanner';
import type { OrderDocument } from '../domain/entities';
import {
  alarmingOrderIds,
  initialKitchenAlarmState,
  isAlarmVisible,
  isSoundActive,
  kitchenAlarmReducer,
  type KitchenAlarmState,
} from '../domain/kitchenAlarm';
import { getStoredKitchenAlarmMuted, storeKitchenAlarmMuted } from '../services/kitchenAlarmMute';

const KITCHEN_ALARM_REPEAT_MS = 20000;
const KITCHEN_ALARM_KEEP_AWAKE_TAG = 'kitchen-board';

/**
 * How long after asking for playback we check whether it actually started. Long
 * enough for a decoded local asset to move `currentTime` off zero, short enough that
 * the "Enable sound" affordance appears in the same breath as the first chime.
 */
const AUTOPLAY_PROBE_MS = 250;

export type KitchenAlarmContextValue = {
  state: KitchenAlarmState;
  /** The orders currently alarming, in queue order, with their details for the alert. */
  alarmingOrders: OrderDocument[];
  soundActive: boolean;
  alarmVisible: boolean;
  /** True when the browser refused playback. Audio is silently dead until a user gesture. */
  soundBlocked: boolean;
  /** True when the screen wake lock could not be held, so the device may sleep. */
  keepAwakeFailed: boolean;
  acknowledge: (orderId: string) => void;
  acknowledgeAll: () => void;
  setMuted: (muted: boolean) => void;
  /** Retry playback from inside a user gesture, which is the only thing that lifts an autoplay block. */
  enableSound: () => void;
  /** Called by whichever screen owns the order feed with the orders currently in the "New" lane. */
  syncNewOrders: (orders: readonly OrderDocument[]) => void;
};

const KitchenAlarmContext = createContext<KitchenAlarmContextValue | null>(null);

export const useKitchenAlarm = (): KitchenAlarmContextValue => {
  const value = useContext(KitchenAlarmContext);

  if (!value) {
    throw new Error('useKitchenAlarm must be used inside <KitchenAlarmProvider>.');
  }

  return value;
};

export function KitchenAlarmProvider({ children }: { children: React.ReactNode }) {
  const isForeground = useAppStateVisibility();
  const [state, dispatch] = useReducer(kitchenAlarmReducer, initialKitchenAlarmState);
  const [newOrders, setNewOrders] = useState<OrderDocument[]>([]);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const [keepAwakeFailed, setKeepAwakeFailed] = useState(false);
  const knownOrderIdsRef = useRef<ReadonlySet<string>>(new Set());
  const syncedKeyRef = useRef<string | null>(null);

  const alarmPlayer = useAudioPlayer(require('../../assets/sounds/kitchen-alarm.wav'));
  const alarmPlayerRef = useRef(alarmPlayer);
  alarmPlayerRef.current = alarmPlayer;

  // Hydrate the persisted per-device mute preference once on mount. Absence of a
  // stored value already resolves to `false` (unmuted), so there is nothing to
  // dispatch in that case -- the reducer's own default is already unmuted.
  useEffect(() => {
    let cancelled = false;

    getStoredKitchenAlarmMuted()
      .then((muted) => {
        if (!cancelled && muted) {
          dispatch({ type: 'mute_toggled', muted: true });
        }
      })
      .catch(() => {
        // Storage unavailable -- keep the reducer's unmuted default rather than block the alarm.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Did the sound we just asked for actually start?
   *
   * expo-audio's WEB player cannot tell us. `AudioPlayerWeb.play()` is typed
   * `play(): void` and its body is `this.media.play(); this.isPlaying = true;`
   * (node_modules/expo-audio/build/AudioModule.web.js) -- it DISCARDS the promise
   * `HTMLMediaElement.play()` returns, so an autoplay rejection is neither throwable
   * nor awaitable, and it then sets its own `isPlaying` flag true unconditionally, so
   * `player.playing` reports true while nothing is audible. A try/catch around
   * `play()` catches nothing at all here.
   *
   * The media element itself does not lie. A refused play leaves it paused with
   * `currentTime` still at the zero we seeked to, and both are on the public
   * AudioPlayer type. That pair is the only honest signal available.
   */
  const probePlaybackStarted = useCallback(() => {
    if (Platform.OS !== 'web') {
      return;
    }

    setTimeout(() => {
      const player = alarmPlayerRef.current;
      if (!player) {
        return;
      }

      setSoundBlocked(player.paused && player.currentTime === 0);
    }, AUTOPLAY_PROBE_MS);
  }, []);

  const playAlarmTone = useCallback(() => {
    const player = alarmPlayerRef.current;
    if (!player) {
      return;
    }

    try {
      void Promise.resolve(player.seekTo(0)).catch(() => {});
    } catch {
      // seekTo is unavailable on this player -- play from wherever it is rather than not at all.
    }

    try {
      player.play();
    } catch {
      // A synchronous throw is the one failure mode try/catch can see here.
      setSoundBlocked(true);
      return;
    }

    probePlaybackStarted();
  }, [probePlaybackStarted]);

  // Find out whether this browser will let us make noise BEFORE the first order
  // lands, rather than discovering it by missing one. Playing at volume 0 is still
  // "audible intent" as far as autoplay policy is concerned (the policy keys off
  // `muted`, not `volume`), so a refusal here is a real refusal -- but if it is
  // allowed, nobody hears the probe. Web only: native has no autoplay policy.
  useEffect(() => {
    if (Platform.OS !== 'web') {
      return;
    }

    const player = alarmPlayerRef.current;
    if (!player) {
      return;
    }

    const restoreVolume = player.volume;
    try {
      player.volume = 0;
      player.play();
    } catch {
      setSoundBlocked(true);
      player.volume = restoreVolume;
      return;
    }

    const timeoutId = setTimeout(() => {
      const probed = alarmPlayerRef.current;
      if (!probed) {
        return;
      }

      setSoundBlocked(probed.paused && probed.currentTime === 0);

      try {
        probed.pause();
        void Promise.resolve(probed.seekTo(0)).catch(() => {});
      } catch {
        // Nothing to undo if the player rejected the probe outright.
      }

      probed.volume = restoreVolume;
    }, AUTOPLAY_PROBE_MS);

    return () => clearTimeout(timeoutId);
  }, []);

  const soundActive = isSoundActive(state);

  // Repeat cadence lives here, not in the reducer: while anything is alarming and
  // unmuted, chime immediately and then every 20s until acknowledge/mute changes
  // `soundActive`, at which point the effect tears the interval down.
  useEffect(() => {
    if (!soundActive) {
      return;
    }

    playAlarmTone();
    const intervalId = setInterval(playAlarmTone, KITCHEN_ALARM_REPEAT_MS);

    return () => clearInterval(intervalId);
  }, [playAlarmTone, soundActive]);

  // Keep-awake only while the app is foregrounded -- deactivating on cleanup covers
  // both background and unmount, so a tablet left idle overnight is not held awake.
  // Re-running on `isForeground` is also the re-acquire path that web needs: a
  // browser releases the screen wake lock by itself when the tab is hidden and never
  // takes it back on its own.
  //
  // The failure is no longer swallowed. Web Wake Lock needs a secure context and a
  // visible document and is absent in several browsers; when it fails the screen
  // sleeps, the tab stops being visible, the visibility-gated poll stops, and the
  // queue quietly goes stale. That is worth one honest line on screen.
  useEffect(() => {
    if (!isForeground) {
      return;
    }

    let cancelled = false;

    activateKeepAwakeAsync(KITCHEN_ALARM_KEEP_AWAKE_TAG)
      .then(() => {
        if (!cancelled) {
          setKeepAwakeFailed(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setKeepAwakeFailed(true);
        }
      });

    return () => {
      cancelled = true;
      deactivateKeepAwake(KITCHEN_ALARM_KEEP_AWAKE_TAG).catch(() => {
        // Throws with ERR_KEEP_AWAKE_TAG_INVALID on web when activation never succeeded.
      });
    };
  }, [isForeground]);

  // Diff the "New" lane's ids against what this provider has already seen to derive
  // order_arrived / order_left_board. An id disappearing means the order left `placed`
  // entirely (accepted, rejected, or gone) -- acknowledging does NOT remove it from
  // the caller's list, so it stays "known" and cannot spuriously re-arm.
  //
  // Bailing out when the id sequence is unchanged makes this safe to call from a
  // render-keyed effect: a caller handing us a fresh array of the same orders every
  // render costs one join and no state update, so there is no feedback loop.
  const syncNewOrders = useCallback((orders: readonly OrderDocument[]) => {
    const orderIds = orders.map((order) => order.id);
    const syncKey = orderIds.join('|');

    if (syncKey === syncedKeyRef.current) {
      return;
    }

    syncedKeyRef.current = syncKey;
    setNewOrders([...orders]);

    const currentOrderIds = new Set(orderIds);
    const knownOrderIds = knownOrderIdsRef.current;

    currentOrderIds.forEach((orderId) => {
      if (!knownOrderIds.has(orderId)) {
        dispatch({ type: 'order_arrived', orderId });
      }
    });

    knownOrderIds.forEach((orderId) => {
      if (!currentOrderIds.has(orderId)) {
        dispatch({ type: 'order_left_board', orderId });
      }
    });

    knownOrderIdsRef.current = currentOrderIds;
  }, []);

  const acknowledge = useCallback((orderId: string) => {
    dispatch({ type: 'order_acknowledged', orderId });
  }, []);

  const acknowledgeAll = useCallback(() => {
    dispatch({ type: 'all_acknowledged' });
  }, []);

  const setMuted = useCallback((muted: boolean) => {
    dispatch({ type: 'mute_toggled', muted });
    void storeKitchenAlarmMuted(muted).catch(() => {
      // Best-effort persistence -- the in-memory reducer state is already updated.
    });
  }, []);

  const enableSound = useCallback(() => {
    // Called from a press handler, which is the user gesture the browser is waiting
    // for. Clear optimistically; the probe inside playAlarmTone re-raises the flag if
    // this still did not produce sound, so a failed attempt cannot look like success.
    setSoundBlocked(false);
    playAlarmTone();
  }, [playAlarmTone]);

  const alarmingOrders = useMemo(() => {
    // Driven by the domain helper rather than by re-reading the Set here, so the
    // alert lists exactly the ids the reducer says are alarming.
    const ids = new Set(alarmingOrderIds(state));
    return newOrders.filter((order) => ids.has(order.id));
  }, [newOrders, state]);

  const value = useMemo<KitchenAlarmContextValue>(
    () => ({
      state,
      alarmingOrders,
      soundActive,
      alarmVisible: isAlarmVisible(state),
      // Suppressed while muted: a silent alarm the partner asked for is not a
      // defect, and telling them their sound is broken when they turned it off
      // would train them to ignore the one notice that means it really is broken.
      soundBlocked: soundBlocked && !state.muted,
      keepAwakeFailed,
      acknowledge,
      acknowledgeAll,
      setMuted,
      enableSound,
      syncNewOrders,
    }),
    [
      acknowledge,
      acknowledgeAll,
      alarmingOrders,
      enableSound,
      keepAwakeFailed,
      setMuted,
      soundActive,
      soundBlocked,
      state,
      syncNewOrders,
    ]
  );

  return (
    <KitchenAlarmContext.Provider value={value}>
      {/*
        The alert sits ABOVE the app in normal flow, not over it. Its predecessor was
        `position: absolute` inset-0 across the board, so while it was up the kitchen
        could not read the queue, tap a ticket, or reach the mute button -- the alarm
        blindfolded the people it was alerting. In flow, everything below stays
        readable and tappable while it sounds.
      */}
      <View style={styles.host}>
        <KitchenAlarmBanner
          acknowledge={acknowledge}
          acknowledgeAll={acknowledgeAll}
          alarmVisible={value.alarmVisible}
          alarmingOrders={alarmingOrders}
          enableSound={enableSound}
          keepAwakeFailed={keepAwakeFailed}
          muted={state.muted}
          setMuted={setMuted}
          soundBlocked={value.soundBlocked}
        />
        <View style={styles.body}>{children}</View>
      </View>
    </KitchenAlarmContext.Provider>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
});
