// Whether a push that arrives while the partner app is open should make its own
// sound. Pure, so the foreground notification handler stays a one-liner and this
// is node-testable.
//
// WHY. While the app is open, the kitchen alarm (KitchenAlarmContext) chimes for
// every unaccepted new order and repeats every 20 s. A new-order or reminder push
// arriving then played its urgent sound on top of the alarm. The alarm is the
// louder, repeating signal, so while it is sounding the push is shown silently.
//
// Only while the alarm is ACTUALLY sounding. Muted, nothing alarming, everything
// acknowledged, or the alarm not yet fed the order (the queue screen is not open,
// or the push beat the queue refresh) all leave the push as the only audible
// signal, so it keeps its sound. Other pushes are never touched.
import { isPartnerUrgentPush } from '../../../../packages/domain/src/notifications.ts';

export const shouldPlayPartnerPushSound = (data: unknown, kitchenAlarmSounding: boolean): boolean => {
  if (!kitchenAlarmSounding) {
    return true;
  }

  const payload = (data ?? {}) as { status?: unknown; type?: unknown };
  return !isPartnerUrgentPush({ status: payload.status, type: payload.type });
};
