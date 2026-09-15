// Pure, Node-testable state machine for the kitchen alarm (Task 15 / F1).
// Kept free of React, audio, timers, and storage on purpose --
// apps/partner/src/contexts/KitchenAlarmContext.tsx is the thin, impure wiring layer
// that drives expo-audio/expo-keep-awake and AsyncStorage off of this reducer's
// output; it is not where the alarm logic lives. Matches the split documented in
// apps/customer/src/domain/ratingPrompt.ts and
// apps/partner/src/contexts/partnerAuthFlow.ts.

export type KitchenAlarmState = {
  /** Order ids that are currently alarming: a new order not yet acknowledged. */
  alarming: ReadonlySet<string>;
  /** Order ids whose alarm has been acknowledged but that still need an accept/reject decision. */
  acknowledged: ReadonlySet<string>;
  /** Persisted per-device mute flag. Governs audio only -- never the visual alert. */
  muted: boolean;
};

export type KitchenAlarmEvent =
  // A new order entered the "New" column (arms/re-arms the alarm for that id).
  | { type: 'order_arrived'; orderId: string }
  // Acknowledge stops the alarm for one order; the order still needs accept/reject.
  | { type: 'order_acknowledged'; orderId: string }
  // Silence everything currently alarming in one action. The alarm surface used to
  // be a full-screen interstitial with a per-order Acknowledge and nothing else, so
  // four orders landing at once meant four taps through a sheet that covered the
  // board -- during the exact minute the kitchen most needs the board. Same
  // semantics as acknowledging each id: seen, still undecided.
  | { type: 'all_acknowledged' }
  // The order left the board entirely (accepted, rejected, or otherwise gone) --
  // clears it from both sets. This is NOT the same event as acknowledge.
  | { type: 'order_left_board'; orderId: string }
  | { type: 'mute_toggled'; muted: boolean };

export const initialKitchenAlarmState: KitchenAlarmState = {
  alarming: new Set(),
  // Not a silent default: callers seed `muted` from persisted per-device storage,
  // and until that load resolves the reducer's own default is unmuted (sound on).
  acknowledged: new Set(),
  muted: false,
};

const without = (set: ReadonlySet<string>, orderId: string): ReadonlySet<string> => {
  if (!set.has(orderId)) {
    return set;
  }

  const next = new Set(set);
  next.delete(orderId);
  return next;
};

const withId = (set: ReadonlySet<string>, orderId: string): ReadonlySet<string> => {
  if (set.has(orderId)) {
    return set;
  }

  const next = new Set(set);
  next.add(orderId);
  return next;
};

export const kitchenAlarmReducer = (state: KitchenAlarmState, event: KitchenAlarmEvent): KitchenAlarmState => {
  switch (event.type) {
    case 'order_arrived':
      // Re-arms even if this id was previously acknowledged (should not normally
      // happen for the same id, but stays correct if it does), and -- critically --
      // arming one order's alarm makes the derived isSoundActive/isAlarmVisible
      // true again regardless of any other order already sitting in `acknowledged`.
      return {
        ...state,
        alarming: withId(state.alarming, event.orderId),
        acknowledged: without(state.acknowledged, event.orderId),
      };

    case 'order_acknowledged':
      return {
        ...state,
        alarming: without(state.alarming, event.orderId),
        acknowledged: withId(state.acknowledged, event.orderId),
      };

    case 'all_acknowledged': {
      if (state.alarming.size === 0) {
        return state;
      }

      const acknowledged = new Set(state.acknowledged);
      state.alarming.forEach((orderId) => acknowledged.add(orderId));

      return {
        ...state,
        alarming: new Set(),
        acknowledged,
      };
    }

    case 'order_left_board':
      return {
        ...state,
        alarming: without(state.alarming, event.orderId),
        acknowledged: without(state.acknowledged, event.orderId),
      };

    case 'mute_toggled':
      return {
        ...state,
        muted: event.muted,
      };

    default:
      return state;
  }
};

/** True while any order is alarming AND sound is not muted. Drives the audio side effect. */
export const isSoundActive = (state: KitchenAlarmState): boolean => !state.muted && state.alarming.size > 0;

/**
 * True while any order is alarming, independent of mute. Mute governs audio only --
 * the visual alert must keep showing so a muted tablet doesn't silently drop a new
 * order off screen.
 */
export const isAlarmVisible = (state: KitchenAlarmState): boolean => state.alarming.size > 0;

export const isOrderAlarming = (state: KitchenAlarmState, orderId: string): boolean => state.alarming.has(orderId);

/** True for an order still awaiting the (separate) accept/reject decision, whether or not its alarm has been acknowledged. */
export const orderNeedsAcceptDecision = (state: KitchenAlarmState, orderId: string): boolean =>
  state.alarming.has(orderId) || state.acknowledged.has(orderId);

/** The order ids the alert surface should currently list (still alarming, unacknowledged). */
export const alarmingOrderIds = (state: KitchenAlarmState): string[] => Array.from(state.alarming);
