/**
 * Run with: node --test --experimental-strip-types apps/admin-web/src/lib/restaurantRating.test.ts
 *
 * The three states this has to keep apart are easy to collapse into two, and
 * collapsing them is how a rating display starts lying:
 *
 *   - rated        -> the average, always with its count
 *   - unrated      -> said in words, never 0.0 and never zero stars
 *   - not supplied -> the payload carried no rating fields at all, which a
 *                     stale deployed function still produces
 *
 * The third collapsing into the second is the expensive one: it reports a
 * restaurant with two hundred ratings as having none.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { summarizeRestaurantRating, type RestaurantRatingFields } from './restaurantRating.ts';

test('a rated restaurant shows the average and the count together', () => {
  const summary = summarizeRestaurantRating({ ratingAverage: 4.6, ratingCount: 212 });

  assert.equal(summary.label, '4.6 ★ from 212 ratings');
  assert.equal(summary.hasRatings, true);
  assert.equal(summary.unavailable, false);
});

test('the count is never dropped, because 5.0 from one is not 4.6 from two hundred', () => {
  const one = summarizeRestaurantRating({ ratingAverage: 5, ratingCount: 1 });
  const many = summarizeRestaurantRating({ ratingAverage: 4.6, ratingCount: 212 });

  assert.equal(one.label, '5.0 ★ from 1 rating', 'singular, and the count is present');
  assert.match(many.label, /212 ratings/);

  for (const summary of [one, many]) {
    assert.match(summary.label, /\d+ rating/, 'an average must never be shown on its own');
  }
});

test('no ratings is said in words, never as a zero', () => {
  const summary = summarizeRestaurantRating({ ratingAverage: null, ratingCount: 0 });

  assert.equal(summary.label, 'No ratings yet');
  assert.equal(summary.hasRatings, false);
  assert.equal(summary.unavailable, false);

  // The specific renderings the brief rules out. No ratings is not a bad
  // rating, and both of these read as one.
  assert.doesNotMatch(summary.label, /0\.0/);
  assert.doesNotMatch(summary.label, /★/);
});

test('an unrated restaurant stays unrated even if the average column is dirty', () => {
  // count is the authority on whether anything has been rated. A stray 0 in
  // the average column must not turn "no ratings" into "rated 0.0".
  assert.equal(summarizeRestaurantRating({ ratingAverage: 0, ratingCount: 0 }).label, 'No ratings yet');
  assert.equal(summarizeRestaurantRating({ ratingAverage: 4.9, ratingCount: 0 }).label, 'No ratings yet');
});

test('a payload with no rating fields is NOT reported as having no ratings', () => {
  // The admin payloads carry the fields now, so this branch should be rare --
  // but it is the one that lies loudest when it does fire, so it stays pinned.
  for (const candidate of [{}, undefined, null, { ratingAverage: 4.5 }]) {
    const summary = summarizeRestaurantRating(candidate);
    assert.equal(summary.unavailable, true, `${JSON.stringify(candidate)} should be unavailable, not unrated`);
    assert.equal(summary.label, 'Rating not available');
    assert.notEqual(summary.label, 'No ratings yet', 'absence of data is not a finding about the restaurant');
  }
});

test('a null count is unavailable, not zero', () => {
  // The column is `ratingCount integer` and the row type is `number | null`.
  // Coalescing null to 0 is the one-character version of the lie above.
  const summary = summarizeRestaurantRating({ ratingAverage: null, ratingCount: null });
  assert.equal(summary.unavailable, true);
});

test('a count with no average reports the half that exists', () => {
  const summary = summarizeRestaurantRating({ ratingAverage: null, ratingCount: 7 });

  assert.equal(summary.label, '7 ratings, average unavailable');
  assert.equal(summary.hasRatings, false);
  assert.doesNotMatch(summary.label, /0\.0/, 'a missing average must not be printed as zero');
});

test('the average always carries exactly one decimal place', () => {
  assert.match(summarizeRestaurantRating({ ratingAverage: 5, ratingCount: 3 }).label, /^5\.0 ★/);
  assert.match(summarizeRestaurantRating({ ratingAverage: 3.66667, ratingCount: 3 }).label, /^3\.7 ★/);
  assert.match(summarizeRestaurantRating({ ratingAverage: 4, ratingCount: 3 }).label, /^4\.0 ★/);
});

test('the label is never empty, for any input', () => {
  const inputs = [
    undefined,
    null,
    {},
    { ratingAverage: null, ratingCount: 0 },
    { ratingAverage: 4.2, ratingCount: 9 },
    { ratingAverage: Number.NaN, ratingCount: 9 },
    { ratingAverage: 4.2, ratingCount: Number.NaN },
    { ratingAverage: 4.2, ratingCount: -3 },
  ];

  for (const input of inputs) {
    const summary = summarizeRestaurantRating(input);
    assert.notEqual(summary.label.trim(), '', `empty label for ${JSON.stringify(input)}`);
  }

  // A negative or non-numeric count is nonsense, not a rating; it must not
  // produce a star line claiming a score.
  assert.equal(summarizeRestaurantRating({ ratingAverage: 4.2, ratingCount: -3 }).hasRatings, false);
  assert.equal(summarizeRestaurantRating({ ratingAverage: 4.2, ratingCount: Number.NaN }).hasRatings, false);
});

/* ------------------------------------------------- the real wire shape now */

