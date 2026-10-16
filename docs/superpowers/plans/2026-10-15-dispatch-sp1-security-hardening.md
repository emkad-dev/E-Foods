# Dispatch SP-1 — Security & Correctness Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close five backend security/correctness defects in the live rider-dispatch system so the dispatch pilot can run against real riders and real customer data without leaking PII, offering orders to unverified/stale riders, or spamming admins.

**Architecture:** Backend-only edits to the `feasty-dispatch` edge-function domain (`supabase/functions/_shared/domains/dispatch.ts` + `_shared/dispatchSelection.ts` + two `_shared` helpers). Each fix only ever *reduces* what a caller receives or does; no client code, no schema migration, no `DISPATCH_ENABLED` flip. All five reuse existing prod infrastructure (the `auth_rl_hit` rate-limit RPC, the `FeatureFlag` table, existing response builders). Pure deno unit tests with fake clients prove each.

**Tech Stack:** Deno + TypeScript edge functions, Supabase (`serviceClient` PostgREST), `ensureRole` guards, `ClientSafeError`, `isFeatureEnabled`/`loadFeatureFlagMap`, `enforceRateLimit`/`auth_rl_hit`.

**Spec:** `docs/superpowers/specs/2026-10-15-dispatch-sp1-security-hardening-design.md`

## Global Constraints

- Backend only. Touch `supabase/functions/_shared/domains/dispatch.ts`, `supabase/functions/_shared/dispatchSelection.ts`, `supabase/functions/_shared/dispatchRiders.ts`, and new `_shared` helper/test files. **No** app code, **no** `apps/dispatch/app/_layout.tsx` flip.
- **No migration.** All five fixes use existing columns/tables (`DispatchRiderRecord.verificationStatus` exists via `20260827_courier_supply`; `FeatureFlag` table exists via `20260826_feature_flags.sql`, deployed; `auth_rate_limits`/`auth_rl_hit` exist via `20260712_auth_gateway.sql`). If any fix appears to need a new column, STOP and raise it — do not invent a migration.
- `deno check` runs from `supabase/`; the bar is **no new errors** over the ~210-error baseline ([[feasty-deno-check-baseline]]). `dispatch.ts` is NOT in the type-checked test list today, so tests that dynamically import it go in the SECOND (`--no-check`) `test:deno` invocation; tests that import only clean modules (`dispatchSelection.ts`, `dispatchRiders.ts`, new helpers) go in the FIRST (type-checked) invocation.
- Every new `*.test.ts` file MUST be appended to the matching `test:deno` invocation list in `package.json` or CI never runs it ([[ci-workflow-silent-norun]]).
- Changes never weaken an existing role guard. `ensureRole` signature: `ensureRole(context.role, ['dispatch','admin'])`.
- Client-safe errors only: throw `ClientSafeError(status, message)` (from `_shared/observability.ts`) or call the existing `fail(status, msg)` helper used in `dispatch.ts`. Never leak raw errors to clients.
- No new RPC action is added, so the four-copy action contract ([[feasty-rpc-action-count-guards]]) does NOT change. Do not touch `rpc/actions.ts`, the registry tests, or route maps.
- Deploy of `feasty-dispatch` and any FeatureFlag seeding are the OWNER's steps. This branch stops at merged, tested code. Never `supabase db push`.

## Review Focus

- **A dispatch-role token calling `dispatchGetRiders` for someone else's data** — must receive only its own record, never another rider's licence/plate/GPS. (Task 1 test.)
- **A pending-offer rider reading the queue** — must not receive `deliveryAddress`/`customerPhone`/`customerId`/precise coords for an offer it has not accepted. (Task 2 test.)
- **A rider with a stale (>120s) or missing live location** being offered an order — must be excluded from selection even if `status` is online and `verificationStatus='approved'`. (Task 3 test.)
- **An oversized or non-image KYC upload, and a flood of applications** — oversize/non-image rejected before any bucket write; the 4th application in the window returns 429. (Task 4 test.)
- **A delivery order while `platform_dispatch` is disabled** — `runAutomaticDispatchAssignment` returns `skipped` with zero DeliveryEvent writes and zero admin notifications. (Task 5 test.)

---

## File Structure

