// Address search in front of the map provider. Pass-through only: nothing is
// cached or stored, and the provider sees only the typed text (never the
// customer's IP or headers). See README.md for the contract.
import { parseBBox } from './bbox.ts';
import { corsHeaders } from './cors.ts';
import { buildLocationIqUrl, normalizeLocationIq } from './locationiq.ts';
import { buildPhotonUrl, normalizePhoton } from './photon.ts';
import { parseSearchParams } from './query.ts';
import type { GeocodeResult } from './types.ts';

export interface Env {
  PROVIDER?: string;
  SERVICE_BBOX?: string;
  LOCATIONIQ_KEY?: string;
  RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

const UPSTREAM_USER_AGENT = 'FEASTY-Geocode/1.0 (https://feasty.com.ng)';
const UPSTREAM_TIMEOUT_MS = 3000;

const json = (status: number, body: unknown, extra: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra },
  });

// Only the User-Agent goes upstream: no cookies, referer, or client IP headers.
const fetchUpstream = (url: string) =>
  fetch(url, {
    headers: { 'user-agent': UPSTREAM_USER_AGENT, accept: 'application/json' },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(request.headers.get('origin'));
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { 'cache-control': 'no-store', ...cors } });
    }
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.pathname !== '/search') {
      return json(404, { error: 'not_found' }, cors);
    }

    const provider = (env.PROVIDER ?? 'photon').trim().toLowerCase();
    if (provider === 'off') return json(503, { error: 'unavailable' }, cors);

    const parsed = parseSearchParams(url.searchParams);
    if (!parsed.ok) return json(400, { error: 'bad_query' }, cors);

    // Cloudflare always sets CF-Connecting-IP in production; without it there
    // is nothing to key the limit on, so the request is refused.
    const clientIp = request.headers.get('cf-connecting-ip');
    if (!clientIp) return json(400, { error: 'bad_request' }, cors);

    // The binding is mandatory in the shipped config: fail closed if it is gone.
    if (!env.RATE_LIMITER) {
      console.error('geocode: RATE_LIMITER binding is missing');
      return json(503, { error: 'unavailable' }, cors);
    }
    try {
      const { success } = await env.RATE_LIMITER.limit({ key: clientIp });
      if (!success) return json(429, { error: 'rate_limited' }, { 'retry-after': '60', ...cors });
    } catch (error) {
      // A limiter outage must not take address search down with it: fail open.
      console.error('geocode: rate limiter failed', error instanceof Error ? error.name : 'unknown');
    }

    const box = parseBBox(env.SERVICE_BBOX);
    if (!box) {
      console.error('geocode: SERVICE_BBOX is missing or malformed');
      return json(503, { error: 'unavailable' }, cors);
    }

    try {
      let results: GeocodeResult[];
      if (provider === 'photon') {
        const upstream = await fetchUpstream(buildPhotonUrl(parsed.q, parsed.limit, box));
        if (!upstream.ok) throw new Error(`photon status ${upstream.status}`);
        results = normalizePhoton(await upstream.json(), box, parsed.limit);
      } else if (provider === 'locationiq') {
        if (!env.LOCATIONIQ_KEY) throw new Error('LOCATIONIQ_KEY is not set');
        const upstream = await fetchUpstream(
          buildLocationIqUrl(env.LOCATIONIQ_KEY, parsed.q, parsed.limit, box),
        );
        // LocationIQ answers 404 when nothing matches: an empty result, not a failure.
        if (upstream.status === 404) {
          results = [];
        } else {
          if (!upstream.ok) throw new Error(`locationiq status ${upstream.status}`);
          results = normalizeLocationIq(await upstream.json(), box, parsed.limit);
        }
      } else {
        console.error(`geocode: unknown PROVIDER "${provider}"`);
        return json(503, { error: 'unavailable' }, cors);
      }
      return json(200, { results }, cors);
    } catch (error) {
      // Never echo provider details (the LocationIQ URL carries the key).
      console.error('geocode upstream failure', error instanceof Error ? error.name : 'unknown');
      return json(503, { error: 'unavailable' }, cors);
    }
  },
};
