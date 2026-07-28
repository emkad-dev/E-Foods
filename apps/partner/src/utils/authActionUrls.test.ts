/**
 * Run with: node --test --experimental-strip-types apps/partner/src/utils/authActionUrls.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPartnerActionCodeSettings, buildPartnerAuthActionUrl } from './authActionUrls.js';

test('builds the canonical partner web reset-password URL', () => {
  assert.deepEqual(
    buildPartnerActionCodeSettings('reset-password', {
      appScheme: 'feasty-partner',
      isWeb: true,
      webOrigin: 'https://partner.feasty.com.ng',
    }),
    {
    url: 'https://partner.feasty.com.ng/reset-password',
    }
  );
});

test('builds a partner scheme URL for native action links', () => {
  assert.equal(buildPartnerAuthActionUrl('reset-password', { appScheme: 'feasty-partner' }), 'feasty-partner://reset-password');
});
