import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { bboxToString, isInsideBBox, parseBBox } from './bbox.ts';
import { corsHeaders, isAllowedOrigin } from './cors.ts';
import worker, { type Env } from './index.ts';
import { joinLabel } from './label.ts';
import { buildLocationIqUrl, normalizeLocationIq } from './locationiq.ts';
import { buildPhotonUrl, normalizePhoton } from './photon.ts';
import { parseSearchParams } from './query.ts';

const BOX = parseBBox('2.6,6.2,4.4,7.9')!;
const qs = (query: string) => new URLSearchParams(query);

describe('parseSearchParams', () => {
  it('accepts a normal query and defaults the limit to 5', () => {
    assert.deepEqual(parseSearchParams(qs('q=Allen%20Avenue')), { ok: true, q: 'Allen Avenue', limit: 5 });
  });
  it('trims and collapses whitespace', () => {
    const parsed = parseSearchParams(qs('q=%20%20Ikeja%20%20%20City%20Mall%20'));
    assert.deepEqual(parsed, { ok: true, q: 'Ikeja City Mall', limit: 5 });
  });
  it('enforces length 3 to 120 after trimming', () => {
    assert.equal(parseSearchParams(qs('q=ab')).ok, false);
    assert.equal(parseSearchParams(qs('q=%20ab%20')).ok, false);
    assert.equal(parseSearchParams(qs('q=abc')).ok, true);
    assert.equal(parseSearchParams(qs(`q=${'a'.repeat(120)}`)).ok, true);
    assert.equal(parseSearchParams(qs(`q=${'a'.repeat(121)}`)).ok, false);
    assert.equal(parseSearchParams(qs('')).ok, false);
  });
  it('validates limit as an integer from 1 to 5', () => {
    assert.deepEqual(parseSearchParams(qs('q=Lekki&limit=3')), { ok: true, q: 'Lekki', limit: 3 });
    for (const bad of ['0', '6', '-1', '2.5', 'abc', '']) {
      assert.equal(parseSearchParams(qs(`q=Lekki&limit=${bad}`)).ok, false, `limit=${bad}`);
    }
  });
  it('rejects control characters', () => {
    assert.equal(parseSearchParams(new URLSearchParams({ q: 'Lekki\u0000Phase' })).ok, false);
  });
});

describe('bbox', () => {
  it('parses the default service area', () => {
    assert.deepEqual(BOX, { minLon: 2.6, minLat: 6.2, maxLon: 4.4, maxLat: 7.9 });
    assert.equal(bboxToString(BOX), '2.6,6.2,4.4,7.9');
  });
  it('rejects malformed values', () => {
    for (const bad of [undefined, '', '1,2,3', '1,2,3,x', '4,6,2,7', '2,8,3,7', '2,6,3,,', '2,6,200,7', '2,-100,3,7']) {
      assert.equal(parseBBox(bad), null, String(bad));
    }
  });
  it('tests containment, edges included', () => {
    assert.equal(isInsideBBox(BOX, 6.5244, 3.3792), true);
    assert.equal(isInsideBBox(BOX, 6.2, 2.6), true);
    assert.equal(isInsideBBox(BOX, 9.07, 7.49), false);
  });
});

describe('joinLabel', () => {
  it('skips empties and case-insensitive duplicates', () => {
    assert.equal(joinLabel(['Lagos', undefined, '', ' lagos ', 'Lagos State']), 'Lagos, Lagos State');
  });
});

describe('cors', () => {
  it('allows the FEASTY web origins and localhost with any port', () => {
    for (const origin of [
      'https://feasty.com.ng',
      'https://www.feasty.com.ng',
      'https://app.feasty.com.ng',
      'https://partner.feasty.com.ng',
      'https://admin.feasty.com.ng',
      'http://localhost:8081',
      'http://localhost:19006',
    ]) {
      assert.equal(corsHeaders(origin)['access-control-allow-origin'], origin);
    }
  });
  it('refuses look-alikes and other origins', () => {
    for (const origin of [
      'https://evil.example',
      'https://feasty.com.ng.evil.example',
      'https://evilfeasty.com.ng',
      'http://feasty.com.ng',
      'https://localhost:8081',
      'http://localhost.evil.example',
      'http://localhost:8081.evil.example',
    ]) {
      assert.equal(isAllowedOrigin(origin), false, origin);
      assert.equal(corsHeaders(origin)['access-control-allow-origin'], undefined);
    }
  });
  it('adds no allow-origin without an Origin (native) but still varies', () => {
    assert.deepEqual(corsHeaders(null), { vary: 'Origin' });
  });
});

