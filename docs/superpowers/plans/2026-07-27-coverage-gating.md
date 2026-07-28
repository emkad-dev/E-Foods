# Coverage Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Customers whose pinned delivery address falls outside every restaurant's delivery range can browse the whole catalogue but cannot add anything to a cart; they see a "coming soon" message instead.

**Architecture:** Coverage is derived from the published restaurant list, never configured — a pinned address is "covered" when at least one published, delivery-supporting restaurant has it inside that restaurant's `deliveryRadiusKm`. A pure function in the existing availability utility computes it, a React context distributes it to four customer screens, and a pure module on the edge function enforces the same rule server-side at order creation.

**Tech Stack:** Expo / React Native (customer app, TypeScript), Supabase Edge Functions (Deno, TypeScript), `node:test` for app-side tests, `Deno.test` for edge-function tests.

Spec: `docs/superpowers/specs/2026-07-27-coverage-gating-design.md`

## Global Constraints

- **Radius fallback rule, applied identically on client and server:** a `deliveryRadiusKm` that is null, undefined, zero, or negative falls back to **12** km. This mirrors `getRestaurantServiceRadiusKm` (`apps/customer/src/utils/restaurantAvailability.ts:157`). Client and server must agree or customers hit 412 rejections the UI said were fine.
- **Missing coordinates never block.** A restaurant with no latitude/longitude is skipped for coverage and skipped for the server distance check. Never reject an order because of absent data.
- **Unknown location is treated as covered.** No pinned address, or an address without finite coordinates, means `isCovered: true`.
- **Coverage keys off delivery reachability only**, and browse-only mode blocks pickup too.
- **One copy constant.** All four screens import the same exported strings. Never inline coverage copy in a screen.
- **App-side tests** run with `node --test <file>` (Node 25 strips TypeScript natively). Test files import source with an explicit `.ts` extension, per `packages/domain/src/phone.test.ts`.
- **Edge-function tests** run with `deno test <file>`. Per the toolchain notes, `deno` may not be on the tool shell's PATH — use PowerShell with the winget Links directory prepended if `deno` is not found.
- **No new database tables, no admin UI, no partner/admin app changes.**

---

### Task 1: Coverage function

The pure geometry. Everything else depends on this.

**Files:**
- Modify: `apps/customer/src/utils/restaurantAvailability.ts` (append; do not alter existing exports)
- Test: `apps/customer/src/utils/restaurantAvailability.test.ts` (create)

**Interfaces:**
- Consumes: existing `DiscoveryRestaurant`, `AddressRecord`, `extractRestaurantCoordinates`, `getRestaurantServiceRadiusKm`, `isRestaurantVisibleToCustomers` from the same file.
- Produces: `getPlatformCoverage(restaurants: DiscoveryRestaurant[], deliveryLocation: AddressRecord | null): PlatformCoverage` where `PlatformCoverage = { isCovered: boolean; nearestDeliverableKm: number | null }`.

- [ ] **Step 1: Write the failing test**

Create `apps/customer/src/utils/restaurantAvailability.test.ts`:

