import { assertEquals } from 'jsr:@std/assert';

const WEEK = {
  endsAt: '2026-08-25T00:00:00.000Z',
  startsAt: '2026-08-18T00:00:00.000Z',
  timezone: 'Africa/Lagos',
};

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-role-key-not-real');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-not-real');

const { buildCourierWeeklyEarningsSummary } = await import('./courierSupply.ts');

Deno.test('buildCourierWeeklyEarningsSummary totals ledger rows and falls back to the week snapshot when no payout exists', () => {
  const summary = buildCourierWeeklyEarningsSummary({
    payouts: [],
    records: [
      {
        amount: 1250,
        courierId: 'courier-1',
        currency: 'NGN',
        deliveredAt: '2026-08-21T11:00:00.000Z',
        id: 'earning-1',
        orderId: 'order-1',
      },
      {
        amount: 750,
        courierId: 'courier-1',
        currency: 'NGN',
        deliveredAt: '2026-08-21T09:00:00.000Z',
        id: 'earning-2',
        orderId: 'order-2',
      },
    ],
    weekWindow: WEEK,
  });

  assertEquals(summary.total, 2000);
  assertEquals(summary.deliveredOrders, 2);
  assertEquals(summary.records.map((record) => record.orderId), ['order-1', 'order-2']);
  assertEquals(summary.payout.ledgerTotal, 2000);
  assertEquals(summary.payout.id, null);
  assertEquals(summary.week, WEEK);
});

Deno.test('buildCourierWeeklyEarningsSummary prefers a matching payout snapshot over the raw ledger total', () => {
  const summary = buildCourierWeeklyEarningsSummary({
    payouts: [
      {
        courierId: 'courier-1',
        currency: 'NGN',
        id: 'payout-1',
        ledgerTotal: 1800,
        periodEndsAt: '2026-08-24T23:59:59.000Z',
        periodStartsAt: '2026-08-18T00:00:00.000Z',
        reference: 'bank-transfer-1',
        reviewNotes: 'Processed',
        status: 'paid',
      },
    ],
    records: [
      {
        amount: 1250,
        courierId: 'courier-1',
        currency: 'NGN',
        deliveredAt: '2026-08-21T11:00:00.000Z',
        id: 'earning-1',
        orderId: 'order-1',
      },
      {
        amount: 750,
        courierId: 'courier-1',
        currency: 'NGN',
        deliveredAt: '2026-08-21T09:00:00.000Z',
        id: 'earning-2',
        orderId: 'order-2',
      },
    ],
    weekWindow: WEEK,
  });

  assertEquals(summary.total, 2000);
  assertEquals(summary.payout.id, 'payout-1');
  assertEquals(summary.payout.ledgerTotal, 1800);
  assertEquals(summary.payout.status, 'paid');
  assertEquals(summary.payout.reference, 'bank-transfer-1');
});
