/**
 * Run with: node --test --experimental-strip-types apps/dispatch/src/utils/locationSyncThrottle.test.ts
 *
 * The client-side gate that keeps rider GPS inside the Supabase Free plan's
 * edge-invocation quota (see locationSyncThrottle.ts).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACTIVE_FORCED_SYNC_MS,
  canResendFix,
  distanceMetres,
  isForcedSyncDue,
  MAX_RESEND_FIX_AGE_MS,
  shouldSyncFix,
} from './locationSyncThrottle.ts';

const LAGOS = { latitude: 6.5244, longitude: 3.3792 };
// ~0.00018 deg latitude is ~20m; 0.0003 is ~33m.
const NEAR = { latitude: 6.52458, longitude: 3.3792 };
const FAR = { latitude: 6.5247, longitude: 3.3792 };

test('distanceMetres is roughly right at Lagos latitude', () => {
  const near = distanceMetres(LAGOS, NEAR);
  const far = distanceMetres(LAGOS, FAR);
  assert.ok(near > 15 && near < 25, `near=${near}`);
  assert.ok(far > 25 && far < 40, `far=${far}`);
});

test('first fix always syncs, idle fixes always sync', () => {
  assert.equal(shouldSyncFix({ activeDelivery: true, fix: LAGOS, lastSync: null, now: 0 }), true);
  assert.equal(
    shouldSyncFix({ activeDelivery: false, fix: LAGOS, lastSync: { ...LAGOS, at: 0 }, now: 1000 }),
    true
  );
});

test('active delivery: barely moved AND recent -> skipped', () => {
  assert.equal(
    shouldSyncFix({ activeDelivery: true, fix: NEAR, lastSync: { ...LAGOS, at: 0 }, now: 5_000 }),
    false
  );
});

test('active delivery: moved >= 25m OR waited >= 15s -> synced', () => {
  assert.equal(shouldSyncFix({ activeDelivery: true, fix: FAR, lastSync: { ...LAGOS, at: 0 }, now: 5_000 }), true);
  assert.equal(shouldSyncFix({ activeDelivery: true, fix: NEAR, lastSync: { ...LAGOS, at: 0 }, now: 15_000 }), true);
});

test('forced keep-alive is due after 60s, and stale fixes are not re-sent', () => {
  assert.equal(isForcedSyncDue({ lastSync: null, now: 0 }), true);
  assert.equal(isForcedSyncDue({ lastSync: { ...LAGOS, at: 0 }, now: ACTIVE_FORCED_SYNC_MS - 1 }), false);
  assert.equal(isForcedSyncDue({ lastSync: { ...LAGOS, at: 0 }, now: ACTIVE_FORCED_SYNC_MS }), true);
  assert.equal(canResendFix({ fixTimestamp: 0, now: MAX_RESEND_FIX_AGE_MS }), true);
  assert.equal(canResendFix({ fixTimestamp: 0, now: MAX_RESEND_FIX_AGE_MS + 1 }), false);
});

