import { buildSettlementBreakdown } from './analytics.ts';

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

const orders = [
  {
    createdAt: '2026-08-30T10:00:00.000Z',
    id: 'order-1',
    payment: { settlementMode: 'split', splitSubaccountCode: 'ACCT_split_123' },
    pricing: { total: 13000, settlement: { netSettlement: 10800 } },
    restaurantId: 'restaurant-1',
    restaurantName: 'Sunrise Kitchen',
    status: 'placed',
  },
  {
    createdAt: '2026-08-30T16:30:00.000Z',
    id: 'order-2',
    payment: { settlementMode: 'manual' },
    pricing: { total: 7200, settlement: { netSettlement: 6200 } },
    restaurantId: 'restaurant-1',
    restaurantName: 'Sunrise Kitchen',
    status: 'placed',
  },
] as const;

Deno.test('buildSettlementBreakdown groups orders by restaurant and day', () => {
  const rows = buildSettlementBreakdown(orders as never);

  expectEqual(rows.length, 1, 'row count');
  const [row] = rows;
  expectEqual(row.restaurantName, 'Sunrise Kitchen', 'restaurantName');
  expectEqual(row.orders, 2, 'orders');
  expectEqual(row.gross, 20200, 'gross');
  expectEqual(row.split, 10800, 'split');
  expectEqual(row.manual, 6200, 'manual');
  expectEqual(row.delta, 3200, 'delta');
});
