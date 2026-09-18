/**
 * Run with: node --test --experimental-strip-types apps/partner/src/domain/restaurantRatings.test.ts
 *
 * Three claims are pinned here, and each one is a way this screen could lie to
 * a restaurant about its own reputation.
 *
 * FIRST, that an unrated restaurant is never given a score. "0.0" and an empty
 * star row both read as one star short of a complaint; the only honest output
 * for a restaurant nobody has rated is words.
 *
 * SECOND, that the average is never rounded UP. Truncation is the whole point
 * of formatRatingAverage: half-up would print "5.0" for a 4.96, i.e. a perfect
 * score the restaurant does not have.
 *
 * THIRD, that the denominator survives. One rating and two hundred ratings
 * must not produce the same sentence.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  NO_RATINGS_DETAIL,
  NO_RATINGS_HEADLINE,
  NO_RATINGS_VALUE,
  UNKNOWN_DATE_LABEL,
  appendRatingsPage,
  describeRatingSummary,
  filledStarCount,
  formatRatingAverage,
  formatRatingCount,
  formatRatingDate,
  formatRatingScore,
  toRatingSummary,
  type RestaurantRating,
} from './restaurantRatings.ts';

const rating = (id: string, overrides: Partial<RestaurantRating> = {}): RestaurantRating => ({
  id,
  restaurantScore: 5,
  comment: null,
  createdAt: '2026-09-18T10:00:00.000Z',
  ...overrides,
});

test('a restaurant with no ratings gets words, never a zero and never stars', () => {
  const copy = describeRatingSummary({ ratingAverage: null, ratingCount: 0 });

  assert.equal(copy.state, 'unrated');
  assert.equal(copy.value, NO_RATINGS_VALUE);
  assert.equal(copy.headline, NO_RATINGS_HEADLINE);
  assert.equal(copy.detail, NO_RATINGS_DETAIL);
  // Null, not 0: nothing for a star row to draw, rather than five empty stars.
  assert.equal(copy.average, null);
  assert.equal(filledStarCount(copy.average), 0);
  // The whole point. No branch of the zero case may contain a score-shaped
  // string.
  assert.ok(!/\d\.\d/.test(copy.value + copy.headline + copy.detail));
});

test('a stored average with a zero count is dropped, not shown', () => {
  // The count is the fact; an average over nothing is an artefact.
  assert.deepEqual(toRatingSummary({ ratingAverage: 4.5, ratingCount: 0 }), {
    ratingAverage: null,
    ratingCount: 0,
  });
  assert.equal(describeRatingSummary({ ratingAverage: 4.5, ratingCount: 0 }).state, 'unrated');
});

test('a count with no usable average still refuses to invent a score', () => {
  assert.equal(describeRatingSummary({ ratingAverage: null, ratingCount: 7 }).state, 'unrated');
  assert.equal(
    describeRatingSummary({ ratingAverage: Number.NaN, ratingCount: 7 } as never).state,
    'unrated'
  );
});

test('toRatingSummary narrows junk off the wire', () => {
  assert.deepEqual(toRatingSummary(null), { ratingAverage: null, ratingCount: 0 });
  assert.deepEqual(toRatingSummary(undefined), { ratingAverage: null, ratingCount: 0 });
  // A numeric column can arrive as a string over JSON.
  assert.deepEqual(toRatingSummary({ ratingAverage: '4.5', ratingCount: '12' }), {
    ratingAverage: 4.5,
    ratingCount: 12,
  });
  // Negative counts are not a state; fractional ones are not a count.
  assert.deepEqual(toRatingSummary({ ratingAverage: 4, ratingCount: -3 }), {
    ratingAverage: null,
    ratingCount: 0,
  });
  assert.equal(toRatingSummary({ ratingAverage: 4, ratingCount: 12.7 }).ratingCount, 12);
  // Above the scale is a data error, not a 7-star restaurant.
  assert.equal(toRatingSummary({ ratingAverage: 7.4, ratingCount: 2 }).ratingAverage, 5);
});

test('the average is truncated to one decimal, never rounded up', () => {
  // The documented tie: 4.25 shows as 4.2, NOT 4.3.
  assert.equal(formatRatingAverage(4.25), '4.2');
  assert.equal(formatRatingAverage(4.249), '4.2');
  // The case that matters most: a 4.96 must not be promoted to a clean 5.0.
  assert.equal(formatRatingAverage(4.96), '4.9');
  assert.equal(formatRatingAverage(4.999), '4.9');
  // Only a genuine five prints five.
  assert.equal(formatRatingAverage(5), '5.0');
  // Binary floating point: 4.7 * 10 is 46.99999999999999, so a naive floor
  // would understate this one as 4.6.
  assert.equal(formatRatingAverage(4.7), '4.7');
  assert.equal(formatRatingAverage(2.8), '2.8');
  assert.equal(formatRatingAverage(1), '1.0');
});

test('the denominator is always carried, and singular is singular', () => {
  assert.equal(formatRatingCount(1), '1 rating');
  assert.equal(formatRatingCount(2), '2 ratings');
  assert.equal(formatRatingCount(200), '200 ratings');

  const one = describeRatingSummary({ ratingAverage: 5, ratingCount: 1 });
  const many = describeRatingSummary({ ratingAverage: 4.63, ratingCount: 200 });

  assert.equal(one.value, '5.0');
  assert.equal(one.detail, 'From 1 rating');
  assert.equal(one.headline, '5.0 out of 5');

  assert.equal(many.value, '4.6');
  assert.equal(many.detail, 'From 200 ratings');
  // The two claims must not read the same.
  assert.notEqual(one.detail, many.detail);
});

test('filled stars floor the average, so 4.9 is four stars and not five', () => {
  assert.equal(filledStarCount(4.9), 4);
  assert.equal(filledStarCount(4), 4);
  assert.equal(filledStarCount(5), 5);
  assert.equal(filledStarCount(0.4), 0);
  assert.equal(filledStarCount(null), 0);
  assert.equal(filledStarCount(Number.NaN), 0);
  // Above the scale cannot draw a sixth star.
  assert.equal(filledStarCount(9), 5);
});

test('a single score is clamped to the scale and spoken in full', () => {
  assert.equal(formatRatingScore(4), '4 out of 5');
  assert.equal(formatRatingScore(1), '1 out of 5');
  assert.equal(formatRatingScore(9), '5 out of 5');
  assert.equal(formatRatingScore(Number.NaN), '0 out of 5');
});

test('dates read as Today / Yesterday / an absolute date, and bad input is said plainly', () => {
  // Midday base on both sides so the local-midnight reduction lands the same
  // way at every plausible device offset.
  const now = Date.parse('2026-09-18T12:00:00.000Z');

  assert.equal(formatRatingDate('2026-09-18T12:00:00.000Z', now), 'Today');
  assert.equal(formatRatingDate('2026-09-17T12:00:00.000Z', now), 'Yesterday');

  const older = formatRatingDate('2026-08-02T12:00:00.000Z', now);
  assert.ok(older.includes('2026'));
  assert.notEqual(older, 'Today');
  assert.notEqual(older, 'Yesterday');

  // Clock skew must not produce "-1 days ago" wording.
  assert.equal(formatRatingDate('2026-09-18T23:59:00.000Z', Date.parse('2026-09-18T12:00:00.000Z')), 'Today');

  assert.equal(formatRatingDate('not-a-date', now), UNKNOWN_DATE_LABEL);
  assert.equal(formatRatingDate('', now), UNKNOWN_DATE_LABEL);
});

test('paging merges by id, so a row that shifts between pages is not shown twice', () => {
  const pageOne = [rating('a'), rating('b'), rating('c')];
  // A new rating arrived between the two fetches, so offset 3 hands back 'c'
  // again.
  const pageTwo = [rating('c'), rating('d')];

  const merged = appendRatingsPage(pageOne, pageTwo);

  assert.deepEqual(
    merged.map((entry) => entry.id),
    ['a', 'b', 'c', 'd']
  );
});

test('paging keeps the existing rows and the new page in order', () => {
  assert.deepEqual(appendRatingsPage([], [rating('a'), rating('b')]).map((entry) => entry.id), ['a', 'b']);
  assert.deepEqual(appendRatingsPage([rating('a')], []).map((entry) => entry.id), ['a']);
  // An entirely duplicate page adds nothing rather than doubling the list.
  assert.deepEqual(appendRatingsPage([rating('a')], [rating('a')]).map((entry) => entry.id), ['a']);
});
