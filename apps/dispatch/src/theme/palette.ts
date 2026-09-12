// Imported by module path, not from the '@feasty/design-system' barrel, on
// purpose — the same rule the dispatch screens already follow. The barrel
// re-exports useFeastyFonts, which pulls expo-font and six @expo-google-fonts
// faces into the bundle; this app does not declare those dependencies. The
// token module itself imports nothing, so taking it directly is free.
import { brand, border, status, surface, text } from '../../../../packages/design-system/src/tokens/color';

/**
 * Compatibility shim over `@feasty/design-system`.
 *
 * This file used to be a hand-maintained hex list — the third copy of the brand,
 * after customer and partner were already migrated. That meant a brand change
 * landed in two apps and silently skipped this one. Every key below is preserved
 * so the existing `StyleSheet.create` blocks keep working untouched, but the
 * values now come from the shared token layer.
 *
 * Three values were near-misses of a token rather than exact matches, and moving
 * them to the token changes the rendered colour. Each is deliberate:
 *  - `textSoft` was #6a7d76 (4.04:1 on canvas — failed AA). Now `text.secondary`
 *    (#54626f), matching the correction customer and partner already took.
 *  - `textMuted` was #5b6978, which passed on canvas but failed on the darker
 *    soft fills used by badges and chips. Now `text.secondary` too.
 *  - `hero` was #090f1d, four/six/five points off `surface.inverse` (#0d1522) —
 *    close enough that nobody would catch it by eye, different enough to be a
 *    second source of truth. Now the token.
 *  - `warning` was #ef6c00 against the brand's #f57c00. Now `status.warning`.
 *    Orange still cannot carry text, so `warningText` below is the label colour.
 *
 * Two values have no token equivalent and stay literal on purpose; they are
 * dispatch-only tones, not brand values:
 *  - `backgroundAlt` (#e3ece8), which customer also carries as a literal
 *  - `heroSecondary` (#172133), the hairline on the dark hero
 *
 * `cream` is a dispatch-only alias for `surface.default`. It is used both as an
 * input background (correct) and as the hero title colour (a surface role doing
 * a text job) — the latter now uses `textOnInverse`.
 *
 * This shim is temporary: it is deleted as dispatch screens migrate to primitives.
 */
export const dispatchTheme = {
  background: surface.canvas,
  /** Dispatch/customer-only tone; no token equivalent. */
  backgroundAlt: '#e3ece8',
  surface: surface.default,
  surfaceMuted: surface.muted,
  border: border.default,
  text: text.primary,
  textMuted: text.secondary,
  textSoft: text.secondary,
  /** White label for a brand-green or danger fill. */
  textOnBrand: text.onBrand,
  /** Dark label for an orange fill — white on #f57c00 is 2.70:1. */
  textOnAccent: text.onAccent,
  /** Text on the near-black hero. */
  textOnInverse: text.onInverse,
  /**
   * Supporting copy on the hero, under `textOnInverse`. 10.50:1 on `hero`.
   *
   * Replaces two literals, both invented here because the token layer had a
   * full-strength `onInverse` but no muted sibling: #d6dfeb (blue-grey) on the
   * three auth heroes and complete-rider-details, and #f7ead8 (beige) on the
   * delivery detail hero. The beige had drifted to 15.44:1 — all but
   * indistinguishable from the title above it, so it was not reading as muted
   * at all — and dispatch had two answers to one question.
   */
  textOnInverseMuted: text.onInverseMuted,
  accent: brand.primary,
  accentStrong: brand.primaryStrong,
  accentSoft: brand.primarySoft,
  accentTint: brand.primaryTint,
  /** Accessible orange for text (7.16:1). Use instead of an orange fill value. */
  accentText: brand.accentText,
  hero: surface.inverse,
  /** Hairline on the dark hero; no token equivalent. */
  heroSecondary: '#172133',
  cream: surface.default,
  success: status.success,
  successSoft: status.successSoft,
  warning: status.warning,
  warningSoft: status.warningSoft,
  /** Accessible counterpart to `warning` for text. */
  warningText: status.warningText,
  danger: status.danger,
  dangerSoft: status.dangerSoft,
  tabBackground: surface.default,
};
