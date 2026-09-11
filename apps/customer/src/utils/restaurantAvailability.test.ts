/**
 * Run with: node --test apps/customer/src/utils/restaurantAvailability.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  getDiscoverySections,
  getPlatformCoverage,
  getRestaurantAvailability,
  getRestaurantRatingLabel,
  isRestaurantVisibleToCustomers,
  NEW_RESTAURANT_RATING_THRESHOLD,
  type DiscoveryRestaurant,
} from './restaurantAvailability.ts';
import type { AddressRecord } from '../domain/entities.ts';

// Lagos Island. Distances below are measured from here.
// Cast because AddressRecord carries fields coverage never reads.
const PINNED = {
  address: '12 Broad Street, Lagos',
  latitude: 6.4550,
  longitude: 3.3841,
} as unknown as AddressRecord;

const restaurant = (overrides: Partial<DiscoveryRestaurant> = {}): DiscoveryRestaurant => ({
  id: 'rest-1',
  name: 'Test Kitchen',
  isPublished: true,
  supportsDelivery: true,
  latitude: 6.4600,
  longitude: 3.3900,
  deliveryRadiusKm: 5,
  menu: [
    {
      category: 'Mains',
      items: [{ id: 'item-1', name: 'Jollof', description: '', price: 2000, isAvailable: true }],
    },
  ],
  ...overrides,
});

test('pinned address inside a restaurant radius is covered', () => {
  const coverage = getPlatformCoverage([restaurant()], PINNED);
  assert.equal(coverage.isCovered, true);
  assert.ok(coverage.nearestOrderableKm !== null && coverage.nearestOrderableKm < 5);
});

test('pinned address outside every radius is not covered but reports the nearest kitchen', () => {
  // Abuja, ~500km from the pinned Lagos address.
  const far = restaurant({ latitude: 9.0765, longitude: 7.3986, deliveryRadiusKm: 5 });
  const coverage = getPlatformCoverage([far], PINNED);
  assert.equal(coverage.isCovered, false);
  assert.ok(coverage.nearestOrderableKm !== null && coverage.nearestOrderableKm > 400);
});

test('no pinned address is treated as covered', () => {
  const coverage = getPlatformCoverage([restaurant()], null);
  assert.deepEqual(coverage, { isCovered: true, nearestOrderableKm: null });
});

test('a restaurant without coordinates is skipped entirely, and the empty candidate set fails open', () => {
  // A published, delivery-capable restaurant missing coordinates is not a usable
  // candidate, so with no other restaurants there are zero eligible candidates. That
  // must fail open (isCovered: true), not be treated as "checked and out of range".
  const coverage = getPlatformCoverage([restaurant({ latitude: null, longitude: null })], PINNED);
  assert.deepEqual(coverage, { isCovered: true, nearestOrderableKm: null });
});

test('a zero radius falls back to the 12km default rather than blocking', () => {
  // ~7km from the pinned address: outside a literal 0km radius, inside the 12km fallback.
  const nearby = restaurant({ latitude: 6.5170, longitude: 3.3841, deliveryRadiusKm: 0 });
  assert.equal(getPlatformCoverage([nearby], PINNED).isCovered, true);
});

test('a delivery-disabled, pickup-capable restaurant still creates coverage', () => {
  const coverage = getPlatformCoverage(
    [restaurant({ supportsDelivery: false, supportsPickup: true })],
    PINNED
  );
  assert.equal(coverage.isCovered, true);
  assert.ok(coverage.nearestOrderableKm !== null && coverage.nearestOrderableKm < 5);
});

test('a restaurant that opts out of both delivery and pickup does not count as a candidate', () => {
  const coverage = getPlatformCoverage(
    [restaurant({ supportsDelivery: false, supportsPickup: false })],
    PINNED
  );
  // Zero eligible candidates -> fails open, but for a different reason than "in range":
  // this restaurant was correctly excluded from candidacy, not silently counted.
  assert.equal(coverage.isCovered, true);
  assert.equal(coverage.nearestOrderableKm, null);
});

test('an eligible restaurant that is out of range is still not covered (fail-open does not swallow the real gate)', () => {
  // Pickup-capable, has coordinates, so it IS an eligible candidate — but it's ~500km
  // away, well outside its service radius. This must gate normally.
  const far = restaurant({
    supportsDelivery: false,
    supportsPickup: true,
    latitude: 9.0765,
    longitude: 7.3986,
    deliveryRadiusKm: 5,
  });
  const coverage = getPlatformCoverage([far], PINNED);
  assert.equal(coverage.isCovered, false);
  assert.ok(coverage.nearestOrderableKm !== null && coverage.nearestOrderableKm > 400);
});

test('unpublished and empty-menu restaurants are excluded from candidacy, so the lone-candidate case fails open', () => {
  // Neither restaurant is visible to customers, so neither is an eligible candidate. With
  // zero eligible candidates and no other restaurant in the list, coverage fails open.
  assert.equal(getPlatformCoverage([restaurant({ isPublished: false })], PINNED).isCovered, true);
  assert.equal(getPlatformCoverage([restaurant({ menu: [] })], PINNED).isCovered, true);
});

test('the nearest orderable distance is the smallest across all candidates', () => {
  const near = restaurant({ id: 'near', latitude: 6.4600, longitude: 3.3900, deliveryRadiusKm: 1 });
  const far = restaurant({ id: 'far', latitude: 9.0765, longitude: 7.3986, deliveryRadiusKm: 1 });
  const coverage = getPlatformCoverage([far, near], PINNED);
  assert.ok(coverage.nearestOrderableKm !== null && coverage.nearestOrderableKm < 5);
});

test('live catalogue regression: delivery-capable restaurant without coordinates plus a far pickup-only restaurant with coordinates', () => {
  // Reproduces the production shape that caused the platform-wide outage: one restaurant
  // supports delivery but has no coordinates (not an eligible candidate), and one
  // restaurant is pickup-only with coordinates far from the pinned address (an eligible
  // candidate, but out of range). One eligible-but-out-of-range candidate exists, so this
  // must gate normally to NOT covered -- it is not the zero-candidate case.
  const deliveryNoCoords = restaurant({
    id: 'delivery-no-coords',
    supportsDelivery: true,
    latitude: null,
    longitude: null,
  });
  const pickupFar = restaurant({
    id: 'pickup-far',
    supportsDelivery: false,
    supportsPickup: true,
    latitude: 9.0765,
    longitude: 7.3986,
    deliveryRadiusKm: 5,
  });
  const coverage = getPlatformCoverage([deliveryNoCoords, pickupFar], PINNED);
  assert.equal(coverage.isCovered, false);
  assert.ok(coverage.nearestOrderableKm !== null && coverage.nearestOrderableKm > 400);
});

// --- card/client seam: customerGetRestaurantList cards have no `menu` key at
// all (unlike a full catalog entry, whose `menu` is present, possibly `[]`).
// This is the exact shape supabase/functions/public-catalog/catalog.ts's
// toRestaurantCard emits (id/name/cuisine/cuisines/image/logoImage/
// deliveryFee/deliveryTime/minOrder/latitude/longitude/deliveryRadiusKm/
// supportsDelivery/supportsPickup/isOpen/isPublished/updatedAt/
// ratingAverage/ratingCount, isPublished always literal true) — keep this
// fixture in sync with that function if its field set changes.
const card = (overrides: Partial<DiscoveryRestaurant> = {}): DiscoveryRestaurant => ({
  id: 'card-1',
  name: 'Card Kitchen',
  cuisine: 'Nigerian',
  cuisines: ['nigerian'],
  image: undefined,
  logoImage: null,
  deliveryFee: 500,
  deliveryTime: '25-35 min',
  minOrder: 1000,
  latitude: 6.46,
  longitude: 3.39,
  deliveryRadiusKm: 5,
  supportsDelivery: true,
  supportsPickup: true,
  isOpen: true,
  isPublished: true,
  updatedAt: '2026-08-01T00:00:00.000Z',
  ratingAverage: null,
  ratingCount: 0,
  ...overrides,
  // Deliberately after the spread and set (not omitted): the field being
  // read as `undefined` is what matters to isRestaurantVisibleToCustomers's
  // `restaurant.menu === undefined` check, and JSON.stringify drops an
  // `undefined` value the same as an absent key — this reproduces what a
  // real card looks like on the wire regardless of which JS shape it takes
  // in memory. A caller's overrides can never accidentally give this
  // fixture a real menu.
  menu: undefined,
});

test('a card (no menu key) is visible to customers — regression for the empty-home-feed defect', () => {
  // Before the fix, isRestaurantVisibleToCustomers checked isPublished
  // before the menu-undefined shim, and a card had no isPublished field
  // either -- isPublished !== true on undefined rejected every card,
  // emptying the home feed. This fixture matches the server's real card
  // shape (isPublished: true is now a literal on every card) end to end.
  assert.equal(isRestaurantVisibleToCustomers(card()), true);
});

test('a card is excluded only when the server itself marked it unpublished', () => {
  assert.equal(isRestaurantVisibleToCustomers(card({ isPublished: false })), false);
});

test('a full catalog entry (menu present) still needs the real has-available-item check', () => {
  assert.equal(isRestaurantVisibleToCustomers({ ...card(), menu: [] }), false);
  assert.equal(
    isRestaurantVisibleToCustomers({
      ...card(),
      menu: [{ category: 'Mains', items: [{ id: 'i1', name: 'Jollof', description: '', price: 2000, isAvailable: true }] }],
    }),
    true
  );
});

test('getPlatformCoverage: a card (no menu key) inside its delivery radius is covered — C2 regression', () => {
  // Before the fix, every card failed isRestaurantVisibleToCustomers (see
  // above), so eligibleCandidateCount stayed 0 and this silently fell into
  // the fail-open branch (isCovered: true) even for a customer far outside
  // every restaurant's radius, because there was nothing left to check
  // distance against. With the fix, a real in-range card is covered for the
  // right reason (it passed the eligibility gate and is within range).
  const coverage = getPlatformCoverage([card()], PINNED);
  assert.equal(coverage.isCovered, true);
  assert.ok(coverage.nearestOrderableKm !== null && coverage.nearestOrderableKm < 5);
});

test('getPlatformCoverage: a card (no menu key) outside every radius is correctly NOT covered — C2 regression', () => {
  // The scenario the review called out: a customer 60km+ outside every
  // restaurant's radius must see isCovered: false, not fail open because the
  // eligibility gate wrongly rejected the (menu-less) card.
  const far = card({ id: 'far-card', latitude: 9.0765, longitude: 7.3986, deliveryRadiusKm: 5 });
  const coverage = getPlatformCoverage([far], PINNED);
  assert.equal(coverage.isCovered, false);
  assert.ok(coverage.nearestOrderableKm !== null && coverage.nearestOrderableKm > 400);
});

// --- getRestaurantRatingLabel: the "New" threshold flips at ratingCount === 5 ---

test('getRestaurantRatingLabel: ratingCount 0 (no ratings at all) shows New', () => {
  assert.equal(getRestaurantRatingLabel({ ratingAverage: null, ratingCount: 0 }), 'New');
});

test('getRestaurantRatingLabel: one below the threshold (ratingCount 4) still shows New', () => {
  assert.equal(getRestaurantRatingLabel({ ratingAverage: 5, ratingCount: NEW_RESTAURANT_RATING_THRESHOLD - 1 }), 'New');
});

test('getRestaurantRatingLabel: exactly the threshold (ratingCount 5) shows the average, not New — the flip point', () => {
  const label = getRestaurantRatingLabel({ ratingAverage: 4.2, ratingCount: NEW_RESTAURANT_RATING_THRESHOLD });
  assert.notEqual(label, 'New');
  assert.equal(label, '4.2 ★ (5)');
});

test('getRestaurantRatingLabel: well above the threshold formats the average to one decimal with the count', () => {
  assert.equal(getRestaurantRatingLabel({ ratingAverage: 3.6667, ratingCount: 42 }), '3.7 ★ (42)');
});

test('getRestaurantRatingLabel: missing ratingAverage/ratingCount defaults to New (undefined count treated as 0)', () => {
  assert.equal(getRestaurantRatingLabel({ ratingAverage: undefined, ratingCount: undefined }), 'New');
});

test('zero eligible candidates because no restaurant has coordinates, but the catalogue is non-empty -> covered (live production scenario)', () => {
  // This is the exact defect scenario: 6 published restaurants, none of them both
  // coordinate-bearing AND orderable-eligible in a way that produces a candidate. Here we
  // model it as multiple restaurants, all missing coordinates -- a non-empty catalogue
  // with zero eligible candidates must fail open, not block every customer.
  const restaurants = [
    restaurant({ id: 'r1', supportsDelivery: true, latitude: null, longitude: null }),
    restaurant({ id: 'r2', supportsDelivery: false, supportsPickup: false, latitude: 6.46, longitude: 3.39 }),
    restaurant({ id: 'r3', latitude: null, longitude: null }),
    restaurant({ id: 'r4', latitude: null, longitude: null }),
  ];
  const coverage = getPlatformCoverage(restaurants, PINNED);
  assert.deepEqual(coverage, { isCovered: true, nearestOrderableKm: null });
});

// Regression: a typed address is stored with null coordinates on purpose
// (app/onboarding.tsx keeps the text and leaves geocoding to checkout). The
// guard used to read them with Number(), and Number(null) is 0 -- which is
// finite, so the unknown-location branch was skipped and the customer was
// placed at 0N 0E. Every restaurant with a real pin and a sane radius then
// reported 'does not deliver to your pinned address'.
const TYPED_ONLY = {
  address: '12 Roundabout Road, Badagry',
  latitude: null,
  longitude: null,
} as unknown as AddressRecord;

test('a typed address with no coordinates is unknown, not the origin of the coordinate system', () => {
  const availability = getRestaurantAvailability(restaurant(), TYPED_ONLY);
  assert.equal(availability.isAvailable, true, 'null coordinates must fail open, not place the customer at 0N 0E');
  assert.equal(availability.distanceKm, null);
  assert.equal(availability.radiusKm, null);
});

test('an explicit 0,0 pin is still honoured as a real coordinate', () => {
  const atOrigin = { address: 'Null Island', latitude: 0, longitude: 0 } as unknown as AddressRecord;
  const availability = getRestaurantAvailability(restaurant(), atOrigin);
  assert.equal(availability.isAvailable, false, 'Lagos is ~700km from 0,0, well outside a 5km radius');
});

test('a real pin inside the radius is unaffected by the null handling', () => {
  const availability = getRestaurantAvailability(restaurant(), PINNED);
  assert.equal(availability.isAvailable, true);
  assert.ok(availability.distanceKm !== null && availability.distanceKm < 5);
});

// The blank-home-screen regression. The shelf and the empty state were guarded by
// two unrelated predicates, so a visitor with no pinned address and a non-empty
// catalogue satisfied NEITHER and saw header chrome and nothing else.
test('a non-empty catalogue always renders the shelf, with or without a pinned address', () => {
  const pinned = getDiscoverySections({ availableCount: 2, hasDeliveryLocation: true });
  const unpinned = getDiscoverySections({ availableCount: 2, hasDeliveryLocation: false });

  assert.equal(pinned.showShelf, true);
  assert.equal(
    unpinned.showShelf,
    true,
    'no delivery location is not a reason to hide restaurants -- this is the blank-screen defect'
  );
});

test('the heading only claims proximity when there is a location to be near', () => {
  assert.equal(
    getDiscoverySections({ availableCount: 2, hasDeliveryLocation: true }).shelfTitle,
    'Near your delivery point'
  );
  assert.equal(
    getDiscoverySections({ availableCount: 2, hasDeliveryLocation: false }).shelfTitle,
    'All restaurants'
  );
});

test('an empty list renders the empty state instead of the shelf', () => {
  const sections = getDiscoverySections({ availableCount: 0, hasDeliveryLocation: false });
  assert.equal(sections.showShelf, false);
  assert.equal(sections.showEmptyState, true);
});

test('THE INVARIANT: exactly one of the shelf and the empty state ever renders', () => {
  for (const availableCount of [0, 1, 2, 50]) {
    for (const hasDeliveryLocation of [true, false]) {
      const { showShelf, showEmptyState } = getDiscoverySections({ availableCount, hasDeliveryLocation });
      assert.notEqual(
        showShelf,
        showEmptyState,
        `both gates agreed for availableCount=${availableCount} hasDeliveryLocation=${hasDeliveryLocation};` +
          ' that is the hole that rendered a blank screen'
      );
    }
  }
});