/**
 * Fixtures shaped exactly as `buildRestaurantResponse`
 * (supabase/functions/_shared/restaurants.ts) now emits them, including its
 * `?? null` / `?? 0` coalescing. Only the fields this module reads are listed;
 * the point is the rating pair and its null-handling, not the whole document.
 */
const wireShape = (ratingAverage: number | null, ratingCount: number) => ({
  id: 'restaurant-1',
  name: 'Mama Put',
  isPublished: true,
  ratingAverage,
  ratingCount,
});

test('the shape the admin payloads now send renders a real figure, not "unavailable"', () => {
  // The regression this guards: the builder emitting the fields is what makes
  // the console able to show a rating at all. If that emit is ever reverted,
  // this keeps passing (the fixture is a literal) -- but it pins the CONTRACT
  // the component relies on, so a change to the coalescing below fails here.
  const rated = summarizeRestaurantRating(wireShape(4.6, 212));

  assert.equal(rated.unavailable, false);
  assert.equal(rated.hasRatings, true);
  assert.equal(rated.label, '4.6 ★ from 212 ratings');
});

test('the builder coalesces an unrated restaurant to count 0, which is "No ratings yet"', () => {
  // `ratingCount: restaurant.ratingCount ?? 0` means a never-rated restaurant
  // arrives as 0, NOT as null. So it lands in the unrated branch and says so
  // in words -- and a null/missing count is genuinely evidence of a broken
  // payload rather than of a new restaurant.
  const unrated = summarizeRestaurantRating(wireShape(null, 0));

  assert.equal(unrated.label, 'No ratings yet');
  assert.equal(unrated.unavailable, false, 'count 0 is a fact about the restaurant, not a gap in the payload');
});

test('a restaurant object with no rating keys is still caught as unavailable', () => {
  // What a stale deployed function returns: the pre-change wire shape, which
  // is a valid restaurant in every other respect.
  //
  // Parsed rather than written as a literal, because that is how it actually
  // reaches the console -- and because TypeScript REJECTS the literal form
  // ("no properties in common with RestaurantRatingFields"), which is a
  // useful reminder that the compiler cannot help here: the object that
  // arrives at runtime is a parsed response, and the type it is read through
  // is a claim about that response, not a check on it. Hence this branch.
  const stale = JSON.parse('{"id":"restaurant-1","name":"Mama Put","isPublished":true}') as RestaurantRatingFields;

  assert.equal(summarizeRestaurantRating(stale).unavailable, true);
});
