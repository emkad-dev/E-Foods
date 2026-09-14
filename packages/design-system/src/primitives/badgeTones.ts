/**
 * The `Badge` tone table, split out of `Badge.tsx`.
 *
 * It lives in its own React-free module for one reason: `BADGE_TONE_PAIRS` was
 * written to be asserted ("Exported for the a11y test") and then nothing ever
 * asserted it, because it sat in a `.tsx` file. Node's test runner cannot load
 * JSX, so the guard could not reach the table and the primitive that encodes
 * the whole fill/ink rule was the one pairing in the design system with no
 * test behind it.
 *
 * The `.ts` extension on the token import is what lets `color.test.ts` load
 * this under `node --test --experimental-strip-types`, matching the convention
 * documented in `../tokens/index.ts`.
 */
import { brand, status, surface, text } from '../tokens/color.ts';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'accent';

type BadgeToneSpec = {
  background: string;
  /** A key of `text`, i.e. the `TextTone` `Text` accepts. */
  tone: keyof typeof text;
};

/**
 * Small status pill — order state, "New", promo flags.
 *
 * The `warning` and `accent` tones deliberately use a soft fill with dark text rather
 * than orange text, because orange cannot clear AA as a text color. `accent` uses the
 * full-strength orange fill paired with `onAccent` ink (6.77:1) for genuine emphasis.
 */
export const BADGE_TONES: Record<BadgeTone, BadgeToneSpec> = {
  neutral: { background: surface.strong, tone: 'secondary' },
  success: { background: status.successSoft, tone: 'primary' },
  warning: { background: status.warningSoft, tone: 'primary' },
  danger: { background: status.dangerSoft, tone: 'primary' },
  accent: { background: brand.accent, tone: 'onAccent' },
};

/** Exported for the a11y test — every badge tone must be a legal fill/text pairing. */
export const BADGE_TONE_PAIRS = Object.entries(BADGE_TONES).map(([name, spec]) => ({
  name: `badge.${name}`,
  bg: spec.background,
  fg: text[spec.tone],
}));