- `supabase/functions/_shared/dispatchRiders.ts` — add `buildFleetRiderResponse` (minimal projection) beside the existing `buildDispatchRiderResponse`. (Task 1)
- `supabase/functions/_shared/domains/dispatch.ts` — scope `dispatchGetRiders`, make `dispatchGetNearestRiders` admin-only (Task 1); redact offer snapshots in `dispatchGetDeliveryQueue` (Task 2); rate-limit + validate in `submitDispatchApplication`/`uploadDispatchDocument` (Task 4).
- `supabase/functions/_shared/dispatchSelection.ts` — add verification + location-freshness gates to candidate loading (Task 3); gate `runAutomaticDispatchAssignment` on the `platform_dispatch` feature flag (Task 5).
- `supabase/functions/_shared/offerRedaction.ts` — NEW: pure `redactOfferSnapshot(snapshot)` helper. (Task 2)
- `supabase/functions/_shared/rateLimit.ts` — NEW: `enforceDispatchRateLimit(key, policy)` wrapping the existing `auth_rl_hit` RPC without the auth-gateway salt dependency. (Task 4)
- `supabase/functions/_shared/riderEligibility.ts` — NEW: pure `isRiderEligibleForOffer({verificationStatus, lastLocationAtIso, nowMs, maxAgeSeconds})`. (Task 3)
- Test files (new): `dispatchFleetProjection.test.ts` (T1), `offerRedaction.test.ts` (T2), `riderEligibility.test.ts` (T3), `dispatchApplicationGuards.test.ts` (T4), `dispatchFeatureGate.test.ts` (T5).

Before Task 1, the implementer MUST open `dispatch.ts` around the cited line ranges to confirm exact variable names (the plan cites HEAD `main`); if a line moved, search by the function name given.

---

### Task 1: Scope rider fleet reads

**Files:**
- Modify: `supabase/functions/_shared/dispatchRiders.ts` (add `buildFleetRiderResponse` after `buildDispatchRiderResponse`, ~line 64)
- Modify: `supabase/functions/_shared/domains/dispatch.ts` — `dispatchGetRiders` (~557), `dispatchGetNearestRiders` (~922)
- Test: `supabase/functions/_shared/dispatchFleetProjection.test.ts` (NEW)

**Interfaces:**
- Consumes: `DispatchRiderRow`, `mergeRiderLiveLocation`, `buildDispatchRiderResponse` (existing).
- Produces: `buildFleetRiderResponse(rider: DispatchRiderRow): FleetRiderResponse` where `FleetRiderResponse = { id: string; displayName: string; status: string; zone: string; vehicleType: string; activeLoad: number; latitude: number | null; longitude: number | null; ratingAverage: number | null }` — coarse lat/lng rounded to 3 decimals, and NONE of `licenseNumber`, `vehiclePlateNumber`, `verifiedByUid`, `verifiedAt`, `phoneNumber`, `currentAddress`, `verificationStatus`.

- [ ] **Step 1: Write the failing test**

```typescript
// dispatchFleetProjection.test.ts
import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { buildFleetRiderResponse } from './dispatchRiders.ts';

Deno.test('fleet projection omits PII and coarsens location', () => {
  const r = buildFleetRiderResponse({
    id: 'rider-1', displayName: 'Ada', status: 'Available', zone: 'Yaba',
    vehicleType: 'Bike', activeLoad: 2, latitude: 6.512345, longitude: 3.378912,
    licenseNumber: 'LIC-999', vehiclePlateNumber: 'ABC-123', verifiedByUid: 'admin-1',
    verifiedAt: '2026-01-01', phoneNumber: '+234800', currentAddress: '1 Road',
    verificationStatus: 'approved', acceptanceRate: 0.9,
  } as never);
  assertEquals(r.id, 'rider-1');
  assertEquals(r.activeLoad, 2);
  assertEquals(r.latitude, 6.512);       // 3-decimal coarsening
  assertEquals(r.longitude, 3.379);
  assert(!('licenseNumber' in r), 'licenseNumber must be absent');
  assert(!('vehiclePlateNumber' in r), 'plate must be absent');
  assert(!('verifiedByUid' in r), 'verifiedByUid must be absent');
  assert(!('phoneNumber' in r), 'phone must be absent');
  assert(!('currentAddress' in r), 'address must be absent');
});

Deno.test('fleet projection keeps null location null', () => {
  const r = buildFleetRiderResponse({
    id: 'r2', displayName: 'B', status: 'Available', zone: 'Z', vehicleType: 'Bike',
    activeLoad: 0, latitude: null, longitude: null,
  } as never);
  assertEquals(r.latitude, null);
  assertEquals(r.longitude, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test -A --no-lock --config supabase/deno.json supabase/functions/_shared/dispatchFleetProjection.test.ts`
Expected: FAIL — `buildFleetRiderResponse` is not exported.

- [ ] **Step 3: Implement `buildFleetRiderResponse`**

