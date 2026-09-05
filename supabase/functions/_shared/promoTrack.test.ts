import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { MAX_PROMO_ID_LENGTH, validatePromoTrack } from './promoTrack.ts';

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

Deno.test('rejects a promoId longer than 128 characters', () => {
  const promoId = 'a'.repeat(MAX_PROMO_ID_LENGTH + 1);
  assertEquals(validatePromoTrack({ promoId, type: 'click' }).ok, false);
});

Deno.test('rejects a whitespace-only promoId', () => {
  assertEquals(validatePromoTrack({ promoId: '   ', type: 'click' }).ok, false);
});

Deno.test('rejects a non-string promoId', () => {
  assertEquals(validatePromoTrack({ promoId: 123, type: 'click' }).ok, false);
});

Deno.test('accepts an exactly-128-character promoId', () => {
  const promoId = 'a'.repeat(MAX_PROMO_ID_LENGTH);
  assertEquals(validatePromoTrack({ promoId, type: 'click' }), {
    ok: true, value: { promoId, type: 'click' },
  });
});