// Shaped like photon.komoot.io output, with the awkward cases real data has.
const photonBody = {
  type: 'FeatureCollection',
  features: [
    {
      geometry: { type: 'Point', coordinates: [3.3515, 6.6018] },
      properties: { name: 'Ikeja City Mall', housenumber: '174', street: 'Obafemi Awolowo Way', district: 'Alausa', city: 'Ikeja', state: 'Lagos', country: 'Nigeria' },
    },
    // Duplicate of the first (same label and point)
    {
      geometry: { coordinates: [3.3515, 6.6018] },
      properties: { name: 'Ikeja City Mall', housenumber: '174', street: 'Obafemi Awolowo Way', district: 'Alausa', city: 'Ikeja', state: 'Lagos' },
    },
    // Name repeats street and city repeats state; locality used when no district
    {
      geometry: { coordinates: [3.4219, 6.4281] },
      properties: { name: 'Adeola Odeku Street', street: 'Adeola Odeku Street', locality: 'Victoria Island', city: 'Lagos', state: 'Lagos' },
    },
    // Missing everything but a state: still a usable label
    { geometry: { coordinates: [3.9, 7.38] }, properties: { state: 'Oyo' } },
    // Skipped: no coordinates, bad coordinates, no label, outside the box
    { properties: { name: 'No geometry' } },
    { geometry: { coordinates: ['3.3', '6.5'] }, properties: { name: 'String coords' } },
    { geometry: { coordinates: [3.3, 6.5] }, properties: {} },
    { geometry: { coordinates: [7.49, 9.07] }, properties: { name: 'Abuja', city: 'Abuja' } },
    null,
  ],
};

describe('normalizePhoton', () => {
  it('builds labels, drops duplicates and malformed features', () => {
    assert.deepEqual(normalizePhoton(photonBody, BOX, 5), [
      { label: 'Ikeja City Mall, 174 Obafemi Awolowo Way, Alausa, Ikeja, Lagos', latitude: 6.6018, longitude: 3.3515 },
      { label: 'Adeola Odeku Street, Victoria Island, Lagos', latitude: 6.4281, longitude: 3.4219 },
      { label: 'Oyo', latitude: 7.38, longitude: 3.9 },
    ]);
  });
  it('respects the limit', () => {
    assert.equal(normalizePhoton(photonBody, BOX, 1).length, 1);
  });
  it('returns an empty list for unexpected bodies', () => {
    for (const body of [null, undefined, 'x', {}, { features: 'no' }, []]) {
      assert.deepEqual(normalizePhoton(body, BOX, 5), []);
    }
  });
  it('builds the upstream URL from query parameters only', () => {
    const url = new URL(buildPhotonUrl('Ikeja & Co', 4, BOX));
    assert.equal(url.origin + url.pathname, 'https://photon.komoot.io/api/');
    assert.equal(url.searchParams.get('q'), 'Ikeja & Co');
    assert.equal(url.searchParams.get('limit'), '4');
    assert.equal(url.searchParams.get('bbox'), '2.6,6.2,4.4,7.9');
  });
});

// Shaped like api.locationiq.com/v1/autocomplete output (coordinates are strings).
const locationIqBody = [
  {
    lat: '6.6018',
    lon: '3.3515',
    display_name: 'Ikeja City Mall, Obafemi Awolowo Way, Alausa, Ikeja, Lagos, Nigeria',
    address: { name: 'Ikeja City Mall', house_number: '174', road: 'Obafemi Awolowo Way', suburb: 'Alausa', city: 'Ikeja', state: 'Lagos', country: 'Nigeria' },
  },
  {
    lat: '6.6018',
    lon: '3.3515',
    display_name: 'Ikeja City Mall, Lagos, Nigeria',
    address: { name: 'Ikeja City Mall', house_number: '174', road: 'Obafemi Awolowo Way', suburb: 'Alausa', city: 'Ikeja', state: 'Lagos' },
  },
  // No structured address: falls back to display_name without the country
  { lat: '6.4281', lon: '3.4219', display_name: 'Victoria Island, Lagos, Nigeria' },
  { lat: 'x', lon: '3.4', address: { name: 'Bad lat' } },
  { lat: '9.07', lon: '7.49', address: { name: 'Abuja' } },
  { lat: '6.5', lon: '3.3' },
];

describe('normalizeLocationIq', () => {
  it('builds labels, converts coordinates, drops duplicates and malformed items', () => {
    assert.deepEqual(normalizeLocationIq(locationIqBody, BOX, 5), [
      { label: 'Ikeja City Mall, 174 Obafemi Awolowo Way, Alausa, Ikeja, Lagos', latitude: 6.6018, longitude: 3.3515 },
      { label: 'Victoria Island, Lagos', latitude: 6.4281, longitude: 3.4219 },
    ]);
  });
  it('returns an empty list for non-array bodies (LocationIQ error objects)', () => {
    assert.deepEqual(normalizeLocationIq({ error: 'Unable to geocode' }, BOX, 5), []);
  });
  it('restricts to the box, Nigeria and the key', () => {
    const url = new URL(buildLocationIqUrl('k', 'Lekki', 3, BOX));
    assert.equal(url.origin + url.pathname, 'https://api.locationiq.com/v1/autocomplete');
    assert.equal(url.searchParams.get('viewbox'), '2.6,6.2,4.4,7.9');
    assert.equal(url.searchParams.get('bounded'), '1');
    assert.equal(url.searchParams.get('countrycodes'), 'ng');
    assert.equal(url.searchParams.get('key'), 'k');
  });
});

