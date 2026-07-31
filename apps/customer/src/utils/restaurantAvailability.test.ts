/**
 * Run with: node --test apps/customer/src/utils/restaurantAvailability.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getPlatformCoverage, type DiscoveryRestaurant } from './restaurantAvailability.ts';
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
  menu: [{ category: 'Mains', items: [{ id: 'item-1', name: 'Jollof', price: 2000, isAvailable: true }] }],
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
