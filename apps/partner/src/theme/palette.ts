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
  hero: surface.inverse,
  heroSoft: brand.primarySoft,
  cream: surface.default,
};
