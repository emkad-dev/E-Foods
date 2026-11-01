# Rider trip map + shared live map — implementation plan

Branch: `feature/rider-trip-map` (off `main` at `c36e44c`). Repo root: `C:\Users\emkad\EBuy\E-Foods`.

## Spec (agreed with the user, binding)

User request: "make dispatch and customer see each other on a mini map". Agreed design:

1. ONE shared map module in `packages/design-system/src/liveMap/`: pure `.ts` HTML builder + message protocol;
   `LiveMap.tsx` (native, react-native-webview) and `LiveMap.web.tsx` (sandboxed `<iframe sandbox="allow-scripts" srcDoc>`).
   HTML is built once per map; markers are pushed after a `'ready'` handshake (native: `injectJavaScript`; web:
   `postMessage`). Bounds re-fit only on first load or when the set of stops changes, never on rider movement.
   The rider pin GLIDES between updates (~1s ease), snapping on large jumps. ~8s with no ready → `fallback` render.
   `interactive` prop: false = no pan/zoom/controls and touches pass through.
2. Customer: `apps/customer/src/components/CustomerLiveMap.tsx` becomes a thin wrapper over the shared map — same
   pins (rider, delivery, restaurant), same layout (260 tall, radius.xl, marginTop 12), still interactive. Fixes:
   red "platform not supported" text on web, and the full map reload on every render.
3. Dispatch rider's own live GPS: a `RiderLocationProvider` owns the app's single `useRealTimeLocation` and wraps
   both `RootLayoutNav` and `DispatchLocationSyncBridge`; screens read it with a hook. No second GPS watcher, no
   fallback to `assignment.courierLatitude/Longitude` (always null on dispatch payloads).
4. `RiderTripMap` (dispatch): compact NON-interactive map with a pressable overlay opening a full-screen interactive
   `Modal`; a native "Navigate" button OUTSIDE the map opens Google Maps directions to the next stop via
   `openExternalLink` (synchronously in the press handler) with
   `https://www.google.com/maps/dir/?api=1&destination=LAT,LNG&travelmode=driving`.
   Pins: rider (self), restaurant (when coords exist), drop-off.
5. Next stop: before pickup = `accepted`, `preparing`, `ready_for_pickup` → restaurant; after pickup = `picked_up`,
   `on_the_way` → customer drop-off. `escalated` → customer if `timeline.pickedUpAt` is set, otherwise unknown (hide
   Navigate). Always `normalizeOrderStatus` first. Terminal statuses and `fulfillmentType === 'pickup'` → no map.
   Before pickup with no restaurant coords → Navigate uses a Google Maps SEARCH for the restaurant name
   (`https://www.google.com/maps/search/?api=1&query=...`).
6. Delivery screen `apps/dispatch/app/(dispatch)/delivery/[id].tsx`: the map REPLACES the dead "Live rider location"
   card and `handleOpenRiderMap`. Dashboard `apps/dispatch/app/(dispatch)/index.tsx`: a card with the same mini map
   for the rider's OWN active delivery (`assignment.courierId === user.uid`), most urgent first, "1 of N" when
   several; tapping opens that delivery.
7. Server (human deploys; client ships first and handles null): restaurant lat/lng on dispatch order snapshots —
   detail handler owner branch, plus ONE batched `RestaurantRecord` query in the queue handler for ONLY the caller's
   own, unredacted, non-terminal assigned orders. Deno test: redacted/offer snapshots carry no restaurant coords.
8. Tiles stay OpenStreetMap public tiles behind one constant (`LIVE_MAP_TILE_URL`).

## Global Constraints

- No new native modules. `react-native-webview` is already a dependency of customer and dispatch.
- `liveMap` is NOT exported from `packages/design-system/src/index.ts` (admin-web, a Vite app with no RN, imports
  that barrel). Apps import it by relative path, like `packages/runtime/src/externalLink` (see
  `packages/runtime/src/index.ts:1-12`).
- Node tests must be `.ts` (run with `--experimental-strip-types`) and must be added by hand to the explicit
  `test:node` list in root `package.json`, or they never run. Run: `npm run -s test:node`.
- Typecheck: `npx tsc --noEmit -p apps/<app>`; lint: `npm --prefix apps/<app> run -s lint`. Pre-existing lint
  warnings in dispatch (`AuthContext.tsx` unused `session`, `dispatchReadModel.ts` array-type) are not yours.
