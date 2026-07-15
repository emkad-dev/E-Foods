import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { validatePromoTrack } from './promoTrack.ts';

Deno.test('accepts a valid impression', () => {
  assertEquals(validatePromoTrack({ promoId: 'p1', type: 'impression' }), {
    ok: true, value: { promoId: 'p1', type: 'impression' },
  });
});

Deno.test('accepts a valid click', () => {
  assertEquals(validatePromoTrack({ promoId: 'p1', type: 'click' }).ok, true);
});

Deno.test('rejects missing promoId', () => {
  assertEquals(validatePromoTrack({ type: 'click' }).ok, false);
});

Deno.test('rejects an unknown type', () => {
  assertEquals(validatePromoTrack({ promoId: 'p1', type: 'view' }).ok, false);
});
