/**
 * Run with: node --test --experimental-strip-types packages/runtime/src/nominatimSearch.test.ts
 *
 * The parsing and outcome mapping are also pinned by the partner's own suite
 * (apps/partner/src/domain/addressLookup.test.ts), which re-exports them; this
 * file covers what the customer fallback added: several matches per request,
 * the optional User-Agent, and the fetch wrapper itself. No network.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ADDRESS_LOOKUP_MIN_INTERVAL_MS,
  NOMINATIM_MIN_QUERY_LENGTH,
  buildAddressSearchUrl,
  findAddressMatches,
  outcomeFromResponse,
  parseGeocodeMatches,
  parseGeocodeResults,
} from './nominatimSearch.ts';

const entry = (name: string, lat = '7.4352', lon = '3.9133') => ({ lat, lon, display_name: name });

/**
 * A manual clock shared by every call in this file. Each test starts far past
 * the last one, so the module's spacing never makes a test really wait, and
 * `sleep` advances the clock instead of the wall time.
 */
let clock = 0;
const waits: number[] = [];
const fakeTime = () => {
  clock += 10 * ADDRESS_LOOKUP_MIN_INTERVAL_MS;
  waits.length = 0;
  return {
    now: () => clock,
    sleep: async (ms: number) => {
      waits.push(ms);
      clock += ms;
    },
  };
};

test('buildAddressSearchUrl defaults to one result and clamps a larger ask to five', () => {
  assert.equal(new URL(buildAddressSearchUrl('Bodija Market')).searchParams.get('limit'), '1');
  assert.equal(new URL(buildAddressSearchUrl('Bodija Market', 3)).searchParams.get('limit'), '3');
  assert.equal(new URL(buildAddressSearchUrl('Bodija Market', 50)).searchParams.get('limit'), '5');
  assert.equal(new URL(buildAddressSearchUrl('Bodija Market', 50)).searchParams.get('countrycodes'), 'ng');
});

test('parseGeocodeMatches keeps usable entries in order, at most the limit', () => {
  const payload = [entry('A'), entry('Null', '0', '0'), entry('B'), entry('C')];
  assert.deepEqual(
    parseGeocodeMatches(payload, 5).map((match) => match.placeName),
    ['A', 'B', 'C']
  );
  assert.deepEqual(
    parseGeocodeMatches(payload, 2).map((match) => match.placeName),
    ['A', 'B']
  );
  assert.equal(parseGeocodeMatches(payload).length, 1);
  assert.deepEqual(parseGeocodeMatches('<html>', 5), []);
  assert.equal(parseGeocodeResults(payload)?.placeName, 'A');
});

test('outcomeFromResponse carries every match and the first as match', () => {
  const found = outcomeFromResponse(true, [entry('A'), entry('B')], 5);
  assert.equal(found.kind, 'found');
  assert.ok(found.kind === 'found');
  assert.equal(found.match.placeName, 'A');
  assert.deepEqual(
    found.matches.map((match) => match.placeName),
    ['A', 'B']
  );
});

test('findAddressMatches sends the User-Agent only when given, and asks for the limit', async () => {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    seen.push({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string> });
    return new Response(JSON.stringify([entry('A'), entry('B')]), { status: 200 });
  };

  const time = fakeTime();
  const native = await findAddressMatches('Bodija Market', { userAgent: 'FEASTY-Test/1.0', limit: 5, fetchImpl, ...time });
  const web = await findAddressMatches('Bodija Market', { fetchImpl, ...time });

  assert.equal(native.kind, 'found');
  assert.equal(native.kind === 'found' && native.matches.length, 2);
  assert.equal(seen[0]!.headers['User-Agent'], 'FEASTY-Test/1.0');
  assert.equal(new URL(seen[0]!.url).searchParams.get('limit'), '5');
  assert.equal('User-Agent' in seen[1]!.headers, false);
  assert.equal(web.kind === 'found' && web.matches.length, 1);
});

test('findAddressMatches spaces consecutive requests at least a second apart', async () => {
  const time = fakeTime();
  const startedAt: number[] = [];
  const fetchImpl: typeof fetch = async () => {
    startedAt.push(time.now());
    return new Response('[]', { status: 200 });
  };

  await findAddressMatches('Bodija Market', { fetchImpl, ...time });
  assert.deepEqual(waits, []);
  clock += 300;
  await findAddressMatches('Bodija Market', { fetchImpl, ...time });

  assert.deepEqual(waits, [ADDRESS_LOOKUP_MIN_INTERVAL_MS - 300]);
  assert.equal(startedAt[1]! - startedAt[0]!, ADDRESS_LOOKUP_MIN_INTERVAL_MS);
});

test('the map search needs four characters', () => {
  assert.equal(NOMINATIM_MIN_QUERY_LENGTH, 4);
});

test('findAddressMatches maps failures and reports only the unexpected ones', async () => {
  const reported: unknown[] = [];
  const time = fakeTime();
  const onUnexpectedError = (error: unknown) => reported.push(error);

  const tooShort = await findAddressMatches('ab', { onUnexpectedError, ...time });
  assert.equal(tooShort.kind, 'no-result');

  const offline = await findAddressMatches('Bodija Market', {
    ...time,
    onUnexpectedError,
    fetchImpl: async () => {
      throw new TypeError('Network request failed');
    },
  });
  assert.equal(offline.kind, 'offline');
  assert.equal(reported.length, 0);

  const limited = await findAddressMatches('Bodija Market', {
    ...time,
    onUnexpectedError,
    fetchImpl: async () => new Response('', { status: 429 }),
  });
  assert.equal(limited.kind, 'unavailable');

  const broken = await findAddressMatches('Bodija Market', {
    ...time,
    onUnexpectedError,
    fetchImpl: async () => new Response('<html>', { status: 200 }),
  });
  assert.equal(broken.kind, 'unavailable');
  assert.equal(reported.length, 1);
});
