/**
 * Run with: node --test --experimental-strip-types apps/partner/src/domain/pushSoundPolicy.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shouldPlayPartnerPushSound } from './pushSoundPolicy.ts';

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

test('other pushes are unchanged, alarm or not', () => {
  assert.equal(shouldPlayPartnerPushSound(CANCELLED, true), true);
  assert.equal(shouldPlayPartnerPushSound({ app: 'partner', type: 'staff_access' }, true), true);
  assert.equal(shouldPlayPartnerPushSound(undefined, true), true);
  assert.equal(shouldPlayPartnerPushSound(null, false), true);
});
