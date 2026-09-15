/**
 * Run with: node --test --experimental-strip-types apps/partner/src/domain/kitchenAlarm.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  alarmingOrderIds,
  initialKitchenAlarmState,
  isAlarmVisible,
  isOrderAlarming,
  isSoundActive,
  kitchenAlarmReducer,
  orderNeedsAcceptDecision,
  type KitchenAlarmState,
} from './kitchenAlarm.js';

const arrive = (state: KitchenAlarmState, orderId: string) =>
  kitchenAlarmReducer(state, { type: 'order_arrived', orderId });
const acknowledge = (state: KitchenAlarmState, orderId: string) =>
  kitchenAlarmReducer(state, { type: 'order_acknowledged', orderId });
const leave = (state: KitchenAlarmState, orderId: string) =>
  kitchenAlarmReducer(state, { type: 'order_left_board', orderId });
const mute = (state: KitchenAlarmState, muted: boolean) =>
  kitchenAlarmReducer(state, { type: 'mute_toggled', muted });
const acknowledgeAll = (state: KitchenAlarmState) => kitchenAlarmReducer(state, { type: 'all_acknowledged' });

test('defaults to unmuted with nothing alarming', () => {
  assert.equal(initialKitchenAlarmState.muted, false);
  assert.equal(isSoundActive(initialKitchenAlarmState), false);
  assert.equal(isAlarmVisible(initialKitchenAlarmState), false);
});

test('a new order arriving arms the alarm: sound on, interstitial shown', () => {
  const state = arrive(initialKitchenAlarmState, 'o1');

  assert.equal(isOrderAlarming(state, 'o1'), true);
  assert.equal(isSoundActive(state), true);
  assert.equal(isAlarmVisible(state), true);
  assert.deepEqual(alarmingOrderIds(state), ['o1']);
});

test('acknowledging an order stops its alarm: sound off, interstitial cleared', () => {
  const state = acknowledge(arrive(initialKitchenAlarmState, 'o1'), 'o1');

  assert.equal(isOrderAlarming(state, 'o1'), false);
  assert.equal(isSoundActive(state), false);
  assert.equal(isAlarmVisible(state), false);
});

test('a second new order re-arms the alarm even after a prior order was acknowledged', () => {
  let state = arrive(initialKitchenAlarmState, 'o1');
  state = acknowledge(state, 'o1');
  assert.equal(isSoundActive(state), false, 'precondition: silenced after acknowledging o1');

  state = arrive(state, 'o2');

  assert.equal(isSoundActive(state), true);
  assert.equal(isAlarmVisible(state), true);
  assert.equal(isOrderAlarming(state, 'o2'), true);
  // o1 stays acknowledged (not re-armed) -- only the new arrival re-arms the alarm.
  assert.equal(isOrderAlarming(state, 'o1'), false);
});

test('mute suppresses sound but the interstitial still shows', () => {
  const alarming = arrive(initialKitchenAlarmState, 'o1');
  const muted = mute(alarming, true);

  assert.equal(isSoundActive(muted), false);
  assert.equal(isAlarmVisible(muted), true);
  assert.equal(isOrderAlarming(muted, 'o1'), true);
});

test('an acknowledged order still needs an accept/reject decision', () => {
  const state = acknowledge(arrive(initialKitchenAlarmState, 'o1'), 'o1');

  assert.equal(orderNeedsAcceptDecision(state, 'o1'), true);
  assert.equal(isAlarmVisible(state), false, 'acknowledging clears the interstitial, not the accept requirement');
});

test('an order accepted or rejected leaves both the alarming and acknowledged sets', () => {
  let state = acknowledge(arrive(initialKitchenAlarmState, 'o1'), 'o1');
  state = leave(state, 'o1');

  assert.equal(isOrderAlarming(state, 'o1'), false);
  assert.equal(orderNeedsAcceptDecision(state, 'o1'), false);
  assert.equal(isAlarmVisible(state), false);
});

test('an order can also leave the board directly from the alarming set (accepted before acknowledging)', () => {
  const state = leave(arrive(initialKitchenAlarmState, 'o1'), 'o1');

  assert.equal(isOrderAlarming(state, 'o1'), false);
  assert.equal(orderNeedsAcceptDecision(state, 'o1'), false);
  assert.equal(isSoundActive(state), false);
});

test('mute toggled on while alarming silences immediately, without touching the alarm sets', () => {
  const alarming = arrive(initialKitchenAlarmState, 'o1');
  const muted = mute(alarming, true);

  assert.equal(isSoundActive(muted), false);
  assert.deepEqual(alarmingOrderIds(muted), ['o1']);
});

test('unmuting while an unacknowledged order is still alarming re-sounds', () => {
  let state = arrive(initialKitchenAlarmState, 'o1');
  state = mute(state, true);
  assert.equal(isSoundActive(state), false, 'precondition: muted');

  state = mute(state, false);

  assert.equal(isSoundActive(state), true);
  assert.equal(isAlarmVisible(state), true);
});

test('unmuting after the only alarming order was acknowledged stays silent', () => {
  let state = arrive(initialKitchenAlarmState, 'o1');
  state = mute(state, true);
  state = acknowledge(state, 'o1');

  state = mute(state, false);

  assert.equal(isSoundActive(state), false);
  assert.equal(isAlarmVisible(state), false);
});

test('multiple orders can alarm concurrently; acknowledging one leaves the other sounding', () => {
  let state = arrive(initialKitchenAlarmState, 'o1');
  state = arrive(state, 'o2');
  state = acknowledge(state, 'o1');

  assert.equal(isSoundActive(state), true);
  assert.equal(isAlarmVisible(state), true);
  assert.equal(isOrderAlarming(state, 'o1'), false);
  assert.equal(isOrderAlarming(state, 'o2'), true);
  assert.equal(orderNeedsAcceptDecision(state, 'o1'), true);
});

test('acknowledge-all silences every alarming order in one action', () => {
  let state = arrive(initialKitchenAlarmState, 'o1');
  state = arrive(state, 'o2');
  state = arrive(state, 'o3');

  state = acknowledgeAll(state);

  assert.equal(isSoundActive(state), false);
  assert.equal(isAlarmVisible(state), false);
  assert.deepEqual(alarmingOrderIds(state), []);
});

test('acknowledge-all leaves every order still needing an accept/reject decision', () => {
  let state = arrive(initialKitchenAlarmState, 'o1');
  state = arrive(state, 'o2');

  state = acknowledgeAll(state);

  assert.equal(orderNeedsAcceptDecision(state, 'o1'), true);
  assert.equal(orderNeedsAcceptDecision(state, 'o2'), true);
  assert.equal(isOrderAlarming(state, 'o1'), false);
  assert.equal(isOrderAlarming(state, 'o2'), false);
});

test('acknowledge-all preserves orders acknowledged one at a time beforehand', () => {
  let state = arrive(initialKitchenAlarmState, 'o1');
  state = acknowledge(state, 'o1');
  state = arrive(state, 'o2');

  state = acknowledgeAll(state);

  assert.equal(orderNeedsAcceptDecision(state, 'o1'), true, 'o1 must not be dropped by the bulk action');
  assert.equal(orderNeedsAcceptDecision(state, 'o2'), true);
});

test('acknowledge-all with nothing alarming is a no-op that does not churn state', () => {
  const state = acknowledgeAll(initialKitchenAlarmState);

  assert.equal(state, initialKitchenAlarmState);
});

test('a new order arriving after acknowledge-all re-arms the alarm', () => {
  let state = acknowledgeAll(arrive(initialKitchenAlarmState, 'o1'));
  assert.equal(isSoundActive(state), false, 'precondition: silenced');

  state = arrive(state, 'o2');

  assert.equal(isSoundActive(state), true);
  assert.equal(isAlarmVisible(state), true);
  assert.deepEqual(alarmingOrderIds(state), ['o2']);
});

test('acknowledge-all does not touch the persisted mute flag', () => {
  let state = mute(arrive(initialKitchenAlarmState, 'o1'), true);

  state = acknowledgeAll(state);

  assert.equal(state.muted, true);
});

// Re-announcing the queue is the defect the provider was hoisted onto the (partner)
// layout to prevent: while the alarm state was component-local, navigating to an
// order detail and back replayed the whole placed queue as arrivals. The reducer is
// the half of that fix which can be tested here -- a re-sync of ids it has already
// seen must produce no arrivals, so only the SEEN-ID SET has to survive the unmount.
test('re-syncing the same ids without a leave in between never re-arms them', () => {
  let state = arrive(initialKitchenAlarmState, 'o1');
  state = acknowledge(state, 'o1');

  // What the provider does on re-sync when the id is already known: nothing.
  assert.equal(isOrderAlarming(state, 'o1'), false);
  assert.equal(isSoundActive(state), false);

  // And what it does when the id genuinely left and came back: a real re-arm.
  state = leave(state, 'o1');
  state = arrive(state, 'o1');

  assert.equal(isOrderAlarming(state, 'o1'), true);
  assert.equal(isSoundActive(state), true);
});
