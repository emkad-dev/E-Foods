/**
 * Run with: node --test --experimental-strip-types packages/domain/src/serviceArea.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { SERVICE_AREA_BBOX, SERVICE_AREA_BBOX_STRING, isInsideServiceArea } from './serviceArea.ts';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');

test('the Worker restricts suggestions to the same box the apps use', () => {
  const wrangler = fs.readFileSync(path.join(repoRoot, 'cloudflare/geocode/wrangler.jsonc'), 'utf8');
  const configured = wrangler.match(/"SERVICE_BBOX"\s*:\s*"([^"]+)"/)?.[1];
  assert.equal(configured, SERVICE_AREA_BBOX_STRING);
  assert.equal(SERVICE_AREA_BBOX_STRING, '2.6,6.2,4.4,7.9');
});

test('isInsideServiceArea: inside, on the edges, outside and non-finite', () => {
  assert.equal(isInsideServiceArea(7.4352, 3.9133), true); // Ibadan
  assert.equal(isInsideServiceArea(6.455, 3.3841), true); // Lagos Island
  assert.equal(isInsideServiceArea(SERVICE_AREA_BBOX.minLat, SERVICE_AREA_BBOX.minLon), true);
  assert.equal(isInsideServiceArea(SERVICE_AREA_BBOX.maxLat, SERVICE_AREA_BBOX.maxLon), true);
  assert.equal(isInsideServiceArea(9.0765, 7.3986), false); // Abuja
  assert.equal(isInsideServiceArea(51.5, -0.12), false);
  assert.equal(isInsideServiceArea(Number.NaN, 3.9), false);
});