```ts
/**
 * Run with: node --test apps/customer/src/utils/restaurantAvailability.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getPlatformCoverage, type DiscoveryRestaurant } from './restaurantAvailability.ts';
import type { AddressRecord } from '../domain/entities.ts';

// Lagos Island. Distances below are measured from here.
// Cast because AddressRecord carries fields coverage never reads.
const PINNED = {
  address: '12 Broad Street, Lagos',
  latitude: 6.4550,
  longitude: 3.3841,
} as unknown as AddressRecord;

const restaurant = (overrides: Partial<DiscoveryRestaurant> = {}): DiscoveryRestaurant => ({
  id: 'rest-1',
  name: 'Test Kitchen',
  isPublished: true,
  supportsDelivery: true,
  latitude: 6.4600,
  longitude: 3.3900,
  deliveryRadiusKm: 5,
  menu: [{ category: 'Mains', items: [{ id: 'item-1', name: 'Jollof', price: 2000, isAvailable: true }] }],
  ...overrides,
});

test('pinned address inside a restaurant radius is covered', () => {
  const coverage = getPlatformCoverage([restaurant()], PINNED);
  assert.equal(coverage.isCovered, true);
  assert.ok(coverage.nearestDeliverableKm !== null && coverage.nearestDeliverableKm < 5);
});

test('pinned address outside every radius is not covered but reports the nearest kitchen', () => {
  // Abuja, ~500km from the pinned Lagos address.
  const far = restaurant({ latitude: 9.0765, longitude: 7.3986, deliveryRadiusKm: 5 });
  const coverage = getPlatformCoverage([far], PINNED);
  assert.equal(coverage.isCovered, false);
  assert.ok(coverage.nearestDeliverableKm !== null && coverage.nearestDeliverableKm > 400);
});

test('no pinned address is treated as covered', () => {
  const coverage = getPlatformCoverage([restaurant()], null);
  assert.deepEqual(coverage, { isCovered: true, nearestDeliverableKm: null });
});

test('a restaurant without coordinates is skipped entirely', () => {
  const coverage = getPlatformCoverage([restaurant({ latitude: null, longitude: null })], PINNED);
  assert.deepEqual(coverage, { isCovered: false, nearestDeliverableKm: null });
});

test('a zero radius falls back to the 12km default rather than blocking', () => {
  // ~7km from the pinned address: outside a literal 0km radius, inside the 12km fallback.
  const nearby = restaurant({ latitude: 6.5170, longitude: 3.3841, deliveryRadiusKm: 0 });
  assert.equal(getPlatformCoverage([nearby], PINNED).isCovered, true);
});

test('a delivery-disabled restaurant does not create coverage', () => {
  const coverage = getPlatformCoverage([restaurant({ supportsDelivery: false })], PINNED);
  assert.equal(coverage.isCovered, false);
});

test('unpublished and empty-menu restaurants do not create coverage', () => {
  assert.equal(getPlatformCoverage([restaurant({ isPublished: false })], PINNED).isCovered, false);
  assert.equal(getPlatformCoverage([restaurant({ menu: [] })], PINNED).isCovered, false);
});

test('the nearest deliverable distance is the smallest across all candidates', () => {
  const near = restaurant({ id: 'near', latitude: 6.4600, longitude: 3.3900, deliveryRadiusKm: 1 });
  const far = restaurant({ id: 'far', latitude: 9.0765, longitude: 7.3986, deliveryRadiusKm: 1 });
  const coverage = getPlatformCoverage([far, near], PINNED);
  assert.ok(coverage.nearestDeliverableKm !== null && coverage.nearestDeliverableKm < 5);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test apps/customer/src/utils/restaurantAvailability.test.ts
```

Expected: FAIL — `getPlatformCoverage` is not exported from `./restaurantAvailability.ts`.

- [ ] **Step 3: Write the implementation**

Append to `apps/customer/src/utils/restaurantAvailability.ts`. The internal `calculateDistanceKm` and `toNumber` helpers already exist above in that file — reuse them, do not redefine.

```ts
export type PlatformCoverage = {
  isCovered: boolean;
  nearestDeliverableKm: number | null;
};

/**
 * Platform-level coverage: is FEASTY live where this customer pinned their address?
 *
 * Derived from the published catalogue, never configured — onboarding a delivery-capable
 * partner in a new area opens that area automatically. Distinct from
 * getRestaurantAvailability, which answers the narrower "can this one restaurant serve
 * this one order".
 */
export const getPlatformCoverage = (
  restaurants: DiscoveryRestaurant[],
  deliveryLocation: AddressRecord | null
): PlatformCoverage => {
  const customerCoordinates = deliveryLocation
    ? extractCoordinatePoint({
        latitude: deliveryLocation.latitude,
        longitude: deliveryLocation.longitude,
      })
    : null;

  // Unknown location is never gated. The customer cannot reach delivery checkout without
  // pinning an address, and the server check is the real boundary.
  if (!customerCoordinates) {
    return { isCovered: true, nearestDeliverableKm: null };
  }

  let isCovered = false;
  let nearestDeliverableKm: number | null = null;

  restaurants.forEach((restaurant) => {
    if (!isRestaurantVisibleToCustomers(restaurant) || restaurant.supportsDelivery === false) {
      return;
    }

    const restaurantCoordinates = extractRestaurantCoordinates(restaurant);
    if (!restaurantCoordinates) {
      return;
    }

    const distanceKm = calculateDistanceKm(restaurantCoordinates, customerCoordinates);

    if (nearestDeliverableKm === null || distanceKm < nearestDeliverableKm) {
      nearestDeliverableKm = distanceKm;
    }

    if (distanceKm <= getRestaurantServiceRadiusKm(restaurant)) {
      isCovered = true;
    }
  });

  return { isCovered, nearestDeliverableKm };
};
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --test apps/customer/src/utils/restaurantAvailability.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/customer/src/utils/restaurantAvailability.ts apps/customer/src/utils/restaurantAvailability.test.ts
git commit -m "feat(customer): derive platform delivery coverage from published restaurants"
```

---

### Task 2: Server-side distance enforcement

Independent of every client task and worth landing on its own: it closes a hole that exists today, where nothing stops a delivery order 500km from the kitchen.

Follow the established pattern for testable `app-rpc` logic — a pure sibling module with a `Deno.test` file, as in `supabase/functions/app-rpc/partnerRestaurantScope.ts`. `index.ts` is ~6500 lines and is not directly testable.

**Files:**
- Create: `supabase/functions/app-rpc/deliveryCoverage.ts`
- Test: `supabase/functions/app-rpc/deliveryCoverage.test.ts` (create)
- Modify: `supabase/functions/app-rpc/index.ts` — delete the private `toRadians` + `getDistanceKm` (`:1428-1445`), import from the new module, insert the guard after `:1983`

