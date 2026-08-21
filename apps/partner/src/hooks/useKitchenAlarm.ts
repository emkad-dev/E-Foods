import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  initialKitchenAlarmState,
  isInterstitialVisible,
  isSoundActive,
  kitchenAlarmReducer,
  type KitchenAlarmState,
} from '../domain/kitchenAlarm';
import { getStoredKitchenAlarmMuted, storeKitchenAlarmMuted } from '../services/kitchenAlarmMute';

export type UseKitchenAlarmResult = {
  state: KitchenAlarmState;
  soundActive: boolean;
  interstitialVisible: boolean;
  acknowledge: (orderId: string) => void;
  setMuted: (muted: boolean) => void;
};

/**
 * Wires the pure kitchenAlarmReducer (apps/partner/src/domain/kitchenAlarm.ts) up to the
 * real order feed and per-device mute persistence. This hook owns no alarm LOGIC -- it
 * only translates "which order ids are currently new" into order_arrived/order_left_board
 * events and hydrates/persists the mute flag. The 20s repeat + audio/keep-awake side
 * effects live in the KitchenBoard component, driven off `soundActive`.
 */
export const useKitchenAlarm = (newOrderIds: readonly string[]): UseKitchenAlarmResult => {
  const [state, dispatch] = useReducer(kitchenAlarmReducer, initialKitchenAlarmState);
  const knownOrderIdsRef = useRef<ReadonlySet<string>>(new Set());

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
        // Storage unavailable -- keep the reducer's unmuted default rather than block the board.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Diff the "New" column's order ids against what this hook has already seen to
  // derive order_arrived / order_left_board events. An id disappearing here means
  // the order left the placed/"New" status entirely (accepted, rejected, or gone) --
  // acknowledging an order does NOT remove it from this list, so it keeps being seen
  // as "known" and does not spuriously re-arm.
  useEffect(() => {
    const currentOrderIds = new Set(newOrderIds);
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
  }, [newOrderIds]);

  const acknowledge = useCallback((orderId: string) => {
    dispatch({ type: 'order_acknowledged', orderId });
  }, []);

  const setMuted = useCallback((muted: boolean) => {
    dispatch({ type: 'mute_toggled', muted });
    void storeKitchenAlarmMuted(muted).catch(() => {
      // Best-effort persistence -- the in-memory reducer state is already updated.
    });
  }, []);

  return {
    state,
    soundActive: isSoundActive(state),
    interstitialVisible: isInterstitialVisible(state),
    acknowledge,
    setMuted,
  };
};
