/**
 * Run with: node --test --experimental-strip-types apps/partner/src/domain/kitchenAlarm.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  alarmingOrderIds,
  initialKitchenAlarmState,
  isInterstitialVisible,
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

test('defaults to unmuted with nothing alarming', () => {
  assert.equal(initialKitchenAlarmState.muted, false);
  assert.equal(isSoundActive(initialKitchenAlarmState), false);
  assert.equal(isInterstitialVisible(initialKitchenAlarmState), false);
});

test('a new order arriving arms the alarm: sound on, interstitial shown', () => {
  const state = arrive(initialKitchenAlarmState, 'o1');

  assert.equal(isOrderAlarming(state, 'o1'), true);
  assert.equal(isSoundActive(state), true);
  assert.equal(isInterstitialVisible(state), true);
  assert.deepEqual(alarmingOrderIds(state), ['o1']);
});

test('acknowledging an order stops its alarm: sound off, interstitial cleared', () => {
  const state = acknowledge(arrive(initialKitchenAlarmState, 'o1'), 'o1');

  assert.equal(isOrderAlarming(state, 'o1'), false);
  assert.equal(isSoundActive(state), false);
  assert.equal(isInterstitialVisible(state), false);
});

test('a second new order re-arms the alarm even after a prior order was acknowledged', () => {
  let state = arrive(initialKitchenAlarmState, 'o1');
  state = acknowledge(state, 'o1');
  assert.equal(isSoundActive(state), false, 'precondition: silenced after acknowledging o1');

  state = arrive(state, 'o2');

  assert.equal(isSoundActive(state), true);
  assert.equal(isInterstitialVisible(state), true);
  assert.equal(isOrderAlarming(state, 'o2'), true);
  // o1 stays acknowledged (not re-armed) -- only the new arrival re-arms the alarm.
  assert.equal(isOrderAlarming(state, 'o1'), false);
});

test('mute suppresses sound but the interstitial still shows', () => {
  const alarming = arrive(initialKitchenAlarmState, 'o1');
  const muted = mute(alarming, true);

  assert.equal(isSoundActive(muted), false);
  assert.equal(isInterstitialVisible(muted), true);
  assert.equal(isOrderAlarming(muted, 'o1'), true);
});

test('an acknowledged order still needs an accept/reject decision', () => {
  const state = acknowledge(arrive(initialKitchenAlarmState, 'o1'), 'o1');

  assert.equal(orderNeedsAcceptDecision(state, 'o1'), true);
  assert.equal(isInterstitialVisible(state), false, 'acknowledging clears the interstitial, not the accept requirement');
});

test('an order accepted or rejected leaves both the alarming and acknowledged sets', () => {
  let state = acknowledge(arrive(initialKitchenAlarmState, 'o1'), 'o1');
  state = leave(state, 'o1');

  assert.equal(isOrderAlarming(state, 'o1'), false);
  assert.equal(orderNeedsAcceptDecision(state, 'o1'), false);
  assert.equal(isInterstitialVisible(state), false);
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
  assert.equal(isInterstitialVisible(state), true);
});

test('unmuting after the only alarming order was acknowledged stays silent', () => {
  let state = arrive(initialKitchenAlarmState, 'o1');
  state = mute(state, true);
  state = acknowledge(state, 'o1');

  state = mute(state, false);

  assert.equal(isSoundActive(state), false);
  assert.equal(isInterstitialVisible(state), false);
});

test('multiple orders can alarm concurrently; acknowledging one leaves the other sounding', () => {
  let state = arrive(initialKitchenAlarmState, 'o1');
  state = arrive(state, 'o2');
  state = acknowledge(state, 'o1');

  assert.equal(isSoundActive(state), true);
  assert.equal(isInterstitialVisible(state), true);
  assert.equal(isOrderAlarming(state, 'o1'), false);
  assert.equal(isOrderAlarming(state, 'o2'), true);
  assert.equal(orderNeedsAcceptDecision(state, 'o1'), true);
});
