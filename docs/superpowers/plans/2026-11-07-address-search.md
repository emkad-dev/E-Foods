# Address search with suggestions, pin-as-truth, and restaurant pin rules — implementation plan

Branch: `feature/address-search` (off `main` at `1f083b7`). Repo root: `C:\Users\emkad\EBuy\E-Foods`.

## Spec (agreed with the owner, binding)

Goal: a customer outside the delivery area cannot order, and saving an address is quick and never a dead end.

### A. Geocode Worker (`cloudflare/geocode`, Worker `feasty-geocode`, custom domain `geo.feasty.com.ng`)
1. `GET /search?q=<text>&limit=<1-5>` returns `{ results: [{ label, latitude, longitude }] }`. Pass-through only: no caching, no storage.
2. Provider chosen by the `PROVIDER` var: `photon` (default, public komoot instance, no key), `locationiq` (key in secret `LOCATIONIQ_KEY`),
   `off` (returns 503 so clients fall back). Switching or turning off must never need an app update.
3. Results restricted to the service area: bounding box in the `SERVICE_BBOX` var (`minLon,minLat,maxLon,maxLat`), initially
   `2.6,6.2,4.4,7.9` (Badagry to Ibadan, covering every live restaurant). Widen it as restaurants join, by config.
4. Privacy: the provider never sees the customer's IP or headers. Forward only the query.
5. Abuse: per-IP rate limit with the Workers rate-limiting binding (about 60 requests per minute). CORS allow-list of FEASTY web origins
   and `localhost` for development; requests with no `Origin` (native apps) are allowed. 3 second upstream timeout. Query length 3-120.
6. Deployed by CI on push to main, like `feasty-hooks` and `feasty-edge-cache` in `.github/workflows/deploy.yml`.

### B. Customer address entry (onboarding prompt and `delivery-location` screen, one shared component)
7. GPS first ("Use my current location"), then a search field: suggestions after 3 characters and about 400 ms pause, at most 5, from the Worker.
8. The pin is the truth; the text is free. Only a tapped suggestion, a GPS fix, or a confirmed fallback search sets coordinates. The address text
   and the existing note field stay free-form for the rider. A new pin always replaces the old one. The text must never silently disagree with the
   pin: auto-filled text follows a new pin, text the customer typed is kept, and the chosen place is shown next to it.
9. An address can only be saved with usable coordinates. Text alone is not an address.
10. GPS accuracy is captured. A fix worse than 1,000 m (typical of a laptop browser) is not used: the customer is asked to search instead.
11. The 15 second live reverse geocode is removed; a fix is reverse geocoded once.
12. Never a dead end: if the Worker fails, times out or is off, offer a one-shot "Search the map" button (Nominatim forward search, one request per tap,
    allowed by its policy), and on Android `Location.geocodeAsync` as an extra attempt. If everything fails and GPS is refused, a clear message:
    allow location or try again.
13. OpenStreetMap attribution is shown with search results.
14. A previously saved text-only address no longer counts as saved: the launch prompt asks again and checkout asks for a pin once.
15. Existing coverage, out-of-range, checkout-address and 50 km collection rules stay as they are and now work for every saved address.

### C. Restaurant pins (partner app and server rule)
16. Publishing additionally requires the pin to be inside Nigeria (padded box: latitude 4.0 to 14.0, longitude 2.5 to 15.0), enforced by the shared rule
    on server and client. Like the existing 0,0 rule, it applies only when coordinates are set or changed; an unchanged existing value still saves.
17. "Use my current location" is the main partner action and requires accuracy of 150 m or better; a worse reading asks the partner to move near a window
    or outside and try again. Raw fields stay as the manual fallback.
18. Address search is the secondary partner action and uses the shared search component through the Worker, keeping the existing confirm step and the
    approximate-pin caveat. The current one-tap Nominatim search becomes its fallback.

### D. Disclosure
19. The privacy policy (`docs/legal/privacy-policy.md` and `apps/web-landing/public/privacy.html`) names the map and search providers (OpenStreetMap,
    Nominatim, Photon by komoot, and LocationIQ as a possible alternative), says what is sent (the typed search text, or the device location when the
    user chooses it), and covers partner device location. Play data-safety notes updated to match. The owner reviews the legal text before release.

### Out of scope (later, owner decided)
- Server requiring coordinates on delivery orders: one build cycle after release, behind a flag, after checking how many orders still arrive without them.

## Global Constraints
- Never apply migrations, write to production, deploy or push from a task. This plan adds no database columns.
- react-native `Alert` is a no-op on web: use design-system `useConfirm` and inline notices. Touchables need a style and a 44pt minimum
  (`scripts/uiContract.test.ts`). Must work on web and native.
- Node tests are `.ts`, registered by hand in root `package.json` `test:node`; deno tests in `test:deno`. Run `npm run -s test`.
  deno: PowerShell with `$env:Path = "$env:LOCALAPPDATA\Microsoft\WinGet\Links;" + $env:Path`.
- No new native modules. `expo-location` already exists in customer, partner and dispatch.
- Runtime version stays `1.0.0`. Do not run `eas update:configure`.
- Never send real customer or restaurant addresses to any third party while testing. Generic place names only.
- Each commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Match surrounding code; comments say WHY.

## Tasks

### Task 1: Geocode Worker (Spec A)
- `cloudflare/geocode/` with `wrangler.jsonc`, `src/index.ts`, and pure, tested modules for query validation, bbox, provider response normalisation
  (Photon GeoJSON and LocationIQ autocomplete into `{ label, latitude, longitude }`), CORS decision. Node tests registered in `test:node`.
- CI deploy step in `.github/workflows/deploy.yml` mirroring the existing Worker steps, with a deployment status step.
- Commit: `feat(geocode): address search Worker in front of the map provider`.

### Task 2: Shared search client and customer address entry (Spec B)
- Shared client in `packages/runtime` (or the package that fits best) calling the Worker with a timeout and returning a typed result or a fallback signal;
  the Worker URL from `EXPO_PUBLIC_GEOCODE_URL` with `https://geo.feasty.com.ng` as the default. Shared search field component usable by customer and partner.
- Customer screens and rules per items 7-15, including updating `hasSavedAddress` and its tests, and the one-shot fallback.
- Pure helpers with tests: pin and text reconciliation, accuracy acceptance, suggestion debounce or query gating.
- Commit: `feat(customer): address search with suggestions; the pin is the address`.

### Task 3: Restaurant pins (Spec C)
- Nigeria bounds in `packages/domain/src/restaurantLocation.ts`, server and client, with unit and deno tests.
- Partner store-details: GPS primary with the accuracy rule, search via the shared component, Nominatim as fallback.
- Commit: `feat(partner): restaurant pins must be accurate and inside Nigeria`.

### Task 4: Disclosure (Spec D)
- Privacy policy (both copies) and `docs/play/` notes. Keep the two policy copies consistent in the sections touched.
- Commit: `docs(legal): name the map and search providers`.
