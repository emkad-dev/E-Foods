# Dispatch SP-1 — Security & correctness hardening (design spec)

Date: 2026-10-15. Branch: `feature/dispatch-glovo-sp1`. Worktree: `C:\Users\emkad\EBuy\dispatch-glovo-wt`.

## Context & intent

FEASTY is bringing its rider-dispatch system up to Uber Eats / Glovo standard as a
**one-city pilot** (~30 riders), built subagent-driven, phased: shared delivery engine
first, restaurant-owned riders ship first, the FEASTY cross-restaurant pool opens later.
The whole effort is six sub-projects (SP-1…SP-6); this spec is **SP-1 only** — the P0
security and correctness fixes that must land before the dispatch app can be switched on
for real riders and real customer data.

The dispatch backend is already live in production today (it runs auto-offer logic on
every accepted delivery order) even though the rider app is gated off by
`DISPATCH_ENABLED = false` at `apps/dispatch/app/_layout.tsx:27`. That makes these
server-side exposures reachable now, not hypothetical. **SP-1 does not flip the gate**
(that is SP-6) and does not change any client UX; it is backend-only hardening plus the
matching-eligibility correctness gates.

Decisions carried in from brainstorming that affect SP-1's siblings but **not** SP-1's
scope: tracking is foreground-only for the pilot; cash orders are disabled for
rider-delivered orders (enforced in SP-4); OTP proof of delivery is SP-2; availability
toggle is SP-3; payouts are SP-4; SOS and offer sound channel are SP-5; minimal ops
console and the `com.ebuy.dispatch`→`com.feasty.dispatch` rename and the
`DISPATCH_ENABLED` flip are SP-6.

Success = the five fixes below land with tests, the deno check baseline gains no new
errors, and no change is observable to a correctly-behaving dispatcher or rider beyond
reduced data in payloads. Deploy of the edge functions and any migration is the owner's
step, not this branch's.

## Scope — five fixes

All file:line references are against HEAD of `main` (9089b08) via the dispatch inventory.

### Fix 1 — Scope rider fleet reads (data exposure)

**Problem.** `dispatchGetRiders` (`supabase/functions/_shared/domains/dispatch.ts:557`)
returns **every** `DispatchRiderRecord` — including `licenseNumber`, `vehiclePlateNumber`,
`verifiedByUid`, `verifiedAt`, and live `latitude`/`longitude` — to any user holding the
`dispatch` role. A rider is a dispatch-role user, so any rider can read every other
rider's PII and live position. `dispatchGetNearestRiders` (`:922`) exposes the same
fields and is also unscoped.

**Fix.**
- Split the response projection into two shapes:
  - **`selfRiderResponse`** — the caller's own full record (unchanged fields), returned to
    a `dispatch`-role caller for their own row only.
  - **`fleetRiderResponse`** — a minimal projection for operational fleet views:
    `id`, `displayName`, `status`, `zone`, `vehicleType`, `activeLoad`, coarse location
    only (see below), `ratingAverage`. **No** `licenseNumber`, `vehiclePlateNumber`,
    `verifiedByUid`, `phoneNumber`, `currentAddress`.
- `dispatchGetRiders`: if `context.role === 'admin'`, return the fleet projection for all
  riders. If `context.role === 'dispatch'`, return only the caller's own record
  (`riders.filter(r => r.id === context.uid)` equivalent, enforced in the query via
  `.eq('id', context.uid)`), full self shape. This preserves the one legitimate
  dispatch-role caller: `apps/dispatch/app/(dispatch)/profile.tsx` looks up its own row
  from the returned list.
- `dispatchGetNearestRiders`: admin-only (`ensureRole(context.role, ['admin'])`), fleet
  projection. It is an ops/selection tool, not a rider-facing call. Confirm no
  dispatch-role client code calls it (inventory says it is the only caller of
  `ebuy_nearest_riders`; the selection engine calls the SQL helper directly, not this RPC).
- Coarse location for the fleet projection: round lat/lng to 3 decimals (~110 m) so a
  dispatcher sees approximate position without a rider's precise doorstep. Admin live-map
  precision is an SP-6 concern; SP-1 ships coarse.

**Acceptance.** A `dispatch`-role token calling `dispatchGetRiders` receives exactly one
rider (itself) with no other rider's row present. An `admin` token receives all riders
with the minimal projection and none of the four forbidden fields. `dispatchGetNearestRiders`
returns 403 for a `dispatch` token.

