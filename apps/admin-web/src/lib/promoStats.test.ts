/**
 * Run with: node --test --experimental-strip-types apps/admin-web/src/lib/promoStats.test.ts
 *
 * The point of the module is that absent is not zero, so that is what gets
 * asserted -- including the half-populated payload, which is the tempting one
 * to let through.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatCtr, readPromoStats } from './promoStats.ts';

const FULL = { attributedOrders: 3, attributedRevenue: 12000, clicks: 25, impressions: 400 };

test('a complete metrics block is read through unchanged', () => {
  assert.deepEqual(readPromoStats(FULL), FULL);
});

test('a genuine zero is still a measurement', () => {
  const zeroed = { attributedOrders: 0, attributedRevenue: 0, clicks: 0, impressions: 0 };
  assert.deepEqual(readPromoStats(zeroed), zeroed);
});

test('metrics missing from the payload are unavailable, not zero', () => {
  assert.equal(readPromoStats({}), null);
  assert.equal(readPromoStats({ ...FULL, impressions: undefined }), null);
  assert.equal(readPromoStats({ ...FULL, attributedRevenue: undefined }), null);
});

test('a non-finite metric is unavailable rather than rendered', () => {
  assert.equal(readPromoStats({ ...FULL, clicks: Number.NaN }), null);
});

test('CTR is a dash until there is a denominator', () => {
  assert.equal(formatCtr({ ...FULL, clicks: 0, impressions: 0 }), '—');
  assert.equal(formatCtr(FULL), '6%');
});
