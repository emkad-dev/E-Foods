import { brand, border, status, surface, text } from '@feasty/design-system';

/**
 * Compatibility shim over `@feasty/design-system`.
 *
 * This file used to be a hand-maintained hex list, duplicated in `apps/partner` and
 * already drifted from it. Every key below is preserved so the existing
 * `StyleSheet.create` blocks keep working untouched, but the values now come from the
 * shared token layer — the drift source is gone.
 *
 * Two accessibility defects are corrected here rather than in 35 call sites:
 *  - `textSoft` was #6a7d76 (4.04:1 on canvas — failed AA). Now `text.secondary`.
 *  - `textMuted` was #5b6978, which passed on canvas but failed on the darker soft
 *    fills used by badges and chips. Now `text.secondary` (#54626f), which clears
 *    4.5:1 on every surface role.
 *
 * `brandOrange`/`warning` keep the orange fill value. Orange cannot pass AA as a text
 * color, so the new `accentText`/`warningText` keys exist for that purpose and the
 * former text usages have been pointed at them.
 *
 * `danger` is the same story, found later: it is a fill that had never been declared
 * as one, so it was carrying every error message in the app at 4.39:1 or worse.
 * `dangerText` is now the label colour and the text usages point at it.
 *
 * This shim is temporary: it is deleted per app as screens migrate to primitives.
 */
export const customerTheme = {
  background: surface.canvas,
  backgroundAlt: '#e3ece8',
  surface: surface.default,
  surfaceMuted: surface.muted,
  surfaceStrong: surface.strong,
  border: border.default,
  text: text.primary,
  textMuted: text.secondary,
  textSoft: text.secondary,
  brandGreen: brand.primary,
  brandOrange: brand.accent,
  launchBackground: '#d2d2d2',
  headerBackground: '#d9e0dc',
  headerSurface: '#eef3f0',
  accent: brand.primary,
  accentStrong: brand.primaryStrong,
  accentSoft: brand.primarySoft,
  accentTint: brand.primaryTint,
  /** Accessible orange for text (7.16:1). Use instead of `brandOrange` for any label. */
  accentText: brand.accentText,
  link: brand.primaryStrong,
  linkSoft: brand.primaryTint,
  /**
   * Was #090f1d — four/six/five points off `surface.inverse` (#0d1522). Close
   * enough that nobody would catch it by eye, different enough to be a second
   * source of truth for the darkest surface. Now the token.
   */
  hero: surface.inverse,
  /** No token equivalent: a cool grey-blue used only by the home feature card. */
  heroSoft: '#d4dde7',
  /** White label for a brand-green or danger fill. */
  textOnBrand: text.onBrand,
  /** Dark label for an orange fill — white on #f57c00 is 2.70:1, failing AA. */
  textOnAccent: text.onAccent,
  /** Text on the near-black hero. */
  textOnInverse: text.onInverse,
  /**
   * Supporting copy on a dark surface, under `textOnInverse`. Replaces the
   * literal rgba(255,255,255,0.86) on the home feature card's overlay copy —
   * a translucent white invented here because the token layer had a
   * full-strength `onInverse` but no muted sibling. Opaque, so it no longer
   * depends on whatever happens to be behind it.
   */
  textOnInverseMuted: text.onInverseMuted,
  danger: status.danger,
  dangerSoft: status.dangerSoft,
  /**
   * Accessible counterpart to `danger` for text, the same role `accentText` and
   * `warningText` already play for the orange. `danger` (#c54a43) is a fill: it
   * fails AA as text on seven of the eight light surfaces in the token layer,
   * including this app's own `background` (4.39:1) and `dangerSoft` (3.74:1 —
   * the red-badge pairing, and the worst contrast in the app). Every error line
   * and red label now points here instead.
   */
  dangerText: status.dangerText,
  success: status.success,
  successSoft: status.successSoft,
  warning: status.warning,
  warningSoft: status.warningSoft,
  /** Accessible counterpart to `warning` for text. */
  warningText: status.warningText,
};
