/**
 * Run with: node --test --experimental-strip-types apps/customer/src/utils/orderTrackingSummary.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildOrderTrackingSummary } from './orderTrackingSummary.ts';

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
        subtotal: 8200,
        isPrimary: true,
      },
      {
        id: 'order-secondary',
        restaurantName: 'Kitchen Two',
        itemCount: 1,
        subtotal: 3800,
        isPrimary: false,
      },
    ],
  });
});
