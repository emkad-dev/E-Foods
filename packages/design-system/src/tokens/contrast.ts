/**
 * WCAG 2.1 contrast arithmetic, in one place.
 *
 * `color.test.ts` carried a private copy of the luminance maths. Four more
 * guards now need the same three questions answered — the badge tones, both
 * queue-signal helpers, and the two fill-only status-colour functions — and a
 * second transcription of `0.2126 / 0.7152 / 0.0722` is a second opportunity
 * for two guards to quietly disagree about what 4.5:1 means. So there is one
 * copy and every guard measures against it.
 *
 * Imports nothing, exactly like `color.ts`, so it loads under
 * `node --test --experimental-strip-types` without dragging React Native in.
 *
 * Deliberately NOT re-exported from `./index`: no screen has a reason to
 * measure contrast at runtime. This exists so tests can measure the real
 * exported values instead of a transcription of them.
 */

/** WCAG 2.1 AA for normal-size text. */
export const AA_NORMAL = 4.5;

/** `#RRGGBB` or `#RRGGBBAA`, case-insensitive. */
const HEX = /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * Parsing is strict on purpose. `parseInt` returns NaN rather than throwing, so
 * a lenient reader would turn `rgba(13, 21, 34, 0.45)` or a stray token name
 * into a NaN luminance, every comparison against it would be false, and the
 * guard would report a clean pass while measuring nothing at all.
 */
const channels = (hex: string): number[] => {
  if (!HEX.test(hex)) {
    throw new TypeError(`Not a hex color: ${JSON.stringify(hex)} — contrast cannot be measured`);
  }

  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
};

/** WCAG 2.1 relative luminance. Alpha, if present, is ignored — flatten first. */
export const relativeLuminance = (hex: string): number => {
  const linear = channels(hex)
    .map((v) => v / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));

  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
};

/** Contrast ratio between two opaque colors, 1:1 to 21:1. Order does not matter. */
export const contrastRatio = (a: string, b: string): number => {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);

  return (hi + 0.05) / (lo + 0.05);
};

/**
 * Flatten `#RRGGBBAA` onto an opaque background, in sRGB, the way the renderer
 * composites it.
 *
 * This is what makes the fill-only rule measurable. The call sites write
 * `` `${statusColor}20` `` — alpha 0x20, 32/255 ≈ 12.5% — and the defect class
 * being guarded is a saturated status colour used as the *label* on that tint.
 * Because the tint is derived from the colour, both move together and no amount
 * of darkening the hue can open the gap; you have to measure the composite to
 * see it.
 *
 * A `#RRGGBB` input is already opaque and is returned unchanged.
 */
export const flattenAlpha = (color: string, over: string): string => {
  if (!HEX.test(color)) {
    throw new TypeError(`Not a hex color: ${JSON.stringify(color)} — cannot be flattened`);
  }

  if (color.length === 7) {
    return color.toLowerCase();
  }

  const alpha = parseInt(color.slice(7, 9), 16) / 255;
  const fg = channels(color);
  const bg = channels(over);

  return `#${fg
    .map((v, i) => Math.round(v * alpha + bg[i] * (1 - alpha)))
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;
};
