/**
 * Run with: node --test --experimental-strip-types apps/customer/src/domain/latestChoice.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createLatestChoice } from './latestChoice.ts';

test('a GPS fix that started before a pick is dropped', () => {
  const choice = createLatestChoice();
  const gps = choice.next();
  choice.next(); // the customer picks a suggestion while the fix runs
  assert.equal(choice.isLatest(gps), false);
});

test('a GPS fix with no choice after it is applied', () => {
  const choice = createLatestChoice();
  choice.next(); // an earlier pick
  const gps = choice.next();
  assert.equal(choice.isLatest(gps), true);
});

test('a second GPS request supersedes the first', () => {
  const choice = createLatestChoice();
  const first = choice.next();
  const second = choice.next();
  assert.equal(choice.isLatest(first), false);
  assert.equal(choice.isLatest(second), true);
});

test('each screen gets its own counter', () => {
  const a = createLatestChoice();
  const b = createLatestChoice();
  const ticket = a.next();
  b.next();
  b.next();
  assert.equal(a.isLatest(ticket), true);
});
