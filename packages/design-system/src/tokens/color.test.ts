import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { BADGE_TONE_PAIRS, BADGE_TONES } from '../primitives/badgeTones.ts';
import { a11y, brand, status, surface, text } from './color.ts';
import { AA_NORMAL, contrastRatio as contrast } from './contrast.ts';

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

  /**
   * `Badge` is the primitive that encodes the whole rule — the fill carries the
   * status hue, the label is a plain legible foreground — and every later fix
   * (`getKitchenSignalColors`, the partner and dispatch status pills) cites it
   * as the pattern being copied. It had no test: `BADGE_TONE_PAIRS` was written
   * "for the a11y test" and nothing imported it, so the reference implementation
   * of the rule was the one pairing in this package that could regress in
   * silence.
   */
  it('every badge tone is a legible fill/ink pairing', () => {
    const failures: string[] = [];

    for (const pair of BADGE_TONE_PAIRS) {
      const ratio = contrast(pair.fg, pair.bg);
      if (ratio < AA_NORMAL) {
        failures.push(`${pair.name}: ink ${pair.fg} on fill ${pair.bg} = ${ratio.toFixed(2)}:1`);
      }
    }

    assert.deepEqual(
      failures,
      [],
      `A Badge tone renders its label below 4.5:1. The fill must carry the hue and ` +
        `the label must stay a plain legible foreground — pointing the ink back at a ` +
        `saturated tone colour is the defect this table exists to prevent:\n${failures.join('\n')}`,
    );
  });

  /**
   * Without this, deleting a tone from the table — or the table collapsing to
   * `{}` through a bad refactor — would leave the sweep above iterating nothing
   * and reporting a pass.
   */
  it('the badge tone table still covers every tone Badge offers', () => {
    assert.deepEqual(
      Object.keys(BADGE_TONES).sort(),
      ['accent', 'danger', 'neutral', 'success', 'warning'],
      'Badge tones changed. Every tone must appear in BADGE_TONES so the contrast ' +
        'sweep above actually measures it; an unlisted tone is an unguarded pairing.',
    );
    assert.equal(
      BADGE_TONE_PAIRS.length,
      Object.keys(BADGE_TONES).length,
      'BADGE_TONE_PAIRS no longer derives from BADGE_TONES, so the guard and the ' +
        'rendered table can now disagree.',
    );
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
