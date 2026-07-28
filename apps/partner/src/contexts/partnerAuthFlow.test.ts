/**
 * Run with: node --test --experimental-strip-types apps/partner/src/contexts/partnerAuthFlow.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MISSING_PROFILE_ERROR,
  PARTNER_APPLICATION_PENDING_MESSAGE,
  PARTNER_APPLICATION_REJECTED_FALLBACK,
  PARTNER_RESTAURANT_COMPLETION_TIMEOUT_MESSAGE,
  resolvePartnerRestaurantCompletionState,
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

test('keeps the completion screen waiting while partner access is still customer', () => {
  assert.deepEqual(
    resolvePartnerRestaurantCompletionState({
      startedAt: 1_000,
      userRole: 'customer',
      now: 4_000,
      timeoutMs: 5_000,
    }),
    {
      kind: 'waiting',
    }
  );
});

test('times out the completion handoff when restaurant access does not arrive in time', () => {
  assert.deepEqual(
    resolvePartnerRestaurantCompletionState({
      startedAt: 1_000,
      userRole: 'customer',
      now: 7_001,
      timeoutMs: 5_000,
    }),
    {
      kind: 'timed-out',
      message: PARTNER_RESTAURANT_COMPLETION_TIMEOUT_MESSAGE,
    }
  );
});

test('treats restaurant access as ready once the auth state is reconciled', () => {
  assert.deepEqual(
    resolvePartnerRestaurantCompletionState({
      startedAt: 1_000,
      userRole: 'restaurant',
      now: 4_000,
      timeoutMs: 5_000,
    }),
    {
      kind: 'ready',
    }
  );
});
