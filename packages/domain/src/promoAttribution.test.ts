import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { resolveAttributedPromoId, promoCtr, PROMO_ATTRIBUTION_WINDOW_MS } from './promoAttribution.ts';

const now = 1_000_000_000_000;

Deno.test('attributes a click within 24h', () => {
  assertEquals(resolveAttributedPromoId({ promoId: 'p1', clickedAt: now - 1000 }, now), 'p1');
});

Deno.test('does not attribute a click at exactly 24h + 1ms', () => {
  assertEquals(
    resolveAttributedPromoId({ promoId: 'p1', clickedAt: now - PROMO_ATTRIBUTION_WINDOW_MS - 1 }, now),
    null,
  );
});

Deno.test('returns null when nothing stored', () => {
  assertEquals(resolveAttributedPromoId(null, now), null);
});

Deno.test('CTR guards divide-by-zero', () => {
  assertEquals(promoCtr(0, 0), 0);
  assertEquals(promoCtr(4, 1), 0.25);
});
