/**
 * Run with: node --test --experimental-strip-types apps/partner/src/utils/authActionUrls.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPartnerAuthActionUrl } from './authActionUrls.js';

test('builds a web URL for reset password links', () => {
  assert.equal(
    buildPartnerAuthActionUrl('reset-password', {
      isWeb: true,
      webOrigin: 'https://partner.feasty.com',
    }),
    'https://partner.feasty.com/reset-password'
  );
});

test('builds a partner scheme URL for native action links', () => {
  assert.equal(buildPartnerAuthActionUrl('reset-password', { appScheme: 'feasty-partner' }), 'feasty-partner://reset-password');
});
