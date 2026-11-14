import assert from 'node:assert/strict';
import test from 'node:test';
import { canRestoreAccess } from './accessActions.ts';

test('Enable is offered when the account had a privileged role', () => {
  for (const role of ['admin', 'restaurant', 'dispatch', ' dispatch ']) {
    assert.equal(canRestoreAccess(role), true, role);
  }
});

test('Enable is hidden when there is no privileged role to restore', () => {
  for (const role of [null, undefined, '', 'customer', 'support', 'Admin']) {
    assert.equal(canRestoreAccess(role), false, String(role));
  }
});
