// Edge cache for the anonymous public-catalog POST-RPC. Caches an allowlist
// of read actions keyed on a hash of the raw request body: 60s fresh, and on
// origin failure serves up to 24h stale so menus stay browsable during a
// Supabase outage. Everything else proxies straight through uncached.

export interface Env {
  ORIGIN_URL: string;
}

const CACHEABLE_ACTIONS = new Set([
  'customerGetPublishedRestaurants',
  'customerGetPublishedRestaurantDetail',
]);

const FRESH_MS = 60_000;
const STALE_MS = 24 * 60 * 60 * 1000;
const CACHED_AT_HEADER = 'x-feasty-cached-at';

const hexEncode = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

const sha256Hex = async (text: string) =>
  hexEncode(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));

const forwardHeaders = (request: Request) => {
  const headers = new Headers();
  for (const name of ['content-type', 'apikey', 'authorization']) {
    const value = request.headers.get(name);
    if (value) {
      headers.set(name, value);
    }
  }
  return headers;
};

const fetchOrigin = (env: Env, request: Request, rawBody: string) =>
  fetch(env.ORIGIN_URL, {
    method: 'POST',
    headers: forwardHeaders(request),
    body: rawBody,
  });

const withExtraHeaders = (response: Response, extra: Record<string, string>) => {
  const next = new Response(response.body, response);
  for (const [name, value] of Object.entries(extra)) {
    next.headers.set(name, value);
  }
  return next;
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/public-catalog') {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }

    // CORS preflights and non-POSTs go straight to the origin function,
    // which owns the CORS policy.
    if (request.method !== 'POST') {
      return fetch(env.ORIGIN_URL, request);
    }

    const rawBody = await request.text();

    let action = '';
    try {
      const parsed = JSON.parse(rawBody) as { action?: unknown };
      action = typeof parsed.action === 'string' ? parsed.action : '';
    } catch {
      action = '';
    }

    if (!CACHEABLE_ACTIONS.has(action)) {
      return fetchOrigin(env, request, rawBody);
    }

    const cache = caches.default;
    const cacheKey = new Request(
      `https://api.feasty.com.ng/__cache/public-catalog/${await sha256Hex(rawBody)}`,
      { method: 'GET' }
    );

    const cached = await cache.match(cacheKey);
    const cachedAt = cached ? Number(cached.headers.get(CACHED_AT_HEADER) ?? 0) : 0;
    const age = Date.now() - cachedAt;

    if (cached && age < FRESH_MS) {
      return withExtraHeaders(cached, { 'x-edge-cache': 'HIT' });
    }

    let origin: Response | null = null;
    try {
      origin = await fetchOrigin(env, request, rawBody);
    } catch {
      origin = null;
    }

    if (origin && origin.status === 200) {
      const body = await origin.text();
      const toStore = new Response(body, {
        status: 200,
        headers: origin.headers,
      });
      toStore.headers.set(CACHED_AT_HEADER, String(Date.now()));
      // Cache API eviction honors Cache-Control; the 24h window is our
      // stale-serve budget — freshness is enforced above via CACHED_AT_HEADER.
      toStore.headers.set('cache-control', 'public, max-age=86400');
      ctx.waitUntil(cache.put(cacheKey, toStore.clone()));
      return withExtraHeaders(toStore, { 'x-edge-cache': 'MISS' });
    }

    if (cached && age < STALE_MS) {
      return withExtraHeaders(cached, { 'x-edge-cache': 'HIT', 'x-feasty-stale': '1' });
    }

    return (
      origin ??
      new Response(JSON.stringify({ error: 'Catalog origin unavailable' }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      })
    );
  },
};
