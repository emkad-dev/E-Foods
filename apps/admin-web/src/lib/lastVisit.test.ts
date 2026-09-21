/**
 * Run with: node --test --experimental-strip-types apps/admin-web/src/lib/lastVisit.test.ts
 *
 * The marker is a claim -- "this row was not here last time you looked" -- and
 * every case below is a way that claim can be made falsely. They are all
 * failure-direction tests: the safe answer is always "not new", because a
 * marker that fires when it should not is worse than no marker at all. An
 * operator who sees the marker light up on rows they have already actioned
 * stops reading it, and after that it cannot be repaired by fixing the bug.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  countNewSince,
  isNewSince,
  lastVisitKey,
  parseRowTimestamp,
  readLastVisit,
  writeLastVisit,
  type LastVisitStorage,
} from './lastVisit.ts';

/** A working `localStorage`, reduced to the two methods this module uses. */
const fakeStorage = (seed: Record<string, string> = {}): LastVisitStorage & { entries: Map<string, string> } => {
  const entries = new Map(Object.entries(seed));

  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
  };
};

/** Private window / site data blocked: the methods themselves throw. */
const throwingStorage = (): LastVisitStorage => ({
  getItem: () => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  },
  setItem: () => {
    throw new DOMException('QuotaExceededError', 'QuotaExceededError');
  },
});

const APPROVALS_KEY = lastVisitKey('approvals');

// --- the first visit ------------------------------------------------------

test('the first visit marks nothing at all', () => {
  // No baseline exists, so there is no honest way to say a row is new. The
  // tempting alternative -- treat "never visited" as "everything is new" --
  // lights up the entire queue on the very first load, which is the one
  // impression that decides whether the marker gets read again.
  const now = Date.now();

  assert.equal(isNewSince(null, new Date(now).toISOString()), false);
  assert.equal(isNewSince(null, now + 60_000), false);
  assert.equal(countNewSince(null, [now, now + 1, now + 2]), 0);
});

test('the first visit leaves a baseline behind for the second', () => {
  // The write is what makes the first visit worth anything: read nothing,
  // mark nothing, but record the instant so the NEXT visit has something to
  // compare against.
  const storage = fakeStorage();

  assert.equal(readLastVisit('approvals', storage), null);

  writeLastVisit('approvals', 1_700_000_000_000, storage);

  assert.equal(readLastVisit('approvals', storage), 1_700_000_000_000);
  assert.equal(storage.entries.get(APPROVALS_KEY), '1700000000000');
});

test('read before write, or the comparison is always empty', () => {
  // Pins the ordering the hook depends on. If a page records the visit on
  // arrival instead of on departure, the baseline becomes "now" and nothing
  // can ever be newer than it -- the feature still "works", silently, and
  // never marks a single row again.
  const storage = fakeStorage({ [APPROVALS_KEY]: '1000' });

  const baselineReadFirst = readLastVisit('approvals', storage);
  writeLastVisit('approvals', 5000, storage);

  assert.equal(baselineReadFirst, 1000);
  assert.equal(isNewSince(baselineReadFirst, 3000), true);

  // What the wrong order would have produced from the same sequence of events.
  assert.equal(isNewSince(readLastVisit('approvals', storage), 3000), false);
});

// --- storage that is not there -------------------------------------------

test('storage that throws reads as a first visit, not as an error', () => {
  const storage = throwingStorage();

  assert.equal(readLastVisit('approvals', storage), null);
  // And the write must not escape either: a full quota is not a page failure.
  assert.doesNotThrow(() => writeLastVisit('approvals', Date.now(), storage));
});

test('storage that is absent entirely reads as a first visit', () => {
  // `null` is what the module resolves `window.localStorage` to when the
  // getter itself throws, and what a non-browser render would produce.
  assert.equal(readLastVisit('approvals', null), null);
  assert.doesNotThrow(() => writeLastVisit('approvals', Date.now(), null));
});

// --- corrupt stored values ------------------------------------------------