- Deno: run `deno check`/tests from `supabase/`; the bar is no NEW errors (there is a pre-existing baseline). deno
  may not be on PATH: it is installed via winget (try PowerShell, or `%LOCALAPPDATA%\Microsoft\WinGet\Links\deno.exe`).
- Never deploy edge functions, never write to the production DB, never push. Commit on the current branch only.
- Commit messages end with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- Match surrounding code style and comment density. Comments explain WHY.

## Tasks

### Task 1: Shared live map module — finish and test

Files already drafted (uncommitted) by the controller: `packages/design-system/src/liveMap/liveMapHtml.ts`,
`LiveMap.tsx`, `LiveMap.web.tsx`. Review them against Spec item 1 and finish:
- Add `react-native-webview` to `packages/design-system/package.json` `peerDependencies` as `"*"` with
  `peerDependenciesMeta: { "react-native-webview": { "optional": true } }`. Do NOT run npm install changes beyond
  `npm install --package-lock-only --ignore-scripts --no-audit --no-fund` if the lockfile needs syncing.
- Add `packages/design-system/src/liveMap/liveMapHtml.test.ts` (node:test) covering at least:
  `buildLiveMapApplyScript` embeds the payload as parseable JSON and calls `window.__feastyMap.apply`;
  `buildLiveMapApplyMessage` shape; `buildLiveMapHtml` reflects `interactive` true/false in its config, uses
  `LIVE_MAP_TILE_URL`, and injects the theme colours;
  `isFiniteCoordinate` rejects NaN/strings/null.
- Register the test in root `package.json` `test:node`.
- Fix any defect you find in the drafted files (e.g. typing of the `iframe` style, effect ordering) — explain each.
- Typecheck is exercised in Task 2 (customer) and Task 5 (dispatch) since packages have no tsconfig of their own;
  still make sure the files are self-consistent.
- Commit: `feat(design-system): shared live map (native WebView + web iframe, push updates, gliding rider)`.

### Task 2: Customer map onto the shared module

Rewrite `apps/customer/src/components/CustomerLiveMap.tsx` as a thin wrapper per Spec item 2. Keep its default
export and props (`rider`, `delivery`, `restaurant`: `MapPoint | null`) so `orders/[id].tsx:549` is untouched.
- Module-level `LiveMapTheme` constant: background/text from `customerTheme`, rider `#f97316`, delivery `#16a34a`,
  restaurant `#5D3FD3` (the current colours). Marker ids `'rider' | 'delivery' | 'restaurant'`, labels
  `'Your rider' | 'Delivery' | 'Restaurant'`.
- Build markers with `useMemo` keyed on the raw numbers (lat/lng of each point), not on the point objects.
- `interactive`; container style unchanged (backgroundColor, radius.xl, marginTop 12, overflow hidden); map height
  260; a small fallback Text ("Map unavailable right now. Rider updates still arrive above.") styled from the theme.
- Return null when there are no markers (current behaviour).
- Verify: `npx tsc --noEmit -p apps/customer`, customer lint, `npm run -s test:node`.
- Commit: `fix(customer): live map on the shared module — renders on web, no reload per update`.

### Task 3: RiderLocationProvider (dispatch)

In `apps/dispatch/app/_layout.tsx`, `DispatchLocationSyncBridge` (line ~51) calls `useRealTimeLocation` (~line 91)
and the root renders `<RootLayoutNav />` and `<DispatchLocationSyncBridge />` as siblings (~283-284).
- Create `apps/dispatch/src/contexts/RiderLocationContext.tsx` exporting `RiderLocationProvider` and
  `useRiderLocation()` (returns the latest `location` fix or null).
- Move the streaming decision + the single `useRealTimeLocation` call into the provider with IDENTICAL options and
  gating (isAvailable/hasActiveAssignment, cadence constants, minAccuracy); the bridge keeps its sync logic and
  reads `location` from the context. Wrap both `RootLayoutNav` and the bridge in the provider.
- Behaviour must be unchanged: same streaming conditions, same sync. No second watcher anywhere.
- Verify dispatch typecheck + lint + `npm run -s test:node`.
- Commit: `refactor(dispatch): one rider location stream, readable by screens`.

### Task 4: Trip helpers (pure) + tests

Create `apps/dispatch/src/domain/riderTrip.ts` (pure, no RN imports; relative import of
`packages/domain/src/orders.ts` is fine — follow how other dispatch domain files import domain) with:
- `getTripLeg(order): 'to_restaurant' | 'to_customer' | null` per Spec item 5 (normalize status; escalated uses
  `timeline.pickedUpAt`; terminal/pickup-fulfilment → null).
