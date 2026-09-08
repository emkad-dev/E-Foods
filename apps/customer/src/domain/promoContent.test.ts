/**
 * Run with: node --test --experimental-strip-types apps/customer/src/domain/promoContent.test.ts
 *
 * Converted from a Deno test. It was written against
 * https://deno.land/std/assert, but it lives under apps/customer, where the
 * customer ESLint config lints it and cannot resolve a URL import - so
 * `npm run lint:customer` failed on it. It was also registered in neither
 * test:deno nor test:node, so its four assertions had never run anywhere.
 * promoHasRichContent is a pure customer-app module, so node:test is where it
 * belongs, beside ratingPrompt.test.ts.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { promoHasRichContent } from './promoContent.ts';

test('rich when an image is present', () => {
  assert.equal(
    promoHasRichContent({ imageUrl: 'https://x/storage/v1/object/public/promo-assets/a.jpg' }),
    true
  );
});

test('rich when a detail description is present', () => {
  assert.equal(promoHasRichContent({ detailBody: 'Full details here' }), true);
});

test('rich when terms are present', () => {
  assert.equal(promoHasRichContent({ terms: 'Valid today only' }), true);
});

test('not rich when all rich fields are empty/absent', () => {
  assert.equal(promoHasRichContent({ imageUrl: null, detailBody: '', terms: undefined }), false);
});
