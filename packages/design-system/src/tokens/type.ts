/**
 * Typography scale — 8 roles replacing the 22 distinct fontSize values that
 * existed before this package.
 *
 * Family pairing matches the landing page so all three surfaces agree:
 * Bricolage Grotesque for display/headings, Karla for body/metadata.
 * Weights are restricted to exactly what the landing already loads, so adopting
 * this adds no additional font payload.
 *
 * IMPORTANT: roles carry `fontFamily` but deliberately NO `fontWeight`.
 * With per-weight font files loaded via expo-font, also setting `fontWeight` makes
 * Android synthesize/mis-pick a face. The weight lives in the family name.
 *
 * Weight ceiling: 800 is permitted ONLY on `display`. Body text never exceeds 700.
 * This reverses the previous "fontWeight 800 used 99x" problem — hierarchy comes
 * from size, color, and whitespace instead of heaviness.
 */

export const fontFamily = {
  displayMedium: 'BricolageGrotesque_500Medium',
  displayBold: 'BricolageGrotesque_700Bold',
  displayExtraBold: 'BricolageGrotesque_800ExtraBold',
  bodyRegular: 'Karla_400Regular',
  bodyMedium: 'Karla_500Medium',
  bodyBold: 'Karla_700Bold',
} as const;

/** System fallbacks used until fonts resolve, or if loading fails. */
export const fontFallback = {
  display: 'sans-serif-medium',
  body: 'sans-serif',
} as const;

export const typeScale = {
  /** Rare hero moments only — order success, empty-state headline. */
  display: {
    fontFamily: fontFamily.displayExtraBold,
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: -0.5,
  },
  /** Screen titles. */
  title1: {
    fontFamily: fontFamily.displayBold,
    fontSize: 24,
    lineHeight: 30,
    letterSpacing: -0.3,
  },
  /** Section headers. */
  title2: {
    fontFamily: fontFamily.displayBold,
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.2,
  },
  /** Card titles, restaurant names. */
  title3: {
    fontFamily: fontFamily.displayMedium,
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.1,
  },
  /** Default body text. */
  body: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: 15,
    lineHeight: 22,
    letterSpacing: 0,
  },
  /** Emphasis, prices. */
  bodyStrong: {
    fontFamily: fontFamily.bodyBold,
    fontSize: 15,
    lineHeight: 22,
    letterSpacing: 0,
  },
  /** Metadata — delivery time, rating, distance. */
  callout: {
    fontFamily: fontFamily.bodyMedium,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0,
  },
  /** Badges, labels. */
  caption: {
    fontFamily: fontFamily.bodyMedium,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.3,
  },
} as const;

export type TypeVariant = keyof typeof typeScale;

/** The font map expo-font's `useFonts` expects, assembled by each app's root layout. */
export const REQUIRED_FONT_KEYS = [
  fontFamily.displayMedium,
  fontFamily.displayBold,
  fontFamily.displayExtraBold,
  fontFamily.bodyRegular,
  fontFamily.bodyMedium,
  fontFamily.bodyBold,
] as const;
