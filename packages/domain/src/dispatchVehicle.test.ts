/**
 * Run with: node --test packages/domain/src/dispatchVehicle.test.ts
 * (Node 22.6+ strips types natively; no build step.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isVehicleDetailRequired, VEHICLE_TYPES_WITH_OPTIONAL_DETAILS } from './dispatchVehicle.ts';

test('vehicle details are optional for a bike or scooter', () => {
  for (const vehicleType of VEHICLE_TYPES_WITH_OPTIONAL_DETAILS) {
    assert.equal(isVehicleDetailRequired(vehicleType), false);
  }
});

test('vehicle details stay required for a car or van', () => {
  for (const vehicleType of ['Car', 'Van']) {
    assert.equal(isVehicleDetailRequired(vehicleType), true);
  }
});

test('an empty, null, or undefined vehicle type is treated as requiring details', () => {
  assert.equal(isVehicleDetailRequired(''), true);
  assert.equal(isVehicleDetailRequired('   '), true);
  assert.equal(isVehicleDetailRequired(null), true);
  assert.equal(isVehicleDetailRequired(undefined), true);
});
