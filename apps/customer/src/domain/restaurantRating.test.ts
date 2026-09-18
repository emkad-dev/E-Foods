/**
 * Run with: node --test --experimental-strip-types apps/customer/src/domain/restaurantRating.test.ts
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  formatRatingAverage,
  formatRatingCount,
  getRestaurantRatingSummary,
  UNRATED_LABEL,
} from './restaurantRating.ts';

describe('formatRatingAverage', () => {
  it('rounds DOWN at the midpoint: 4.25 is 4.2, not 4.3', () => {
    assert.equal(formatRatingAverage(4.25), '4.2');
  });

  it('never lets a near-perfect score claim a perfect one', () => {
    // The defect this rule exists for: toFixed(1) prints "5.0" here, and a
    // restaurant that has never earned a perfect average advertises one.
    assert.equal(formatRatingAverage(4.96), '4.9');
    assert.equal(formatRatingAverage(4.999), '4.9');
  });

  it('still prints a genuine 5 as 5.0', () => {
    assert.equal(formatRatingAverage(5), '5.0');
  });

  it('keeps a value that is exactly a tenth, despite IEEE-754', () => {
    // 3.3 * 10 is 32.99999999999999 and 4.2 * 10 is 42.000000000000006. A bare
    // Math.floor marks the first down a tenth for a representation artefact.
    assert.equal(formatRatingAverage(3.3), '3.3');
    assert.equal(formatRatingAverage(4.2), '4.2');
    assert.equal(formatRatingAverage(4.7), '4.7');
  });

  it('truncates a repeating server average rather than rounding it up', () => {
    // 11/3 — the shape the incremental server-side average actually produces.
    assert.equal(formatRatingAverage(3.6666666666666665), '3.6');
  });

  it('always carries one decimal, including on a whole number', () => {
    assert.equal(formatRatingAverage(4), '4.0');
    assert.equal(formatRatingAverage(1), '1.0');
  });

  it('clamps corrupt out-of-range data into the 0..5 scale', () => {
    assert.equal(formatRatingAverage(5.4), '5.0');
    assert.equal(formatRatingAverage(-1), '0.0');
  });
});

describe('formatRatingCount', () => {
  it('is singular at exactly one', () => {
    assert.equal(formatRatingCount(1), '1 rating');
  });

  it('is plural at two and above', () => {
    assert.equal(formatRatingCount(2), '2 ratings');
    assert.equal(formatRatingCount(207), '207 ratings');
  });
});

describe('getRestaurantRatingSummary — the unrated case', () => {
  it('a restaurant nobody has rated is "New", not a zero', () => {
    const summary = getRestaurantRatingSummary({ ratingAverage: null, ratingCount: 0 });

    if (summary.kind !== 'unrated') {
      assert.fail('a restaurant with no ratings must not be rated');
      return;
    }

    assert.equal(summary.label, UNRATED_LABEL);
    // The whole point: no "0.0" anywhere in what gets rendered or announced.
    assert.equal(summary.label.includes('0'), false);
    assert.equal(summary.accessibilityLabel.includes('0'), false);
  });

  it('treats a payload cached before the rating columns existed as unrated', () => {
    assert.equal(getRestaurantRatingSummary({}).kind, 'unrated');
    assert.equal(
      getRestaurantRatingSummary({ ratingAverage: undefined, ratingCount: undefined }).kind,
      'unrated'
    );
  });

  it('refuses to invent an average when the count is positive but the average is missing', () => {
    // Corrupt, not meaningful. Quoting a number for it is the claim this
    // module exists to prevent.
    assert.equal(getRestaurantRatingSummary({ ratingAverage: null, ratingCount: 9 }).kind, 'unrated');
    assert.equal(getRestaurantRatingSummary({ ratingAverage: NaN, ratingCount: 9 }).kind, 'unrated');
  });

  it('does not make an unrated restaurant look worse than a badly-rated one', () => {
    const unrated = getRestaurantRatingSummary({ ratingAverage: null, ratingCount: 0 });
    const badlyRated = getRestaurantRatingSummary({ ratingAverage: 1.2, ratingCount: 30 });

    assert.equal(unrated.kind, 'unrated');
    assert.equal(badlyRated.kind, 'rated');
    // Different KINDS, so the surfaces cannot render them on the same scale —
    // there is no star count and no number for the unrated one to lose at.
    assert.notEqual(unrated.kind, badlyRated.kind);
  });
});

describe('getRestaurantRatingSummary — the rated case', () => {
  it('carries the count alongside the average, always', () => {
    const summary = getRestaurantRatingSummary({ ratingAverage: 4.6, ratingCount: 207 });

    assert.equal(summary.kind, 'rated');
    if (summary.kind !== 'rated') return;
    assert.equal(summary.average, '4.6');
    assert.equal(summary.count, 207);
    assert.equal(summary.countShort, '(207)');
    assert.equal(summary.countLabel, '207 ratings');
  });

  it('distinguishes a perfect score from one order from a strong score from many', () => {
    const one = getRestaurantRatingSummary({ ratingAverage: 5, ratingCount: 1 });
    const many = getRestaurantRatingSummary({ ratingAverage: 4.6, ratingCount: 207 });

    if (one.kind !== 'rated' || many.kind !== 'rated') {
      assert.fail('both should be rated');
      return;
    }

    // The denominator is the whole reason 5.0 and 4.6 can sit in one feed
    // without the reader drawing the wrong conclusion.
    assert.equal(one.countShort, '(1)');
    assert.equal(one.countLabel, '1 rating');
    assert.equal(many.countShort, '(207)');
  });

  it('shows the average from the very first rating rather than hiding it', () => {
    // There is no "too few to say" threshold: suppressing the number for
    // counts 1-4 also suppressed the COUNT, which is the context that makes a
    // small sample readable in the first place.
    const summary = getRestaurantRatingSummary({ ratingAverage: 3, ratingCount: 1 });

    assert.equal(summary.kind, 'rated');
    if (summary.kind !== 'rated') return;
    assert.equal(summary.average, '3.0');
  });

  it('speaks the average with its scale and its sample', () => {
    const summary = getRestaurantRatingSummary({ ratingAverage: 4.25, ratingCount: 1 });

    if (summary.kind !== 'rated') {
      assert.fail('should be rated');
      return;
    }

    assert.equal(summary.accessibilityLabel, 'Rated 4.2 out of 5 from 1 rating');
  });
});
