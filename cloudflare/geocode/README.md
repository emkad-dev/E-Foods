# feasty-geocode

Address search for the customer and partner apps, served at `geo.feasty.com.ng`.
Pass-through only: no caching, no storage. The provider sees the typed text and
a fixed FEASTY User-Agent, never the client's IP or headers.

## Contract

`GET /search?q=<text>&limit=<1-5>` (`limit` defaults to 5; `q` is 3 to 120 characters)

- `200 { "results": [{ "label": string, "latitude": number, "longitude": number }] }` (may be empty)
- `400` bad query or limit
- `429` rate limited (about 60 per minute per IP)
- `503` provider off, failing, or slower than 3 seconds

Clients treat any non-200 as "use the fallback". Responses are `cache-control: no-store`.

## Configuration

- `PROVIDER` var: `photon` (default), `locationiq`, or `off`. Changing it never needs an app update.
- `SERVICE_BBOX` var: `minLon,minLat,maxLon,maxLat`; results are restricted to it.
- `LOCATIONIQ_KEY` secret: only for `locationiq` (`wrangler secret put LOCATIONIQ_KEY --cwd cloudflare/geocode`).
- Rate limit: `ratelimits` binding `RATE_LIMITER` in `wrangler.jsonc`.

CORS allows the FEASTY web origins and `http://localhost:<port>`; requests without `Origin` (native) are allowed.
Deployed by CI on push to main (`.github/workflows/deploy.yml`).
