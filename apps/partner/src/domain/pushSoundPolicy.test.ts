/**
 * Run with: node --test --experimental-strip-types apps/partner/src/domain/pushSoundPolicy.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SILENCED_PUSH_VIBRATION_PATTERN, shouldPlayPartnerPushSound } from './pushSoundPolicy.ts';

const source = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url).href), 'utf8');

const PAID_ORDER = { app: 'partner', orderId: 'o1', type: 'payment_confirmed' };
const REMINDER = { app: 'partner', orderId: 'o1', status: 'placed', type: 'acceptance_reminder' };
const RELEASED_ORDER = { app: 'partner', orderId: 'o1', status: 'placed', type: 'order_update' };
const CANCELLED = { app: 'partner', orderId: 'o1', status: 'cancelled', type: 'order_update' };

test('a new order or reminder push is silent while the kitchen alarm is sounding', () => {
  assert.equal(shouldPlayPartnerPushSound(PAID_ORDER, true), false);
  assert.equal(shouldPlayPartnerPushSound(REMINDER, true), false);
  assert.equal(shouldPlayPartnerPushSound(RELEASED_ORDER, true), false);
});

test('with the alarm quiet (muted, acknowledged or not fed yet) the push keeps its sound', () => {
  assert.equal(shouldPlayPartnerPushSound(PAID_ORDER, false), true);
  assert.equal(shouldPlayPartnerPushSound(REMINDER, false), true);
  assert.equal(shouldPlayPartnerPushSound(RELEASED_ORDER, false), true);
});

// The wiring is impure (React state, a module flag, the native handler), so it
// is pinned at source level: what is published, and that a silenced push buzzes.
test('the provider publishes "actually playing", not just "wants to play"', () => {
  const provider = source('../contexts/KitchenAlarmContext.tsx');
  assert.match(provider, /const alarmAudible = soundActive && !soundBlocked;/);
  assert.match(provider, /setKitchenAlarmSounding\(alarmAudible\)/);
});

test('a silenced push still vibrates, with the "New orders" channel pattern', () => {
  const hook = source('../hooks/usePushNotifications.ts');
  assert.match(hook, /if \(!playSound\) \{[\s\S]*?Vibration\.vibrate\(SILENCED_PUSH_VIBRATION_PATTERN\)/);
  const channel = hook.slice(hook.indexOf('ANDROID_NOTIFICATION_CHANNELS.newOrders, {'));
  const pattern = channel.match(/vibrationPattern: \[([\d, ]+)\]/)?.[1];
  assert.deepEqual(pattern?.split(',').map((value) => Number(value.trim())), SILENCED_PUSH_VIBRATION_PATTERN);
});

test('other pushes are unchanged, alarm or not', () => {
  assert.equal(shouldPlayPartnerPushSound(CANCELLED, true), true);
  assert.equal(shouldPlayPartnerPushSound({ app: 'partner', type: 'staff_access' }, true), true);
  assert.equal(shouldPlayPartnerPushSound(undefined, true), true);
  assert.equal(shouldPlayPartnerPushSound(null, false), true);
});
