/**
 * Run with: node --test --experimental-strip-types apps/admin-web/src/lib/analytics.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildSettlementBreakdown } from './analytics.ts';


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

test('buildSettlementBreakdown groups orders by restaurant and day', () => {
  const rows = buildSettlementBreakdown(orders as never);

  assert.equal(rows.length, 1, 'row count');
  const [row] = rows;
  assert.equal(row.restaurantName, 'Sunrise Kitchen', 'restaurantName');
  assert.equal(row.orders, 2, 'orders');
  assert.equal(row.gross, 20200, 'gross');
  assert.equal(row.split, 10800, 'split');
  assert.equal(row.manual, 6200, 'manual');
  assert.equal(row.delta, 3200, 'delta');
});
