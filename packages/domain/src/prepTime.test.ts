/**
 * Run with: node --test --experimental-strip-types packages/domain/src/prepTime.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildRestaurantPrepTimeEstimate,
  computeMedianMinutes,
  parsePrepFallbackMinutes,
} from './prepTime.ts';

test('computeMedianMinutes returns the middle value for an odd-sized set', () => {
  assert.equal(computeMedianMinutes([11, 9, 15, 13, 17]), 13);
});

test('computeMedianMinutes averages the middle pair for an even-sized set', () => {
  assert.equal(computeMedianMinutes([20, 10, 30, 40]), 25);
});

test('buildRestaurantPrepTimeEstimate falls back to static deliveryTime before 20 samples exist', () => {
  const result = buildRestaurantPrepTimeEstimate({
    acceptedAtIso: '2026-08-27T10:10:00.000Z',
    fallbackDeliveryTime: '25-35 min',
    samples: [
      ...Array.from({ length: 19 }, (_, index) => ({
        acceptedAtIso: `2026-08-27T10:${String(5 + index).padStart(2, '0')}:00.000Z`,
        readyAtIso: `2026-08-27T10:${String(17 + index).padStart(2, '0')}:00.000Z`,
      })),
    ],
  });

  assert.equal(result.source, 'fallback');
  assert.equal(result.sampleCount, 19);
  assert.equal(result.minutes, 30);
});

test('buildRestaurantPrepTimeEstimate uses only the matching hour bucket', () => {
  const result = buildRestaurantPrepTimeEstimate({
    acceptedAtIso: '2026-08-27T11:10:00.000Z',
    fallbackDeliveryTime: '25-35 min',
    samples: [
      ...Array.from({ length: 20 }, (_, index) => ({
        acceptedAtIso: `2026-08-27T11:${String(index).padStart(2, '0')}:00.000Z`,
        readyAtIso: `2026-08-27T11:${String(index + 12).padStart(2, '0')}:00.000Z`,
      })),
      ...Array.from({ length: 20 }, (_, index) => ({
        acceptedAtIso: `2026-08-27T12:${String(index).padStart(2, '0')}:00.000Z`,
        readyAtIso: `2026-08-27T12:${String(index + 30).padStart(2, '0')}:00.000Z`,
      })),
    ],
  });

  assert.equal(result.source, 'median');
  assert.equal(result.sampleCount, 20);
  assert.equal(result.minutes, 12);
});

test('parsePrepFallbackMinutes parses a deliveryTime range into a midpoint', () => {
  assert.equal(parsePrepFallbackMinutes('25-35 min'), 30);
});