**Interfaces:**
- Consumes: nothing from Task 1 (the edge function cannot import app code).
- Produces: `calculateDistanceKm(origin, target): number`, `resolveDeliveryRadiusKm(configured: unknown): number`, and `isDeliveryOutOfRange(input: DeliveryRangeInput): boolean` for `index.ts`.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/app-rpc/deliveryCoverage.test.ts`:

```ts
import {
  calculateDistanceKm,
  isDeliveryOutOfRange,
  resolveDeliveryRadiusKm,
} from './deliveryCoverage.ts';

const equals = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
};

Deno.test('a non-positive or absent radius falls back to the 12km default', () => {
  equals(resolveDeliveryRadiusKm(0), 12, 'zero');
  equals(resolveDeliveryRadiusKm(-4), 12, 'negative');
  equals(resolveDeliveryRadiusKm(null), 12, 'null');
  equals(resolveDeliveryRadiusKm(undefined), 12, 'undefined');
  equals(resolveDeliveryRadiusKm('not a number'), 12, 'garbage');
  equals(resolveDeliveryRadiusKm(5), 5, 'configured');
  equals(resolveDeliveryRadiusKm('7.5'), 7.5, 'numeric string');
});

Deno.test('distance between two Lagos points is a few kilometres', () => {
  const distance = calculateDistanceKm(
    { latitude: 6.4550, longitude: 3.3841 },
    { latitude: 6.4600, longitude: 3.3900 }
  );
  if (distance <= 0 || distance > 2) {
    throw new Error(`expected a sub-2km distance, got ${distance}`);
  }
});

Deno.test('a delivery beyond the radius is out of range', () => {
  equals(
    isDeliveryOutOfRange({
      restaurantLatitude: 6.4550,
      restaurantLongitude: 3.3841,
      deliveryLatitude: 9.0765, // Abuja
      deliveryLongitude: 7.3986,
      deliveryRadiusKm: 12,
    }),
    true,
    'far delivery'
  );
});

Deno.test('a delivery inside the radius is in range', () => {
  equals(
    isDeliveryOutOfRange({
      restaurantLatitude: 6.4550,
      restaurantLongitude: 3.3841,
      deliveryLatitude: 6.4600,
      deliveryLongitude: 3.3900,
      deliveryRadiusKm: 12,
    }),
    false,
    'near delivery'
  );
});

Deno.test('a zero radius uses the 12km fallback, matching the client', () => {
  equals(
    isDeliveryOutOfRange({
      restaurantLatitude: 6.4550,
      restaurantLongitude: 3.3841,
      deliveryLatitude: 6.5170, // ~7km away
      deliveryLongitude: 3.3841,
      deliveryRadiusKm: 0,
    }),
    false,
    'zero radius falls back'
  );
});

