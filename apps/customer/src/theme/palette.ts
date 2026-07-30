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
  hero: '#090f1d',
  heroSoft: '#d4dde7',
  danger: status.danger,
  dangerSoft: status.dangerSoft,
  success: status.success,
  successSoft: status.successSoft,
  warning: status.warning,
  warningSoft: status.warningSoft,
  /** Accessible counterpart to `warning` for text. */
  warningText: status.warningText,
};
