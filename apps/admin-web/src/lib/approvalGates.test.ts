import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ADMIN_RESTAURANT_LOCATION_REQUIRED_MESSAGE,
  ADMIN_RESTAURANT_OUTSIDE_NIGERIA_MESSAGE,
} from '../../../../packages/domain/src/restaurantLocation.ts';
import { PARTNER_PAYOUT_MISSING_REASON, partnerApproveBlockedReason, publishBlockedReason } from './approvalGates.ts';

test('Publish is blocked with the server wording when the restaurant has no pin', () => {
  assert.equal(
    publishBlockedReason({ isPublished: false, latitude: null, longitude: null }),
    ADMIN_RESTAURANT_LOCATION_REQUIRED_MESSAGE
  );
  assert.equal(publishBlockedReason({ isPublished: false }), ADMIN_RESTAURANT_LOCATION_REQUIRED_MESSAGE);
  // 0,0 is the old geocoding failure, not a place.
  assert.equal(
    publishBlockedReason({ isPublished: false, latitude: 0, longitude: 0 }),
    ADMIN_RESTAURANT_LOCATION_REQUIRED_MESSAGE
  );
});

test('Publish is blocked when the pin is outside Nigeria', () => {
  assert.equal(
    publishBlockedReason({ isPublished: false, latitude: 3.4, longitude: 6.5 + 40 }),
    ADMIN_RESTAURANT_OUTSIDE_NIGERIA_MESSAGE
  );
});

test('Publish is allowed for a usable pin in Nigeria', () => {
  assert.equal(publishBlockedReason({ isPublished: false, latitude: 6.5, longitude: 3.4 }), undefined);
});

test('partner Approve is blocked when the application has no payout details', () => {
  assert.equal(partnerApproveBlockedReason({}), PARTNER_PAYOUT_MISSING_REASON);
  assert.equal(partnerApproveBlockedReason({ onboarding: null }), PARTNER_PAYOUT_MISSING_REASON);
  assert.equal(partnerApproveBlockedReason({ onboarding: { payout: null } }), PARTNER_PAYOUT_MISSING_REASON);
});

test('partner Approve is allowed when payout details exist', () => {
  assert.equal(
    partnerApproveBlockedReason({ onboarding: { payout: { status: 'pending', bankName: 'GTBank' } } }),
    undefined
  );
});