Deno.test('missing coordinates on either side never block the order', () => {
  equals(
    isDeliveryOutOfRange({
      restaurantLatitude: null,
      restaurantLongitude: null,
      deliveryLatitude: 6.4600,
      deliveryLongitude: 3.3900,
      deliveryRadiusKm: 12,
    }),
    false,
    'restaurant without a pin'
  );
  equals(
    isDeliveryOutOfRange({
      restaurantLatitude: 6.4550,
      restaurantLongitude: 3.3841,
      deliveryLatitude: null,
      deliveryLongitude: null,
      deliveryRadiusKm: 12,
    }),
    false,
    'delivery without coordinates'
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
deno test supabase/functions/app-rpc/deliveryCoverage.test.ts
```

Expected: FAIL — module `./deliveryCoverage.ts` not found.

If `deno` is not on the PATH in your shell, run it from PowerShell with the winget Links directory prepended:

```bash
powershell -NoProfile -Command "$env:PATH = \"$env:LOCALAPPDATA\Microsoft\WinGet\Links;$env:PATH\"; deno test supabase/functions/app-rpc/deliveryCoverage.test.ts"
```

- [ ] **Step 3: Write the implementation**

Create `supabase/functions/app-rpc/deliveryCoverage.ts`:

```ts
/**
 * Delivery range enforcement for order creation.
 *
 * The 12km fallback for a non-positive radius mirrors getRestaurantServiceRadiusKm in
 * apps/customer/src/utils/restaurantAvailability.ts. The two MUST agree: if the server is
 * stricter, customers get 412s on orders the app told them were fine.
 */

const DEFAULT_DELIVERY_RADIUS_KM = 12;

export type GeoPoint = {
  latitude: number;
  longitude: number;
};

export type DeliveryRangeInput = {
  restaurantLatitude: number | null | undefined;
  restaurantLongitude: number | null | undefined;
  deliveryLatitude: number | null | undefined;
  deliveryLongitude: number | null | undefined;
  deliveryRadiusKm: unknown;
};

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const toRadians = (value: number) => (value * Math.PI) / 180;

export const calculateDistanceKm = (origin: GeoPoint, target: GeoPoint) => {
  const earthRadiusKm = 6371;
  const dLat = toRadians(target.latitude - origin.latitude);
  const dLon = toRadians(target.longitude - origin.longitude);
  const lat1 = toRadians(origin.latitude);
  const lat2 = toRadians(target.latitude);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export const resolveDeliveryRadiusKm = (configured: unknown) => {
  const parsed = toFiniteNumber(configured);
  return parsed !== null && parsed > 0 ? parsed : DEFAULT_DELIVERY_RADIUS_KM;
};

/**
 * True only when both sides have coordinates AND the delivery falls outside the radius.
 * Missing coordinates return false: never reject a legitimate order over absent data.
 */
export const isDeliveryOutOfRange = ({
  restaurantLatitude,
  restaurantLongitude,
  deliveryLatitude,
  deliveryLongitude,
  deliveryRadiusKm,
}: DeliveryRangeInput) => {
  const restaurantLat = toFiniteNumber(restaurantLatitude);
  const restaurantLon = toFiniteNumber(restaurantLongitude);
  const deliveryLat = toFiniteNumber(deliveryLatitude);
  const deliveryLon = toFiniteNumber(deliveryLongitude);

  if (restaurantLat === null || restaurantLon === null || deliveryLat === null || deliveryLon === null) {
    return false;
  }

  const distanceKm = calculateDistanceKm(
    { latitude: restaurantLat, longitude: restaurantLon },
    { latitude: deliveryLat, longitude: deliveryLon }
  );

  return distanceKm > resolveDeliveryRadiusKm(deliveryRadiusKm);
};
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
deno test supabase/functions/app-rpc/deliveryCoverage.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Wire the guard into order creation**

In `supabase/functions/app-rpc/index.ts`, add the import beside the other local module imports at the top of the file:

```ts
import { calculateDistanceKm, isDeliveryOutOfRange } from './deliveryCoverage.ts';
```

Delete the now-duplicated private helper at `:1430-1445` (`const getDistanceKm = (origin, target) => { ... }`) and update its call site at `:1565-1566` to use the imported function:

```ts
      const distanceKm =
        restaurantCoordinates && riderCoordinates
          ? calculateDistanceKm(restaurantCoordinates, riderCoordinates)
          : null;
```

Also delete the `toRadians` helper at `:1428`. It has exactly four call sites, all inside the `getDistanceKm` you just deleted, so it becomes dead code; the new module carries its own copy. `deno check` in Step 6 confirms nothing else referenced it.

In `prepareCustomerOrderDraft`, immediately after the existing delivery-location null check (`:1979-1983`, ending in `fail(400, 'A valid delivery location is required.')`), insert:

```ts
  // Delivery range is enforced here, not in the client alone: a stale or tampered client
  // must not be able to book a delivery the restaurant cannot reach.
  if (
    fulfillmentType === 'delivery' &&
    isDeliveryOutOfRange({
      restaurantLatitude: restaurant.latitude,
      restaurantLongitude: restaurant.longitude,
      deliveryLatitude: deliveryLocation?.latitude,
      deliveryLongitude: deliveryLocation?.longitude,
      deliveryRadiusKm: restaurant.deliveryRadiusKm,
    })
  ) {
    fail(412, 'This restaurant does not deliver to your selected location yet.');
  }
```

- [ ] **Step 6: Verify the edge function still type-checks**

```bash
deno check supabase/functions/app-rpc/index.ts
```

Expected: no errors. If `deliveryLocation`'s normalized shape does not expose `latitude`/`longitude` directly, read the fields off it as `normalizeDeliveryLocation` returns them — check that function's return type and adjust the two property reads, nothing else.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/app-rpc/deliveryCoverage.ts supabase/functions/app-rpc/deliveryCoverage.test.ts supabase/functions/app-rpc/index.ts
git commit -m "feat(app-rpc): reject delivery orders outside the restaurant service radius"
```

> **Deployment note for the operator:** this task changes `app-rpc`. It takes effect only after the function is redeployed. Do not deploy as part of this plan.

---

### Task 3: Coverage copy and context

**Files:**
- Create: `apps/customer/src/utils/coverageMessaging.ts`
- Create: `apps/customer/src/contexts/CoverageContext.tsx`
- Modify: `apps/customer/app/(customer)/_layout.tsx` (mount the provider inside `FavoritesProvider`, `:42`; closing tags at `:143-144`)

**Interfaces:**
- Consumes: `getPlatformCoverage`, `PlatformCoverage` from Task 1; `useCart()` from `apps/customer/src/contexts/CartContext.tsx`; `getPublishedRestaurants` from `apps/customer/src/services/publicRestaurantReadModel.ts:115`.
- Produces: `useCoverage(): { isCovered: boolean; nearestDeliverableKm: number | null; isLoading: boolean }`, plus `COVERAGE_COMING_SOON_TITLE`, `COVERAGE_COMING_SOON_COPY`, `COVERAGE_UNAVAILABLE_TAG`, and `describeNearestKitchen(nearestDeliverableKm)`.

- [ ] **Step 1: Write the copy module**

Create `apps/customer/src/utils/coverageMessaging.ts`. Every screen imports from here so the wording cannot drift:

```ts
export const COVERAGE_COMING_SOON_TITLE = 'FEASTY is coming soon to your area';

export const COVERAGE_COMING_SOON_COPY =
  'We are not delivering here yet, so ordering is switched off. Browse the full menu in the meantime — ordering opens the moment a restaurant near you goes live.';

export const COVERAGE_UNAVAILABLE_TAG = 'Not available yet';

export const describeNearestKitchen = (nearestDeliverableKm: number | null) => {
  if (nearestDeliverableKm === null || !Number.isFinite(nearestDeliverableKm)) {
    return null;
  }

  return `Our nearest kitchen is about ${Math.round(nearestDeliverableKm)}km away.`;
};
```

- [ ] **Step 2: Write the context**

Create `apps/customer/src/contexts/CoverageContext.tsx`:

```tsx
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getPublishedRestaurants } from '../services/publicRestaurantReadModel';
import { getPlatformCoverage, type DiscoveryRestaurant } from '../utils/restaurantAvailability';
import { useCart } from './CartContext';

type CoverageContextValue = {
  isCovered: boolean;
  nearestDeliverableKm: number | null;
  isLoading: boolean;
};

const CoverageContext = createContext<CoverageContextValue>({
  isCovered: true,
  nearestDeliverableKm: null,
  isLoading: true,
});

export const CoverageProvider = ({ children }: { children: ReactNode }) => {
  const { deliveryLocation } = useCart();
  const [restaurants, setRestaurants] = useState<DiscoveryRestaurant[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    // getPublishedRestaurants caches through callPublicCatalog, so this shares the home
    // screen's fetch rather than adding a round trip.
    getPublishedRestaurants()
      .then(({ restaurants: catalog }) => {
        if (!cancelled) {
          setRestaurants(catalog as DiscoveryRestaurant[]);
        }
      })
      .catch(() => {
        // A catalogue failure must not gate anyone. Leave the list empty and stay
        // permissive via the isLoading guard below.
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<CoverageContextValue>(() => {
    // Never flash a coming-soon screen at someone who may well be in range.
    if (isLoading || restaurants.length === 0) {
      return { isCovered: true, nearestDeliverableKm: null, isLoading };
    }

    const coverage = getPlatformCoverage(restaurants, deliveryLocation);
    return { ...coverage, isLoading };
  }, [deliveryLocation, isLoading, restaurants]);

  return <CoverageContext.Provider value={value}>{children}</CoverageContext.Provider>;
};

export const useCoverage = () => useContext(CoverageContext);
```

- [ ] **Step 3: Mount the provider**

In `apps/customer/app/(customer)/_layout.tsx`, add the import beside the `FavoritesProvider` import (`:7`) and wrap the tabs. `CartProvider` already sits above this layout in `apps/customer/app/_layout.tsx:226`, so `useCart()` resolves.

```tsx
import { CoverageProvider } from '../../src/contexts/CoverageContext';
```

```tsx
    <FavoritesProvider>
      <CoverageProvider>
        <Tabs
          ...
        </Tabs>
      </CoverageProvider>
    </FavoritesProvider>
```

- [ ] **Step 4: Verify the app compiles and boots**

```bash
npm run lint:customer
```

Expected: no new errors. Then start the customer app and confirm the home screen still renders normally for an in-coverage or unpinned address — this task adds no visible change yet.

- [ ] **Step 5: Commit**

```bash
git add apps/customer/src/utils/coverageMessaging.ts apps/customer/src/contexts/CoverageContext.tsx "apps/customer/app/(customer)/_layout.tsx"
git commit -m "feat(customer): add coverage context and shared coming-soon copy"
```

---

### Task 4: Delivery-location screen

The moment of truth — where the customer learns FEASTY is not live where they are.

**Files:**
- Modify: `apps/customer/app/(customer)/delivery-location.tsx` (`handleSave` at `:141-162`, and the header block at `:171-179`)

**Note:** this screen was rewritten on 2026-07-27 (commit `187ebd5`). It now delegates GPS and
reverse geocoding to `src/services/deviceLocation.ts` and `src/services/locationResolution.ts`,
uses a local `status` state for transient banners instead of `Alert`, and imports no
`customerTheme` — every colour in its `StyleSheet` is a raw hex literal. Match that convention:
do not import `customerTheme`, and do not route the coverage panel through `setStatus`. Coverage
is a persistent condition, not a transient status message.

**Interfaces:**
- Consumes: `useCoverage()` from Task 3; `COVERAGE_COMING_SOON_TITLE`, `COVERAGE_COMING_SOON_COPY`, `describeNearestKitchen` from Task 3.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Read the current save flow**

`handleSave` (`:141`) validates the address, calls `setDeliveryLocation({...})` (`:150`), stops live tracking, then `router.replace('/cart')` (`:161`). The pin must still be saved when out of coverage — the customer keeps a usable address for launch day — but the navigation to cart must not happen.

- [ ] **Step 2: Add coverage state to the screen**

Add the imports:

```tsx
import { useCoverage } from '../../src/contexts/CoverageContext';
import {
  COVERAGE_COMING_SOON_COPY,
  COVERAGE_COMING_SOON_TITLE,
  describeNearestKitchen,
} from '../../src/utils/coverageMessaging';
```

Add beside the existing `useCart()` call (`:36`):

```tsx
  const { isCovered, nearestDeliverableKm } = useCoverage();
```

- [ ] **Step 3: Keep the customer on the screen when out of coverage**

Replace the tail of `handleSave` (`:160-161`) so the save still happens but the redirect does not:

```tsx
    stopLiveTracking();

    // Coverage is recomputed from the address we just saved, so it is only accurate on the
    // next render. Gate on the coordinates being saved and let the panel below react.
    if (!isCovered) {
      return;
    }

    router.replace('/cart');
```

- [ ] **Step 4: Render the coming-soon panel**

Insert directly below the header `View` (after `:179`, before the `ScrollView` opens at `:181`), so it is visible without scrolling:

```tsx
      {!isCovered ? (
        <View style={styles.comingSoonPanel}>
          <Text style={styles.comingSoonTitle}>{COVERAGE_COMING_SOON_TITLE}</Text>
          <Text style={styles.comingSoonCopy}>{COVERAGE_COMING_SOON_COPY}</Text>
          {describeNearestKitchen(nearestDeliverableKm) ? (
            <Text style={styles.comingSoonMeta}>{describeNearestKitchen(nearestDeliverableKm)}</Text>
          ) : null}
        </View>
      ) : null}
```

Add to the `StyleSheet.create` block at the bottom of the file (starts `:274`). Raw hex literals, matching this file's existing convention — do not import `customerTheme`:

```tsx
  comingSoonPanel: {
    backgroundColor: '#ffe0b2',
    borderColor: '#ef6c00',
    borderRadius: 16,
    borderWidth: 1,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
  },
  comingSoonTitle: {
    color: '#7a3c00',
    fontSize: 15,
    fontWeight: '800',
  },
  comingSoonCopy: {
    color: '#7a3c00',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6,
  },
  comingSoonMeta: {
    color: '#7a3c00',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 8,
  },
```

- [ ] **Step 5: Verify manually**

Start the customer app. Pin an address far from every published restaurant (Abuja coordinates work if your data is Lagos-based) and press save. Expected: the panel appears, the app stays on the delivery-location screen, and the address persists if you navigate away and back. Then pin an in-range address: expected, no panel, redirect to `/cart` as before.

- [ ] **Step 6: Commit**

```bash
git add "apps/customer/app/(customer)/delivery-location.tsx"
git commit -m "feat(customer): show coming-soon panel when a pinned address is out of coverage"
```

---

### Task 5: Home screen browse-only mode

**Files:**
- Modify: `apps/customer/app/(customer)/home/index.tsx` (`:222-261`, `:308-317`, the nearby shelf render at `:541`)

**Interfaces:**
- Consumes: `useCoverage()` from Task 3; `COVERAGE_COMING_SOON_TITLE`, `COVERAGE_COMING_SOON_COPY`, `COVERAGE_UNAVAILABLE_TAG`, `describeNearestKitchen` from Task 3.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add coverage state**

Add the imports alongside the existing `restaurantAvailability` import block (`:27-33`):

```tsx
import { useCoverage } from '../../../src/contexts/CoverageContext';
import {
  COVERAGE_COMING_SOON_COPY,
  COVERAGE_COMING_SOON_TITLE,
  COVERAGE_UNAVAILABLE_TAG,
  describeNearestKitchen,
} from '../../../src/utils/coverageMessaging';
```

Add near the other hook calls in the component body:

```tsx
  const { isCovered, nearestDeliverableKm } = useCoverage();
```

- [ ] **Step 2: Bypass the availability split when out of coverage**

Replace the `availableRestaurants` memo (`:231-234`). Out of coverage every restaurant would land on the unavailable shelf, leaving an empty app — so in browse-only mode all matched restaurants stay in the main list:

```tsx
  const availableRestaurants = useMemo(
    () =>
      isCovered
        ? discoveryResults.filter((entry) => entry.availability.isAvailable)
        : discoveryResults,
    [discoveryResults, isCovered]
  );
```

Leave `unavailableRestaurants` (`:235-238`) as it is. Then suppress the redundant secondary shelf — it would repeat the whole catalogue. Change its render condition at `:597`:

```tsx
      {isCovered && unavailableRestaurants.length > 0 ? (
```

The existing `nearbyRestaurants` memo (`:253-261`) already sorts by ascending `availability.distanceKm`, which delivers the required nearest-first ordering with no change.

Note the knock-on effect: `topRatedRestaurants` (`:240`), `featuredRestaurants` (`:263`) and `spotlightSlides` (`:267`) all derive from `availableRestaurants`, so in browse-only mode the spotlight carousel features restaurants the customer cannot order from. That is correct — the slides link to restaurant pages, which stay browsable — and it keeps the screen from rendering an empty carousel. Do not add a separate filter for them.

- [ ] **Step 3: Suppress the duplicated empty-state message**

`getDiscoveryEmptyState` returns "Not available in your area" whenever a pinned location has no available restaurants — the banner now says that properly. Replace the `emptyState` assignment (`:310-317`):

```tsx
  const emptyState = getDiscoveryEmptyState({
    availableCount: availableRestaurants.length,
    matchedCount: discoveryResults.length,
    unavailableReasons: unavailableRestaurants.map((entry) => entry.availability.reason),
    query: search,
    unavailableCount: unavailableRestaurants.length,
    // In browse-only mode the banner carries the out-of-area message; passing the pinned
    // location here would repeat it inside the empty state.
    deliveryLocation: isCovered ? deliveryLocation : null,
  });
```

- [ ] **Step 4: Render the banner**

Insert above the nearby shelf, immediately before the `{nearbyVisible.map(...)}` block at `:541`:

```tsx
          {!isCovered ? (
            <View style={styles.coverageBanner}>
              <Text style={styles.coverageBannerTitle}>{COVERAGE_COMING_SOON_TITLE}</Text>
              <Text style={styles.coverageBannerCopy}>{COVERAGE_COMING_SOON_COPY}</Text>
              {describeNearestKitchen(nearestDeliverableKm) ? (
                <Text style={styles.coverageBannerMeta}>{describeNearestKitchen(nearestDeliverableKm)}</Text>
              ) : null}
            </View>
          ) : null}
```

Add to the file's `StyleSheet.create` block:

```tsx
  coverageBanner: {
    backgroundColor: '#ffe0b2',
    borderColor: '#ef6c00',
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 14,
    padding: 14,
  },
  coverageBannerTitle: {
    color: '#7a3c00',
    fontSize: 15,
    fontWeight: '800',
  },
  coverageBannerCopy: {
    color: '#7a3c00',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6,
  },
  coverageBannerMeta: {
    color: '#7a3c00',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 8,
  },
  coverageCardTag: {
    color: '#7a3c00',
    fontSize: 11,
    fontWeight: '800',
    marginTop: 2,
  },
```

- [ ] **Step 5: Tag every card**

Inside the `{nearbyVisible.map(({ restaurant, availability }) => {` render at `:541`, add the tag next to the existing `nearbyMeta` line (around `:571-573`):

```tsx
                  {!isCovered ? <Text style={styles.coverageCardTag}>{COVERAGE_UNAVAILABLE_TAG}</Text> : null}
```

- [ ] **Step 6: Verify manually**

With an out-of-coverage address pinned, open the home screen. Expected: the banner sits above the restaurant list, the full published catalogue is listed nearest-first, every card carries "Not available yet", and there is no second "unavailable" shelf repeating the same restaurants. With an in-range address pinned, the screen must look exactly as it did before this task.

- [ ] **Step 7: Commit**

```bash
git add "apps/customer/app/(customer)/home/index.tsx"
git commit -m "feat(customer): browse-only home shelf with coverage banner"
```

---

### Task 6: Restaurant detail gating

Where the purchase is actually blocked.

**Files:**
- Modify: `apps/customer/app/(customer)/home/restaurant/[id].tsx` (`:198`, `handleAddToCart` at `:140`, the Add button at `:342-348`)

**Interfaces:**
- Consumes: `useCoverage()` from Task 3; `COVERAGE_COMING_SOON_TITLE`, `COVERAGE_COMING_SOON_COPY` from Task 3; `deliveryLocation` from `useCart()`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Feed the real delivery location into availability**

`:198` currently passes a hardcoded `null`, so the geo branch of `getRestaurantAvailability` never runs on this screen. Pull `deliveryLocation` from the existing `useCart()` destructure (`:59`):

```tsx
  const { addItem, deliveryLocation, items, restaurantId: cartRestaurantId } = useCart();
```

Then at `:198`:

```tsx
  const availability = restaurant ? getRestaurantAvailability(restaurant, deliveryLocation) : null;
```

- [ ] **Step 2: Add coverage state**

```tsx
import { useCoverage } from '../../../../src/contexts/CoverageContext';
import {
  COVERAGE_COMING_SOON_COPY,
  COVERAGE_COMING_SOON_TITLE,
} from '../../../../src/utils/coverageMessaging';
```

```tsx
  const { isCovered } = useCoverage();
```

Verify the relative import depth against a neighbouring import in this file — it sits two levels deeper than the home index.

- [ ] **Step 3: Block add-to-cart at the handler**

Guard the top of `handleAddToCart` (`:140`), before the replace-cart branch, so no path reaches `addItem`:

```tsx
  const handleAddToCart = (item: MenuItem) => {
    if (!isCovered) {
      Alert.alert(COVERAGE_COMING_SOON_TITLE, COVERAGE_COMING_SOON_COPY);
      return;
    }

    if (cartRestaurantId && cartRestaurantId !== id) {
```

- [ ] **Step 4: Disable the Add control visually**

The button at `:342-348` already disables on `restaurant.isOpen === false`. Extend both the style and the `disabled` prop, but keep `onPress` wired so the tap still explains itself rather than failing silently:

```tsx
                <TouchableOpacity
                  style={[
                    styles.addButton,
                    restaurant.isOpen === false || !isCovered ? styles.addButtonDisabled : null,
                  ]}
                  onPress={() => handleAddToCart(menuItem)}
                  disabled={restaurant.isOpen === false}
                >
```

Leaving `disabled` keyed only on `isOpen` is deliberate: a disabled `TouchableOpacity` swallows the press, and an out-of-coverage customer must get the explanation.

- [ ] **Step 5: Verify manually**

With an out-of-coverage address pinned, open any restaurant. Expected: the full menu, descriptions, images and prices render; the Add buttons look disabled; tapping one shows the coming-soon alert and adds nothing to the cart. With an in-range address, adding to the cart behaves exactly as before, including the replace-cart prompt when switching restaurants.

- [ ] **Step 6: Commit**

```bash
git add "apps/customer/app/(customer)/home/restaurant/[id].tsx"
git commit -m "feat(customer): block add-to-cart outside coverage and honour pinned location"
```

---

### Task 7: Cart safety net

Covers the customer who filled a cart in coverage, then re-pinned an address outside it.

**Files:**
- Modify: `apps/customer/app/(customer)/cart.tsx` (`restaurantUnavailableReason` at `:69-75`)

**Interfaces:**
- Consumes: `useCoverage()` from Task 3; `COVERAGE_COMING_SOON_COPY` from Task 3.
- Produces: nothing.

- [ ] **Step 1: Add coverage state**

```tsx
import { useCoverage } from '../../src/contexts/CoverageContext';
import { COVERAGE_COMING_SOON_COPY } from '../../src/utils/coverageMessaging';
```

```tsx
  const { isCovered } = useCoverage();
```

- [ ] **Step 2: Extend the existing unavailable-reason chain**

`restaurantUnavailableReason` (`:69`) already disables the checkout button (`:521`, `:524`) and renders a warning line (`:364`), so one added clause covers the whole surface. Coverage is checked first — it is the broadest reason and the most useful to state:

```tsx
  const restaurantUnavailableReason =
    !isCovered
      ? COVERAGE_COMING_SOON_COPY
      : !restaurant
        ? 'This restaurant is no longer available for checkout.'
        : restaurant.isOpen === false
          ? 'This restaurant is currently closed.'
          : !isRestaurantPublished
            ? 'This restaurant is currently unavailable for new orders.'
            : null;
```

Preserve whatever the existing chain's final branches are — re-indent them under the new clause rather than retyping from memory, and keep the original trailing condition and `null` fallback intact.

- [ ] **Step 3: Verify manually**

Build a cart with an in-range address, then change the pinned address to an out-of-coverage one and open the cart. Expected: the warning line shows the coming-soon copy and the checkout button is disabled. Change back to an in-range address: checkout re-enables and placing an order still works end to end.

- [ ] **Step 4: Commit**

```bash
git add "apps/customer/app/(customer)/cart.tsx"
git commit -m "feat(customer): block checkout when the pinned address is out of coverage"
```

---

## Final verification

- [ ] `node --test apps/customer/src/utils/restaurantAvailability.test.ts` — passes
- [ ] `deno test supabase/functions/app-rpc/deliveryCoverage.test.ts` — passes
- [ ] `deno check supabase/functions/app-rpc/index.ts` — clean
- [ ] `npm run lint:customer` — no new errors
- [ ] End-to-end with an in-range pinned address: browse, add to cart, place an order — unchanged from before this plan
- [ ] End-to-end with an out-of-coverage pinned address: banner on home, full catalogue browsable nearest-first, Add buttons explain and refuse, checkout disabled, delivery-location panel shown

**Operator follow-up, not part of this plan:** `app-rpc` must be redeployed for Task 2's server guard to take effect.
