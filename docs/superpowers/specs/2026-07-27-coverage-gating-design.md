# Coverage gating — browse everywhere, order only where FEASTY is live

Date: 2026-07-27

Customers whose pinned delivery address is outside every restaurant's delivery range can
browse the full catalogue but cannot add anything to a cart. They see a "coming soon"
message instead. Ordering opens automatically for an area as soon as a partner there is
published.

---

## Problem

FEASTY has restaurant-level range filtering but no platform-level "we are not live where
you are" concept, and no server-side distance enforcement at all.

`getRestaurantAvailability` (`apps/customer/src/utils/restaurantAvailability.ts:187`)
already measures haversine distance from the pinned delivery location to a restaurant and
returns `out_of_area` past `deliveryRadiusKm` (default 12km). The home screen uses it to
split the catalogue into available and unavailable shelves
(`apps/customer/app/(customer)/home/index.tsx:221-237`).

Three gaps follow from that:

1. **A customer outside every service range sees an empty app.** Every restaurant lands on
   the unavailable shelf and `getDiscoveryEmptyState` renders "Not available in your area"
   over a list of nothing. There is no browsing experience for someone FEASTY has not
   reached yet, and nothing tells them ordering will open later.

2. **The restaurant detail screen ignores location entirely.**
   `apps/customer/app/(customer)/home/restaurant/[id].tsx:198` calls
   `getRestaurantAvailability(restaurant, null)` with a hardcoded `null` delivery location,
   so the geo branch never runs. An out-of-range customer can open any restaurant and add
   items to a cart.

3. **The server never checks distance.** `prepareCustomerOrderDraft`
   (`supabase/functions/app-rpc/index.ts:1908`) — the single choke point for both
   `placeCustomerOrder` (`:5021`) and the Paystack flow (`:5135`) — validates published,
   open, approved, `supportsDelivery`, `supportsPickup` and `minOrder`, then normalizes the
   delivery location at `:1975` and stops. Nothing rejects a delivery 500km from the
   kitchen. This hole exists today, independent of this feature.

## Decision

Coverage is **derived from published restaurants, never configured**. There is no service-area
table and no admin screen. A pinned address is in coverage when at least one published,
delivery-supporting restaurant has it inside that restaurant's `deliveryRadiusKm`. Onboarding
a partner in a new city opens that city automatically.

When the pinned address is out of coverage the customer app enters **browse-only mode**:
the whole catalogue stays readable, every purchase affordance is disabled.

### Rejected alternatives

- **Explicit service areas managed in admin.** More control (you could announce a city
  before signing a partner) at the cost of a table, admin UI, and a second source of truth
  that can disagree with the restaurant list. Not worth it while coverage and partner
  onboarding are the same event.
- **GPS or IP geolocation.** GPS adds a permission prompt and a denied-permission fallback;
  IP geolocation is unreliable in Nigeria because of carrier NAT. The pinned address is
  what orders actually use, so it is what the gate uses.
- **Waitlist / "notify me" capture.** Deliberately cut. The coming-soon screen collects
  nothing.

### Assumptions

- **Coverage keys off delivery reachability only, and browse-only mode blocks pickup too.**
  Pickup from a restaurant hundreds of kilometres away is not a real order. A pickup-only
  restaurant near an out-of-coverage customer is possible in principle but does not occur
  in practice, because a nearby restaurant is exactly what would put them in coverage.
- **An unpinned address is treated as in coverage.** Do not gate on unknown location. A
  customer cannot reach delivery checkout without pinning, and the server check is the real
  boundary.

---

## Part 1 — The coverage function

Add to `apps/customer/src/utils/restaurantAvailability.ts`, which already owns every
distance and availability rule in the customer app:

```ts
export type PlatformCoverage = {
  isCovered: boolean;
  nearestDeliverableKm: number | null;
};

export const getPlatformCoverage = (
  restaurants: DiscoveryRestaurant[],
  deliveryLocation: AddressRecord | null
): PlatformCoverage;
```

Rules:

- No `deliveryLocation`, or one without finite coordinates → `{ isCovered: true, nearestDeliverableKm: null }`.
- A restaurant counts toward coverage only when `isRestaurantVisibleToCustomers` passes,
  `supportsDelivery !== false`, and `extractRestaurantCoordinates` returns a point.
  Restaurants failing any of these are skipped, never treated as blocking.
- Radius per restaurant comes from the existing `getRestaurantServiceRadiusKm`, preserving
  the established fallback: a zero or negative configured radius falls back to the 12km
  default rather than making the restaurant undeliverable everywhere.
- `isCovered` is true when any counted restaurant's distance is within its radius.
- `nearestDeliverableKm` is the smallest distance to any counted restaurant regardless of
  whether it is within range — it powers the "nearest kitchen is 45km away" line and is
  `null` when no restaurant qualifies.