test('a corrupt stored value is no baseline, never a baseline of zero', () => {
  // The dangerous reading is `Number('garbage') || 0`. A baseline of 0 is the
  // epoch, and every row in the database is newer than the epoch -- so the
  // one case where storage is damaged is also the case that marks the entire
  // queue as new.
  for (const corrupt of ['', '   ', 'garbage', 'NaN', '{"at":123}', 'null', 'undefined', '0', '-1', 'Infinity']) {
    const storage = fakeStorage({ [APPROVALS_KEY]: corrupt });

    assert.equal(readLastVisit('approvals', storage), null, `"${corrupt}" must not yield a baseline`);
    assert.equal(
      countNewSince(readLastVisit('approvals', storage), [Date.now(), Date.now() - 86_400_000]),
      0,
      `"${corrupt}" must not mark rows as new`
    );
  }
});

test('an ISO string in storage is rejected rather than half-parsed', () => {
  // parseInt('2026-09-21T10:00:00Z') is 2026 -- a baseline two millennia
  // before the epoch, which marks everything. A plausible future version of
  // this code writes ISO; it must fail closed until the reader is updated too.
  const storage = fakeStorage({ [APPROVALS_KEY]: '2026-09-21T10:00:00.000Z' });

  assert.equal(readLastVisit('approvals', storage), null);
});

test('each page keeps its own key', () => {
  const storage = fakeStorage();

  writeLastVisit('approvals', 1000, storage);
  writeLastVisit('inbox', 2000, storage);

  assert.equal(readLastVisit('approvals', storage), 1000);
  assert.equal(readLastVisit('inbox', storage), 2000);
  assert.match(APPROVALS_KEY, /^feasty\.admin\.lastVisit\./);
});

// --- row timestamps that cannot be read -----------------------------------

test('a missing or unparseable row timestamp is NOT new', () => {
  // Failing toward "new" here marks every row on any data glitch: one null
  // column, one schema rename, one date the server formats differently.
  const baseline = 1_700_000_000_000;

  for (const broken of [
    undefined,
    null,
    '',
    '   ',
    'not a date',
    '2026-13-45T99:99:99Z',
    Number.NaN,
    Number.POSITIVE_INFINITY,
    0,
    -1,
    {},
    [],
    true,
    new Date('nonsense'),
  ]) {
    assert.equal(isNewSince(baseline, broken), false, `${String(broken)} must not read as new`);
    assert.equal(parseRowTimestamp(broken), null, `${String(broken)} must not parse`);
  }

  assert.equal(countNewSince(baseline, [null, undefined, 'not a date', {}]), 0);
});

// --- the rule itself ------------------------------------------------------

test('a row newer than the previous visit is new, and the boundary is exclusive', () => {
  const baseline = 1_700_000_000_000;

  assert.equal(isNewSince(baseline, baseline + 1), true);
  assert.equal(isNewSince(baseline, baseline - 1), false);
  // A row stamped at exactly the moment of leaving was on screen when the
  // operator left, so it is not new. Exclusive, not inclusive.
  assert.equal(isNewSince(baseline, baseline), false);
});

test('the rule reads the timestamp formats the queues actually carry', () => {
  // `submittedAt` on both application queues and `lastMessageAt` on the inbox
  // are ISO strings from Postgres; epoch millis and Date objects are accepted
  // so a caller is never tempted to pre-convert and get it wrong.
  const baseline = Date.parse('2026-09-20T12:00:00.000Z');

  assert.equal(isNewSince(baseline, '2026-09-20T12:00:01.000Z'), true);
  assert.equal(isNewSince(baseline, '2026-09-20T11:59:59.000Z'), false);
  assert.equal(isNewSince(baseline, new Date('2026-09-21T00:00:00.000Z')), true);
  assert.equal(isNewSince(baseline, Date.parse('2026-09-21T00:00:00.000Z')), true);
});

test('counting agrees with the per-row rule, on a mixed queue', () => {
  const baseline = Date.parse('2026-09-20T12:00:00.000Z');
  const rows = [
    '2026-09-20T12:00:01.000Z', // new
    '2026-09-21T09:30:00.000Z', // new
    '2026-09-20T12:00:00.000Z', // exactly the boundary: not new
    '2026-09-19T08:00:00.000Z', // old
    null, // unreadable: not new
  ];

  assert.equal(countNewSince(baseline, rows), 2);
  assert.equal(rows.filter((row) => isNewSince(baseline, row)).length, 2);
});