describe('worker', () => {
  const realFetch = globalThis.fetch;
  const realError = console.error;
  afterEach(() => {
    globalThis.fetch = realFetch;
    console.error = realError;
  });

  const baseEnv: Env = { PROVIDER: 'photon', SERVICE_BBOX: '2.6,6.2,4.4,7.9' };
  const call = (path: string, env: Env = baseEnv, headers: Record<string, string> = {}, method = 'GET') =>
    worker.fetch(new Request(`https://geo.feasty.com.ng${path}`, { method, headers }), env);

  it('answers a preflight for an allowed origin and none for a bad one', async () => {
    const ok = await call('/search', baseEnv, { origin: 'https://app.feasty.com.ng' }, 'OPTIONS');
    assert.equal(ok.status, 204);
    assert.equal(ok.headers.get('access-control-allow-origin'), 'https://app.feasty.com.ng');
    const bad = await call('/search', baseEnv, { origin: 'https://evil.example' }, 'OPTIONS');
    assert.equal(bad.headers.get('access-control-allow-origin'), null);
  });

  it('returns normalised results, sends only the fixed User-Agent upstream, and is no-store', async () => {
    let seen: { url: string; headers: Record<string, string> } | undefined;
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      seen = { url: String(input), headers: Object.fromEntries(new Headers(init?.headers)) };
      return Response.json(photonBody);
    }) as typeof fetch;
    const response = await call('/search?q=Ikeja%20City&limit=2', baseEnv, {
      origin: 'https://feasty.com.ng',
      'cf-connecting-ip': '203.0.113.9',
      cookie: 'secret=1',
      referer: 'https://feasty.com.ng/x',
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://feasty.com.ng');
    const body = (await response.json()) as { results: unknown[] };
    assert.equal(body.results.length, 2);
    assert.deepEqual(seen?.headers, {
      accept: 'application/json',
      'user-agent': 'FEASTY-Geocode/1.0 (https://feasty.com.ng)',
    });
    assert.equal(new URL(seen!.url).searchParams.get('limit'), '2');
  });

  it('returns 400 for a bad query without calling the provider', async () => {
    globalThis.fetch = (async () => {
      throw new Error('provider must not be called');
    }) as typeof fetch;
    assert.equal((await call('/search?q=ab')).status, 400);
    assert.equal((await call('/search?q=abc&limit=9')).status, 400);
  });

  it('returns 503 when the provider is off, fails, or is slow', async () => {
    console.error = () => {};
    assert.equal((await call('/search?q=Lekki', { ...baseEnv, PROVIDER: 'off' })).status, 503);
    globalThis.fetch = (async () => new Response('boom', { status: 502 })) as typeof fetch;
    assert.equal((await call('/search?q=Lekki')).status, 503);
    globalThis.fetch = (async () => {
      throw new DOMException('timed out', 'TimeoutError');
    }) as typeof fetch;
    assert.equal((await call('/search?q=Lekki')).status, 503);
    assert.equal((await call('/search?q=Lekki', { ...baseEnv, SERVICE_BBOX: 'nope' })).status, 503);
  });

  it('returns 429 when the rate limiter says no, keyed by client IP', async () => {
    const keys: string[] = [];
    const env: Env = {
      ...baseEnv,
      RATE_LIMITER: { limit: async ({ key }) => (keys.push(key), { success: false }) },
    };
    const response = await call('/search?q=Lekki', env, { 'cf-connecting-ip': '203.0.113.9' });
    assert.equal(response.status, 429);
    assert.deepEqual(keys, ['203.0.113.9']);
  });

  it('uses LocationIQ with the secret when selected and treats its 404 as empty', async () => {
    let calledUrl = '';
    globalThis.fetch = (async (input: unknown) => {
      calledUrl = String(input);
      return new Response('{"error":"Unable to geocode"}', { status: 404 });
    }) as typeof fetch;
    const env: Env = { ...baseEnv, PROVIDER: 'locationiq', LOCATIONIQ_KEY: 'k123' };
    const response = await call('/search?q=Lekki', env);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { results: [] });
    assert.equal(new URL(calledUrl).searchParams.get('key'), 'k123');
  });

  it('does not leak the LocationIQ key when it fails', async () => {
    console.error = () => {};
    globalThis.fetch = (async () => new Response('no', { status: 401 })) as typeof fetch;
    const response = await call('/search?q=Lekki', { ...baseEnv, PROVIDER: 'locationiq', LOCATIONIQ_KEY: 'k123' });
    assert.equal(response.status, 503);
    assert.equal((await response.text()).includes('k123'), false);
  });
});
