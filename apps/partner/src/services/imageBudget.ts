// Sizing rules for restaurant asset uploads.
//
// Pure and IO-free so it can be unit tested with `node --test`; the actual
// resize/re-encode lives in restaurantAssetUpload.ts.
//
// Why a cap exists at all: expo-image-picker's `quality` only re-encodes, and
// `allowsEditing` only crops to an aspect ratio — neither bounds resolution. A
// phone photo could therefore land in Storage at several megabytes. Delivery is
// already pinned to width=800 by the Cloudflare transformation, so anything
// beyond a modest retina multiple of that is stored bytes nobody ever receives.

/** Hard ceiling on what we are willing to put in Storage, in bytes. */
export const MAX_UPLOAD_BYTES = 300 * 1024;

/**
 * Longest-edge cap. Delivery is width=800, so 1600 leaves a 2x retina margin
 * without paying for resolution that is never served.
 */
export const MAX_DIMENSION = 1600;

/**
 * Quality ladder tried in order until the result fits MAX_UPLOAD_BYTES. Stops at
 * 0.4 — below that JPEG artefacts are visible on food photography, and shipping
 * a visibly degraded image is worse than storing a slightly large one.
 */
export const QUALITY_STEPS = [0.8, 0.65, 0.5, 0.4] as const;

export type Dimensions = { width: number; height: number };

/**
 * Scales `source` down so its longest edge is at most `maxDimension`, preserving
 * aspect ratio. Never upscales — a small logo stays exactly as it is.
 */
export const resolveTargetDimensions = (
  source: Dimensions,
  maxDimension: number = MAX_DIMENSION
): Dimensions => {
  const { width, height } = source;

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    // Nothing sensible to compute from; let the caller upload as-is rather than
    // invent dimensions.
    return source;
  }

  const longestEdge = Math.max(width, height);

  if (longestEdge <= maxDimension) {
    return { width, height };
  }

  const scale = maxDimension / longestEdge;

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
};

/** True when the encoded result is small enough to stop compressing. */
export const isWithinBudget = (byteLength: number, maxBytes: number = MAX_UPLOAD_BYTES) =>
  byteLength <= maxBytes;

/** Human-readable size for log lines and error messages. */
export const formatKb = (byteLength: number) => `${Math.round(byteLength / 1024)} kB`;
