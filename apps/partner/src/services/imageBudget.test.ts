/**
 * Run with: node --test --experimental-strip-types apps/partner/src/services/imageBudget.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_DIMENSION,
  MAX_UPLOAD_BYTES,
  formatKb,
  isWithinBudget,
  resolveTargetDimensions,
} from './imageBudget.js';

test('landscape photos scale by their longest edge', () => {
  // A typical 12 MP phone photo, 4:3.
  assert.deepEqual(resolveTargetDimensions({ width: 4032, height: 3024 }), {
    width: 1600,
    height: 1200,
  });
});

test('portrait photos scale by height, not width', () => {
  assert.deepEqual(resolveTargetDimensions({ width: 3024, height: 4032 }), {
    width: 1200,
    height: 1600,
  });
});

test('the 16:9 cover crop keeps its aspect ratio', () => {
  assert.deepEqual(resolveTargetDimensions({ width: 3840, height: 2160 }), {
    width: 1600,
    height: 900,
  });
});

test('square logos stay square', () => {
  assert.deepEqual(resolveTargetDimensions({ width: 2400, height: 2400 }), {
    width: 1600,
    height: 1600,
  });
});

test('images already within the cap are left untouched', () => {
  assert.deepEqual(resolveTargetDimensions({ width: 800, height: 450 }), {
    width: 800,
    height: 450,
  });
});

test('small images are never upscaled', () => {
  // A 200px logo must not be blown up to 1600 — that would invent detail and
  // grow the upload rather than shrink it.
  assert.deepEqual(resolveTargetDimensions({ width: 200, height: 120 }), {
    width: 200,
    height: 120,
  });
});

test('an image exactly at the cap is unchanged', () => {
  assert.deepEqual(resolveTargetDimensions({ width: MAX_DIMENSION, height: 400 }), {
    width: MAX_DIMENSION,
    height: 400,
  });
});

test('dimensions never round down to zero', () => {
  // Extreme panorama: the short edge must stay renderable.
  const result = resolveTargetDimensions({ width: 20000, height: 5 });
  assert.equal(result.width, MAX_DIMENSION);
  assert.ok(result.height >= 1, 'height must not collapse to 0');
});

test('unusable dimensions are passed through rather than guessed at', () => {
  assert.deepEqual(resolveTargetDimensions({ width: 0, height: 0 }), { width: 0, height: 0 });
  assert.deepEqual(resolveTargetDimensions({ width: Number.NaN, height: 10 }), {
    width: Number.NaN,
    height: 10,
  });
});

test('a custom cap is honoured', () => {
  assert.deepEqual(resolveTargetDimensions({ width: 2000, height: 1000 }, 500), {
    width: 500,
    height: 250,
  });
});

test('budget check is inclusive of the limit', () => {
  assert.equal(isWithinBudget(MAX_UPLOAD_BYTES), true);
  assert.equal(isWithinBudget(MAX_UPLOAD_BYTES + 1), false);
  assert.equal(isWithinBudget(0), true);
});

test('formatKb renders whole kilobytes', () => {
  assert.equal(formatKb(307200), '300 kB');
  assert.equal(formatKb(65536), '64 kB');
});
