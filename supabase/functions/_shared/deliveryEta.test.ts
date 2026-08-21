// ETA maths (deliveryEta.ts) + the PlatformSettings tracking-config parser
// (dispatchTracking.ts). Pure functions, no DB, no env - so this runs in the
// first (type-checked) `deno test` invocation.

import {
  computeEtaMinutes,
  computeEtaRange,
  ETA_RANGE_PADDING_MINUTES,
  haversineKm,
  MIN_ETA_MINUTES,
} from './deliveryEta.ts';

const assert = (condition: boolean, label: string) => {
  if (!condition) {
    throw new Error(`Assertion failed: ${label}`);
  }
};

const assertEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

Deno.test('haversineKm: a known short hop is roughly its great-circle distance', () => {
  // ~1.11 km per 0.01 deg of latitude near the equator. Two points 0.05 deg
  // apart in latitude at the same longitude are ~5.55 km apart.
  const km = haversineKm(6.5, 3.4, 6.55, 3.4);
  assert(km > 5.4 && km < 5.7, `expected ~5.55 km, got ${km}`);
});

Deno.test('haversineKm: identical points are zero distance', () => {
  assertEqual(haversineKm(6.5, 3.4, 6.5, 3.4), 0, 'zero distance for the same point');
});

Deno.test('computeEtaMinutes: a known distance and speed give a known minute count', () => {
  // 9 km at 18 km/h = 0.5 h = 30 min, exactly.
  assertEqual(computeEtaMinutes(9, 18), 30, '9 km / 18 km/h = 30 min');
  // 6 km at 18 km/h = 20 min.
  assertEqual(computeEtaMinutes(6, 18), 20, '6 km / 18 km/h = 20 min');
});

Deno.test('computeEtaMinutes: a near-zero distance is floored at MIN_ETA_MINUTES, not 0', () => {
  assertEqual(computeEtaMinutes(0, 18), MIN_ETA_MINUTES, 'zero distance floors to 1 min');
  assertEqual(computeEtaMinutes(0.05, 18), MIN_ETA_MINUTES, 'a tiny distance floors to 1 min');
});

Deno.test('computeEtaMinutes: a non-positive or non-finite speed cannot produce Infinity/NaN', () => {
  assertEqual(computeEtaMinutes(5, 0), MIN_ETA_MINUTES, 'zero speed floors to 1 min, not Infinity');
  assertEqual(computeEtaMinutes(5, -3), MIN_ETA_MINUTES, 'negative speed floors to 1 min');
  assertEqual(computeEtaMinutes(5, Number.NaN), MIN_ETA_MINUTES, 'NaN speed floors to 1 min');
});

Deno.test('computeEtaRange: pads the midpoint by +/-ETA_RANGE_PADDING_MINUTES, floored at 1', () => {
  const range = computeEtaRange(9, 18); // midpoint 30
  assertEqual(range.minutes, 30, 'midpoint is 30 min');
  assertEqual(range.minMinutes, 30 - ETA_RANGE_PADDING_MINUTES, 'min is midpoint - padding');
  assertEqual(range.maxMinutes, 30 + ETA_RANGE_PADDING_MINUTES, 'max is midpoint + padding');
});

Deno.test('computeEtaRange: the low end never drops below MIN_ETA_MINUTES', () => {
  const range = computeEtaRange(0, 18); // midpoint floored to 1
  assertEqual(range.minutes, MIN_ETA_MINUTES, 'midpoint floored to 1');
  assertEqual(range.minMinutes, MIN_ETA_MINUTES, 'min end floored to 1, not 1 - 3 = -2');
});
