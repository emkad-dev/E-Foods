/**
 * Shared prep-time estimation helpers.
 *
 * The pure math lives here so both the edge functions and the customer app
 * can consume the same bucket, median, and fallback rules without duplicating
 * the business logic.
 */

export const WAT_OFFSET_MS = 60 * 60 * 1000;
export const PREP_SAMPLE_WINDOW = 20;
const MIN_PREP_MINUTES = 5;
const MAX_PREP_MINUTES = 180;
const STATIC_PREP_FALLBACK_MINUTES = 30;

export type PrepTimeSample = {
  acceptedAtIso: string;
  readyAtIso: string;
};

export type PrepTimeEstimate = {
  bucketHour: number;
  minutes: number;
  sampleCount: number;
  source: 'fallback' | 'median';
};

const clampPrepMinutes = (value: number) => {
  const rounded = Math.round(value);
  if (!Number.isFinite(rounded) || rounded < MIN_PREP_MINUTES) {
    return MIN_PREP_MINUTES;
  }
  if (rounded > MAX_PREP_MINUTES) {
    return MAX_PREP_MINUTES;
  }
  return rounded;
};

export const parsePrepFallbackMinutes = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return clampPrepMinutes(value);
  }

  if (typeof value !== 'string') {
    return STATIC_PREP_FALLBACK_MINUTES;
  }

  const trimmed = value.trim();
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return clampPrepMinutes(Number.parseFloat(trimmed));
  }

  const matches = trimmed.match(/\d+(?:\.\d+)?/g);
  if (!matches || matches.length === 0) {
    return STATIC_PREP_FALLBACK_MINUTES;
  }

  if (matches.length === 1) {
    return clampPrepMinutes(Number.parseFloat(matches[0]));
  }

  const first = Number.parseFloat(matches[0]);
  const second = Number.parseFloat(matches[1]);
  return clampPrepMinutes((first + second) / 2);
};

export const computeMedianMinutes = (values: number[]): number | null => {
  const finiteValues = values.filter((value) => Number.isFinite(value)).map((value) => Math.round(value));
  if (finiteValues.length === 0) {
    return null;
  }

  const sorted = [...finiteValues].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[midpoint];
  }

  return Math.round((sorted[midpoint - 1] + sorted[midpoint]) / 2);
};

export const getPrepBucketHour = (acceptedAtIso: string): number | null => {
  const ts = Date.parse(acceptedAtIso);
  if (Number.isNaN(ts)) {
    return null;
  }

  return new Date(ts + WAT_OFFSET_MS).getUTCHours();
};

export const computePrepDurationMinutes = (acceptedAtIso: string, readyAtIso: string): number | null => {
  const acceptedAtMs = Date.parse(acceptedAtIso);
  const readyAtMs = Date.parse(readyAtIso);
  if (Number.isNaN(acceptedAtMs) || Number.isNaN(readyAtMs) || readyAtMs <= acceptedAtMs) {
    return null;
  }

  return Math.max(1, Math.round((readyAtMs - acceptedAtMs) / 60000));
};

export const buildRestaurantPrepTimeEstimate = ({
  acceptedAtIso,
  fallbackDeliveryTime,
  samples,
}: {
  acceptedAtIso: string;
  fallbackDeliveryTime: unknown;
  samples: PrepTimeSample[];
}): PrepTimeEstimate => {
  const bucketHour = getPrepBucketHour(acceptedAtIso);
  const fallbackMinutes = parsePrepFallbackMinutes(fallbackDeliveryTime);
  if (bucketHour === null) {
    return {
      bucketHour: -1,
      minutes: fallbackMinutes,
      sampleCount: 0,
      source: 'fallback',
    };
  }

  const sampleDurations: number[] = [];
  for (const sample of samples) {
    if (getPrepBucketHour(sample.acceptedAtIso) !== bucketHour) {
      continue;
    }

    const duration = computePrepDurationMinutes(sample.acceptedAtIso, sample.readyAtIso);
    if (duration === null) {
      continue;
    }

    sampleDurations.push(duration);
    if (sampleDurations.length === PREP_SAMPLE_WINDOW) {
      break;
    }
  }

  if (sampleDurations.length < PREP_SAMPLE_WINDOW) {
    return {
      bucketHour,
      minutes: fallbackMinutes,
      sampleCount: sampleDurations.length,
      source: 'fallback',
    };
  }

  return {
    bucketHour,
    minutes: computeMedianMinutes(sampleDurations) ?? fallbackMinutes,
    sampleCount: sampleDurations.length,
    source: 'median',
  };
};
