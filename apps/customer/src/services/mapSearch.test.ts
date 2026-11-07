/**
 * Run with: node --test --experimental-strip-types apps/customer/src/services/mapSearch.test.ts
 *
 * No network: both geocoders are stubs. Generic place names only.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { AddressLookupOutcome } from '../../../../packages/runtime/src/nominatimSearch.ts';
import {
  CUSTOMER_NOMINATIM_USER_AGENT,
  fromDevicePoints,
  fromNominatimOutcome,
  runMapSearch,
  toDeviceGeocodeQuery,
} from './mapSearch.ts';

const MATCH = { latitude: 7.4352, longitude: 3.9133, placeName: 'Bodija Market, Ibadan' };
const found = (count = 1): AddressLookupOutcome => {
  const matches = Array.from({ length: count }, (_, i) => ({ ...MATCH, placeName: `Place ${i}` }));
  return { kind: 'found', match: matches[0]!, matches };
};

test('toDeviceGeocodeQuery biases the device geocoder to Nigeria once', () => {
  assert.equal(toDeviceGeocodeQuery('  Bodija   Market '), 'Bodija Market, Nigeria');
  assert.equal(toDeviceGeocodeQuery('Bodija, Ibadan, Nigeria'), 'Bodija, Ibadan, Nigeria');
});

test('fromDevicePoints keeps the first point inside the service area, labelled approximate', () => {
  assert.deepEqual(
    fromDevicePoints(' Bodija  Market ', [
      { latitude: 0, longitude: 0 },
      { latitude: 9.0765, longitude: 7.3986 }, // Abuja: outside the service area
      { latitude: 7.4352, longitude: 3.9133 },
      { latitude: 7.401, longitude: 3.917 },
    ]),
    [{ label: 'Bodija Market (approximate)', latitude: 7.4352, longitude: 3.9133 }]
  );
  assert.deepEqual(fromDevicePoints('Bodija Market', [{ latitude: 51.5, longitude: -0.12 }]), []);
});

test('fromNominatimOutcome: matches, nothing found, and failures', () => {
  const results = fromNominatimOutcome(found(7));
  assert.equal(results.kind, 'results');
  assert.equal(results.kind === 'results' && results.results.length, 5);
  assert.deepEqual(fromNominatimOutcome({ kind: 'no-result' }), { kind: 'results', results: [] });
  for (const kind of ['offline', 'timeout', 'unavailable'] as const) {
    assert.deepEqual(fromNominatimOutcome({ kind }), { kind: 'failed' });
  }
});

test('without a device geocoder (web, iOS) Nominatim is asked once', async () => {
  const asked: string[] = [];
  const result = await runMapSearch('Bodija Market', {
    nominatim: async (query) => {
      asked.push(query);
      return found(2);
    },
  });
  assert.deepEqual(asked, ['Bodija Market']);
  assert.equal(result.kind === 'results' && result.results.length, 2);
});

test('on Android the device geocoder goes first and, when it finds something, Nominatim is not asked', async () => {
  let nominatimCalls = 0;
  const result = await runMapSearch('Bodija Market', {
    deviceGeocode: async (query) => {
      assert.equal(query, 'Bodija Market, Nigeria');
      return [{ latitude: 7.4352, longitude: 3.9133 }];
    },
    nominatim: async () => {
      nominatimCalls += 1;
      return found();
    },
  });
  assert.equal(nominatimCalls, 0);
  assert.deepEqual(result, {
    kind: 'results',
    results: [{ label: 'Bodija Market (approximate)', latitude: 7.4352, longitude: 3.9133 }],
  });
});

test('a device geocoder that throws or finds nothing falls through to Nominatim', async () => {
  for (const deviceGeocode of [
    async () => {
      throw new Error('E_NO_GEOCODER');
    },
    async () => [],
    async () => [{ latitude: 0, longitude: 0 }],
    async () => [{ latitude: 51.5, longitude: -0.12 }],
  ]) {
    const result = await runMapSearch('Bodija Market', { deviceGeocode, nominatim: async () => found() });
    assert.equal(result.kind === 'results' && result.results[0]?.label, 'Place 0');
  }
});

test('everything failing is one failed result, never a throw', async () => {
  const result = await runMapSearch('Bodija Market', {
    deviceGeocode: async () => {
      throw new Error('no');
    },
    nominatim: async () => {
      throw new Error('boom');
    },
  });
  assert.deepEqual(result, { kind: 'failed' });
});

test('the customer User-Agent names the app and a contact', () => {
  assert.match(CUSTOMER_NOMINATIM_USER_AGENT, /^FEASTY\/\d/);
  assert.match(CUSTOMER_NOMINATIM_USER_AGENT, /\(https:\/\/feasty\.com\.ng\)/);
});
