import { brand, border, status, surface, text } from '@feasty/design-system';

/**
 * Compatibility shim over `@feasty/design-system`.
 *
 * Same accessibility corrections as the customer shim: `textSoft` (#6a7d76, 4.04:1)
 * and `textMuted` (#5b6978, failed on the darker soft fills) both resolve to
 * `text.secondary`, and `warningText` is the accessible orange for labels.
 *
 * Three values deliberately stay literal or map to a different role because partner
 * drifted from customer, and this phase preserves each app's current appearance rather
 * than silently restyling partner. Reconciling them is Phase 3 work:
 *   - `surface` is #ffffff here vs `surface.default` (#fbfcfc) in customer
 *   - `border` matches `border.subtle`, whereas customer's `border` is `border.default`
 *   - `cream` is a partner-only alias for `surface.default`
 *
 * This shim is temporary: it is deleted as partner screens migrate to primitives.
 */
export const partnerTheme = {
  background: surface.canvas,
  /** Drift: customer uses surface.default (#fbfcfc). Reconcile in Phase 3. */
  surface: '#ffffff',
  surfaceMuted: surface.muted,
  border: border.subtle,
  text: text.primary,
  textMuted: text.secondary,
  textSoft: text.secondary,
  brandGreen: brand.primary,
  brandOrange: brand.accent,
  accent: brand.primary,
  accentStrong: brand.primaryStrong,
  accentSoft: brand.primarySoft,
  /** Accessible orange for text (7.16:1). Use instead of `brandOrange` for any label. */
  accentText: brand.accentText,
  success: status.success,
  successSoft: status.successSoft,
  warning: status.warning,
  warningSoft: status.warningSoft,
  /** Accessible counterpart to `warning` for text. */
  warningText: status.warningText,
  danger: status.danger,
  dangerSoft: status.dangerSoft,
  /**
   * The partner hero is FEASTY green, on the owner's call (2026-09-12).
   *
   * `brand.primaryStrong` (#1b5e20), NOT `brand.primary` (#2e7d32). The hero
   * carries `heroSoft` (= `brand.primarySoft`, #c8e6c9) as its eyebrow text, and
   * that pairing measures 3.81:1 on #2e7d32 — under the 4.5:1 AA bar — versus
   * 5.85:1 on #1b5e20. Shipping #2e7d32 here would force the eyebrow to white at
   * the same time; the deeper green keeps every existing hero text colour passing
   * (ratios on #1b5e20, with the #2e7d32 figure in brackets):
   *   heroSoft #c8e6c9 → 5.85:1 [3.81]   textOnHero #f3f7f6 → 7.29:1 [4.75]
   *   textOnHeroMuted #bac7c3 → 4.51:1 [2.94]
   *
   * Previous values, newest first: surface.inverse #0d1522, #0c389e (blue),
   * #4b3923 (brown), #fff0c2 (cream).
   */
  hero: surface.inverseBrand,
  heroSoft: brand.primarySoft,
  cream: surface.default,
  /** White label for a brand-green or danger fill. */
  textOnBrand: text.onBrand,
  /** Dark label for an orange fill — white on #f57c00 is 2.70:1, failing AA. */
  textOnAccent: text.onAccent,
  /**
   * Text on the hero, whatever `hero` currently is. Named for the role rather
   * than the colour so the hero can change without renaming this. Replaces the
   * literal #fffdf8 the auth heroes carried over from the era when `hero` was a
   * cream (#fff0c2) panel.
   */
  textOnHero: text.onInverse,
  /**
   * Supporting copy on the hero, under `textOnHero`. Named for the role, like
   * its sibling. Replaces the literal #e7dbc7 the three hero screens carried —
   * a beige from the era when `hero` was a brown coffee panel (#4b3923), which
   * stayed put through the blue and both green heroes and had been sitting on
   * green for two commits by the time it was caught.
   */
  textOnHeroMuted: text.onInverseMuted,
};
