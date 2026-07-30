/**
 * 4pt spacing scale.
 *
 * Replaces the 13 distinct `paddingVertical` values (including eyeballed one-offs
 * 5, 7, 9, 13, 17) that existed before this package.
 *
 * Migration mapping from legacy values:
 *   5,6,7 -> sm | 9,10 -> md | 13,14,15 -> lg | 17,18 -> xl | 22 -> 2xl | 28,30 -> 3xl
 */

export const space = {
  hair: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 40,
  '5xl': 48,
} as const;

export type SpaceToken = keyof typeof space;

/** Minimum accessible touch target (iOS HIG / Material both land on 44–48dp). */
export const MIN_TAP_TARGET = 44;
