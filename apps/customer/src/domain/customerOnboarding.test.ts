/**
 * Run with: node --test --experimental-strip-types apps/customer/src/domain/customerOnboarding.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { shouldShowLocationOnboarding, toLocationLabel } from './customerOnboarding.ts';

test('a first-time visitor is shown the location step', () => {
  assert.equal(
    shouldShowLocationOnboarding({ hasDeliveryLocation: false, hasSeenLocationStep: false }),
    true
  );
});

test('skipping is remembered, so it does not nag on every launch', () => {
  assert.equal(
    shouldShowLocationOnboarding({ hasDeliveryLocation: false, hasSeenLocationStep: true }),
    false,
    'the gate records that the step was SHOWN, not that it was satisfied'
  );
});

test('a visitor who already has a delivery location is never asked', () => {
  assert.equal(
    shouldShowLocationOnboarding({ hasDeliveryLocation: true, hasSeenLocationStep: false }),
    false,
    'having an address is the goal - an existing user upgrading into this build is not interrupted'
  );
  assert.equal(
    shouldShowLocationOnboarding({ hasDeliveryLocation: true, hasSeenLocationStep: true }),
    false
  );
});

test('the location label prefers the short address', () => {
  assert.equal(toLocationLabel({ address: '12 Admiralty Way, Lekki, Lagos', shortAddress: 'Lekki' }), 'Lekki');
});

test('it falls back to the first two parts of a full address', () => {
  assert.equal(
    toLocationLabel({ address: '12 Admiralty Way, Lekki, Lagos, Nigeria', shortAddress: null }),
    '12 Admiralty Way, Lekki',
    'the parts a person actually recognises, not the country'
  );
});

test('it never renders an empty chip', () => {
  assert.equal(toLocationLabel({ address: null, shortAddress: null }), 'Set your location');
  assert.equal(toLocationLabel({ address: '   ', shortAddress: '  ' }), 'Set your location');
});
