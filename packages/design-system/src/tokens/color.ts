/**
 * FEASTY color roles.
 *
 * Screens reference roles, never raw hex. The brand green/orange are locked; this
 * module reorganizes them into accessible roles rather than replacing them.
 *
 * Contrast rules encoded here (measured, WCAG 2.1):
 *  - `brand.accent` (#f57c00) is 2.70:1 on white and MUST NEVER be a text color on a
 *    light surface. It is a fill; pair it with `text.onAccent`. Use `brand.accentText`
 *    when orange-flavored text is needed.
 *  - `status.danger` (#c54a43) is the same kind of colour and was simply never
 *    declared as one: it clears AA on a single light surface and fails the other
 *    seven, so it too is a fill. Red text is `status.dangerText` / `text.danger`
 *    (#a83b35).
 *  - `text.secondary` is #54626f, not the legacy #6a7d76 (4.04:1, failed AA) nor
 *    #5b6978 (4.18:1 on the darker soft fills). #54626f clears 4.5:1 on every
 *    surface role in this file.
 *
 * This module imports nothing so it stays consumable by non-React targets
 * (the landing CSS build step).
 */

export const brand = {
  primary: '#2e7d32',
  primaryStrong: '#1b5e20',
  primarySoft: '#c8e6c9',
  primaryTint: '#e8f5e9',
  /** FILL ONLY — never a text color on a light surface. Pair with `text.onAccent`. */
  accent: '#f57c00',
  accentSoft: '#ffe0b2',
  /** The accessible stand-in when orange-flavored *text* is needed (7.16:1 on white). */
  accentText: '#8a4500',
} as const;

export const surface = {
  canvas: '#f3f7f6',
  default: '#fbfcfc',
  muted: '#edf3f1',
  strong: '#d8e3df',
  inverse: '#0d1522',
  /**
   * The inverse surface with a brand-green cast, for hero panels that should
   * read as FEASTY without becoming a slab of green. Sits between
   * `inverse` (#0d1522, no brand at all) and `brand.primaryStrong` (#1b5e20,
   * which at full-bleed panel size reads as too much green).
   *
   * Dark, so it is deliberately NOT in `a11y.lightSurfaces` -- the light-text
   * sweep would be meaningless against it. Its real pairings are asserted
   * explicitly in `a11y.pairs` instead.
   */
  inverseBrand: '#14331d',
} as const;

export const status = {
  success: '#2e7d32',
  successSoft: '#c8e6c9',
  /** Fill only, same rule as `brand.accent`. */
  warning: '#f57c00',
  warningSoft: '#ffe0b2',
  warningText: '#8a4500',
  /**
   * FILL ONLY, same rule as `brand.accent` and `warning` — it just was not
   * declared as one, so it got used as words. Measured against the eight light
   * surfaces swept below it clears AA on exactly one of them (`surface.default`,
   * 4.61:1) and fails the other seven, bottoming out at 3.52:1 on
   * `brand.primarySoft`. Correct as a destructive button's fill or an invalid
   * field's border; never as text. Red *text* is `dangerText`.
   */
  danger: '#c54a43',
  dangerSoft: '#f8dfdc',
  /**
   * The accessible counterpart to `danger`, exactly as `warningText` is to
   * `warning` and `brand.accentText` is to `brand.accent`. Clears 4.5:1 on every
   * surface in `a11y.lightSurfaces`; worst case 4.67:1 on `brand.primarySoft`.
   *
   * Not a new colour. This is the value the destructive Button already carried,
   * hardcoded, as its pressed background — the one place in the repo that knew a
   * darker red existed. Naming it here is what lets error copy and quiet
   * destructive labels stop reaching for the fill red.
   */
  dangerText: '#a83b35',
} as const;

