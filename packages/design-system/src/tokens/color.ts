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
} as const;

export const text = {
  primary: '#0d1522',
  secondary: '#54626f',
  onBrand: '#ffffff',
  onAccent: '#0d1522',
  onInverse: '#f3f7f6',
  /** WCAG 1.4.3 exempts disabled controls; excluded from the contrast test. */
  disabled: '#8d9c95',
} as const;

export const border = {
  subtle: '#dde7e3',
  default: '#c2d0ca',
  strong: '#a9bcb4',
  focus: '#2e7d32',
} as const;

export const status = {
  success: '#2e7d32',
  successSoft: '#c8e6c9',
  /** Fill only, same rule as `brand.accent`. */
  warning: '#f57c00',
  warningSoft: '#ffe0b2',
  warningText: '#8a4500',
  danger: '#c54a43',
  dangerSoft: '#f8dfdc',
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
  lightTextRoles: ['primary', 'secondary'] as const,
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
    { fg: brand.accentText, bg: surface.canvas, name: 'accentText/canvas' },
    { fg: status.warningText, bg: brand.accentSoft, name: 'warningText/accentSoft' },
  ] as const,
  /** Values banned from ever being used as a text color on a light surface. */
  fillOnly: [brand.accent, status.warning] as const,
} as const;

export const color = { brand, surface, text, border, status, overlay } as const;

export type ColorTokens = typeof color;
