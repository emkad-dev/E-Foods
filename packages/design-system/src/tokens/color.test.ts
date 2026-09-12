import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { a11y, brand, status, surface, text } from './color.ts';

/** WCAG 2.1 relative luminance. */
const luminance = (hex: string): number => {
  const channels = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
};

const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const AA_NORMAL = 4.5;

describe('color tokens — contrast', () => {
  it('every light text role clears AA on every light surface', () => {
    const failures: string[] = [];

    for (const role of a11y.lightTextRoles) {
      for (const bg of a11y.lightSurfaces) {
        const ratio = contrast(text[role], bg);
        if (ratio < AA_NORMAL) {
          failures.push(`text.${role} on ${bg} = ${ratio.toFixed(2)}:1`);
        }
      }
    }

    assert.deepEqual(failures, [], `contrast failures:\n${failures.join('\n')}`);
  });

  it('every declared fill/text pairing clears AA', () => {
    const failures: string[] = [];

    for (const pair of a11y.pairs) {
      const ratio = contrast(pair.fg, pair.bg);
      if (ratio < AA_NORMAL) {
        failures.push(`${pair.name} = ${ratio.toFixed(2)}:1`);
      }
    }

    assert.deepEqual(failures, [], `contrast failures:\n${failures.join('\n')}`);
  });

  /**
   * Regression guard for a defect that shipped: brand orange was used as a text
   * color in 10 places at 2.70:1 on white, below even the 3.0 large-text floor.
   */
  it('fill-only colors never appear in a text role', () => {
    const textValues = Object.values(text) as string[];

    for (const banned of a11y.fillOnly) {
      assert.equal(
        textValues.includes(banned),
        false,
        `${banned} is fill-only and must never be a text role`,
      );
    }
  });

  it('orange is genuinely unusable as light-surface text, justifying accentText', () => {
    // Documents *why* brand.accentText exists rather than trusting a comment.
    assert.ok(contrast(brand.accent, surface.default) < 3.0);
    assert.ok(contrast(brand.accentText, surface.canvas) >= AA_NORMAL);
  });

  /**
   * `a11y.pairs` proves `onInverseMuted` is legible. It cannot prove it is
   * *muted* — a role that drifted up to full strength would still pass. Both
   * halves matter: the four literals it replaced (partner #e7dbc7, dispatch
   * #d6dfeb and #f7ead8, customer rgba(255,255,255,0.86)) existed precisely
   * because a dimmer-than-onInverse tone was wanted and none was on offer —
   * and #f7ead8 had drifted back up to 15.44:1, muted in name only.
   */
  it('onInverseMuted is dimmer than onInverse but still clears AA', () => {
    for (const bg of [surface.inverse, surface.inverseBrand]) {
      const muted = contrast(text.onInverseMuted, bg);
      const full = contrast(text.onInverse, bg);

      assert.ok(
        muted < full,
        `onInverseMuted (${muted.toFixed(2)}:1) must read dimmer than onInverse (${full.toFixed(2)}:1) on ${bg}`,
      );
      assert.ok(muted >= AA_NORMAL, `onInverseMuted on ${bg} = ${muted.toFixed(2)}:1`);
    }
  });

  it('retired legacy values are absent from the palette', () => {
    const all = [
      ...Object.values(brand),
      ...Object.values(surface),
      ...Object.values(text),
      ...Object.values(status),
    ] as string[];

    // #6a7d76 was the old `textSoft` at 4.04:1 on canvas — failed AA.
    assert.equal(all.includes('#6a7d76'), false, 'legacy textSoft must stay retired');
    // #5b6978 passed on canvas but failed on the darker soft fills.
    assert.equal(all.includes('#5b6978'), false, 'superseded text.secondary must stay retired');
  });
});