### Fix 2 — Redact customer PII in offers until accept

**Problem.** The rider offer screen claims "Address shared on accept"
(`apps/dispatch/app/(dispatch)/offer/[id].tsx:193`), but `dispatchGetDeliveryQueue`
(`dispatch.ts:433`) embeds the full `toOrderSnapshotResponse` in each pending offer,
which includes `deliveryAddress`, `deliveryLocation`, `customerId` and `payment`. The
redaction is cosmetic (client-side) — the data is already on the device. A rider can
read every offered customer's exact address and payment detail before accepting.

**Fix.**
- Add a `redactOrderSnapshotForOffer(snapshot)` helper that returns, for a **pending,
  not-yet-accepted** offer: restaurant name/location, delivery **area/zone label and the
  straight-line distance band** (needed to judge the offer), order value and item count,
  and nothing else. Omit `deliveryAddress`, precise `deliveryLocation` (keep only a
  coarse 3-decimal point for the map pin, or the zone centroid), `customerId`,
  `customerPhone`, and full `payment` (keep only `method` + `status` if the rider needs
  prepaid-vs-… — but cash is disabled for dispatch orders per SP-4, so method is always
  online; keep nothing sensitive).
- Apply the redaction in `dispatchGetDeliveryQueue` to the `offers` array only. Orders the
  caller **owns** (already accepted/assigned) keep the full snapshot — the rider needs the
  address to deliver.
- `dispatchGetOrderDetail` (`:655`) already gates on ownership/admin/manual-queue; leave
  its full detail (including `customerPhone`) but confirm a pending-offer rider who does
  **not** own the order cannot reach it (it requires ownership or manual-queue; a pending
  offer is neither — verify and add a test).

**Acceptance.** A rider with a pending offer, fetching the queue, receives no
`deliveryAddress`, no `customerPhone`, no `customerId`, and only coarse delivery
coordinates for that offer. After accepting (owns the order), the same order in the queue
carries the full address. A pending-offer rider calling `dispatchGetOrderDetail` on that
order gets 403/404.

### Fix 3 — Eligibility gates in matching (correctness + safety)

**Problem.** Rider selection eligibility
(`supabase/functions/_shared/domains/dispatchSelection.ts:208-221`) is only "not
`accountDisabled` and `status != 'Offline'`". It does **not** check
`verificationStatus` or GPS freshness, so an **unverified/pending** rider, or one whose
last ping is hours old, can be offered (and can accept) real orders. `ebuy_nearest_riders`
likewise does not filter by status or verification.

**Fix.**
- Add two eligibility predicates to the candidate filter in `dispatchSelection.ts`:
  1. `verificationStatus === 'approved'` — never offer to a rider who is not approved.
     (Column added by `20260827_courier_supply`.)
  2. **Location freshness** — exclude riders whose most recent `rider_live_location`
     /`DispatchRiderPing` is older than a configurable `DISPATCH_MAX_LOCATION_AGE_SECONDS`
     (default 120s). A rider with no location at all is **not** silently given the
     neutral 6 km score for *eligibility* purposes — no fresh location ⇒ ineligible. (The
     neutral-distance fallback in `dispatchWeights.ts` may remain for *scoring* among
     already-eligible riders, but an ineligible rider never reaches scoring.)
- These are gates in the application-layer candidate loader. SP-1 does **not** rewrite
  `ebuy_nearest_riders` (that SQL helper is only used by the now-admin-only
  `dispatchGetNearestRiders`); note it as a follow-up but out of SP-1 scope.

**Acceptance.** Given a pending verified rider and an approved rider both online and near
a ready order, only the approved rider is offered. Given an approved rider whose last
ping is 5 minutes old and another whose ping is 10 s old, only the fresh one is offered.
Unit tests drive `selectDispatchCourierForRestaurant`/the candidate loader with fixtures.

### Fix 4 — Rate-limit & bound the KYC application upload

**Problem.** `submitDispatchApplication` (`dispatch.ts:1347`) has **no role guard**
(any authenticated user — acceptable, it is an application), **no rate limit**, and the
licence-image upload (`uploadDispatchDocument`) has no visible size cap or mime allowlist;
the base64 travels inside the JSON RPC body to the `dispatch-kyc` bucket.

