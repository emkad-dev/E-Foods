/**
 * Run with: node --test --experimental-strip-types apps/admin-web/src/lib/navCounts.test.ts
 *
 * The badge's whole value is that its absence means something. These tests
 * pin the boundaries where that breaks -- zero, unknown, and the cap -- and
 * not the middle, where `3` rendering as "3" is not in doubt.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  NAV_COUNT_CAP,
  countOpenConversations,
  countPendingApplications,
  describeNavCount,
  formatNavCount,
} from './navCounts.ts';

test('an empty queue renders no badge, and an unknown one renders no badge either', () => {
  // Both are "nothing on the link", and that is the point: the alternative
  // for the unknown case is a `0`, which asserts the queue is clear on the
  // strength of a read that never answered.
  assert.equal(formatNavCount(0), null);
  assert.equal(formatNavCount(null), null);
  assert.equal(formatNavCount(undefined), null);

  // ...and neither may put a count into the link's accessible name, or the
  // screen reader hears "Approvals, 0 waiting" from a failed fetch.
  assert.equal(describeNavCount('Approvals', 0), undefined);
  assert.equal(describeNavCount('Approvals', null), undefined);
  assert.equal(describeNavCount('Inbox', undefined), undefined);
});

test('one waiting item is the first thing that shows', () => {
  assert.equal(formatNavCount(1), '1');
  assert.equal(describeNavCount('Approvals', 1), 'Approvals, 1 waiting');
});

test('the cap holds the sidebar to a fixed width', () => {
  assert.equal(formatNavCount(NAV_COUNT_CAP), String(NAV_COUNT_CAP));
  assert.equal(formatNavCount(NAV_COUNT_CAP + 1), `${NAV_COUNT_CAP}+`);
  assert.equal(formatNavCount(41302), `${NAV_COUNT_CAP}+`);

  // Longest string the badge can ever be asked to hold.
  assert.equal(formatNavCount(Number.MAX_SAFE_INTEGER)!.length, String(NAV_COUNT_CAP).length + 1);

  // "99+ waiting" is a glyph read aloud; the name says the comparison.
  assert.equal(describeNavCount('Inbox', NAV_COUNT_CAP), 'Inbox, 99 waiting');
  assert.equal(describeNavCount('Inbox', NAV_COUNT_CAP + 1), 'Inbox, more than 99 waiting');
});

test('a malformed count degrades to no badge rather than to nonsense', () => {
  // Arithmetic over a server payload can produce these; a badge reading
  // "NaN" or "-1 waiting" is worse than no badge at all.
  assert.equal(formatNavCount(Number.NaN), null);
  assert.equal(formatNavCount(Number.POSITIVE_INFINITY), null);
  assert.equal(formatNavCount(-3), null);
  assert.equal(describeNavCount('Approvals', Number.NaN), undefined);
  assert.equal(describeNavCount('Approvals', -3), undefined);

  // A fractional count never truncates UP into a badge that claims work.
  assert.equal(formatNavCount(0.9), null);
});

test('approvals counts only the applications still awaiting a decision', () => {
  const queue = {
    partnerApplications: [{ status: 'pending' }, { status: 'approved' }, { status: 'rejected' }],
    dispatchApplications: [{ status: 'pending' }, { status: 'pending' }],
  };

  // Not 5: a decided application is not work waiting on anyone. Counting
  // rows would badge Approvals permanently, since decided rows never leave.
  assert.equal(countPendingApplications(queue), 3);

  // A queue that arrived and is genuinely clear is 0, NOT null -- 0 is a
  // truthful claim once the read succeeded, and it is what suppresses the
  // badge one layer up.
  assert.equal(countPendingApplications({ partnerApplications: [], dispatchApplications: [] }), 0);
  assert.equal(countPendingApplications({}), 0);
});

test('a queue that never arrived is null, not zero', () => {
  assert.equal(countPendingApplications(null), null);
  assert.equal(countPendingApplications(undefined), null);
  assert.equal(countOpenConversations(null), null);
  assert.equal(countOpenConversations(undefined), null);

  // The distinction survives the trip to the badge: no badge either way, but
  // nothing anywhere ever states "0 waiting" on a read that failed.
  assert.equal(formatNavCount(countPendingApplications(null)), null);
  assert.equal(formatNavCount(countPendingApplications({})), null);
});

test('inbox counts open threads only, whatever the server sends back', () => {
  // The provider asks for status 'open', so this is normally a length. It is
  // re-checked so that widening that request can never turn closed threads
  // into a badge that says someone is waiting for a reply.
  assert.equal(
    countOpenConversations([{ status: 'open' }, { status: 'closed' }, { status: 'pending' }, { status: 'open' }]),
    2
  );
  assert.equal(countOpenConversations([]), 0);
});
