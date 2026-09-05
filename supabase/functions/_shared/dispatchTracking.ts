// Customer live-tracking config: the average rider speed used to turn a
// straight-line rider->customer distance into an ETA. Tunable via
// `PlatformSettings` (`id = 'dispatchTracking'`) without a deploy, exactly the
// way dispatchWeights.ts is tunable. This file holds the pure, DB-free
// type/defaults/parser so it can be unit-tested directly; the loader that
// reads PlatformSettings, caches, and never throws lives in
// platformSettings.ts (`loadDispatchTrackingConfig`), matching
// `loadDispatchWeights` exactly.

export interface DispatchTrackingConfig {
  /** Assumed average rider ground speed, km/h, for straight-line ETAs. */
  averageSpeedKmh: number;
}

export const DEFAULT_DISPATCH_TRACKING: DispatchTrackingConfig = {
  averageSpeedKmh: 18,
};

// Bounds keep a mistyped admin value from breaking tracking. The ETA maths
// divides distance by this speed, so a zero, negative, non-finite, or absurd
// speed would produce Infinity/NaN/garbage minutes rather than a sane range -
// and a customer watching their food must never see "ETA: NaN min" because
// someone fat-fingered the setting. Same posture as parseDispatchWeights: the
// field must already be a finite JS `number` (not a coerced `Number(null) === 0`
// masquerading as valid), strictly positive, and within a generous upper bound
// (a rider is not doing 300 km/h through Lagos traffic). Anything else falls
// back to the default whole.
export const MAX_TRACKING_SPEED_KMH = 200;

export const parseDispatchTracking = (raw: unknown): DispatchTrackingConfig => {
  if (!raw || typeof raw !== 'object') {
    return DEFAULT_DISPATCH_TRACKING;
  }

  const record = raw as Record<string, unknown>;
  const averageSpeedKmh = record.averageSpeedKmh;

  const valid =
    typeof averageSpeedKmh === 'number' &&
    Number.isFinite(averageSpeedKmh) &&
    averageSpeedKmh > 0 &&
    averageSpeedKmh <= MAX_TRACKING_SPEED_KMH;

  return valid ? { averageSpeedKmh } : DEFAULT_DISPATCH_TRACKING;
};