In `dispatchRiders.ts`, after `buildDispatchRiderResponse`:

```typescript
const coarsen = (v: number | null | undefined): number | null =>
  v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 1000) / 1000;

/**
 * Minimal rider projection for operational fleet views. Deliberately omits
 * every PII/credential field (licence, plate, verifier, phone, address) and
 * coarsens live location to ~110m. Admin live-map precision is a later
 * sub-project; SP-1 ships coarse.
 */
export const buildFleetRiderResponse = (rider: DispatchRiderRow) => ({
  id: rider.id,
  displayName: sanitizeText(rider.displayName, 'Dispatch rider'),
  status: sanitizeText(rider.status, DEFAULT_DISPATCH_STATUS),
  zone: sanitizeText(rider.zone),
  vehicleType: sanitizeText(rider.vehicleType, DEFAULT_DISPATCH_VEHICLE),
  activeLoad: rider.activeLoad ?? 0,
  latitude: coarsen(rider.latitude),
  longitude: coarsen(rider.longitude),
  ratingAverage: (rider as { ratingAverage?: number | null }).ratingAverage ?? null,
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2. Expected: PASS (both tests).

- [ ] **Step 5: Scope the two handlers**

In `dispatch.ts` `dispatchGetRiders` (~557): after `ensureRole(context.role, ['dispatch','admin'])`, branch on role. For `admin`, keep the full-table read but map through `buildFleetRiderResponse`. For `dispatch`, constrain the query to the caller and return their own full record:

```typescript
const dispatchGetRiders: Handler = async ({ context }) => {
  ensureRole(context.role, ['dispatch', 'admin']);

  const baseQuery = serviceClient
    .from('DispatchRiderRecord')
    .select(DISPATCH_RIDER_COLUMNS)
    .order('updatedAt', { ascending: false });
  const { data: riders, error } = context.role === 'admin'
    ? await baseQuery
    : await baseQuery.eq('id', context.uid);
  if (error) throw new Error(error.message);

  // live-location merge block is unchanged ...

  return json(200, {
    data: {
      riders: ((riders ?? []) as DispatchRiderRow[]).map((rider) => {
        const merged = mergeRiderLiveLocation(rider, liveById.get(rider.id), nowMs);
        return context.role === 'admin'
          ? buildFleetRiderResponse(merged)
          : buildDispatchRiderResponse(merged); // caller's own full record
      }),
    },
  });
};
```

In `dispatchGetNearestRiders` (~922): change the guard to `ensureRole(context.role, ['admin'])` and map its result rows through `buildFleetRiderResponse`. (Confirm first via `grep -rn dispatchGetNearestRiders apps/dispatch` that no `dispatch`-role client calls it; the inventory says only ops uses it. If a dispatch-role client does call it, STOP and raise it.)

- [ ] **Step 6: Add the handler-scoping test (no-check invocation)**

Create `dispatchFleetScope.test.ts` that sets the env stubs (see `dispatchSelection.test.ts` header), stubs `serviceClient`, dynamically imports `dispatch.ts`, and asserts a `dispatch`-role context returns only rows with `id === context.uid` and that a returned row has no `licenseNumber` only when admin. Use the fake-client pattern from `domains/adminSetRestaurantPublished.test.ts`. (Full fake-client code: copy that file's `makeClient` helper verbatim and adapt the table name.)

- [ ] **Step 7: Register both test files**

Append `dispatchFleetProjection.test.ts` to the FIRST (type-checked) `test:deno` list and `dispatchFleetScope.test.ts` to the SECOND (`--no-check`) list in `package.json`.

- [ ] **Step 8: Run full deno suite + check**

Run: `npm run test:deno` and `cd supabase && deno check` (expect no new errors vs baseline).

- [ ] **Step 9: Commit**

```bash
git add supabase/functions/_shared/dispatchRiders.ts supabase/functions/_shared/domains/dispatch.ts supabase/functions/_shared/dispatchFleetProjection.test.ts supabase/functions/_shared/dispatchFleetScope.test.ts package.json
git commit -m "fix(dispatch): scope rider fleet reads to caller/admin, drop PII projection"
```

---

### Task 2: Redact customer PII in pending offers

**Files:**
- Create: `supabase/functions/_shared/offerRedaction.ts`
- Modify: `supabase/functions/_shared/domains/dispatch.ts` — `dispatchGetDeliveryQueue` (~433, the `offers` mapping near ~538)
- Test: `supabase/functions/_shared/offerRedaction.test.ts` (NEW)

**Interfaces:**
- Consumes: the object shape returned by `toOrderSnapshotResponse` (an order snapshot with at least `id`, `restaurantName`, `restaurantLocation?`, `deliveryAddress?`, `deliveryLocation?`, `customerId?`, `customerPhone?`, `payment?`, `itemCount?`/`items?`, `pricing?`/`total?`).
- Produces: `redactOfferSnapshot(snapshot: OrderSnapshot): OrderSnapshot` — returns a shallow copy with `deliveryAddress`, `customerId`, `customerPhone` removed; `deliveryLocation` coarsened to 3 decimals; `payment` reduced to `{ status }` only. Restaurant fields, order value, and item count pass through unchanged.

- [ ] **Step 1: Write the failing test**

```typescript
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { redactOfferSnapshot } from './offerRedaction.ts';

