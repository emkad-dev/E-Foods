import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  buildRestaurantPayoutRow,
  buildRiderRosterRow,
  emptySettlementTotals,
  findPayoutProfile,
  summarizeSettlement,
} from './adminFleetReads.ts';

const NOW = new Date('2026-10-19T12:00:00.000Z');

Deno.test('a published restaurant with no subaccount is flagged as not splitting', () => {
  const row = buildRestaurantPayoutRow({ id: 'r1', isPublished: true, name: 'Ogo' }, null, undefined, NOW);
  assertEquals(row.notSplitting, true);
  assertEquals(row.hasSubaccount, false);
  assertEquals(row.payoutStatus, 'none');
});

Deno.test('an unpublished restaurant without a subaccount is not flagged', () => {
  const row = buildRestaurantPayoutRow({ id: 'r1', isPublished: false, name: 'Draft' }, null, undefined, NOW);
  assertEquals(row.notSplitting, false);
});

Deno.test('a blank subaccount code counts as absent', () => {
  const row = buildRestaurantPayoutRow(
    { id: 'r1', isPublished: true, name: 'X', paystackSubaccountCode: '   ' },
    null,
    undefined,
    NOW
  );
  assertEquals(row.notSplitting, true);
});

Deno.test('a published restaurant with a subaccount is splitting', () => {
  const row = buildRestaurantPayoutRow(
    { id: 'r1', isPublished: true, name: 'Perfect Spot', paystackSubaccountCode: 'ACCT_abc' },
    { status: 'active', paystackSubaccountCode: 'ACCT_abc' },
    undefined,
    NOW
  );
  assertEquals(row.notSplitting, false);
  assertEquals(row.payoutStatus, 'active');
  assertEquals(row.payoutProfileHasSubaccount, true);
});

Deno.test('the row never carries the subaccount code or bank details', () => {
  const row = buildRestaurantPayoutRow(
    { id: 'r1', isPublished: true, name: 'P', paystackSubaccountCode: 'ACCT_secretcode' },
    {
      status: 'active',
      paystackSubaccountCode: 'ACCT_secretcode',
      accountNumber: '0123456789',
      bankCode: '058',
    } as never,
    undefined,
    NOW
  );
  const serialized = JSON.stringify(row);
  assert(!serialized.includes('ACCT_secretcode'), 'subaccount code must not leak');
  assert(!serialized.includes('0123456789'), 'account number must not leak');
  assert(!serialized.includes('058'), 'bank code must not leak');
});

Deno.test('paused reflects a future pausedUntil only', () => {
  assertEquals(
    buildRestaurantPayoutRow({ id: 'a', pausedUntil: '2026-10-20T00:00:00.000Z' }, null, undefined, NOW).isPaused,
    true
  );
  assertEquals(
    buildRestaurantPayoutRow({ id: 'a', pausedUntil: '2026-09-18T10:42:46.343Z' }, null, undefined, NOW).isPaused,
    false
  );
});

Deno.test('payout profile is matched by restaurantId, then by owner uid', () => {
  const profiles = [
    { uid: 'owner-2', restaurantId: null, status: 'pending' },
    { uid: 'owner-1', restaurantId: 'r1', status: 'active' },
  ];
  assertEquals(findPayoutProfile({ id: 'r1', ownerId: 'owner-9' }, profiles)?.status, 'active');
  assertEquals(findPayoutProfile({ id: 'rX', ownerId: 'owner-2' }, profiles)?.status, 'pending');
  assertEquals(findPayoutProfile({ id: 'rY', ownerId: 'nobody' }, profiles), null);
});

Deno.test('settlement is totalled per restaurant, split from manual, with unknown kept apart', () => {
  const { byRestaurant, platform } = summarizeSettlement([
    { restaurantId: 'r1', settlementMode: 'manual', amount: 1000 },
    { restaurantId: 'r1', settlementMode: 'manual', amount: 500.5 },
    { restaurantId: 'r1', settlementMode: 'split', amount: 2000 },
    { restaurantId: 'r2', settlementMode: null, amount: 300 },
    { restaurantId: null, settlementMode: 'manual', amount: 100 },
  ]);
  const r1 = byRestaurant.get('r1')!;
  assertEquals(r1.manualCount, 2);
  assertEquals(r1.manualAmount, 1500.5);
  assertEquals(r1.splitCount, 1);
  assertEquals(r1.splitAmount, 2000);
  assertEquals(byRestaurant.get('r2')!.unknownCount, 1);
  assertEquals(byRestaurant.has(''), false);
  // The unattributed row still counts toward the platform total.
  assertEquals(platform.manualCount, 3);
  assertEquals(platform.manualAmount, 1600.5);
});

Deno.test('empty settlement totals are all zero', () => {
  assertEquals(emptySettlementTotals().manualCount + emptySettlementTotals().splitCount, 0);
});

Deno.test('rider roster row exposes only allow-listed fields', () => {
  const nowMs = Date.parse('2026-10-19T12:00:00.000Z');
  const row = buildRiderRosterRow(
    {
      id: 'rider-1',
      displayName: ' Ada ',
      status: 'Available',
      zone: 'Yaba',
      vehicleType: 'Bike',
      acceptanceRate: 0.9,
      activeLoad: 2,
      completedTrips: 14,
      updatedAt: '2026-10-18T08:00:00.000Z',
      licenseNumber: 'LIC-999',
      vehiclePlateNumber: 'ABC-123',
      phoneNumber: '+234800',
      currentAddress: '1 Road',
      latitude: 6.5123,
      longitude: 3.3789,
    } as never,
    '2026-10-19T11:59:30.000Z',
    nowMs
  );
  assertEquals(row.displayName, 'Ada');
  assertEquals(row.online, true);
  assertEquals(row.lastSeenAt, '2026-10-19T11:59:30.000Z');
  const serialized = JSON.stringify(row);
  for (const secret of ['LIC-999', 'ABC-123', '+234800', '1 Road', '6.5123', '3.3789']) {
    assert(!serialized.includes(secret), `${secret} must not leak`);
  }
});

Deno.test('a rider with no live fix falls back to the durable updatedAt and is offline', () => {
  const row = buildRiderRosterRow(
    { id: 'r', displayName: 'B', updatedAt: '2026-10-01T00:00:00.000Z' },
    null,
    Date.parse('2026-10-19T12:00:00.000Z')
  );
  assertEquals(row.online, false);
  assertEquals(row.lastSeenAt, '2026-10-01T00:00:00.000Z');
  assertEquals(row.activeLoad, 0);
  assertEquals(row.completedTrips, 0);
});
