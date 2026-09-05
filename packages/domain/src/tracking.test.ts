/**
 * Run with: node --test --experimental-strip-types packages/domain/src/tracking.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  computeEtaRange,
  computeEtaRangeBetween,
  DEFAULT_AVERAGE_SPEED_KMH,
  formatEtaRange,
  MIN_ETA_MINUTES,
  resolveAverageSpeedKmh,
  shouldShowLiveMap,
} from './tracking.ts';

// --- shouldShowLiveMap: the map only renders in transit ---------------------

test('shouldShowLiveMap: true only for picked_up and on_the_way', () => {
  assert.equal(shouldShowLiveMap('picked_up'), true);
  assert.equal(shouldShowLiveMap('on_the_way'), true);
});

test('shouldShowLiveMap: false before pickup and after delivery', () => {
  for (const status of ['placed', 'accepted', 'preparing', 'ready_for_pickup', 'delivered', 'cancelled', 'rejected']) {
    assert.equal(shouldShowLiveMap(status), false, `expected no map for ${status}`);
  }
  assert.equal(shouldShowLiveMap(null), false, 'no map for a null status');
  assert.equal(shouldShowLiveMap(undefined), false, 'no map for an undefined status');
});

test('shouldShowLiveMap: legacy "ready" maps to ready_for_pickup and still shows no map', () => {
  assert.equal(shouldShowLiveMap('ready'), false);
});

// --- resolveAverageSpeedKmh: an untrusted speed is clamped ------------------

test('resolveAverageSpeedKmh: a sane speed passes through', () => {
  assert.equal(resolveAverageSpeedKmh(25), 25);
});

test('resolveAverageSpeedKmh: a bad speed falls back to the default', () => {
  assert.equal(resolveAverageSpeedKmh(0), DEFAULT_AVERAGE_SPEED_KMH);
  assert.equal(resolveAverageSpeedKmh(-4), DEFAULT_AVERAGE_SPEED_KMH);
  assert.equal(resolveAverageSpeedKmh(null), DEFAULT_AVERAGE_SPEED_KMH);
  assert.equal(resolveAverageSpeedKmh(undefined), DEFAULT_AVERAGE_SPEED_KMH);
  assert.equal(resolveAverageSpeedKmh(99999), DEFAULT_AVERAGE_SPEED_KMH);
});

// --- ETA range formatting ---------------------------------------------------

test('formatEtaRange: a range renders as "min – max min"', () => {
  assert.equal(formatEtaRange({ minMinutes: 12, maxMinutes: 18, minutes: 15 }), '12 – 18 min');
});

test('formatEtaRange: a collapsed band renders a single value', () => {
  assert.equal(formatEtaRange({ minMinutes: 5, maxMinutes: 5, minutes: 5 }), '5 min');
});

test('formatEtaRange: a null range is a calculating placeholder, not "NaN"', () => {
  assert.equal(formatEtaRange(null), 'Calculating ETA');
});

test('computeEtaRange: 9 km at 18 km/h is a 27–33 min band around 30', () => {
  const range = computeEtaRange(9, 18);
  assert.equal(range.minutes, 30);
  assert.equal(range.minMinutes, 27);
  assert.equal(range.maxMinutes, 33);
  assert.equal(formatEtaRange(range), '27 – 33 min');
});

test('computeEtaRange: a near-zero distance floors at MIN_ETA_MINUTES and never goes negative', () => {
  const range = computeEtaRange(0, 18);
  assert.equal(range.minutes, MIN_ETA_MINUTES);
  assert.equal(range.minMinutes, MIN_ETA_MINUTES);
});

// --- computeEtaRangeBetween: coordinates in, range out ----------------------

test('computeEtaRangeBetween: two valid points produce a range', () => {
  const range = computeEtaRangeBetween({ latitude: 6.5, longitude: 3.4 }, { latitude: 6.55, longitude: 3.4 }, 18);
  assert.ok(range, 'a range is returned');
  assert.ok(range!.minutes >= MIN_ETA_MINUTES, 'the midpoint respects the floor');
});

test('computeEtaRangeBetween: a missing coordinate yields null, not a bogus range', () => {
  assert.equal(computeEtaRangeBetween(null, { latitude: 6.5, longitude: 3.4 }, 18), null);
  assert.equal(computeEtaRangeBetween({ latitude: 6.5, longitude: 3.4 }, null, 18), null);
  assert.equal(computeEtaRangeBetween({ latitude: null, longitude: 3.4 }, { latitude: 6.5, longitude: 3.4 }, 18), null);
});

test('computeEtaRangeBetween: a bad speed is clamped rather than dividing by zero', () => {
  const range = computeEtaRangeBetween({ latitude: 6.5, longitude: 3.4 }, { latitude: 6.9, longitude: 3.4 }, 0);
  assert.ok(range, 'a range is still returned with a clamped default speed');
  assert.ok(Number.isFinite(range!.minutes), 'the ETA is finite, not Infinity');
});