Deno.test('redaction strips address/phone/customerId, coarsens coords, reduces payment', () => {
  const out = redactOfferSnapshot({
    id: 'o1', restaurantName: 'Mama Put', restaurantLocation: { latitude: 6.5, longitude: 3.3 },
    deliveryAddress: '15 Secret Lane', deliveryLocation: { latitude: 6.512345, longitude: 3.378912 },
    customerId: 'cust-9', customerPhone: '+2348001234567',
    payment: { method: 'card', status: 'paid', reference: 'ref_x' },
    itemCount: 3, pricing: { total: 4300 },
  } as never) as Record<string, never>;
  assert(!('deliveryAddress' in out), 'address must be gone');
  assert(!('customerId' in out), 'customerId must be gone');
  assert(!('customerPhone' in out), 'phone must be gone');
  assertEquals((out.deliveryLocation as { latitude: number }).latitude, 6.512);
  assertEquals(out.payment as unknown, { status: 'paid' });  // method/reference gone
  assertEquals(out.restaurantName as unknown, 'Mama Put');   // kept
  assertEquals((out.pricing as { total: number }).total, 4300); // kept
});

Deno.test('redaction tolerates missing optional fields', () => {
  const out = redactOfferSnapshot({ id: 'o2', restaurantName: 'X' } as never);
  assertEquals((out as { id: string }).id, 'o2');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test -A --no-lock --config supabase/deno.json supabase/functions/_shared/offerRedaction.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `offerRedaction.ts`**

```typescript
// Server-side redaction of an order snapshot for a PENDING offer. The rider
// has not accepted, so they must not receive the customer's address, phone,
// id, or payment detail -- today the offer screen only HIDES these; the data
// is still in the payload. Applied to pending offers only; an owned (accepted)
// order keeps its full snapshot because the rider needs the address to deliver.

const coarsen = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null;

export const redactOfferSnapshot = <T extends Record<string, unknown>>(snapshot: T): T => {
  const { deliveryAddress: _a, customerId: _c, customerPhone: _p, ...rest } =
    snapshot as Record<string, unknown>;
  const loc = rest.deliveryLocation as { latitude?: unknown; longitude?: unknown } | null | undefined;
  if (loc && typeof loc === 'object') {
    rest.deliveryLocation = { latitude: coarsen(loc.latitude), longitude: coarsen(loc.longitude) };
  }
  const payment = rest.payment as { status?: unknown } | null | undefined;
  if (payment && typeof payment === 'object') {
    rest.payment = { status: payment.status ?? null };
  }
  return rest as T;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: same as Step 2. Expected: PASS.

- [ ] **Step 5: Apply in `dispatchGetDeliveryQueue`**

In `dispatch.ts` (~538), the pending `offers` array maps each offer through `toOrderSnapshotResponse(...)`. Wrap ONLY that offer-snapshot call in `redactOfferSnapshot(...)`. Leave the owned-order snapshot (the separate `toOrderSnapshotResponse` at ~547 for orders the caller owns) UNredacted. Import `redactOfferSnapshot` at the top of the file.

- [ ] **Step 6: Verify `dispatchGetOrderDetail` blocks pending-offer riders**

Read `dispatchGetOrderDetail` (~655). Confirm its access predicate is ownership/admin/manual-queue and that a pending-offer-only rider (not owner, order not in manual queue) is refused. If it is already refused, add a short assertion to `dispatchFleetScope.test.ts` (or a new `dispatchOrderDetailAccess.test.ts`, `--no-check` list) proving a non-owner/non-manual pending-offer rider gets the refusal. If it is NOT refused, that is an in-scope leak: add the ownership/manual-queue check and test it.

- [ ] **Step 7: Register test(s)** in the matching `package.json` `test:deno` lists (`offerRedaction.test.ts` → type-checked list; any dispatch.ts-importing test → `--no-check` list).

- [ ] **Step 8: Run `npm run test:deno` + `deno check`.** Expected: PASS, no new check errors.

- [ ] **Step 9: Commit**

```bash
git add supabase/functions/_shared/offerRedaction.ts supabase/functions/_shared/offerRedaction.test.ts supabase/functions/_shared/domains/dispatch.ts package.json
git commit -m "fix(dispatch): redact customer address/phone/payment in pending offers server-side"
```

---

### Task 3: Verification + location-freshness eligibility gates

**Files:**
- Create: `supabase/functions/_shared/riderEligibility.ts`
- Modify: `supabase/functions/_shared/dispatchSelection.ts` — `loadDispatchCandidates` (~228) and `isDispatcherEligible` (~208)
- Test: `supabase/functions/_shared/riderEligibility.test.ts` (NEW) + extend `dispatchSelection.test.ts`

**Interfaces:**
- Consumes: `DispatchRiderRow` (now includes `verificationStatus`), `rider_live_location.updated_at` recency.
- Produces: `isRiderEligibleForOffer(args: { verificationStatus: string | null | undefined; lastLocationAtMs: number | null; nowMs: number; maxAgeSeconds: number }): boolean` — true iff `verificationStatus === 'approved'` AND `lastLocationAtMs !== null` AND `(nowMs - lastLocationAtMs) <= maxAgeSeconds*1000`.
- Produces: `DISPATCH_MAX_LOCATION_AGE_SECONDS = 120` exported constant.

- [ ] **Step 1: Write the failing test**

```typescript
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { isRiderEligibleForOffer, DISPATCH_MAX_LOCATION_AGE_SECONDS } from './riderEligibility.ts';

const now = 1_000_000_000_000;
Deno.test('approved + fresh location is eligible', () => {
  assertEquals(isRiderEligibleForOffer({ verificationStatus: 'approved', lastLocationAtMs: now - 10_000, nowMs: now, maxAgeSeconds: 120 }), true);
});
Deno.test('unapproved is ineligible even if fresh', () => {
  assertEquals(isRiderEligibleForOffer({ verificationStatus: 'pending', lastLocationAtMs: now, nowMs: now, maxAgeSeconds: 120 }), false);
});
Deno.test('stale location is ineligible', () => {
  assertEquals(isRiderEligibleForOffer({ verificationStatus: 'approved', lastLocationAtMs: now - 200_000, nowMs: now, maxAgeSeconds: 120 }), false);
});
Deno.test('missing location is ineligible', () => {
  assertEquals(isRiderEligibleForOffer({ verificationStatus: 'approved', lastLocationAtMs: null, nowMs: now, maxAgeSeconds: 120 }), false);
});
Deno.test('default max age is 120s', () => { assertEquals(DISPATCH_MAX_LOCATION_AGE_SECONDS, 120); });
```

- [ ] **Step 2: Run to verify fail.** Run: `deno test -A --no-lock --config supabase/deno.json supabase/functions/_shared/riderEligibility.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `riderEligibility.ts`**

```typescript
// An order is only offered to a rider who is (a) KYC-approved and (b) reporting
// a recent location. Matching previously checked neither, so a pending/unverified
// rider, or one whose app last pinged hours ago, could be offered and accept a
// real delivery. Pure function; the DB reads live in dispatchSelection.ts.
export const DISPATCH_MAX_LOCATION_AGE_SECONDS = 120;

export const isRiderEligibleForOffer = (args: {
  verificationStatus: string | null | undefined;
  lastLocationAtMs: number | null;
  nowMs: number;
  maxAgeSeconds: number;
}): boolean => {
  if (args.verificationStatus !== 'approved') return false;
  if (args.lastLocationAtMs === null) return false;
  return args.nowMs - args.lastLocationAtMs <= args.maxAgeSeconds * 1000;
};
```

- [ ] **Step 4: Run to verify pass.** Expected: PASS.

- [ ] **Step 5: Wire gates into `loadDispatchCandidates`**

In `dispatchSelection.ts`:
1. Add `verificationStatus` to the `DispatchRiderRecord` select in `loadDispatchCandidates` (~246): `.select('id,displayName,status,activeLoad,latitude,longitude,verificationStatus')`.
2. Load last-location timestamps for the candidate ids from `rider_live_location` in the same `Promise.all` block: `serviceClient.from('rider_live_location').select('rider_id,updated_at').in('rider_id', userIds)`. Build a `Map<string, number>` of `rider_id → Date.parse(updated_at)`.
3. In the candidate loop (~266), after the existing `isDispatcherEligible` check, also require `isRiderEligibleForOffer({ verificationStatus: rider?.verificationStatus, lastLocationAtMs: locMap.get(userId) ?? null, nowMs: Date.now(), maxAgeSeconds: DISPATCH_MAX_LOCATION_AGE_SECONDS })`. Skip the candidate if false.
4. Import `isRiderEligibleForOffer, DISPATCH_MAX_LOCATION_AGE_SECONDS` at the top.

Keep `NEUTRAL_DISTANCE_KM` scoring untouched — an ineligible rider never reaches scoring now, so the neutral fallback only ever applies to an approved+fresh rider whose durable coords lag.

- [ ] **Step 6: Extend `dispatchSelection.test.ts`**

Add a test using the existing fake-client pattern in that file: seed two dispatch riders (one `approved` with a fresh `rider_live_location` row, one `approved` but with a 5-minute-old row), run `runAutomaticDispatchAssignment` for a ready delivery order, and assert the fresh rider is the one offered (inspect the `offerDispatchAssignment` fake call / returned `courierId`). Add a second asserting a `pending` rider is never offered. (Reuse the file's existing fake `serviceClient` builder; extend its table map with `rider_live_location`.)

- [ ] **Step 7: Register** `riderEligibility.test.ts` in the FIRST (type-checked) `test:deno` list. `dispatchSelection.test.ts` is already registered.

- [ ] **Step 8: Run `npm run test:deno` + `deno check`.** Expected PASS, no new errors. (`dispatchSelection.ts` is in the type-checked list, so a type error here fails CI — keep the new reads typed.)

- [ ] **Step 9: Commit**

```bash
git add supabase/functions/_shared/riderEligibility.ts supabase/functions/_shared/riderEligibility.test.ts supabase/functions/_shared/dispatchSelection.ts supabase/functions/_shared/dispatchSelection.test.ts package.json
git commit -m "fix(dispatch): only offer orders to approved riders with a fresh location"
```

---

### Task 4: Rate-limit & bound the KYC application upload

**Files:**
- Create: `supabase/functions/_shared/rateLimit.ts`
- Modify: `supabase/functions/_shared/domains/dispatch.ts` — `submitDispatchApplication` (~1347), `uploadDispatchDocument` call sites (~1412/1418) and the `uploadDispatchDocument` definition (find via `grep -n "uploadDispatchDocument" supabase/functions/_shared`)
- Test: `supabase/functions/_shared/rateLimit.test.ts` + `supabase/functions/_shared/dispatchUploadGuards.test.ts` (NEW)

**Interfaces:**
- Consumes: existing `auth_rl_hit` RPC (prod) and `ClientSafeError`.
- Produces: `enforceDispatchRateLimit(key: string, policy: { limit: number; windowSecs: number; lockoutSecs: number }): Promise<void>` — throws `ClientSafeError(429, 'Too many attempts. Please try again later.')` when over limit; fails OPEN on RPC error (abuse brake, not a credential gate).
- Produces: `assertUploadAllowed(input: { contentType?: string | null; base64: string; maxBytes: number }): void` — throws `ClientSafeError(400, ...)` for a non-allowlisted mime or an decoded size over `maxBytes`. Allowlist: `image/jpeg`, `image/png`, `image/webp`.

- [ ] **Step 1: Write the failing tests**

```typescript
// rateLimit.test.ts
Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'x'); Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'x');
import { assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
// Inject a fake serviceClient via the same module-stub pattern the repo uses,
// OR test assertUploadAllowed (pure) here and cover enforceDispatchRateLimit in
// the dispatch handler test. Prefer the pure test for determinism:
const { assertUploadAllowed } = await import('./rateLimit.ts');

Deno.test('rejects non-image mime', () => {
  assertRejects(async () => assertUploadAllowed({ contentType: 'application/pdf', base64: 'AAAA', maxBytes: 5_000_000 }));
});
Deno.test('rejects oversize', () => {
  const big = 'A'.repeat(8_000_000); // ~6MB decoded
  assertRejects(async () => assertUploadAllowed({ contentType: 'image/png', base64: big, maxBytes: 5_000_000 }));
});
Deno.test('accepts small jpeg', () => {
  assertUploadAllowed({ contentType: 'image/jpeg', base64: 'AAAA', maxBytes: 5_000_000 }); // no throw
});
```

Note: `assertUploadAllowed` is synchronous; wrap in `async () => { assertUploadAllowed(...) }` for `assertRejects`, or use a try/catch assertion. Keep whichever compiles; the behavior asserted is the contract.

- [ ] **Step 2: Run to verify fail.** Run the file → FAIL (module missing).

- [ ] **Step 3: Implement `rateLimit.ts`**

```typescript
import { serviceClient } from './client.ts';
import { ClientSafeError, logEdgeEvent } from './observability.ts';

const TOO_MANY = 'Too many attempts. Please try again later.';
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export const enforceDispatchRateLimit = async (
  key: string,
  policy: { limit: number; windowSecs: number; lockoutSecs: number },
): Promise<void> => {
  const { data, error } = await serviceClient.rpc('auth_rl_hit', {
    p_key: `dispatch:${key}`,
    p_limit: policy.limit,
    p_window_secs: policy.windowSecs,
    p_lockout_secs: policy.lockoutSecs,
  });
  if (error) { logEdgeEvent('error', 'dispatch rate limit RPC failed', { reason: error.message }); return; }
  const row = Array.isArray(data) ? data[0] : data;
  if (row && row.allowed === false) throw new ClientSafeError(429, TOO_MANY);
};

// base64 length N decodes to roughly N*3/4 bytes.
const decodedBytes = (base64: string): number => Math.floor((base64.length * 3) / 4);

export const assertUploadAllowed = (input: {
  contentType?: string | null;
  base64: string;
  maxBytes: number;
}): void => {
  const type = (input.contentType ?? '').toLowerCase().split(';')[0].trim();
  if (!ALLOWED_IMAGE_TYPES.has(type)) throw new ClientSafeError(400, 'Upload must be a JPEG, PNG, or WebP image.');
  if (!input.base64 || decodedBytes(input.base64) > input.maxBytes) {
    throw new ClientSafeError(400, 'Image is too large. Please upload a photo under 5 MB.');
  }
};
```

(Note: `auth_rl_hit`'s key column is `text` and the auth-gateway hashes its keys; here we store `dispatch:<uid>` unhashed. That is acceptable — the table is service-role-only and a uid is not a secret. We intentionally avoid the auth-gateway `hashValue` path so this does not depend on `AUTH_HASH_SALT` being present in the `feasty-dispatch` function env — see [[feasty-staff-invites]].)

- [ ] **Step 4: Run to verify pass.** Expected PASS.

- [ ] **Step 5: Apply guards in the handler**

In `submitDispatchApplication` (~1347), as the FIRST line inside the handler body (after reading `context`):

```typescript
await enforceDispatchRateLimit(`apply:${context.uid}`, { limit: 3, windowSecs: 3600, lockoutSecs: 900 });
```

In `uploadDispatchDocument` (its definition), before the storage upload call, extract the declared content type and base64 and call:

```typescript
assertUploadAllowed({ contentType, base64: rawBase64, maxBytes: 5_000_000 });
```

If `uploadDispatchDocument` currently receives a data URL, parse the `data:<mime>;base64,<payload>` prefix for `contentType` and strip it before decoding. If the mime is not in the payload at all, require the caller to pass it; do not default to an allowed type. Import both helpers at the top of `dispatch.ts`.

- [ ] **Step 6: Add handler guard test**

`dispatchUploadGuards.test.ts` (`--no-check` list): fake `serviceClient` so `auth_rl_hit` returns `{allowed:false}`, dynamically import `dispatch.ts`, call `submitDispatchApplication` with a valid-looking payload, assert it throws 429. Second case: `auth_rl_hit` returns `{allowed:true}` but a `application/pdf` document → assert 400 and assert the storage upload fake was never called.

- [ ] **Step 7: Register** `rateLimit.test.ts` (type-checked list) and `dispatchUploadGuards.test.ts` (`--no-check` list) in `package.json`.

- [ ] **Step 8: Run `npm run test:deno` + `deno check`.** Expected PASS, no new errors.

- [ ] **Step 9: Commit**

```bash
git add supabase/functions/_shared/rateLimit.ts supabase/functions/_shared/rateLimit.test.ts supabase/functions/_shared/dispatchUploadGuards.test.ts supabase/functions/_shared/domains/dispatch.ts package.json
git commit -m "fix(dispatch): rate-limit KYC applications and bound upload size/mime"
```

---

### Task 5: Gate auto-dispatch behind a feature flag (stop empty-pool spam)

**Files:**
- Modify: `supabase/functions/_shared/dispatchSelection.ts` — `runAutomaticDispatchAssignment` (~539, the early-return block near ~547-558)
- Test: `supabase/functions/_shared/dispatchFeatureGate.test.ts` (NEW)

**Interfaces:**
- Consumes: `loadFeatureFlagMap` and `isFeatureEnabled` from `_shared/featureFlags.ts`.
- Produces: no new exported symbol. `runAutomaticDispatchAssignment` now returns `{ outcome: 'skipped' }` when the `platform_dispatch` flag is not enabled, before any candidate load, event write, or notification.

**Design note (deviation from spec Fix 5, intentional):** The spec described skipping for "self-delivery" orders, but there is no restaurant field distinguishing platform-dispatched from self-delivered orders — every delivery order currently attempts platform dispatch, which is why the empty-pool notification fires for all of them while there are zero riders. The correct, migration-free, reversible control is the existing `FeatureFlag` table: gate ALL auto-dispatch behind `platform_dispatch` (absent/false by default). This produces zero offers and zero spam until the pilot, and SP-6 enables the flag together with the app. This strengthens the spec's intent (stop the spam) rather than weakening it. The owner seeds/enables the flag at pilot time.

- [ ] **Step 1: Write the failing test**

```typescript
Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SERVICE_ROLE_KEY', 'x'); Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'x');
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
// Stub featureFlags so the flag is OFF, then assert runAutomaticDispatchAssignment
// returns 'skipped' and never calls the candidate loader / notifier.
// Use the repo's module-import-after-env pattern; inject a fake serviceClient
// whose FeatureFlag select returns [] (flag absent => disabled).
const { runAutomaticDispatchAssignment } = await import('./dispatchSelection.ts');

Deno.test('auto-dispatch is a no-op when platform_dispatch flag is off', async () => {
  const order = { id: 'o1', restaurantId: 'r1', fulfillmentType: 'delivery', status: 'ready_for_pickup' } as never;
  const res = await runAutomaticDispatchAssignment(order, null, 'actor', 'ready_for_pickup', async () => ({ load: 1, distance: 0.15 }));
  assertEquals(res.outcome, 'skipped');
});
```

(The fake `serviceClient` must return `[]` for the `FeatureFlag` table select so `isFeatureEnabled(map,'platform_dispatch')` is false. Reuse the fake-client builder already in `dispatchSelection.test.ts`; add a `FeatureFlag` entry returning `[]`.)

- [ ] **Step 2: Run to verify fail.** Run the file → FAIL (currently it proceeds to candidate loading / returns `pool_empty`, not `skipped`).

- [ ] **Step 3: Implement the gate**

In `runAutomaticDispatchAssignment`, immediately after the `AUTO_DISPATCH_ELIGIBLE_STATUSES` and `fulfillmentType` early returns (~554, before the `already_assigned` check), add:

```typescript
const flags = await loadFeatureFlagMap();
if (!isFeatureEnabled(flags, 'platform_dispatch')) {
  return { outcome: 'skipped' };
}
```

Import at top: `import { isFeatureEnabled, loadFeatureFlagMap } from './featureFlags.ts';`. Place the gate AFTER the cheap status/fulfillment checks (so a pickup order still short-circuits without a flag read) but BEFORE any DB read, candidate load, event insert, or `notifyAdmins` call — that is what removes the spam.

- [ ] **Step 4: Run to verify pass.** Expected PASS. Also re-run the existing `dispatchSelection.test.ts` offered/exhausted tests: they must now stub the flag ON (add a `FeatureFlag` row with `key:'platform_dispatch', enabled:true` to those tests' fake client) or they will all return `skipped`. Update those fixtures as part of this step.

- [ ] **Step 5: Register** `dispatchFeatureGate.test.ts` in the FIRST (type-checked) `test:deno` list.

- [ ] **Step 6: Run `npm run test:deno` + `deno check`.** Expected PASS (including updated existing tests), no new errors.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/dispatchSelection.ts supabase/functions/_shared/dispatchFeatureGate.test.ts supabase/functions/_shared/dispatchSelection.test.ts package.json
git commit -m "fix(dispatch): gate auto-dispatch behind platform_dispatch feature flag"
```

---

## Final verification (whole-branch, after all tasks)

- [ ] `npm run test:deno` green end-to-end.
- [ ] `cd supabase && deno check` reports no new errors vs the ~210 baseline.
- [ ] `git grep -n "buildDispatchRiderResponse" supabase/functions` — confirm the only remaining full-PII callers are the rider's own-profile path and `dispatchGetOrderDetail`'s courier snapshot, never a fleet list.
- [ ] Confirm no app file changed: `git diff --stat main -- apps/` is empty.
- [ ] Confirm no migration added: `git diff --stat main -- supabase/migrations functions/prisma` is empty.
- [ ] Owner action note for the PR body: deploy `feasty-dispatch`; the `platform_dispatch` flag stays OFF until the pilot (SP-6).
