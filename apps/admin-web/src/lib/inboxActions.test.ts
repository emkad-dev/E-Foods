import assert from 'node:assert/strict';
import test from 'node:test';
import { statusActionsFor } from './inboxActions.ts';

const statuses = (current: Parameters<typeof statusActionsFor>[0]) =>
  statusActionsFor(current).map((action) => action.status);

test('an open conversation offers Pending and Close, never Reopen', () => {
  assert.deepEqual(statuses('open'), ['pending', 'closed']);
});

test('a pending conversation offers Close and Reopen', () => {
  assert.deepEqual(statuses('pending'), ['closed', 'open']);
});

test('a closed conversation offers Pending and Reopen, never Close', () => {
  assert.deepEqual(statuses('closed'), ['pending', 'open']);
  assert.equal(
    statusActionsFor('closed').find((action) => action.status === 'open')?.label,
    'Reopen'
  );
});
