// The PlatformSettings tracking-config parser (dispatchTracking.ts). Pure, no
// DB, no env - runs in the first (type-checked) `deno test` invocation, the
// same as dispatchWeights.test.ts which it mirrors. A mistyped admin speed
// must fall back to the default whole, never divide-by-zero the ETA maths.

import {
  DEFAULT_DISPATCH_TRACKING,
  MAX_TRACKING_SPEED_KMH,
  parseDispatchTracking,
} from './dispatchTracking.ts';

const assertEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

Deno.test('parseDispatchTracking: a valid speed is accepted as-is', () => {
  assertEqual(parseDispatchTracking({ averageSpeedKmh: 25 }).averageSpeedKmh, 25, 'accepts 25 km/h');
  assertEqual(
    parseDispatchTracking({ averageSpeedKmh: MAX_TRACKING_SPEED_KMH }).averageSpeedKmh,
    MAX_TRACKING_SPEED_KMH,
    'accepts the upper bound'
  );
});

Deno.test('parseDispatchTracking: a mistyped or out-of-range speed falls back to the default whole', () => {
  const fallback = DEFAULT_DISPATCH_TRACKING.averageSpeedKmh;

  assertEqual(parseDispatchTracking({ averageSpeedKmh: 'fast' }).averageSpeedKmh, fallback, 'a string speed falls back');
  assertEqual(
    parseDispatchTracking({ averageSpeedKmh: 0 }).averageSpeedKmh,
    fallback,
    'a zero speed falls back (would divide by zero)'
  );
  assertEqual(parseDispatchTracking({ averageSpeedKmh: -5 }).averageSpeedKmh, fallback, 'a negative speed falls back');
  assertEqual(
    parseDispatchTracking({ averageSpeedKmh: MAX_TRACKING_SPEED_KMH + 1 }).averageSpeedKmh,
    fallback,
    'an absurd speed falls back'
  );
  assertEqual(
    parseDispatchTracking({ averageSpeedKmh: Number.POSITIVE_INFINITY }).averageSpeedKmh,
    fallback,
    'a non-finite speed falls back'
  );
  assertEqual(
    parseDispatchTracking({ averageSpeedKmh: null }).averageSpeedKmh,
    fallback,
    'null does NOT coerce to 0 - it falls back'
  );
  assertEqual(parseDispatchTracking(null).averageSpeedKmh, fallback, 'a missing config object falls back');
  assertEqual(parseDispatchTracking('nope').averageSpeedKmh, fallback, 'a non-object falls back');
});
