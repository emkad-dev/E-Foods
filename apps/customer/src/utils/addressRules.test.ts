/**
 * Run with: node --test --experimental-strip-types apps/customer/src/utils/addressRules.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { AddressRecord } from '../domain/entities.ts';
import { COLLECTION_WARNING_KM, exceedsCollectionLimit, getCollectionDistanceWarning } from './collectionDistance.ts';
import {
  hasLaunchAddressPromptBeenShown,
  markLaunchAddressPromptShown,
  shouldShowLaunchAddressPrompt,
} from './launchAddressPrompt.ts';
import { type DiscoveryRestaurant } from './restaurantAvailability.ts';
import { hasSavedAddress } from './savedAddress.ts';

const address = (overrides: Partial<AddressRecord> = {}): AddressRecord => ({
  address: '12 Broad Street, Lagos',
  latitude: 6.455,
  longitude: 3.3841,
  ...overrides,
});

const ORIGIN = { latitude: 6.455, longitude: 3.3841 };
// Same meridian, so the distance is purely a latitude difference.
const restaurantAtKm = (km: number, id = 'r'): DiscoveryRestaurant => ({
  id,
  name: id,
  latitude: ORIGIN.latitude + km / 111.19492664455873,
  longitude: ORIGIN.longitude,
});

test('hasSavedAddress: coordinates, typed address, and the empty cases', () => {
  assert.equal(hasSavedAddress(null), false);
  assert.equal(hasSavedAddress(undefined), false);
  assert.equal(hasSavedAddress(address()), true);
  // A typed address has null coordinates and still counts.
  assert.equal(hasSavedAddress(address({ latitude: null, longitude: null })), true);
  assert.equal(hasSavedAddress(address({ latitude: 0, longitude: 0, address: '  ' })), false);
  assert.equal(hasSavedAddress(address({ latitude: null, longitude: null, address: '' })), false);
  // Usable coordinates alone are enough even with no text.
  assert.equal(hasSavedAddress(address({ address: '' })), true);
});

const baseInput = {
  accountFlowSettled: true,
  alreadyShownThisLaunch: false,
  cartHydrated: true,
  deliveryLocation: null,
  onHome: true,
};

test('launch prompt: shows only when hydrated, settled, on Home, unshown and no address', () => {
  assert.equal(shouldShowLaunchAddressPrompt(baseInput), true);
  assert.equal(shouldShowLaunchAddressPrompt({ ...baseInput, deliveryLocation: address() }), false);
  assert.equal(
    shouldShowLaunchAddressPrompt({ ...baseInput, deliveryLocation: address({ latitude: null, longitude: null }) }),
    false
  );
  assert.equal(shouldShowLaunchAddressPrompt({ ...baseInput, cartHydrated: false }), false);
  assert.equal(shouldShowLaunchAddressPrompt({ ...baseInput, alreadyShownThisLaunch: true }), false);
  assert.equal(shouldShowLaunchAddressPrompt({ ...baseInput, onHome: false }), false);
  assert.equal(shouldShowLaunchAddressPrompt({ ...baseInput, accountFlowSettled: false }), false);
});

test('launch prompt: shown flag is in memory and starts false', () => {
  assert.equal(hasLaunchAddressPromptBeenShown(), false);
  markLaunchAddressPromptShown();
  assert.equal(hasLaunchAddressPromptBeenShown(), true);
});

const warn = (
  restaurants: (DiscoveryRestaurant | null)[],
  overrides: Partial<Parameters<typeof getCollectionDistanceWarning>[0]> = {}
) =>
  getCollectionDistanceWarning({
    deliveryLocation: address(),
    fulfillmentType: 'pickup',
    restaurants,
    ...overrides,
  });

test('collection warning: boundary at 50 km is strict', () => {
  assert.equal(COLLECTION_WARNING_KM, 50);
  assert.equal(warn([restaurantAtKm(0)]), null);
  assert.equal(warn([restaurantAtKm(49.9)]), null);
  // The comparison itself, free of floating-point fixtures: a >= mutation fails here.
  assert.equal(exceedsCollectionLimit(50), false);
  assert.equal(exceedsCollectionLimit(50.000001), true);
  assert.equal(exceedsCollectionLimit(49.999999), false);
  assert.equal(warn([restaurantAtKm(50 - 1e-6)]), null);
  const just = warn([restaurantAtKm(50.6)]);
  assert.ok(just);
  assert.equal(just.message, 'This restaurant is 51 km away. Are you sure?');
});

test('collection warning: rounds UP so an over-limit distance never reads 50', () => {
  const result = warn([restaurantAtKm(50.4)]);
  assert.ok(result);
  assert.equal(result.displayKm, 51);
  assert.equal(result.message, 'This restaurant is 51 km away. Are you sure?');
});

test('collection warning: mixed basket uses the farthest restaurant', () => {
  const result = warn([restaurantAtKm(10, 'near'), restaurantAtKm(120, 'far'), restaurantAtKm(70, 'mid')]);
  assert.ok(result);
  assert.equal(result.displayKm, 120);
});

test('collection warning: missing and 0,0 coordinates are ignored', () => {
  const noCoords: DiscoveryRestaurant = { id: 'x', name: 'x' };
  const zero: DiscoveryRestaurant = { id: 'z', name: 'z', latitude: 0, longitude: 0 };
  assert.equal(warn([noCoords, zero, null]), null);
  const result = warn([noCoords, zero, restaurantAtKm(80)]);
  assert.ok(result);
  assert.equal(result.displayKm, 80);
});

test('collection warning: no usable address coordinates means no warning', () => {
  const far = restaurantAtKm(500);
  assert.equal(warn([far], { deliveryLocation: null }), null);
  assert.equal(warn([far], { deliveryLocation: address({ latitude: null, longitude: null }) }), null);
  assert.equal(warn([far], { deliveryLocation: address({ latitude: 0, longitude: 0 }) }), null);
});

test('collection warning: delivery never warns', () => {
  assert.equal(warn([restaurantAtKm(500)], { fulfillmentType: 'delivery' }), null);
});
