import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  RANGE_OPTIONS,
  bucketKey,
  buildBuckets,
  rangePhrase,
  rangeShortLabel,
  resolveRangeDays,
  seriesBucket,
} from './ranges.ts';

const NOW = new Date(2026, 10, 20, 15, 0, 0); // Fri 20 Nov 2026, local time

test('the picker offers the three new ranges after the original three', () => {
  assert.deepEqual(
    RANGE_OPTIONS.map((option) => option.value),
    [7, 30, 90, 182, 365, 'all']
  );
});

test('fixed ranges resolve to themselves; all time reaches the first record', () => {
  assert.equal(resolveRangeDays(30, null, NOW), 30);
  assert.equal(resolveRangeDays(365, new Date(2020, 0, 1), NOW), 365);
  // First record 10 days ago: the window must include that day.
  assert.equal(resolveRangeDays('all', new Date(2026, 10, 10, 9, 0, 0), NOW), 12);
  // No records at all: a one-day window, never zero or negative.
  assert.equal(resolveRangeDays('all', null, NOW), 1);
});

test('labels keep the old wording for the old ranges', () => {
  assert.equal(rangeShortLabel(7), '7d');
  assert.equal(rangeShortLabel(30), '30d');
  assert.equal(rangeShortLabel(182), '6mo');
  assert.equal(rangeShortLabel(365), '1y');
  assert.equal(rangeShortLabel('all'), 'all time');
  assert.equal(rangePhrase(30), 'the last 30 days');
  assert.equal(rangePhrase(182), 'the last 6 months');
  assert.equal(rangePhrase('all'), 'all recorded history');
});

test('charts go weekly only above four months', () => {
  assert.equal(seriesBucket(90), 'day');
  assert.equal(seriesBucket(120), 'day');
  assert.equal(seriesBucket(182), 'week');
  assert.equal(seriesBucket(365), 'week');
});

test('daily buckets are one per day, ending today, as before', () => {
  const buckets = buildBuckets(7, NOW);
  assert.equal(buckets.length, 7);
  assert.equal(buckets[6].key, bucketKey(NOW, 'day'));
});

test('weekly buckets start on Mondays, seven days apart, ending this week', () => {
  const buckets = buildBuckets(182, NOW);
  assert.ok(buckets.length >= 26 && buckets.length <= 27, `got ${buckets.length} weeks`);
  for (const bucket of buckets) {
    assert.equal(bucket.start.getDay(), 1, `${bucket.key} is not a Monday`);
  }
  for (let i = 1; i < buckets.length; i += 1) {
    const gapDays = Math.round((buckets[i].start.getTime() - buckets[i - 1].start.getTime()) / 86400000);
    assert.ok(gapDays === 7, `gap ${gapDays}`); // DST-safe: local-midnight dates
  }
  assert.equal(buckets[buckets.length - 1].key, bucketKey(NOW, 'week'));
});

test('an order lands in the bucket that the series created for its week', () => {
  const keys = new Set(buildBuckets(365, NOW).map((bucket) => bucket.key));
  assert.ok(keys.has(bucketKey(new Date(2026, 5, 10, 18, 30), 'week')));
  assert.ok(keys.has(bucketKey(NOW, 'week')));
});
