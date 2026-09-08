/**
 * Corner radius scale.
 *
 * Replaces 13 distinct `borderRadius` values (7,8,10,12,14,15,16,18,20,22,24,28,999).
 *
 * Migration mapping:
 *   7,8 -> sm | 10,12 -> md | 14,15,16 -> lg | 18,20 -> xl | 22,24,28 -> 2xl | 999 -> pill
 */

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  pill: 999,
} as const;

export type RadiusToken = keyof typeof radius;
