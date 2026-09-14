/**
 * Run with: node --test --experimental-strip-types apps/partner/src/theme/statusColors.test.ts
 *
 * `getPartnerStatusColor` is documented FILL ONLY. A comment is not a guard, so
 * this file measures the property that makes the rule true.
 *
 * What is *not* checkable from a unit test: "no screen renders this as text."
 * Nothing here can see a screen. What IS checkable is the two halves of the rule
 * itself:
 *
 *  1. The values cannot carry their own label. Every call site consumes them as
 *     `${color}20`, a 12.5% tint of the colour, so a coloured label sits on a
 *     wash of itself — and no amount of darkening the hue helps, because the
 *     tint darkens with it. Pinning that failure in place is more honest than
 *     pretending the values are safe: it is the reason the rule exists, and if
 *     it ever stops being true somebody has changed the palette out from under
 *     the rule and should have to say so deliberately.
 *
 *  2. The pairing that actually ships — the tint as a fill, with the plain
 *     legible foreground each screen already uses — clears AA on every branch.
 *     This is the forward-looking half: a new status colour dark enough to sink
 *     its own tint would break the pills, and this catches it.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  AA_NORMAL,
  contrastRatio,
  flattenAlpha,
} from '../../../../packages/design-system/src/tokens/contrast.ts';
import {
  LEGACY_ORDER_STATUS_MAP,
  ORDER_STATUSES,
} from '../../../../packages/domain/src/orders.ts';
import { partnerTheme } from './palette.ts';
import { getPartnerStatusColor } from './statusColors.ts';

/** The alpha every call site appends: `${color}20`, 0x20 = 32/255 ≈ 12.5%. */
const TINT_ALPHA = '20';

const distinctStatusColors = (): string[] => [
  ...new Set(
    [...ORDER_STATUSES, ...Object.keys(LEGACY_ORDER_STATUS_MAP), 'not_a_status'].map(
      (status) => getPartnerStatusColor(status),
    ),
  ),
];

/**
 * The two places a partner status tint is actually rendered, each with the ink
 * that screen puts on it. Kept together so a screen that changes its parent
 * surface has one obvious place to update.
 */
const RENDERED_PILLS = [
  {
    where: 'app/(partner)/orders.tsx — orderCard',
    surface: partnerTheme.surface,
    ink: partnerTheme.text,
  },
  {
    where: 'app/(partner)/order/[id].tsx — hero',
    surface: partnerTheme.hero,
    ink: partnerTheme.textOnHero,
  },
];

describe('getPartnerStatusColor is fill only', () => {
  /**
   * Pins the defect rather than the fix. Exactly one branch survives being used
   * as its own label, and it is not a signal hue at all: the `default` branch
   * returns `textMuted`, a text role borrowed for the muted case. Every colour
   * chosen to read as a *status* fails, which is precisely why the function may
   * never be handed to a `color` prop.
   */
  it('no signal hue can legibly label its own tint', () => {
    const selfLabelled = distinctStatusColors().map((color) => {
      const tint = flattenAlpha(`${color}${TINT_ALPHA}`, partnerTheme.surface);
      return { color, ratio: contrastRatio(color, tint), tint };
    });

    const passing = selfLabelled
      .filter((row) => row.ratio >= AA_NORMAL)
      .map((row) => row.color)
      .sort();

    assert.deepEqual(
      passing,
      [partnerTheme.textMuted],
      `The fill-only rule has shifted. Exactly one value returned by ` +
        `getPartnerStatusColor may legibly label its own ${TINT_ALPHA} tint — ` +
        `textMuted (${partnerTheme.textMuted}), which is a text role, not a status ` +
        `hue. Measured now:\n` +
        selfLabelled
          .map((row) => `  ${row.color} on ${row.tint} = ${row.ratio.toFixed(2)}:1`)
          .join('\n') +
        `\nIf a status hue now passes, someone changed the palette, not the rule: ` +
        `these values are still consumed as a fill by every call site. Darkening a ` +
        `hue to "fix" a label cannot work — the tint is derived from the hue and ` +
        `darkens with it.`,
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
      `A status pill's label is no longer readable on its own tint. The tint ` +
        `carries the status hue and the label is a plain foreground; a new status ` +
        `colour dark enough to sink its tint breaks that. Either lighten the hue or ` +
        `change the pill's ink:\n${failures.join('\n')}`,
    );
  });
});
