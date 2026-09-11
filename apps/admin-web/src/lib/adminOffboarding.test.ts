/**
 * Run with: node --test --experimental-strip-types apps/admin-web/src/lib/adminOffboarding.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  canDeleteAdminAccess,
  canDeleteUserAccountOnRequest,
  resolveAdminDeleteEligibility,
  resolveRequestedDeleteEligibility,
} from './adminOffboarding.ts';

const SIGNED_IN = 'admin-self-uid';

test('an admin row that is not the signed-in admin is deletable', () => {
  assert.deepEqual(
    resolveAdminDeleteEligibility({ role: 'admin', signedInUid: SIGNED_IN, targetUid: 'admin-other-uid' }),
    { deletable: true }
  );
  assert.equal(canDeleteAdminAccess({ role: 'admin', signedInUid: SIGNED_IN, targetUid: 'admin-other-uid' }), true);
});

test('the signed-in admin cannot delete their own row (server 412)', () => {
  assert.deepEqual(resolveAdminDeleteEligibility({ role: 'admin', signedInUid: SIGNED_IN, targetUid: SIGNED_IN }), {
    deletable: false,
    reason: 'self',
  });
});

test('self check ignores surrounding whitespace on either uid', () => {
  assert.deepEqual(
    resolveAdminDeleteEligibility({ role: 'admin', signedInUid: ` ${SIGNED_IN} `, targetUid: `${SIGNED_IN} ` }),
    { deletable: false, reason: 'self' }
  );
});

test('non-admin roles are never deletable through this action (server 412)', () => {
  for (const role of ['restaurant', 'dispatch', 'customer', 'support']) {
    assert.deepEqual(resolveAdminDeleteEligibility({ role, signedInUid: SIGNED_IN, targetUid: 'other-uid' }), {
      deletable: false,
      reason: 'not-admin',
    });
  }
});

test('a missing or blank target uid is refused before anything else (server 400)', () => {
  for (const targetUid of [undefined, null, '', '   ']) {
    assert.deepEqual(resolveAdminDeleteEligibility({ role: 'admin', signedInUid: SIGNED_IN, targetUid }), {
      deletable: false,
      reason: 'missing-target',
    });
  }
});

test('a missing or unknown role is refused rather than assumed to be admin', () => {
  for (const role of [undefined, null, '', 'Admin']) {
    assert.deepEqual(resolveAdminDeleteEligibility({ role, signedInUid: SIGNED_IN, targetUid: 'other-uid' }), {
      deletable: false,
      reason: 'not-admin',
    });
  }
});

test('the self check still applies when the signed-in uid is unknown', () => {
  // No session uid means we cannot prove the row is someone else, but the role
  // gate still holds and the server re-checks both conditions.
  assert.equal(canDeleteAdminAccess({ role: 'admin', signedInUid: null, targetUid: 'admin-other-uid' }), true);
  assert.equal(canDeleteAdminAccess({ role: 'customer', signedInUid: null, targetUid: 'admin-other-uid' }), false);
});

// --- deleteUserAccountOnRequest -------------------------------------------

test('non-admin rows are deletable on request (customer, partner, rider)', () => {
  for (const role of ['customer', 'restaurant', 'dispatch', 'support']) {
    assert.deepEqual(resolveRequestedDeleteEligibility({ role, signedInUid: SIGNED_IN, targetUid: 'other-uid' }), {
      deletable: true,
    });
  }
  assert.equal(canDeleteUserAccountOnRequest({ role: 'customer', signedInUid: SIGNED_IN, targetUid: 'other-uid' }), true);
});

test('an admin row is never deletable through the on-request action (server 412)', () => {
  assert.deepEqual(resolveRequestedDeleteEligibility({ role: 'admin', signedInUid: SIGNED_IN, targetUid: 'admin-other-uid' }), {
    deletable: false,
    reason: 'is-admin',
  });
  assert.deepEqual(
    resolveRequestedDeleteEligibility({ role: ' admin ', signedInUid: SIGNED_IN, targetUid: 'admin-other-uid' }),
    { deletable: false, reason: 'is-admin' }
  );
});

test('the signed-in admin cannot delete their own row on request either (server 412)', () => {
  assert.deepEqual(resolveRequestedDeleteEligibility({ role: 'customer', signedInUid: SIGNED_IN, targetUid: SIGNED_IN }), {
    deletable: false,
    reason: 'self',
  });
  assert.deepEqual(
    resolveRequestedDeleteEligibility({ role: 'customer', signedInUid: ` ${SIGNED_IN} `, targetUid: `${SIGNED_IN} ` }),
    { deletable: false, reason: 'self' }
  );
});

test('on request, a missing or blank target uid is refused before anything else (server 400)', () => {
  for (const targetUid of [undefined, null, '', '   ']) {
    assert.deepEqual(resolveRequestedDeleteEligibility({ role: 'customer', signedInUid: SIGNED_IN, targetUid }), {
      deletable: false,
      reason: 'missing-target',
    });
  }
});

test('an unknown role is still offered on request, because only "admin" is refused server-side', () => {
  for (const role of [undefined, null, '', 'Admin']) {
    assert.equal(canDeleteUserAccountOnRequest({ role, signedInUid: SIGNED_IN, targetUid: 'other-uid' }), true);
  }
});

test('the two delete controls partition every row: exactly one is ever offered', () => {
  // This is the whole point of the pair — an operator must never be choosing
  // between "delete admin access" and "delete account on request" on one row.
  for (const role of ['admin', 'restaurant', 'dispatch', 'customer', 'support', '', undefined, null, 'Admin']) {
    const input = { role, signedInUid: SIGNED_IN, targetUid: 'other-uid' };
    assert.notEqual(
      canDeleteAdminAccess(input),
      canDeleteUserAccountOnRequest(input),
      `role ${String(role)} offered both controls or neither`
    );
  }
});

test('neither control is offered on the signed-in admin own row', () => {
  const input = { role: 'admin', signedInUid: SIGNED_IN, targetUid: SIGNED_IN };
  assert.equal(canDeleteAdminAccess(input), false);
  assert.equal(canDeleteUserAccountOnRequest(input), false);
});
