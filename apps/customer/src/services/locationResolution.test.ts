/**
 * Run with: node --test --experimental-strip-types apps/customer/src/services/locationResolution.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LOCATION_ERROR_MESSAGES,
  MAX_FIX_ACCURACY_METERS,
  acquireBrowserCoordinates,
  assessFixAccuracy,
  toAccuracyMeters,
  browserPositionErrorReason,
  buildNominatimAddress,
  locationFailure,
  type BrowserPositionOptions,
  type CoordinatesResult,
} from './locationResolution.ts';

const success: CoordinatesResult = {
  ok: true,
  coordinates: { latitude: 6.5244, longitude: 3.3792 },
};

test('maps browser geolocation error codes onto actionable reasons', () => {
  assert.equal(browserPositionErrorReason(1), 'permission-denied');
  assert.equal(browserPositionErrorReason(2), 'unavailable');
  assert.equal(browserPositionErrorReason(3), 'timeout');
  assert.equal(browserPositionErrorReason(undefined), 'unavailable');
});

test('every failure carries a message the screen can show', () => {
  for (const reason of ['permission-denied', 'timeout', 'unavailable', 'unsupported'] as const) {
    const result = locationFailure(reason);
    assert.equal(result.ok, false);
    assert.ok(result.ok === false && result.message.length > 0);
  }
});

test('retries with a coarse fix when the high-accuracy fix times out', async () => {
  const attempts: BrowserPositionOptions[] = [];

  const result = await acquireBrowserCoordinates(async (options) => {
    attempts.push(options);
    return attempts.length === 1 ? locationFailure('timeout') : success;
  });

  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].enableHighAccuracy, true);
  assert.equal(attempts[1].enableHighAccuracy, false);
  assert.deepEqual(result, success);
});

test('retries when the high-accuracy fix reports the position is unavailable', async () => {
  let calls = 0;

  const result = await acquireBrowserCoordinates(async () => {
    calls += 1;
    return calls === 1 ? locationFailure('unavailable') : success;
  });

  assert.equal(calls, 2);
  assert.deepEqual(result, success);
});

test('does not retry after a denied permission', async () => {
  let calls = 0;

  const result = await acquireBrowserCoordinates(async () => {
    calls += 1;
    return locationFailure('permission-denied');
  });

  assert.equal(calls, 1);
  assert.equal(result.ok, false);
  assert.ok(result.ok === false && result.reason === 'permission-denied');
});

test('stops immediately when the browser has no geolocation support', async () => {
  let calls = 0;

  const result = await acquireBrowserCoordinates(async () => {
    calls += 1;
    return locationFailure('unsupported');
  });

  assert.equal(calls, 1);
  assert.ok(result.ok === false && result.reason === 'unsupported');
});

test('does not request a second fix once the first one succeeds', async () => {
  let calls = 0;

  const result = await acquireBrowserCoordinates(async () => {
    calls += 1;
    return success;
  });

  assert.equal(calls, 1);
  assert.deepEqual(result, success);
});

test('builds a street-level address from an OpenStreetMap reverse lookup', () => {
  const resolved = buildNominatimAddress({
    address: {
      house_number: '14',
      road: 'Adeola Odeku Street',
      suburb: 'Victoria Island',
      city: 'Lagos',
      state: 'Lagos',
      country: 'Nigeria',
    },
    display_name: '14, Adeola Odeku Street, Victoria Island, Lagos, Nigeria',
  });

  assert.deepEqual(resolved, {
    address: '14 Adeola Odeku Street, Victoria Island, Lagos, Lagos, Nigeria',
    shortAddress: 'Adeola Odeku Street, Victoria Island',
  });
});

test('falls back to the display name when the lookup has no structured address', () => {
  const resolved = buildNominatimAddress({
    display_name: 'Yaba, Lagos Mainland, Lagos, Nigeria',
  });

  assert.deepEqual(resolved, {
    address: 'Yaba, Lagos Mainland, Lagos, Nigeria',
    shortAddress: 'Yaba, Lagos Mainland',
  });
});

test('returns null when there is nothing usable to show', () => {
  assert.equal(buildNominatimAddress(null), null);
  assert.equal(buildNominatimAddress({}), null);
  assert.equal(buildNominatimAddress({ display_name: '   ' }), null);
});

test('a fix up to 1,000 m is used; a worse one asks the customer to search instead', () => {
  assert.equal(MAX_FIX_ACCURACY_METERS, 1000);
  assert.deepEqual(assessFixAccuracy(8), { ok: true });
  assert.deepEqual(assessFixAccuracy(1000), { ok: true });

  const laptop = assessFixAccuracy(3400);
  assert.equal(laptop.ok, false);
  assert.ok(laptop.ok === false && /3\.4 km/.test(laptop.message));
  assert.ok(laptop.ok === false && /Search for your address/.test(laptop.message));

  const justOver = assessFixAccuracy(1000.5);
  assert.equal(justOver.ok, false);
  assert.ok(justOver.ok === false && /1 km/.test(justOver.message));
});

test('an unreported or meaningless accuracy does not block the fix', () => {
  for (const value of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, -5]) {
    assert.deepEqual(assessFixAccuracy(value), { ok: true });
  }
});

test('assessFixAccuracy takes a stricter limit when given one', () => {
  assert.equal(assessFixAccuracy(200, 150).ok, false);
  assert.equal(assessFixAccuracy(120, 150).ok, true);
});

test('toAccuracyMeters keeps a real radius and drops anything else', () => {
  assert.equal(toAccuracyMeters(12.5), 12.5);
  assert.equal(toAccuracyMeters(0), 0);
  for (const value of [null, undefined, '12', Number.NaN, -1]) {
    assert.equal(toAccuracyMeters(value), null);
  }
});

test('location failures point at search, never at typing an address', () => {
  for (const message of Object.values(LOCATION_ERROR_MESSAGES)) {
    assert.match(message, /search for your address/i);
    assert.doesNotMatch(message, /type your address/i);
  }
});
