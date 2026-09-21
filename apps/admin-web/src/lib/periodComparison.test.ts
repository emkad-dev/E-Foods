/**
 * Run with: node --test --experimental-strip-types apps/admin-web/src/lib/periodComparison.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildPeriodWindows,
  comparisonText,
  coversPreviousWindow,
  earlierOf,
  earliestDateIn,
  filterWithin,
  isWithin,
  kpiComparison,
  noPriorWindowNote,
  windowTotalCaption,
} from './periodComparison.ts';

/** What an inline figure renders for a covered window: arrow plus label. */
const rendered = (current: number, previous: number) =>
  comparisonText({ current, previous, previousWindowCovered: true, fallback: 'unused' });

const DAY_MS = 24 * 60 * 60 * 1000;
const at = (iso: string) => new Date(iso);

test('the two windows are equal, contiguous and end at now', () => {
  const now = at('2026-09-21T14:37:12.345Z');
  const windows = buildPeriodWindows(30, now);

  assert.equal(windows.currentEnd.getTime(), now.getTime(), 'current window ends at now, not at a rounded hour');
  assert.equal(windows.currentEnd.getTime() - windows.currentStart.getTime(), 30 * DAY_MS, 'current span');
  assert.equal(windows.previousEnd.getTime() - windows.previousStart.getTime(), 30 * DAY_MS, 'previous span');
  // Contiguous: the previous window ends exactly where the current one starts,
  // so no order falls in both and none falls between them.
  assert.equal(windows.previousEnd.getTime(), windows.currentStart.getTime(), 'contiguity');
});

test('windows stay equal length across a DST transition', () => {
  // Anchored just after the European clock change. Snapping to local midnight
  // would make one window 23 or 25 hours longer than the other and the delta
  // would partly be measuring the clock; exact-millisecond spans cannot.
  const windows = buildPeriodWindows(7, at('2026-10-26T09:00:00.000Z'));
  const current = windows.currentEnd.getTime() - windows.currentStart.getTime();
  const previous = windows.previousEnd.getTime() - windows.previousStart.getTime();

  assert.equal(current, previous, 'the comparison is only honest if both windows are the same length');
  assert.equal(current, 7 * DAY_MS);
});

test('a nonsensical range still yields two measurable windows', () => {
  // RangeDays is a 7|30|90 union, so this only fires on a value from outside
  // it. Zero-length windows would make everything read "No change", which is a
  // false statement rather than a missing one.
  for (const bad of [0, -5, Number.NaN]) {
    const windows = buildPeriodWindows(bad, at('2026-09-21T00:00:00.000Z'));
    assert.equal(windows.currentEnd.getTime() - windows.currentStart.getTime(), DAY_MS, `range ${bad}`);
    assert.ok(windows.previousStart.getTime() < windows.currentStart.getTime(), `range ${bad} ordering`);
  }
});

test('window membership is half-open, so boundary rows are counted once', () => {
  const start = at('2026-09-01T00:00:00.000Z');
  const end = at('2026-09-08T00:00:00.000Z');

  assert.equal(isWithin(start, start, end), true, 'the instant at start is inside');
  assert.equal(isWithin(end, start, end), false, 'the instant at end belongs to the next window');
  assert.equal(isWithin(at('2026-09-04T12:00:00.000Z'), start, end), true);
  assert.equal(isWithin(at('2026-08-31T23:59:59.999Z'), start, end), false);
  assert.equal(isWithin(null, start, end), false, 'an unparseable timestamp is not a member of any window');
});

test('filterWithin drops undated and future-dated rows', () => {
  const rows = [
    { at: at('2026-09-02T00:00:00.000Z'), id: 'in' },
    { at: null, id: 'undated' },
    { at: at('2026-09-30T00:00:00.000Z'), id: 'after the window' },
    { at: at('2026-08-01T00:00:00.000Z'), id: 'before the window' },
  ];

  const kept = filterWithin(rows, (row) => row.at, at('2026-09-01T00:00:00.000Z'), at('2026-09-08T00:00:00.000Z'));

  assert.deepEqual(
    kept.map((row) => row.id),
    ['in']
  );
});

