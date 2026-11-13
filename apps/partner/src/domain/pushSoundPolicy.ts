// Whether a push that arrives while the partner app is open should make its own
// sound. Pure, so the foreground notification handler stays a one-liner and this
// is node-testable.
//
// WHY. While the app is open, the kitchen alarm (KitchenAlarmContext) chimes for
// every unaccepted new order and repeats every 20 s. A new-order or reminder push
// arriving then played its urgent sound on top of the alarm. The alarm is the
// louder, repeating signal, so while it is sounding the push is shown silently.
//
// Only while the alarm is ACTUALLY sounding (KitchenAlarmContext publishes
// soundActive && !soundBlocked). Muted, nothing alarming, everything
// acknowledged, playback refused, or the alarm not yet fed the order (the queue
// screen is not open, or the push beat the queue refresh) all leave the push as
// the only audible signal, so it keeps its sound. Other pushes are never touched.
//
// A silenced push still vibrates. expo-notifications drops vibration together
// with sound when the handler says no sound, so the handler vibrates itself with
// this pattern (the "New orders" channel's): a tablet whose media volume is at 0
// cannot hear the alarm, but it still buzzes.
import { isPartnerUrgentPush } from '../../../../packages/domain/src/notifications.ts';

export const SILENCED_PUSH_VIBRATION_PATTERN = [0, 500, 150, 500, 150, 500];

export const shouldPlayPartnerPushSound = (data: unknown, kitchenAlarmSounding: boolean): boolean => {
  if (!kitchenAlarmSounding) {
    return true;
  }

  const payload = (data ?? {}) as { status?: unknown; type?: unknown };
  return !isPartnerUrgentPush({ status: payload.status, type: payload.type });
};
