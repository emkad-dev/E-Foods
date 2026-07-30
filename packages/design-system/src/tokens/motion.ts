/**
 * Motion tokens.
 *
 * Easing is expressed as cubic-bezier control points so the values stay free of any
 * animation-library import. Consumers map them to Reanimated's `Easing.bezier(...)`
 * or a CSS `cubic-bezier(...)` on the landing page.
 *
 * Screens must respect `useReducedMotion()` (Reanimated is already a dependency);
 * when reduced motion is on, use `duration.instant`.
 */

export const duration = {
  instant: 0,
  fast: 120,
  base: 200,
  slow: 320,
} as const;

export const easing = {
  /** General-purpose; most transitions. */
  standard: [0.2, 0, 0, 1],
  /** Entering the screen — starts fast, settles gently. */
  decelerate: [0, 0, 0.2, 1],
  /** Leaving the screen. */
  accelerate: [0.4, 0, 1, 1],
} as const;

export type DurationToken = keyof typeof duration;
export type EasingToken = keyof typeof easing;