test('the data horizon is the oldest record across both collections', () => {
  const orders = [{ at: at('2026-06-01T00:00:00.000Z') }, { at: at('2026-07-01T00:00:00.000Z') }, { at: null }];
  const users = [{ at: at('2026-05-02T00:00:00.000Z') }];

  const horizon = earlierOf(
    earliestDateIn(orders, (row) => row.at),
    earliestDateIn(users, (row) => row.at)
  );

  assert.equal(horizon?.toISOString(), '2026-05-02T00:00:00.000Z', 'users predate orders on a real platform');
  assert.equal(earliestDateIn([], (row: { at: Date | null }) => row.at), null, 'no records, no horizon');
  assert.equal(earliestDateIn([{ at: null }], (row) => row.at), null, 'undated records give no horizon');
  assert.equal(earlierOf(null, null), null);
  assert.equal(earlierOf(null, at('2026-01-01T00:00:00.000Z'))?.getFullYear(), 2026);
});

test('a previous window that predates the data is not covered', () => {
  const windows = buildPeriodWindows(30, at('2026-09-21T00:00:00.000Z'));
  // currentStart 2026-08-22, previousStart 2026-07-23.

  assert.equal(coversPreviousWindow(at('2026-01-01T00:00:00.000Z'), windows), true, 'horizon well before it');
  assert.equal(coversPreviousWindow(windows.previousStart, windows), true, 'horizon exactly at previousStart');
  assert.equal(
    coversPreviousWindow(at('2026-08-01T00:00:00.000Z'), windows),
    false,
    'horizon inside the previous window: that window is only partly observed'
  );
  // The "current window shorter than the previous one" case: the platform is
  // younger than the range, so the current window is itself partial and the
  // previous one contains no data at all. "0 last period" there would be an
  // absence of measurement dressed up as a measurement of zero.
  assert.equal(
    coversPreviousWindow(at('2026-09-10T00:00:00.000Z'), windows),
    false,
    'horizon inside the current window'
  );
  assert.equal(coversPreviousWindow(null, windows), false, 'no records at all');
});

test('kpiComparison hands the card a delta only when the window is covered', () => {
  const covered = kpiComparison({
    current: 120,
    previous: 100,
    previousWindowCovered: true,
    fallbackCaption: windowTotalCaption(30),
  });

  assert.deepEqual(covered, { current: 120, previous: 100 });

  const uncovered = kpiComparison({
    current: 120,
    previous: 0,
    previousWindowCovered: false,
    fallbackCaption: windowTotalCaption(30),
  });

  // KpiCard renders a delta whenever BOTH numbers are present, so the absence
  // of `previous` here is the whole mechanism: a caption is the only thing the
  // card can fall back to.
  assert.equal('previous' in uncovered, false, 'no previous figure leaks through');
  assert.equal('current' in uncovered, false);
  assert.equal(uncovered.caption, 'Window total · no prior 30d');
});

test('the caption never calls a windowed total a live count', () => {
  for (const rangeDays of [7, 30, 90]) {
    const caption = windowTotalCaption(rangeDays);
    assert.match(caption, /^Window total/, `${rangeDays}d`);
    assert.match(caption, new RegExp(`no prior ${rangeDays}d`), `${rangeDays}d`);
    assert.doesNotMatch(caption, /live/i, 'the default KpiCard caption is the lie this replaces');
  }

  assert.equal(noPriorWindowNote(7), 'no prior 7d on record');
});

test('a rise from zero is reported as new activity, not as a percentage', () => {
  // There is no finite percentage change from zero. Rendering +100% (or ∞, or
  // a division by zero) would put a fabricated magnitude on the figure. Note
  // this is a genuine measured zero -- the previous window was observed and
  // held nothing. An UNOBSERVED previous window never reaches this point;
  // coversPreviousWindow stops it above.
  assert.equal(rendered(5, 0), '▲ New activity');
  assert.equal(rendered(0, 0), 'No change', 'zero to zero is flat, and carries no arrow');
});

test('equal values read as no change, and so does sub-half-percent noise', () => {
  assert.equal(rendered(840000, 840000), 'No change');
  // 0.2% -- real movement, but not movement an operator should act on.
  assert.equal(rendered(1002, 1000), 'No change');
  assert.equal(rendered(1010, 1000), '▲ +1% vs previous period');
});

test('a fall reads as a fall', () => {
  assert.equal(rendered(75, 100), '▼ -25% vs previous period');
});

test('inline figures get the same coverage gate as cards', () => {
  assert.equal(
    comparisonText({ current: 120, previous: 100, previousWindowCovered: true, fallback: noPriorWindowNote(30) }),
    '▲ +20% vs previous period'
  );
  assert.equal(
    comparisonText({ current: 120, previous: 100, previousWindowCovered: false, fallback: noPriorWindowNote(30) }),
    'no prior 30d on record',
    'the figure exists but the comparison does not'
  );
});
