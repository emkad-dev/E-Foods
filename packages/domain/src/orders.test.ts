/**
 * Run with: node --test --experimental-strip-types packages/domain/src/orders.test.ts
 *
 * `getOrderStatusColor` is documented FILL ONLY, and a comment is not a guard.
 * Five call sites across customer and dispatch consume it as `${color}20` — a
 * 12.5% tint — and the defect being prevented is a saturated status colour used
 * as the *label* on that tint, where the text and its background are the same
 * hue and move together.
 *
 * The design-system import below is the one place this package reaches into the
 * UI layer, and only from a test: the contrast arithmetic and the surfaces these
 * pills are rendered on both live there, and measuring against a transcription
 * of them would guard nothing.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  surface,
  text,
} from '../../design-system/src/tokens/color.ts';
import {
  AA_NORMAL,
  contrastRatio,
  flattenAlpha,
} from '../../design-system/src/tokens/contrast.ts';
import { getOrderStatusColor, LEGACY_ORDER_STATUS_MAP, ORDER_STATUSES } from './orders.ts';

/** The alpha every call site appends: `${color}20`, 0x20 = 32/255 ≈ 12.5%. */
const TINT_ALPHA = '20';

/**
 * Pure white, not a token. Of every light surface a pill can land on, white
 * produces the *lightest* tint and therefore the most favourable contrast for a
 * dark label — so a colour that cannot label its own tint here cannot label it
 * on any real surface either. Using the friendliest case makes the fill-only
 * finding a floor rather than a coincidence of which card it was measured on.
 */
const MOST_FAVOURABLE_LIGHT_SURFACE = '#ffffff';

const distinctStatusColors = (): string[] => [
  ...new Set(
    [...ORDER_STATUSES, ...Object.keys(LEGACY_ORDER_STATUS_MAP), 'not_a_status'].map(
      (status) => getOrderStatusColor(status),
    ),
  ),
];

/**
 * The parent surface / ink combinations these tints are actually rendered on,
 * from the five call sites: the light order cards in customer's orders list and
 * detail and in dispatch's deliveries, index and delivery detail, plus the dark
 * hero on dispatch's delivery detail.
 */
const RENDERED_PILLS = [
  { where: 'light order card', surface: surface.default, ink: text.primary },
  { where: 'dark delivery hero', surface: surface.inverse, ink: text.onInverse },
];

describe('getOrderStatusColor is fill only', () => {
  /**
   * Pins the defect, not the fix. Exactly one of the eleven values can legibly
   * label its own tint (#5D3FD3, a deep violet that is already nearly a text
   * colour); the other ten cannot, and darkening them cannot help because the
   * tint is derived from the hue and darkens with it. That is the whole reason
   * the function may never be handed to a `color` prop.
   */
  it('all but one status hue fail to label their own tint, even on white', () => {
    const selfLabelled = distinctStatusColors().map((color) => {
      const tint = flattenAlpha(`${color}${TINT_ALPHA}`, MOST_FAVOURABLE_LIGHT_SURFACE);
      return { color, tint, ratio: contrastRatio(color, tint) };
    });

    const passing = selfLabelled
      .filter((row) => row.ratio >= AA_NORMAL)
      .map((row) => row.color)
      .sort();

    assert.deepEqual(
      passing,
      ['#5D3FD3'],
      `The fill-only rule has shifted. Measured on white — the most favourable ` +
        `light surface there is — these are the ratios of each status colour used ` +
        `as its own label:\n` +
        selfLabelled
          .map((row) => `  ${row.color} on ${row.tint} = ${row.ratio.toFixed(2)}:1`)
          .join('\n') +
        `\nIf a hue now passes that did not before, the palette changed, not the ` +
        `rule: every call site still uses this value as a fill. Do not "fix" a ` +
        `label by darkening the hue — the tint darkens with it.`,
    );
  });

  it('every status tint is a legible fill for the ink its screen puts on it', () => {
    const failures: string[] = [];

    for (const color of distinctStatusColors()) {
      for (const pill of RENDERED_PILLS) {
        const tint = flattenAlpha(`${color}${TINT_ALPHA}`, pill.surface);
        const ratio = contrastRatio(pill.ink, tint);

        if (ratio < AA_NORMAL) {
          failures.push(
            `${color} tinted to ${tint} on ${pill.surface}: ink ${pill.ink} = ` +
              `${ratio.toFixed(2)}:1 (${pill.where})`,
          );
        }
      }
    }

    assert.deepEqual(
      failures,
      [],
      `A status badge's label is no longer readable on its own tint. The tint ` +
        `carries the status hue and the label is a plain foreground; a status ` +
        `colour whose tint collides with that foreground breaks the badge on every ` +
        `screen at once:\n${failures.join('\n')}`,
    );
  });

  /**
   * The two sweeps above measure hex strings. A branch returning `rgba(...)`, a
   * named colour or an empty string would make `flattenAlpha` throw rather than
   * quietly report a pass — this states that expectation outright so the reason
   * for the strict parsing is not a mystery.
   */
  it('every branch returns a parseable hex', () => {
    for (const status of [...ORDER_STATUSES, 'not_a_status']) {
      const color = getOrderStatusColor(status);
      assert.match(
        color,
        /^#[0-9a-f]{6}$/i,
        `getOrderStatusColor('${status}') returned ${JSON.stringify(color)}. Call ` +
          `sites build a tint by string concatenation (\`\${color}20\`), which only ` +
          `works for a 6-digit hex; anything else renders as a transparent pill and ` +
          `cannot be contrast-checked.`,
      );
    }
  });
});