- `getRestaurantPoint(order)`, `getDropoffPoint(order)` → `{ latitude, longitude } | null` (finite numbers only;
  restaurant from `restaurantLatitude/restaurantLongitude`, drop-off from `deliveryLocation`).
- `buildDirectionsUrl(point)` and `buildPlaceSearchUrl(query)` exactly in the Spec item 4/5 formats
  (encodeURIComponent the query).
- `getNavigateTarget(order)`: `{ kind: 'directions', url } | { kind: 'search', url } | null` (to_restaurant with
  coords → directions; to_restaurant without coords but with `restaurantName` → search; to_customer with drop-off →
  directions; otherwise null).
- `pickActiveDeliveries(orders, riderUid)`: rider's own (`assignment.courierId === riderUid`), delivery fulfilment,
  `getTripLeg` non-null, sorted most urgent first: `on_the_way`, `picked_up`, `escalated`, `ready_for_pickup`,
  `preparing`, `accepted`.
- Tests `apps/dispatch/src/domain/riderTrip.test.ts` covering every branch above; register in `test:node`.
- Commit: `feat(dispatch): trip leg, next stop and Google Maps link helpers`.

### Task 5: RiderTripMap + delivery screen

- Create `apps/dispatch/src/components/RiderTripMap.tsx` per Spec item 4, using the shared `LiveMap` (relative
  import) and Task 4 helpers and `useRiderLocation()` for the rider pin. Theme constant from `dispatchTheme`
  (rider = accent, restaurant purple `#5D3FD3`, delivery green `#16a34a` or theme equivalents). Compact height ~200,
  pressable overlay → full-screen `Modal` with an interactive map and a close button. Navigate button (native RN
  control, design-system/BusyLabel conventions of the screen) calls `openExternalLink` synchronously; on failure
  show the existing notice pattern used in the screen (`describeExternalLinkFailure`). Hidden when
  `getNavigateTarget` is null. No map when `getTripLeg` is null. Fallback when the map can't load: the drop-off
  address text + Navigate still shown.
- In `delivery/[id].tsx`, REPLACE the dead "Live rider location" card (~line 461+) and remove `handleOpenRiderMap`
  (~348) plus now-unused courier-coordinate derivations (~157-170) and styles, with `<RiderTripMap order={order} />`.
  Keep the courier phone/call UI if it lives in that card (move it, don't drop it).
- Verify dispatch typecheck + lint + test:node.
- Commit: `feat(dispatch): trip mini map with Navigate on the delivery screen`.

### Task 6: Dashboard card

In `apps/dispatch/app/(dispatch)/index.tsx`, using `useDispatchOrders()` (already used there) and `useAuth()`:
`pickActiveDeliveries(orders, user.uid)`; when non-empty render a card above the dashboard stats with
`<RiderTripMap order={first} compact />` (add a prop if needed so the dashboard variant hides the address block),
a title like "Current delivery", "1 of N" when N > 1, and tapping the card navigates to
`/(dispatch)/delivery/[id]` for that order (follow existing navigation code in the dashboard/deliveries screens).
Verify dispatch typecheck + lint. Commit: `feat(dispatch): current delivery map card on the dashboard`.

### Task 7: Server — restaurant coordinates for the assigned rider

In `supabase/functions/_shared/domains/dispatch.ts`:
- Detail handler (~785-787, owner branch): load the order's restaurant lat/lng (`RestaurantRecord`
  `id,latitude,longitude`, as `supabase/functions/_shared/prepTime.ts:74` reads it) and pass
  `restaurantLatitude/restaurantLongitude` into `toOrderSnapshotResponse` options alongside `customerPhone`.
- Queue handler (~613): ONE batched `.in('id', ids)` query over distinct restaurant ids of orders whose snapshot
  goes out UNREDACTED to this caller (same predicate as ~619, `getDispatchAssignmentOwnerId(assignment) ===
  context.uid`), skipping terminal orders; skip the query when the id set is empty; merge coords only into those
  snapshots. Offers and redacted manual-queue snapshots must never get them.
- Deno test proving owner snapshots get coords and redacted/offer snapshots do not; register it in root
  `test:deno` (follow the file list conventions there).
- `deno check` from `supabase/` — no NEW errors. Do NOT deploy.
- Commit: `feat(dispatch-api): restaurant coordinates for the rider's own assigned orders`.
