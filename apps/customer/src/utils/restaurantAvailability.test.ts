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
  assert.ok(coverage.nearestDeliverableKm !== null && coverage.nearestDeliverableKm < 5);
});

test('pinned address outside every radius is not covered but reports the nearest kitchen', () => {
  // Abuja, ~500km from the pinned Lagos address.
  const far = restaurant({ latitude: 9.0765, longitude: 7.3986, deliveryRadiusKm: 5 });
  const coverage = getPlatformCoverage([far], PINNED);
  assert.equal(coverage.isCovered, false);
  assert.ok(coverage.nearestDeliverableKm !== null && coverage.nearestDeliverableKm > 400);
});

test('no pinned address is treated as covered', () => {
  const coverage = getPlatformCoverage([restaurant()], null);
  assert.deepEqual(coverage, { isCovered: true, nearestDeliverableKm: null });
});

test('a restaurant without coordinates is skipped entirely', () => {
  const coverage = getPlatformCoverage([restaurant({ latitude: null, longitude: null })], PINNED);
  assert.deepEqual(coverage, { isCovered: false, nearestDeliverableKm: null });
});

test('a zero radius falls back to the 12km default rather than blocking', () => {
  // ~7km from the pinned address: outside a literal 0km radius, inside the 12km fallback.
  const nearby = restaurant({ latitude: 6.5170, longitude: 3.3841, deliveryRadiusKm: 0 });
  assert.equal(getPlatformCoverage([nearby], PINNED).isCovered, true);
});

test('a delivery-disabled restaurant does not create coverage', () => {
  const coverage = getPlatformCoverage([restaurant({ supportsDelivery: false })], PINNED);
  assert.equal(coverage.isCovered, false);
});

test('unpublished and empty-menu restaurants do not create coverage', () => {
  assert.equal(getPlatformCoverage([restaurant({ isPublished: false })], PINNED).isCovered, false);
  assert.equal(getPlatformCoverage([restaurant({ menu: [] })], PINNED).isCovered, false);
});

test('the nearest deliverable distance is the smallest across all candidates', () => {
  const near = restaurant({ id: 'near', latitude: 6.4600, longitude: 3.3900, deliveryRadiusKm: 1 });
  const far = restaurant({ id: 'far', latitude: 9.0765, longitude: 7.3986, deliveryRadiusKm: 1 });
  const coverage = getPlatformCoverage([far, near], PINNED);
  assert.ok(coverage.nearestDeliverableKm !== null && coverage.nearestDeliverableKm < 5);
});
