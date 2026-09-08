// apps/customer/src/domain/promoContent.test.ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { promoHasRichContent } from './promoContent.ts';

Deno.test('rich when an image is present', () => {
  assertEquals(promoHasRichContent({ imageUrl: 'https://x/storage/v1/object/public/promo-assets/a.jpg' }), true);
});

Deno.test('rich when a detail description is present', () => {
  assertEquals(promoHasRichContent({ detailBody: 'Full details here' }), true);
});

Deno.test('rich when terms are present', () => {
  assertEquals(promoHasRichContent({ terms: 'Valid today only' }), true);
});

Deno.test('not rich when all rich fields are empty/absent', () => {
  assertEquals(promoHasRichContent({ imageUrl: null, detailBody: '', terms: undefined }), false);
});
