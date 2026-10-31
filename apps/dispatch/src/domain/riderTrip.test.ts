/**
 * Run with: node --test --experimental-strip-types apps/dispatch/src/domain/riderTrip.test.ts
 *
 * The trip map's "Navigate" button must never send a rider to the wrong place:
 * before pickup the next stop is the restaurant, after pickup it is the
 * customer, and when we cannot tell (an escalated order with no pickup stamp)
 * the button hides rather than guess.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { OrderDocument } from './entities.ts';
import {
  buildDirectionsUrl,
  buildPlaceSearchUrl,
  getDropoffPoint,
  getNavigateTarget,
  getRestaurantPoint,
  getTripLeg,
  pickActiveDeliveries,
} from './riderTrip.ts';

type OrderOverrides = Record<string, unknown>;

const orderWith = (overrides: OrderOverrides = {}) =>
  ({
    id: 'o1',
    status: 'accepted',
    fulfillmentType: 'delivery',
    restaurantName: 'Mama Put',
    restaurantLatitude: 6.45,
    restaurantLongitude: 3.4,
    deliveryLocation: { address: '1 Test St', latitude: 6.5, longitude: 3.35 },
    assignment: { courierId: 'rider-1' },
    timeline: {},
    ...overrides,
  }) as unknown as OrderDocument;

describe('getTripLeg', () => {
  it('heads to the restaurant before pickup', () => {
    for (const status of ['accepted', 'preparing', 'ready_for_pickup']) {
      assert.equal(getTripLeg(orderWith({ status })), 'to_restaurant', status);
    }
  });

  it('heads to the customer after pickup', () => {
    for (const status of ['picked_up', 'on_the_way']) {
      assert.equal(getTripLeg(orderWith({ status })), 'to_customer', status);
    }
  });

  it('normalizes legacy status spellings before deciding', () => {
    assert.equal(getTripLeg(orderWith({ status: 'ready' })), 'to_restaurant');
  });

  it('sends an escalated order to the customer only once it was picked up', () => {
    assert.equal(
      getTripLeg(orderWith({ status: 'escalated', timeline: { pickedUpAt: '2026-10-31T10:00:00Z' } })),
      'to_customer',
    );
    assert.equal(getTripLeg(orderWith({ status: 'escalated', timeline: {} })), null);
    assert.equal(getTripLeg(orderWith({ status: 'escalated', timeline: { pickedUpAt: null } })), null);
    assert.equal(getTripLeg(orderWith({ status: 'escalated', timeline: undefined })), null);
  });

  it('has no leg for terminal statuses', () => {
    for (const status of ['delivered', 'cancelled', 'rejected', 'failed_delivery']) {
      assert.equal(getTripLeg(orderWith({ status })), null, status);
    }
  });

  it('has no leg before a rider could be on the order', () => {
    for (const status of ['draft', 'scheduled', 'placed', 'not-a-status']) {
      assert.equal(getTripLeg(orderWith({ status })), null, status);
    }
  });

  it('has no leg for pickup fulfilment, whatever the status', () => {
    assert.equal(getTripLeg(orderWith({ fulfillmentType: 'pickup', status: 'preparing' })), null);
    assert.equal(getTripLeg(orderWith({ fulfillmentType: 'pickup', status: 'on_the_way' })), null);
  });
});

describe('getRestaurantPoint / getDropoffPoint', () => {
  it('reads finite coordinates', () => {
    assert.deepEqual(getRestaurantPoint(orderWith()), { latitude: 6.45, longitude: 3.4 });
    assert.deepEqual(getDropoffPoint(orderWith()), { latitude: 6.5, longitude: 3.35 });
  });

  it('accepts zero as a coordinate', () => {
    assert.deepEqual(getRestaurantPoint(orderWith({ restaurantLatitude: 0, restaurantLongitude: 0 })), {
      latitude: 0,
      longitude: 0,
    });
  });

  it('rejects absent, null, string, NaN and infinite values', () => {
    const bad: unknown[] = [undefined, null, '6.45', Number.NaN, Number.POSITIVE_INFINITY];
    for (const value of bad) {
      assert.equal(getRestaurantPoint(orderWith({ restaurantLatitude: value })), null, String(value));
      assert.equal(getRestaurantPoint(orderWith({ restaurantLongitude: value })), null, String(value));
      assert.equal(
        getDropoffPoint(orderWith({ deliveryLocation: { address: 'x', latitude: value, longitude: 3.3 } })),
        null,
        String(value),
      );
      assert.equal(
        getDropoffPoint(orderWith({ deliveryLocation: { address: 'x', latitude: 6.5, longitude: value } })),
        null,
        String(value),
      );
    }
  });

  it('returns null with no delivery location at all', () => {
    assert.equal(getDropoffPoint(orderWith({ deliveryLocation: null })), null);
    assert.equal(getDropoffPoint(orderWith({ deliveryLocation: undefined })), null);
  });
});

describe('URL builders', () => {
  it('builds the directions link exactly', () => {
    assert.equal(
      buildDirectionsUrl({ latitude: 6.5, longitude: 3.35 }),
      'https://www.google.com/maps/dir/?api=1&destination=6.5,3.35&travelmode=driving',
    );
  });

  it('keeps negative coordinates intact', () => {
    assert.equal(
      buildDirectionsUrl({ latitude: -1.25, longitude: -36.8 }),
      'https://www.google.com/maps/dir/?api=1&destination=-1.25,-36.8&travelmode=driving',
    );
  });

  it('builds the place-search link and encodes the query', () => {
    assert.equal(
      buildPlaceSearchUrl('Mama Put & Sons, Lekki'),
      'https://www.google.com/maps/search/?api=1&query=Mama%20Put%20%26%20Sons%2C%20Lekki',
    );
  });
});

describe('getNavigateTarget', () => {
  it('goes to the restaurant coordinates before pickup', () => {
    assert.deepEqual(getNavigateTarget(orderWith()), {
      kind: 'directions',
      url: 'https://www.google.com/maps/dir/?api=1&destination=6.45,3.4&travelmode=driving',
    });
  });

  it('falls back to a name search when the restaurant has no coordinates', () => {
    assert.deepEqual(
      getNavigateTarget(orderWith({ restaurantLatitude: undefined, restaurantLongitude: undefined })),
      { kind: 'search', url: 'https://www.google.com/maps/search/?api=1&query=Mama%20Put' },
    );
  });

  it('has nothing to navigate to without coordinates or a restaurant name', () => {
    assert.equal(
      getNavigateTarget(orderWith({ restaurantLatitude: null, restaurantLongitude: null, restaurantName: '  ' })),
      null,
    );
    assert.equal(
      getNavigateTarget(
        orderWith({ restaurantLatitude: null, restaurantLongitude: null, restaurantName: undefined }),
      ),
      null,
    );
  });

  it('goes to the drop-off after pickup', () => {
    assert.deepEqual(getNavigateTarget(orderWith({ status: 'on_the_way' })), {
      kind: 'directions',
      url: 'https://www.google.com/maps/dir/?api=1&destination=6.5,3.35&travelmode=driving',
    });
  });

  it('never falls back to the restaurant after pickup when the drop-off is unknown', () => {
    assert.equal(
      getNavigateTarget(
        orderWith({ status: 'picked_up', deliveryLocation: { address: 'x', latitude: null, longitude: null } }),
      ),
      null,
    );
  });

  it('hides for an escalated order with no pickup stamp, terminal and pickup orders', () => {
    assert.equal(getNavigateTarget(orderWith({ status: 'escalated' })), null);
    assert.equal(getNavigateTarget(orderWith({ status: 'delivered' })), null);
    assert.equal(getNavigateTarget(orderWith({ fulfillmentType: 'pickup' })), null);
  });

  it('follows the drop-off for an escalated order that was picked up', () => {
    assert.equal(
      getNavigateTarget(orderWith({ status: 'escalated', timeline: { pickedUpAt: 'x' } }))?.url,
      'https://www.google.com/maps/dir/?api=1&destination=6.5,3.35&travelmode=driving',
    );
  });
});

describe('pickActiveDeliveries', () => {
  const ids = (orders: OrderDocument[]) => orders.map((order) => order.id);

  it('sorts the rider own trips most urgent first', () => {
    const orders = [
      orderWith({ id: 'accepted', status: 'accepted' }),
      orderWith({ id: 'preparing', status: 'preparing' }),
      orderWith({ id: 'ready', status: 'ready_for_pickup' }),
      orderWith({ id: 'escalated', status: 'escalated', timeline: { pickedUpAt: 'x' } }),
      orderWith({ id: 'picked', status: 'picked_up' }),
      orderWith({ id: 'onway', status: 'on_the_way' }),
    ];
    assert.deepEqual(ids(pickActiveDeliveries(orders, 'rider-1')), [
      'onway',
      'picked',
      'escalated',
      'ready',
      'preparing',
      'accepted',
    ]);
  });

  it('keeps input order within the same status', () => {
    const orders = [
      orderWith({ id: 'a', status: 'preparing' }),
      orderWith({ id: 'b', status: 'preparing' }),
      orderWith({ id: 'c', status: 'preparing' }),
    ];
    assert.deepEqual(ids(pickActiveDeliveries(orders, 'rider-1')), ['a', 'b', 'c']);
  });

  it('drops other riders, unassigned, pickup, terminal and unknown-leg orders', () => {
    const orders = [
      orderWith({ id: 'mine' }),
      orderWith({ id: 'theirs', assignment: { courierId: 'rider-2' } }),
      orderWith({ id: 'unassigned', assignment: null }),
      orderWith({ id: 'no-assignment', assignment: undefined }),
      orderWith({ id: 'pickup', fulfillmentType: 'pickup' }),
      orderWith({ id: 'done', status: 'delivered' }),
      orderWith({ id: 'esc-unknown', status: 'escalated' }),
    ];
    assert.deepEqual(ids(pickActiveDeliveries(orders, 'rider-1')), ['mine']);
  });

  it('matches nothing without a rider uid', () => {
    const orders = [orderWith({ id: 'a', assignment: { courierId: null } })];
    assert.deepEqual(pickActiveDeliveries(orders, ''), []);
    assert.deepEqual(pickActiveDeliveries(orders, null), []);
  });

  it('does not mutate the input array', () => {
    const orders = [orderWith({ id: 'a', status: 'accepted' }), orderWith({ id: 'b', status: 'on_the_way' })];
    pickActiveDeliveries(orders, 'rider-1');
    assert.deepEqual(ids(orders), ['a', 'b']);
  });
});
