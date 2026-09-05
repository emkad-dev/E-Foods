/**
 * Run with: node --test --experimental-strip-types apps/customer/src/utils/checkoutGrouping.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { groupCartItemsByRestaurant } from './checkoutGrouping.ts';

test('groups mixed cart items by restaurant and sums each restaurant subtotal', () => {
  const grouped = groupCartItemsByRestaurant([
    { id: 'item-1', name: 'Jollof', price: 2500, quantity: 2, restaurantId: 'rest-1', restaurantName: 'Kitchen One' },
    { id: 'item-2', name: 'Suya', price: 1800, quantity: 1, restaurantId: 'rest-2', restaurantName: 'Kitchen Two' },
    { id: 'item-3', name: 'Fried Rice', price: 3200, quantity: 1, restaurantId: 'rest-1', restaurantName: 'Kitchen One' },
  ]);

  assert.deepEqual(grouped, [
    {
      restaurantId: 'rest-1',
      restaurantName: 'Kitchen One',
      items: [
        { id: 'item-1', name: 'Jollof', price: 2500, quantity: 2, restaurantId: 'rest-1', restaurantName: 'Kitchen One' },
        { id: 'item-3', name: 'Fried Rice', price: 3200, quantity: 1, restaurantId: 'rest-1', restaurantName: 'Kitchen One' },
      ],
      subtotal: 8200,
      totalQuantity: 3,
    },
    {
      restaurantId: 'rest-2',
      restaurantName: 'Kitchen Two',
      items: [
        { id: 'item-2', name: 'Suya', price: 1800, quantity: 1, restaurantId: 'rest-2', restaurantName: 'Kitchen Two' },
      ],
      subtotal: 1800,
      totalQuantity: 1,
    },
  ]);
});
