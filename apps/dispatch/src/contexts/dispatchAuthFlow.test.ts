/**
 * Run with: node --test --experimental-strip-types apps/dispatch/src/contexts/dispatchAuthFlow.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DISPATCH_APPLICATION_PENDING_MESSAGE,
  DISPATCH_APPLICATION_REJECTED_FALLBACK,
  MISSING_PROFILE_ERROR,
  resolveDispatchAccessState,
} from './dispatchAuthFlow.js';

test('routes a customer-role rider with no application to phase 2', () => {
  assert.deepEqual(
    resolveDispatchAccessState({
      claimRole: 'customer',
      userDocument: {
        dispatchApplicationStatus: null,
      },
    }),
    {
      kind: 'complete-profile',
      userRole: 'customer',
    }
  );
});

test('keeps dispatch riders on the main app', () => {
  assert.deepEqual(
    resolveDispatchAccessState({
      claimRole: 'dispatch',
      userDocument: {
        dispatchApplicationStatus: null,
      },
    }),
    {
      kind: 'dispatch',
      userRole: 'dispatch',
    }
  );
});

test('blocks pending applicants with the pending message', () => {
  assert.deepEqual(
    resolveDispatchAccessState({
      claimRole: 'customer',
      userDocument: {
        dispatchApplicationStatus: 'pending',
      },
    }),
    {
      kind: 'blocked',
      message: DISPATCH_APPLICATION_PENDING_MESSAGE,
    }
  );
});

test('blocks rejected applicants with the rejection fallback', () => {
  assert.deepEqual(
    resolveDispatchAccessState({
      claimRole: 'customer',
      userDocument: {
        dispatchApplicationStatus: 'rejected',
      },
    }),
    {
      kind: 'blocked',
      message: DISPATCH_APPLICATION_REJECTED_FALLBACK,
    }
  );
});

test('blocks missing profiles with the missing-profile message', () => {
  assert.deepEqual(
    resolveDispatchAccessState({
      claimRole: 'customer',
      userDocument: null,
    }),
    {
      kind: 'blocked',
      message: MISSING_PROFILE_ERROR,
    }
  );
});