`isCovered` and `getRestaurantAvailability` stay independent: coverage answers "is FEASTY
live here", availability answers "can this specific restaurant serve this order". The cart
uses both.

## Part 2 — Coverage state in the app

New `apps/customer/src/contexts/CoverageContext.tsx` providing
`{ isCovered, nearestDeliverableKm, isLoading }`.

- Reads `deliveryLocation` from `CartContext` (`apps/customer/src/contexts/CartContext.tsx:14`),
  which already persists the pinned address.
- Loads the catalogue through the existing `getPublishedRestaurants`
  (`apps/customer/src/services/publicRestaurantReadModel.ts:115`). That helper already caches
  responses via `callPublicCatalog`, so mounting the provider does not add a network round
  trip on top of the home screen's own fetch.
- Recomputes coverage when either the pinned address or the catalogue changes.
- Mounted in `apps/customer/app/(customer)/_layout.tsx` inside the existing cart provider.

While `isLoading` is true, treat the customer as covered. Never flash a coming-soon screen
at someone who is in range.

## Part 3 — Customer surfaces

All four use one exported copy constant so the wording never drifts.

### Delivery location — `apps/customer/app/(customer)/delivery-location.tsx`

The moment of truth. Pinning an out-of-coverage address shows the coming-soon message
inline on that screen, with the `nearestDeliverableKm` line when available. The pin is still
saved: the customer keeps a usable address for when FEASTY launches nearby, and re-pinning
inside coverage clears the state immediately.

### Home — `apps/customer/app/(customer)/home/index.tsx`

When `!isCovered`:

- Skip the availability split at `:230-237`. Build a single shelf from all catalogue entries
  matching the search query, sorted ascending by `availability.distanceKm`, so the nearest
  kitchens lead.
- Render a banner above the shelf carrying the coming-soon message.
- Tag every card "Not available yet" instead of the normal availability badge.
- Suppress the `getDiscoveryEmptyState` "Not available in your area" branch — the banner
  now says it once, properly.

In-coverage rendering is untouched.

### Restaurant detail — `apps/customer/app/(customer)/home/restaurant/[id].tsx`

- Replace the hardcoded `null` at `:198` with the real `deliveryLocation` from the cart
  context, so the geo branch runs. This also makes the existing per-restaurant
  `out_of_area` state reachable on this screen for in-coverage customers.
- When out of coverage, disable the add-to-cart control and the quantity steppers
  (`:150`, `:172`). Pressing the disabled control surfaces the coming-soon message rather
  than failing silently.
- Menu, prices and images render normally. Browsing is the point.

### Cart — `apps/customer/app/(customer)/cart.tsx`

Safety net for a cart built in coverage and then re-pinned outside it. `restaurantUnavailableReason`
(`:69`) already gates the checkout button (`:521`, `:524`) and renders a warning line (`:364`),
so this is one added clause in that chain rather than new UI.

## Part 4 — Server-side enforcement

Client gating is bypassable and stale clients drift. In `prepareCustomerOrderDraft`
(`supabase/functions/app-rpc/index.ts:1908`), immediately after the delivery location is
normalized and null-checked at `:1975-1979`:

- Compute distance with the existing `getDistanceKm` helper (`:1425`, already used for rider
  dispatch weighting) between the restaurant's `latitude`/`longitude` and the normalized
  delivery location.
- Resolve the radius from `restaurant.deliveryRadiusKm`, applying the same
  zero-or-negative-falls-back-to-12km rule the client uses. The two must agree or customers
  will hit server rejections the UI told them were fine.
- When distance exceeds the radius, `fail(412, ...)` with a client-safe message.
- Skip the check when either side lacks coordinates. Do not block orders on missing data;
  that would reject legitimate orders for restaurants onboarded without a pin.

Placing the check inside `prepareCustomerOrderDraft` covers `placeCustomerOrder` and the
Paystack initialization path in one edit. `fulfillmentType === 'pickup'` skips it, since
`deliveryLocation` is null there by construction.

## Testing

`apps/customer/src/utils/restaurantAvailability.test.ts` — `getPlatformCoverage`:

- Pinned address inside one restaurant's radius → covered.
- Pinned address outside every radius → not covered, `nearestDeliverableKm` set.
- No pinned address → covered, `nearestDeliverableKm` null.
- Restaurant without coordinates → skipped, does not affect the verdict.
- Restaurant with `deliveryRadiusKm: 0` → uses the 12km default, matching
  `getRestaurantServiceRadiusKm`.
- Restaurant with `supportsDelivery: false` → excluded from coverage.
- Unpublished or empty-menu restaurant → excluded from coverage.

Server: a delivery order beyond the restaurant's radius is rejected with 412; one inside is
accepted; one where the restaurant has no coordinates is accepted.

## Out of scope

Waitlist capture, admin-managed service areas, GPS and IP geolocation, service-area
clustering, and any partner- or admin-app change. Coverage is a customer-app concept plus
one server guard.