**Fix.**
- Add a per-user rate limit on `submitDispatchApplication` using the existing rate-limit
  RPC/helper used elsewhere in the auth gateway (reuse, do not invent): e.g. max 3
  submissions per hour per uid. On exceed, `fail(429, …)` with a client-safe message and
  `Retry-After`.
- In `uploadDispatchDocument`: enforce an allowlist of `image/jpeg`, `image/png`,
  `image/webp`; reject anything else with a client-safe 400. Enforce a max decoded size
  (e.g. 5 MB per image); reject oversize with 400 before the upload call. Validate the
  base64 decodes to a buffer of a sane length first.

**Acceptance.** A 4th application within an hour returns 429. A non-image or >5 MB payload
returns 400 and nothing is written to the bucket. A valid jpeg/png/webp under the cap
still succeeds.

### Fix 5 — Suppress empty-pool admin spam for self-delivery

**Problem.** `runAutomaticDispatchAssignment` runs on every partner transition
(`partner.ts:1392`). When there are zero eligible riders it writes a `dispatch_pool_empty`
event and sends an **admin notification per order** (`dispatchSelection.ts:390`). With
the pilot not yet live and restaurants self-delivering, this is per-order noise for orders
that were never meant for the platform pool.

**Fix.**
- Only attempt dispatch assignment for orders that are actually platform/rider-dispatched.
  Determine this from the order/restaurant delivery model: if the restaurant self-delivers
  (`supportsDelivery === true` meaning "I handle my own delivery" per the
  `feasty-delivery-and-admin-model` decision) OR the order is pickup, **skip
  `runAutomaticDispatchAssignment` entirely** — no offer, no empty-pool event, no
  notification.
- Where the order *is* dispatch-eligible but the pool is genuinely empty, keep **one**
  `dispatch_pool_empty` event per order (idempotent, as today) but gate the admin
  notification behind a debounce/dedupe so a burst of orders does not fan out one
  notification each (reuse existing notification dedupe if present; otherwise at-most-one
  per restaurant per N minutes).

**Acceptance.** A self-delivery/pickup order produces no dispatch offer and no
`dispatch_pool_empty` notification. A dispatch-eligible order with an empty pool produces
at most one admin notification within the debounce window.

## Out of scope for SP-1 (explicit)

- Any client UI change, any dispatch app screen, the `DISPATCH_ENABLED` flip.
- Rewriting `ebuy_nearest_riders` SQL (note as follow-up).
- Broadcast-topic `private`-flag / `realtime.messages` RLS (inventory flagged it low-risk;
  revisit in SP-5/SP-6 when the app goes live — **note it, do not fix here** to keep SP-1
  tightly scoped). If the owner wants it in SP-1, it becomes Fix 6.
- Proof of delivery, availability, payouts, cash-disable, SOS, ops console (SP-2…SP-6).

## Global constraints

- Edit backend only: `supabase/functions/_shared/domains/dispatch.ts`,
  `dispatchSelection.ts`, `_shared/domains/partner.ts` (the assignment call site only),
  and any `_shared` helper/response modules they use. No app code.
- Run `deno check` from `supabase/`; the bar is **no new errors** over the 210-error
  baseline (`feasty-deno-check-baseline`). Add/extend deno tests for each fix.
- Never `supabase db push`; SP-1 adds **no migration** (all five fixes are code against
  existing columns). If any fix is found to need a column, stop and raise it — do not
  invent a migration silently.
- Do not weaken any existing role guard. Changes only ever **reduce** what a caller sees.
- Reuse existing helpers (rate-limit RPC, notification dedupe, client-safe error
  `ClientSafeError`/`clientErrorMessage`) rather than adding parallel ones.
- Deploy and any Supabase dashboard step are the owner's; this branch stops at merged,
  tested code.

## Testing

- Deno unit tests per fix, driven by fixtures (no live DB): projection shape assertions
  (Fix 1/2), candidate-filter assertions (Fix 3), upload-guard assertions (Fix 4),
  skip-path assertions (Fix 5).
- A registry/contract test if any action's signature or guard changes (per
  `feasty-rpc-action-count-guards`, confirm no action was added — none is — so the
  four-copy contract does not change).
- `deno check` clean (no new errors) before each task's commit.