export const text = {
  primary: '#0d1522',
  secondary: '#54626f',
  onBrand: '#ffffff',
  onAccent: '#0d1522',
  onInverse: '#f3f7f6',
  /**
   * The muted sibling of `onInverse`, for supporting copy on a dark surface —
   * hero body text under a full-strength `onInverse` title, and anything else
   * that must recede without dropping below AA.
   *
   * It exists because its absence was being filled by invention. With only
   * `onInverse` available, each app improvised its own muted tone and they
   * drifted apart: partner carried #e7dbc7 (a beige left over from a brown
   * coffee hero, still sitting on a green panel long after that hero died),
   * dispatch #d6dfeb (blue-grey) and, on one screen, #f7ead8 (a beige so close
   * to full strength it was not reading as muted), customer
   * rgba(255,255,255,0.86). Four literals, four hues, one role — dispatch alone
   * had two answers — so the role is now named here and all four are retired.
   *
   * A cool grey with a faint green cast, consistent with the tinted neutrals
   * already in this file (`surface.canvas` #f3f7f6, `border.subtle` #dde7e3)
   * rather than a fourth unrelated hue. Measurably dimmer than `onInverse`, so
   * it reads as muted, and far clear of the 4.5:1 AA bar on both dark surfaces:
   *   on `surface.inverse` #0d1522       10.50:1  (`onInverse`: 16.95:1)
   *   on `surface.inverseBrand` #14331d   7.92:1  (`onInverse`: 12.78:1)
   *
   * Both pairings are asserted in `a11y.pairs`, so this role cannot drift out
   * of contrast without failing the test.
   */
  onInverseMuted: '#bac7c3',
  /**
   * Red words: a field's error message, the label on a quiet destructive button.
   *
   * It is `status.dangerText` (#a83b35) and NOT `status.danger` (#c54a43),
   * because the fill red fails AA on seven of the eight surfaces in
   * `a11y.lightSurfaces` — so every red string in the three apps was failing
   * until this role existed, including the error line under every form field.
   *
   * It has to be a `text.*` key rather than a bare status value because `Text`
   * derives `TextTone` from `keyof typeof text`; without it there is no
   * `tone="danger"`, and a component that wants red copy has no choice but to
   * hand-roll `color: status.danger` and fail. `status` is declared above `text`
   * in this file purely so this role can name the token instead of repeating the
   * hex.
   */
  danger: status.dangerText,
  /** WCAG 1.4.3 exempts disabled controls; excluded from the contrast test. */
  disabled: '#8d9c95',
} as const;

export const border = {
  subtle: '#dde7e3',
  default: '#c2d0ca',
  strong: '#a9bcb4',
  focus: '#2e7d32',
} as const;

export const overlay = {
  scrim: 'rgba(13, 21, 34, 0.45)',
  shadow: '#0d1522',
} as const;

/**
 * Machine-readable accessibility contract, consumed by `color.test.ts`.
 * Keeping it beside the values means a new role cannot be added without
 * declaring how it is allowed to be used.
 */
export const a11y = {
  /** Text roles that must clear 4.5:1 against every surface in `lightSurfaces`. */
  lightTextRoles: ['primary', 'secondary', 'danger'] as const,
  lightSurfaces: [
    surface.canvas,
    surface.default,
    surface.muted,
    surface.strong,
    brand.primarySoft,
    brand.primaryTint,
    brand.accentSoft,
    status.dangerSoft,
  ] as const,
  /** Fill/text pairings that must clear 4.5:1. */
  pairs: [
    { fg: text.onBrand, bg: brand.primary, name: 'onBrand/primary' },
    { fg: text.onBrand, bg: brand.primaryStrong, name: 'onBrand/primaryStrong' },
    { fg: text.onAccent, bg: brand.accent, name: 'onAccent/accent' },
    { fg: text.onBrand, bg: status.danger, name: 'onBrand/danger' },
    { fg: text.onInverse, bg: surface.inverse, name: 'onInverse/inverse' },
    { fg: text.onInverse, bg: surface.inverseBrand, name: 'onInverse/inverseBrand' },
    { fg: text.onInverseMuted, bg: surface.inverse, name: 'onInverseMuted/inverse' },
    { fg: text.onInverseMuted, bg: surface.inverseBrand, name: 'onInverseMuted/inverseBrand' },
    { fg: brand.primarySoft, bg: surface.inverseBrand, name: 'primarySoft/inverseBrand' },
    { fg: brand.accentText, bg: surface.canvas, name: 'accentText/canvas' },
    { fg: status.warningText, bg: brand.accentSoft, name: 'warningText/accentSoft' },
  ] as const,
  /** Values banned from ever being used as a text color on a light surface. */
  fillOnly: [brand.accent, status.warning, status.danger] as const,
} as const;

export const color = { brand, surface, text, border, status, overlay } as const;

export type ColorTokens = typeof color;
