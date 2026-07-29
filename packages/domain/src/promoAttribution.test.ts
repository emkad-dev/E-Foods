/**
 * Run with: node --test --experimental-strip-types packages/domain/src/promoAttribution.test.ts
 * (Converted from Deno.test; pure functions, no Deno-specific behaviour needed.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveAttributedPromoId, promoCtr, PROMO_ATTRIBUTION_WINDOW_MS } from './promoAttribution.ts';

const now = 1_000_000_000_000;

test('attributes a click within 24h', () => {
  assert.deepEqual(resolveAttributedPromoId({ promoId: 'p1', clickedAt: now - 1000 }, now), 'p1');
});

test('attributes at exactly the 24h inclusive edge', () => {
  assert.deepEqual(
    resolveAttributedPromoId({ promoId: 'p1', clickedAt: now - PROMO_ATTRIBUTION_WINDOW_MS }, now),
    'p1',
  );
});

test('attributes at 23h59m', () => {
  assert.deepEqual(
    resolveAttributedPromoId({ promoId: 'p1', clickedAt: now - PROMO_ATTRIBUTION_WINDOW_MS + 60_000 }, now),
    'p1',
  );
});

test('does not attribute a click at exactly 24h + 1ms', () => {
  assert.deepEqual(
    resolveAttributedPromoId({ promoId: 'p1', clickedAt: now - PROMO_ATTRIBUTION_WINDOW_MS - 1 }, now),
    null,
  );
});

test('returns null when nothing stored', () => {
  assert.deepEqual(resolveAttributedPromoId(null, now), null);
});

test('CTR guards divide-by-zero', () => {
  assert.deepEqual(promoCtr(0, 0), 0);
  assert.deepEqual(promoCtr(4, 1), 0.25);
});
