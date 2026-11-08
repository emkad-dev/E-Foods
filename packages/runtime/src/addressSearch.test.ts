/**
 * Run with: node --test --experimental-strip-types packages/runtime/src/addressSearch.test.ts
 *
 * No network: every request goes to an injected fetch. Generic place names only.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ADDRESS_SEARCH_MAX_LENGTH,
  DEFAULT_GEOCODE_URL,
  buildAddressSearchRequestUrl,
  normalizeSearchQuery,
  parseAddressSuggestions,
  resolveGeocodeBaseUrl,
  searchAddresses,
} from './addressSearch.ts';

const MARKET = { label: 'Bodija Market, Ibadan', latitude: 7.4352, longitude: 3.9133 };

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('resolveGeocodeBaseUrl: env value when it is an http(s) URL, the production Worker otherwise', () => {
  assert.equal(DEFAULT_GEOCODE_URL, 'https://geo.feasty.com.ng');
  assert.equal(resolveGeocodeBaseUrl(undefined), DEFAULT_GEOCODE_URL);
  assert.equal(resolveGeocodeBaseUrl(null), DEFAULT_GEOCODE_URL);
  assert.equal(resolveGeocodeBaseUrl('   '), DEFAULT_GEOCODE_URL);
  assert.equal(resolveGeocodeBaseUrl('geo.example.test'), DEFAULT_GEOCODE_URL);
  assert.equal(resolveGeocodeBaseUrl('javascript:alert(1)'), DEFAULT_GEOCODE_URL);
  assert.equal(resolveGeocodeBaseUrl(' http://localhost:8787/ '), 'http://localhost:8787');
  assert.equal(resolveGeocodeBaseUrl('https://geo.example.test//'), 'https://geo.example.test');
});

test('normalizeSearchQuery gates on 3 characters, collapses whitespace and caps the length', () => {
  assert.equal(normalizeSearchQuery(''), null);
  assert.equal(normalizeSearchQuery('  ab  '), null);
  assert.equal(normalizeSearchQuery('a  b'), 'a b');
  assert.equal(normalizeSearchQuery('  Bodija \n  Market '), 'Bodija Market');
  assert.equal(normalizeSearchQuery('x'.repeat(500))?.length, ADDRESS_SEARCH_MAX_LENGTH);
});

test('buildAddressSearchRequestUrl encodes the query and clamps the limit to 1-5', () => {
  const url = new URL(buildAddressSearchRequestUrl('https://geo.example.test/', 'Ring Road & Co', 9));
  assert.equal(url.origin + url.pathname, 'https://geo.example.test/search');
  assert.equal(url.searchParams.get('q'), 'Ring Road & Co');
  assert.equal(url.searchParams.get('limit'), '5');
  assert.equal(new URL(buildAddressSearchRequestUrl(DEFAULT_GEOCODE_URL, 'Yaba', 0)).searchParams.get('limit'), '1');
});

test('parseAddressSuggestions keeps only labelled, usable pins, at most the limit', () => {
  assert.deepEqual(parseAddressSuggestions({ results: [MARKET] }), [MARKET]);
  assert.deepEqual(
    parseAddressSuggestions({
      results: [
        null,
        'x',
        { label: '', latitude: 7, longitude: 3 },
        { label: 'Null Island', latitude: 0, longitude: 0 },
        { label: 'Off the map', latitude: 95, longitude: 3 },
        { label: 'String coords', latitude: '7.1', longitude: '3.1' },
        MARKET,
      ],
    }),
    [MARKET]
  );
  const many = { results: Array.from({ length: 8 }, (_, i) => ({ ...MARKET, label: `Place ${i}` })) };
  assert.equal(parseAddressSuggestions(many)?.length, 5);
  assert.equal(parseAddressSuggestions(many, 2)?.length, 2);
});

test('parseAddressSuggestions answers null for a body that is not the contract', () => {
  for (const payload of [null, undefined, [], 'oops', 42, {}, { results: 'nope' }]) {
    assert.equal(parseAddressSuggestions(payload), null);
  }
  assert.deepEqual(parseAddressSuggestions({ results: [] }), []);
});

test('searchAddresses returns the Worker suggestions on a 200', async () => {
  let requested = '';
  const result = await searchAddresses('Bodija Market', {
    baseUrl: 'https://geo.example.test',
    fetchImpl: async (input) => {
      requested = String(input);
      return jsonResponse(200, { results: [MARKET] });
    },
  });

  assert.deepEqual(result, { kind: 'results', results: [MARKET] });
  assert.equal(requested, 'https://geo.example.test/search?q=Bodija+Market&limit=5');
});

test('searchAddresses never sends a query that is too short', async () => {
  let calls = 0;
  const result = await searchAddresses('ab', {
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse(200, { results: [MARKET] });
    },
  });

  assert.equal(calls, 0);
  assert.deepEqual(result, { kind: 'results', results: [] });
});

test('every non-200 is the unavailable signal', async () => {
  for (const status of [201, 400, 429, 500, 503]) {
    const result = await searchAddresses('Bodija', { fetchImpl: async () => jsonResponse(status, {}) });
    assert.deepEqual(result, { kind: 'unavailable', reason: 'http' });
  }
});

test('a body that is not the contract is the unavailable signal', async () => {
  const wrongShape = await searchAddresses('Bodija', { fetchImpl: async () => jsonResponse(200, ['x']) });
  assert.deepEqual(wrongShape, { kind: 'unavailable', reason: 'invalid' });

  const notJson = await searchAddresses('Bodija', {
    fetchImpl: async () => new Response('<html>blocked</html>', { status: 200 }),
  });
  assert.deepEqual(notJson, { kind: 'unavailable', reason: 'invalid' });
});

test('a transport failure is the unavailable signal', async () => {
  const result = await searchAddresses('Bodija', {
    fetchImpl: async () => {
      throw new TypeError('Network request failed');
    },
  });
  assert.deepEqual(result, { kind: 'unavailable', reason: 'network' });
});

/** A fetch that only settles when its signal aborts, the way a hung request behaves. */
const hangingFetch: typeof fetch = (_input, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });

test('a slow Worker times out into the unavailable signal', async () => {
  const startedAt = Date.now();
  const result = await searchAddresses('Bodija', { fetchImpl: hangingFetch, timeoutMs: 30 });

  assert.deepEqual(result, { kind: 'unavailable', reason: 'timeout' });
  assert.ok(Date.now() - startedAt < 1000);
});

test('the caller cancelling is reported as aborted, not as a failing service', async () => {
  const controller = new AbortController();
  const pending = searchAddresses('Bodija', { fetchImpl: hangingFetch, signal: controller.signal, timeoutMs: 5000 });
  controller.abort();
  assert.deepEqual(await pending, { kind: 'unavailable', reason: 'aborted' });

  let calls = 0;
  const already = new AbortController();
  already.abort();
  const skipped = await searchAddresses('Bodija', {
    signal: already.signal,
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse(200, { results: [] });
    },
  });
  assert.equal(calls, 0);
  assert.deepEqual(skipped, { kind: 'unavailable', reason: 'aborted' });
});
