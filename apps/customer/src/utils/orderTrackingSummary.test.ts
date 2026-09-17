/**
 * Run with: node --test --experimental-strip-types apps/customer/src/utils/orderTrackingSummary.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { OrderItemDocument, OrderPriceBreakdown } from '../domain/entities.ts';
import {
  buildOrderItemRows,
  buildOrderReceipt,
  buildOrderTrackingSummary,
  formatOrderItemOptions,
} from './orderTrackingSummary.ts';

test('builds an explicit grouped summary when the order snapshot includes child restaurant orders', () => {
  const summary = buildOrderTrackingSummary({
    id: 'order-primary',
    customerId: 'customer-1',
    restaurantId: 'rest-1',
    restaurantName: 'Kitchen One',
    items: [
      {
        id: 'item-1',
        name: 'Jollof',
        price: 2500,
        quantity: 2,
        restaurantId: 'rest-1',
        restaurantName: 'Kitchen One',
      },
    ],
    status: 'placed',
    fulfillmentType: 'delivery',
    createdAt: '2026-08-27T10:00:00.000Z',
    pricing: {
      currency: 'NGN',
      subtotal: 8200,
      deliveryFee: 900,
      serviceFee: 300,
      tip: 0,
      discount: 0,
      total: 9400,
      restaurantBasis: 8200,
      partnerServiceFee: 0,
      restaurantPayable: 8200,
    },
    payment: {
      method: 'card',
      status: 'paid',
    },
    orderGroup: {
      id: 'group-1',
      orderCount: 2,
      primaryOrderId: 'order-primary',
      pricing: {
        currency: 'NGN',
        subtotal: 12000,
        deliveryFee: 1800,
        serviceFee: 500,
        tip: 0,
        discount: 0,
        total: 14300,
      },
      restaurantCount: 2,
      restaurantIds: ['rest-1', 'rest-2'],
    },
    groupOrders: [
      {
        id: 'order-primary',
        customerId: 'customer-1',
        restaurantId: 'rest-1',
        restaurantName: 'Kitchen One',
        items: [
          {
            id: 'item-1',
            name: 'Jollof',
            price: 2500,
            quantity: 2,
            restaurantId: 'rest-1',
            restaurantName: 'Kitchen One',
          },
        ],
        status: 'placed',
        fulfillmentType: 'delivery',
        createdAt: '2026-08-27T10:00:00.000Z',
        pricing: {
          currency: 'NGN',
          subtotal: 8200,
          deliveryFee: 900,
          serviceFee: 300,
          tip: 0,
          discount: 0,
          total: 9400,
          restaurantBasis: 8200,
          partnerServiceFee: 0,
          restaurantPayable: 8200,
        },
        payment: {
          method: 'card',
          status: 'paid',
        },
      },
      {
        id: 'order-secondary',
        customerId: 'customer-1',
        restaurantId: 'rest-2',
        restaurantName: 'Kitchen Two',
        items: [
          {
            id: 'item-2',
            name: 'Suya',
            price: 1800,
            quantity: 1,
            restaurantId: 'rest-2',
            restaurantName: 'Kitchen Two',
          },
        ],
        status: 'placed',
        fulfillmentType: 'delivery',
        createdAt: '2026-08-27T10:00:00.000Z',
        pricing: {
          currency: 'NGN',
          subtotal: 3800,
          deliveryFee: 900,
          serviceFee: 200,
          tip: 0,
          discount: 0,
          total: 4900,
          restaurantBasis: 3800,
          partnerServiceFee: 0,
          restaurantPayable: 3800,
        },
        payment: {
          method: 'card',
          status: 'paid',
        },
      },
    ],
  });

  assert.deepEqual(summary, {
    title: 'Grouped checkout',
    subtitle: '2 restaurant orders across 2 restaurants',
    totalLabel: 'Group total',
    total: 14300,
    restaurantCount: 2,
    orderCount: 2,
    groupOrderCount: 2,
    lines: [
      {
        id: 'order-primary',
        restaurantName: 'Kitchen One',
        itemCount: 2,
        // Each restaurant's own lines travel on its own summary line: a mixed
        // basket flattened into one list credits the wrong kitchen.
        items: [{ key: 'item-1:0', name: 'Jollof', options: null, quantity: 2, total: 5000 }],
        subtotal: 8200,
        isPrimary: true,
      },
      {
        id: 'order-secondary',
        restaurantName: 'Kitchen Two',
        itemCount: 1,
        items: [{ key: 'item-2:0', name: 'Suya', options: null, quantity: 1, total: 1800 }],
        subtotal: 3800,
        isPrimary: false,
      },
    ],
  });
});

const orderItem = (overrides: Partial<OrderItemDocument> = {}): OrderItemDocument => ({
  id: 'item-1',
  name: 'Jollof',
  price: 2500,
  quantity: 2,
  restaurantId: 'rest-1',
  restaurantName: 'Kitchen One',
  ...overrides,
});

test('builds printable item rows with the line price the customer was charged', () => {
  assert.deepEqual(buildOrderItemRows([orderItem(), orderItem({ id: 'item-2', name: 'Suya', price: 1800, quantity: 1 })]), [
    { key: 'item-1:0', name: 'Jollof', options: null, quantity: 2, total: 5000 },
    { key: 'item-2:1', name: 'Suya', options: null, quantity: 1, total: 1800 },
  ]);
});

test('keys repeat menu items by position so two modifier variants of one dish both render', () => {
  const rows = buildOrderItemRows([
    orderItem({ selectedOptions: [{ groupId: 'protein', groupLabel: 'Protein', optionId: 'beef', optionLabel: 'Beef' }] }),
    orderItem({ selectedOptions: [{ groupId: 'protein', groupLabel: 'Protein', optionId: 'fish', optionLabel: 'Fish' }] }),
  ]);

  assert.deepEqual(
    rows.map((row) => row.key),
    ['item-1:0', 'item-1:1']
  );
});

test('returns no rows at all for a legacy order carrying no items, so no empty heading is rendered', () => {
  assert.deepEqual(buildOrderItemRows(undefined), []);
  assert.deepEqual(buildOrderItemRows(null), []);
  assert.deepEqual(buildOrderItemRows([]), []);
});

test('drops an unnamed line rather than printing a blank row', () => {
  // Index is taken after the drop, so keys stay dense and unique in the list
  // that is actually rendered.
  assert.deepEqual(buildOrderItemRows([orderItem({ name: '   ' }), orderItem({ id: 'item-2', name: 'Suya' })]), [
    { key: 'item-2:0', name: 'Suya', options: null, quantity: 2, total: 5000 },
  ]);
});

test('coerces a missing quantity or price to zero instead of rendering NaN', () => {
  assert.deepEqual(
    buildOrderItemRows([orderItem({ price: undefined as unknown as number, quantity: undefined as unknown as number })]),
    [{ key: 'item-1:0', name: 'Jollof', options: null, quantity: 0, total: 0 }]
  );
});

test('joins the customer modifier choices, group-labelled, and falls back to the raw option id', () => {
  assert.equal(
    formatOrderItemOptions(
      orderItem({
        selectedOptions: [
          { groupId: 'protein', groupLabel: 'Protein', optionId: 'beef', optionLabel: 'Beef' },
          // Older rows predate the label snapshot; the id beats dropping the
          // customer's choice off their own receipt.
          { groupId: 'extras', optionId: 'no-onions' },
        ],
      })
    ),
    // No group label on the second choice, so it prints bare — the group
    // prefix is dropped, the choice itself never is.
    'Protein: Beef · no-onions'
  );
});

test('returns null, not an empty string, when a line carries no modifiers', () => {
  assert.equal(formatOrderItemOptions(orderItem()), null);
  assert.equal(formatOrderItemOptions(orderItem({ selectedOptions: [] })), null);
  assert.equal(formatOrderItemOptions(orderItem({ selectedOptions: null })), null);
});

const pricing = (overrides: Partial<OrderPriceBreakdown> = {}): OrderPriceBreakdown => ({
  currency: 'NGN',
  subtotal: 8200,
  deliveryFee: 900,
  serviceFee: 0,
  tip: 300,
  discount: 0,
  total: 9400,
  ...overrides,
});

test('the receipt column sums to the total it is printed under', () => {
  const receipt = buildOrderReceipt({ pricing: pricing(), restaurantScoped: false, total: 9400 });

  assert.deepEqual(receipt.lines, [
    { amount: 8200, id: 'subtotal', label: 'Subtotal' },
    { amount: 900, id: 'deliveryFee', label: 'Delivery fee' },
    { amount: 300, id: 'tip', label: 'Tip' },
  ]);
  // The defect this replaces: delivery fee and tip with no subtotal and no
  // discount line can never reconcile to the total above them.
  assert.equal(receipt.residual, 0);
});

test('a discount is a signed deduction, so the column still reaches the total', () => {
  const receipt = buildOrderReceipt({
    pricing: pricing({ discount: 1000, total: 8400 }),
    restaurantScoped: false,
    total: 8400,
  });

  assert.deepEqual(receipt.lines.at(-1), { amount: -1000, id: 'discount', label: 'Discount' });
  assert.equal(receipt.residual, 0);
});

test('suppresses the service fee row that pricing v2 hard-codes to zero, and keeps it for commission-era orders', () => {
  assert.equal(
    buildOrderReceipt({ pricing: pricing(), restaurantScoped: false, total: 9400 }).lines.some(
      (line) => line.id === 'serviceFee'
    ),
    false
  );

  const legacy = buildOrderReceipt({
    pricing: pricing({ serviceFee: 500, total: 9900 }),
    restaurantScoped: false,
    total: 9900,
  });
  assert.deepEqual(legacy.lines.find((line) => line.id === 'serviceFee'), {
    amount: 500,
    id: 'serviceFee',
    label: 'Service fee',
  });
  assert.equal(legacy.residual, 0);
});

test('prints a zero delivery fee and a zero tip, because ₦0.00 there is a statement rather than an absence', () => {
  const receipt = buildOrderReceipt({
    pricing: pricing({ deliveryFee: 0, subtotal: 8200, tip: 0, total: 8200 }),
    restaurantScoped: false,
    total: 8200,
  });

  assert.deepEqual(
    receipt.lines.map((line) => line.id),
    ['subtotal', 'deliveryFee', 'tip']
  );
  assert.equal(receipt.residual, 0);
});

test('scopes every label to the restaurant inside a grouped checkout', () => {
  const receipt = buildOrderReceipt({
    pricing: pricing({ discount: 100, total: 9300 }),
    restaurantScoped: true,
    total: 9300,
  });

  assert.deepEqual(
    receipt.lines.map((line) => line.label),
    ['Restaurant subtotal', 'Restaurant delivery fee', 'Restaurant tip', 'Restaurant discount']
  );
  assert.equal(receipt.residual, 0);
});

test('omits the subtotal and reports the shortfall when a legacy order carries none', () => {
  const receipt = buildOrderReceipt({
    pricing: { currency: 'NGN', deliveryFee: 900, tip: 0, total: 9400 } as unknown as OrderPriceBreakdown,
    restaurantScoped: false,
    total: 9400,
  });

  // No invented figure: the line is absent and `residual` states the gap.
  assert.equal(
    receipt.lines.some((line) => line.id === 'subtotal'),
    false
  );
  assert.equal(receipt.residual, -8500);
});
