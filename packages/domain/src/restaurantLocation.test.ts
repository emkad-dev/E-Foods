/**
 * Run with: node --test --experimental-strip-types packages/domain/src/restaurantLocation.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isSafeServerMessage } from '../../observability/src/userMessage.ts';
import {
  RESTAURANT_LOCATION_REQUIRED_MESSAGE,
  isPublishBlockedByLocation,
  isUsableCoordinatePair,
} from './restaurantLocation.ts';

test('a normal Lagos coordinate is usable', () => {
  assert.equal(isUsableCoordinatePair(6.5244, 3.3792), true);
});

test('southern and western hemispheres and the exact range limits are usable', () => {
  assert.equal(isUsableCoordinatePair(-33.9, -70.6), true);
  assert.equal(isUsableCoordinatePair(90, 180), true);
  assert.equal(isUsableCoordinatePair(-90, -180), true);
});

test('0,0 is never a location, but a zero on one axis is', () => {
  assert.equal(isUsableCoordinatePair(0, 0), false);
  assert.equal(isUsableCoordinatePair(0, 3.4), true);
  assert.equal(isUsableCoordinatePair(6.5, 0), true);
});

test('missing, partial and non-numeric values are not usable', () => {
  assert.equal(isUsableCoordinatePair(null, null), false);
  assert.equal(isUsableCoordinatePair(undefined, undefined), false);
  assert.equal(isUsableCoordinatePair(6.5, null), false);
  assert.equal(isUsableCoordinatePair(null, 3.4), false);
  assert.equal(isUsableCoordinatePair('6.5', '3.4'), false);
  assert.equal(isUsableCoordinatePair('', ''), false);
});

test('NaN and infinities are not usable', () => {
  assert.equal(isUsableCoordinatePair(Number.NaN, 3.4), false);
  assert.equal(isUsableCoordinatePair(6.5, Number.POSITIVE_INFINITY), false);
  assert.equal(isUsableCoordinatePair(Number.NEGATIVE_INFINITY, 3.4), false);
});

test('out-of-range values are not usable', () => {
  assert.equal(isUsableCoordinatePair(90.0001, 3.4), false);
  assert.equal(isUsableCoordinatePair(-90.5, 3.4), false);
  assert.equal(isUsableCoordinatePair(6.5, 180.01), false);
  assert.equal(isUsableCoordinatePair(6.5, -181), false);
});

const LOCATED = { latitude: 6.5244, longitude: 3.3792 };
const UNLOCATED = { latitude: null, longitude: null };

test('publishing a new restaurant with no row is blocked without coordinates and allowed with them', () => {
  assert.equal(isPublishBlockedByLocation(null, { isPublished: true, ...UNLOCATED }), true);
  assert.equal(isPublishBlockedByLocation(null, { isPublished: true, ...LOCATED }), false);
});

test('flipping an unpublished restaurant to published needs coordinates in the resulting row', () => {
  const current = { isPublished: false, ...UNLOCATED };
  assert.equal(isPublishBlockedByLocation(current, { isPublished: true, ...UNLOCATED }), true);
  assert.equal(isPublishBlockedByLocation(current, { isPublished: true, ...LOCATED }), false);
  assert.equal(isPublishBlockedByLocation(current, { isPublished: true, latitude: 0, longitude: 0 }), true);
});

test('an unpublished restaurant that already has coordinates can be published unchanged', () => {
  const current = { isPublished: false, ...LOCATED };
  assert.equal(isPublishBlockedByLocation(current, { isPublished: true, ...LOCATED }), false);
});

test('clearing the coordinates of a published restaurant that has them is blocked', () => {
  const current = { isPublished: true, ...LOCATED };
  assert.equal(isPublishBlockedByLocation(current, { isPublished: true, ...UNLOCATED }), true);
  assert.equal(isPublishBlockedByLocation(current, { isPublished: true, latitude: 0, longitude: 0 }), true);
});

test('saving other details on a published restaurant with coordinates is allowed', () => {
  const current = { isPublished: true, ...LOCATED };
  assert.equal(isPublishBlockedByLocation(current, { isPublished: true, ...LOCATED }), false);
});

test('an already-published restaurant without coordinates is not newly blocked', () => {
  const current = { isPublished: true, ...UNLOCATED };
  assert.equal(isPublishBlockedByLocation(current, { isPublished: true, ...UNLOCATED }), false);
  assert.equal(isPublishBlockedByLocation(current, { isPublished: true, ...LOCATED }), false);
});

test('unpublishing is never blocked, whatever the coordinates', () => {
  assert.equal(
    isPublishBlockedByLocation({ isPublished: true, ...LOCATED }, { isPublished: false, ...UNLOCATED }),
    false
  );
  assert.equal(
    isPublishBlockedByLocation({ isPublished: false, ...UNLOCATED }, { isPublished: false, ...UNLOCATED }),
    false
  );
});

test('the message tells the owner what to do', () => {
  assert.match(RESTAURANT_LOCATION_REQUIRED_MESSAGE, /location/i);
  assert.match(RESTAURANT_LOCATION_REQUIRED_MESSAGE, /Store details/);
});

test('the message survives the 4xx screen, so partners and admins read it instead of a generic fallback', () => {
  assert.equal(isSafeServerMessage(RESTAURANT_LOCATION_REQUIRED_MESSAGE), true);
});
