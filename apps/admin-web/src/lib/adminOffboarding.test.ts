/**
 * Run with: node --test --experimental-strip-types apps/admin-web/src/lib/adminOffboarding.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { canDeleteAdminAccess, resolveAdminDeleteEligibility } from './adminOffboarding.ts';

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
