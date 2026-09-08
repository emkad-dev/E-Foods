/**
 * Raw elevation values.
 *
 * This module stays platform-agnostic (imports nothing) so the token layer remains
 * consumable outside React Native. The ready-to-spread `Platform.select` style
 * objects are built from these in `primitives/elevation.ts`.
 *
 * Shadow color derives from `surface.inverse` (#0d1522) rather than pure black, so
 * cards read correctly against the sage canvas instead of looking grey-dirty.
 */

export const elevationValues = {
  none: {
    offsetY: 0,
    blur: 0,
    opacity: 0,
    android: 0,
  },
  sm: {
    offsetY: 1,
    blur: 3,
    opacity: 0.08,
    android: 1,
  },
  md: {
    offsetY: 4,
    blur: 10,
    opacity: 0.1,
    android: 4,
  },
  lg: {
    offsetY: 10,
    blur: 24,
    opacity: 0.14,
    android: 10,
  },
} as const;

export type ElevationToken = keyof typeof elevationValues;
