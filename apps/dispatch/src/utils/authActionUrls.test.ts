/**
 * Run with: node --test --experimental-strip-types apps/dispatch/src/utils/authActionUrls.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDispatchActionCodeSettings, buildDispatchAuthActionUrl } from './authActionUrls.ts';

test('builds a dispatch scheme URL for native action links', () => {
  assert.deepEqual(buildDispatchActionCodeSettings('verify-email', { appScheme: 'feasty-dispatch' }), {
    url: 'feasty-dispatch://verify-email',
  });
});

test('never points a rider action link at an https host the project does not serve', () => {
  assert.equal(
    buildDispatchAuthActionUrl('reset-password', { appScheme: 'feasty-dispatch', isWeb: true }),
    'feasty-dispatch://reset-password'
  );
});

test('uses an explicit rider web origin when one is configured', () => {
  assert.equal(
    buildDispatchAuthActionUrl('reset-password', {
      appScheme: 'feasty-dispatch',
      isWeb: true,
      webOrigin: 'https://rider.feasty.com.ng',
    }),
    'https://rider.feasty.com.ng/reset-password'
  );
});
