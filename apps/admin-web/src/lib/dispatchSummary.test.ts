import assert from 'node:assert/strict';
import { test } from 'node:test';

import { courierLabel, distinctOwner, summarizeRoster } from './dispatchSummary.ts';

test('counts riders online, carrying orders, and waiting for approval', () => {
  const summary = summarizeRoster([
    { online: true, activeLoad: 1, verificationStatus: 'approved' },
    { online: true, activeLoad: 0, verificationStatus: 'approved' },
    { online: false, activeLoad: 0, verificationStatus: 'pending' },
    { online: false, activeLoad: 0, verificationStatus: 'rejected' },
    { online: false, activeLoad: 2, verificationStatus: 'Approved' },
  ]);
  assert.deepEqual(summary, { total: 5, online: 2, carrying: 2, awaitingApproval: 1 });
});

test('an empty roster is all zeros', () => {
  assert.deepEqual(summarizeRoster([]), { total: 0, online: 0, carrying: 0, awaitingApproval: 0 });
});

test('the owner shows only when it differs from the courier', () => {
  assert.equal(distinctOwner({ courierId: 'rider-1', dispatchOwnerId: 'rider-1' }), null);
  assert.equal(distinctOwner({ courierId: null, dispatchOwnerId: null }), null);
  assert.equal(distinctOwner({ courierId: 'rider-2', dispatchOwnerId: 'rider-1' }), 'rider-1');
  assert.equal(distinctOwner({ courierId: null, dispatchOwnerId: 'rider-1' }), 'rider-1');
});

test('a courier label never comes out blank', () => {
  assert.equal(courierLabel('Tunde', 'rider-abc123'), 'Tunde');
  assert.equal(courierLabel('  Tunde  ', null), 'Tunde');
  assert.equal(courierLabel('   ', 'rider-abc123'), 'ABC123');
  assert.equal(courierLabel('', 'rider-abc123'), 'ABC123');
  assert.equal(courierLabel(null, 'rider-abc123'), 'ABC123');
  assert.equal(courierLabel(undefined, ' rider-xyz789 '), 'XYZ789');
  assert.equal(courierLabel(null, null), '—');
  assert.equal(courierLabel('  ', '  '), '—');
});
