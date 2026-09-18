/**
 * Run with: node --test --experimental-strip-types apps/customer/src/domain/ratingPromptDismissals.test.ts
 *
 * The rating prompt is a full-screen backdrop over the whole customer app, and
 * this list is what decides whether it appears. Two properties matter more than
 * the rest, and both are asserted below:
 *
 *   1. Corrupt storage must degrade to "show the prompt", never to a throw.
 *      This value is read during the first render after sign-in; a parse error
 *      here is a crash on launch.
 *   2. The list must not grow without bound, because nothing ever clears it.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MAX_REMEMBERED_DISMISSALS,
  mergeDismissedOrderIds,
  parseDismissedOrderIds,
  serializeDismissedOrderIds,
} from './ratingPromptDismissals.ts';

test('a round trip preserves the ids', () => {
  const ids = ['order-1', 'order-2'];
  assert.deepEqual(parseDismissedOrderIds(serializeDismissedOrderIds(ids)), ids);
});

test('nothing stored yet reads as nothing dismissed', () => {
  for (const empty of [null, undefined, '']) {
    assert.deepEqual(parseDismissedOrderIds(empty), []);
  }
});

test('corrupt storage degrades to an empty list rather than throwing', () => {
  // Each of these is a real shape storage can hand back: truncated writes,
  // a value written by an older build, or something hand-edited.
  for (const corrupt of ['{', 'null', '"order-1"', '42', '{"a":1}', '[]']) {
    assert.doesNotThrow(() => parseDismissedOrderIds(corrupt), `threw on ${corrupt}`);
    assert.deepEqual(parseDismissedOrderIds(corrupt), [], `wrong result for ${corrupt}`);
  }
});

test('non-string and blank entries are dropped, not kept as holes', () => {
  assert.deepEqual(
    parseDismissedOrderIds(JSON.stringify(['order-1', 42, null, '   ', { id: 'x' }, 'order-2'])),
    ['order-1', 'order-2']
  );
});

test('ids are trimmed and de-duplicated on read', () => {
  assert.deepEqual(
    parseDismissedOrderIds(JSON.stringify([' order-1 ', 'order-1', 'order-2'])),
    ['order-1', 'order-2']
  );
});

test('merging appends, newest last', () => {
  assert.deepEqual(mergeDismissedOrderIds(['a', 'b'], 'c'), ['a', 'b', 'c']);
});

test('re-dismissing an id moves it to the end instead of duplicating it', () => {
  // It was just acted on, so it is the least sensible entry to evict next.
  assert.deepEqual(mergeDismissedOrderIds(['a', 'b', 'c'], 'a'), ['b', 'c', 'a']);
});

test('a blank id is ignored rather than stored', () => {
  assert.deepEqual(mergeDismissedOrderIds(['a'], '   '), ['a']);
  assert.deepEqual(mergeDismissedOrderIds(['a'], ''), ['a']);
});

test('the list is capped, and the cap drops the OLDEST', () => {
  const full = Array.from({ length: MAX_REMEMBERED_DISMISSALS }, (_, i) => `order-${i}`);
  const next = mergeDismissedOrderIds(full, 'newest');

  assert.equal(next.length, MAX_REMEMBERED_DISMISSALS, 'the cap must hold');
  assert.equal(next.at(-1), 'newest', 'the newest dismissal must survive');
  assert.ok(!next.includes('order-0'), 'the oldest must be the one evicted');
});

test('an oversized stored list is capped on the way back in', () => {
  // A list written by a build with a larger cap must not come back oversized.
  const oversized = Array.from({ length: MAX_REMEMBERED_DISMISSALS + 20 }, (_, i) => `order-${i}`);

  assert.equal(
    parseDismissedOrderIds(JSON.stringify(oversized)).length,
    MAX_REMEMBERED_DISMISSALS
  );
  assert.equal(
    parseDismissedOrderIds(JSON.stringify(oversized)).at(-1),
    `order-${MAX_REMEMBERED_DISMISSALS + 19}`,
    'capping keeps the newest end'
  );
});

test('the regression: a dismissed order stays dismissed across a relaunch', () => {
  // What the customer does: taps "Not now" on an order that is delivered and
  // unrated. What used to happen: the set was session-only, so the next launch
  // fetched the same pending order and covered the screen again. Forever --
  // declining is not rating, so the order never leaves the pending list.
  const afterDismiss = mergeDismissedOrderIds([], 'a094aa47');
  const afterRelaunch = parseDismissedOrderIds(serializeDismissedOrderIds(afterDismiss));

  assert.ok(
    new Set(afterRelaunch).has('a094aa47'),
    'the dismissal must survive a serialize/parse cycle, or the prompt returns'
  );
});
