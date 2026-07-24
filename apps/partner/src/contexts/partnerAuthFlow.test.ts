/**
 * Run with: node --test --experimental-strip-types apps/partner/src/contexts/partnerAuthFlow.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MISSING_PROFILE_ERROR,
  PARTNER_APPLICATION_PENDING_MESSAGE,
  PARTNER_APPLICATION_REJECTED_FALLBACK,
  resolvePartnerAccessState,
} from './partnerAuthFlow.js';

test('treats an approved partner application as restaurant access even when the claim is still customer', () => {
  assert.deepEqual(
    resolvePartnerAccessState({
      claimRole: 'customer',
      userDocument: {
        partnerApplicationStatus: 'approved',
        role: 'customer',
      },
    }),
    {
      kind: 'restaurant',
      userRole: 'restaurant',
    }
  );
});

test('blocks pending partner applications with the pending message', () => {
  assert.deepEqual(
    resolvePartnerAccessState({
      claimRole: 'customer',
      userDocument: {
        partnerApplicationStatus: 'pending',
        role: 'customer',
      },
    }),
    {
      kind: 'blocked',
      message: PARTNER_APPLICATION_PENDING_MESSAGE,
    }
  );
});

test('blocks rejected partner applications with the rejection fallback', () => {
  assert.deepEqual(
    resolvePartnerAccessState({
      claimRole: 'customer',
      userDocument: {
        partnerApplicationRejectionReason: null,
        partnerApplicationStatus: 'rejected',
        role: 'customer',
      },
    }),
    {
      kind: 'blocked',
      message: PARTNER_APPLICATION_REJECTED_FALLBACK,
    }
  );
});

test('blocks missing partner profiles with the missing-profile message', () => {
  assert.deepEqual(
    resolvePartnerAccessState({
      claimRole: 'customer',
      userDocument: null,
    }),
    {
      kind: 'blocked',
      message: MISSING_PROFILE_ERROR,
    }
  );
});
