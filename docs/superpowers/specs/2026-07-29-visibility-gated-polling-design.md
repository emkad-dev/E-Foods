# Visibility-Gated Polling — Cutting Idle Egress Across the Five Apps

**Date:** 2026-07-29
**Status:** Design, approved for planning
**Scope:** All 13 data-fetching `setInterval` sites in `apps/customer`,
`apps/partner`, `apps/dispatch`, and `apps/admin-web`. (A 14th `setInterval`, in
`app/(customer)/home/index.tsx:294`, rotates a spotlight carousel and issues no
requests — explicitly excluded.)
**Related:** `2026-07-18-cloudflare-edge-shield-design.md` (payload-side egress,
already shipped), `2026-07-29-zero-cost-backend-scaling-design.md` (write-side
churn)

## 1. Why this, and why not payload optimization

The work began as "cut egress." Measurement of the Frankfurt project showed there
is almost nothing to cut on the payload side:

| Measured | Actual |
| --- | --- |
| Storage objects (all images, all buckets) | 15 objects, 972 kB total, 65 kB average |
| Published restaurants | 6 |
| Entire published catalog menu JSON | 970 bytes on the wire, 3 menu entries |
| Orders ever placed | 96 |
| Largest table | `OrderItem`, 114 rows / 88 kB |

The two mechanisms the edge-shield design built for egress — Cloudflare image
transformations and the catalog edge cache — are therefore optimizing a 1 MB
image corpus and a sub-1 KB catalog response. Both Workers (`feasty-edge-cache`,
`feasty-hooks`) are deployed and live as of 2026-07-22. Neither is wrong; both
are simply operating on a rounding error.

**The cost that actually scales is request count, not response size.** Every
polling loop in every app runs on a fixed timer for as long as its component is
mounted, with no gating on app background, browser tab visibility, or screen
focus. Exactly one file in the codebase gates on focus
(`apps/customer/app/(customer)/cart.tsx`, via `useFocusEffect`).

The projected binding constraint is **edge-function invocations**. At a modest
launch — 20 restaurants, 500 daily-active customers, 2 admin sessions — the
unconditional timers alone generate on the order of 90,000 `app-rpc` invocations
per day (~2.7M/month) before a single user action. A restaurant tablet left open
in a kitchen for 12 hours issues ~2,200–3,600 calls per day on its own, nearly
all returning byte-identical data. Shrinking payloads does not touch this number.

## 2. The polling inventory

| App | Site | Interval | Realtime alongside it |
| --- | --- | --- | --- |
| customer | `src/hooks/useCustomerOrder.ts:94` | 30s | `postgres_changes` on `CustomerOrder` + `DeliveryAssignment` |
| customer | `app/(customer)/orders/index.tsx:166` | 30s | `postgres_changes` |
| customer | `app/(customer)/home/restaurant/[id].tsx:111` | 30s | none |
| customer | `app/(customer)/cart.tsx:143` | 30s | none (already focus-gated) |
| customer | `src/hooks/useSupportThreadRealtime.ts:23` | 30s | yes (Broadcast) |
| partner | `src/hooks/usePartnerOrders.ts:75` | 30s | Broadcast (`ORDERS_REALTIME_TOPIC`) |
| partner | `src/hooks/usePartnerOrder.ts:53` | 30s | Broadcast (`orderRealtimeTopic`) |
| partner | `src/hooks/usePartnerRestaurant.ts:66` | 60s | Broadcast (`RESTAURANTS_REALTIME_TOPIC`) |
| dispatch | `src/hooks/useDispatchOrders.ts:74` | 30s | Broadcast |
| dispatch | `src/hooks/useDispatchOrder.ts:111` | 30s | Broadcast |
| dispatch | `src/hooks/useDispatchRiders.ts:179` | 30s | Broadcast |
| admin-web | `src/lib/usePolledRpc.ts:37` | 20s | **none** |
| admin-web | `src/contexts/SnapshotContext.tsx:57` | 20s | **none** |

Two observations that shape the design:

- **Almost every timer is already a declared fallback**, not the primary
  freshness mechanism. `usePartnerOrders.ts:74` says so in a comment: "Slow
  fallback poll in case the realtime connection drops silently." Realtime
  delivers the freshness; the timer exists to cover a silently dropped socket.
  A fallback for a user who is not looking at the screen has no one to serve.
- **`admin-web` is the only pure poller.** Its two loops have no realtime at all,
  and an admin dashboard parked on a second monitor is the single worst case in
  the system: 360+ invocations/hour indefinitely, with nobody watching.

`apps/web-landing` has no polling and is out of scope.

## 3. Goals and non-goals

**Goals:**

1. No polling request is issued while the app is backgrounded or its tab hidden.
2. A user returning to the app sees current data immediately, not after waiting
   out the remainder of an interval.
3. The change is revertible one call site at a time.

**Non-goals:**

- **Changing any interval value.** Freshness while visible stays exactly as it is
  today. Widening intervals is a separate decision with a real UX cost for
  partners waiting on new orders.
- **Removing any polling site**, including the redundant timer in
  `useCustomerOrder` that duplicates a working `postgres_changes` subscription.
  Deleting it is defensible but is a freshness change, not an idle-cost change.
- **Touching any realtime subscription, fetcher, or response shape.**
- **Migrating `admin-web` onto realtime.** That is the architecturally correct
  end state and the largest single win, but it is money-path work and belongs in
  its own spec after this is measured.
- **Payload or image optimization.** §1 shows there is nothing there.

## 4. Architecture

The shaping constraint: `apps/admin-web` is plain React 19 + Vite with no
`react-native` dependency, so a single shared hook cannot import `AppState`
without breaking that build. Conversely `react-native-web` polyfills `AppState`
onto the Page Visibility API, so `AppState` is correct for customer, partner, and
dispatch on **both** native and their web exports.

That yields one shared, platform-free timer hook plus one small adapter per
stack.

### 4.1 `packages/runtime/src/useVisiblePolling.ts` (new)

No platform imports, so every app can consume it.

```ts
useVisiblePolling(onTick: () => void, intervalMs: number, isVisible: boolean): void
```

Behaviour:

- While `isVisible` is `true`, invoke `onTick` every `intervalMs`.
- On the `false → true` transition, invoke `onTick` once immediately, then start
  the interval afresh. This is what keeps a returning user from staring at stale
  data for up to a full interval.
- On the `true → false` transition, clear the interval. No invocation occurs
  while hidden.
- On unmount, clear the interval.
- `onTick` is held in a ref so that an unstable inline callback does not restart
  the interval on every render — a real hazard, since most call sites pass a
  closure defined in the effect body.
- The hook never wraps `onTick` in try/catch. Errors propagate exactly as they do
  today.

### 4.2 Visibility adapters

`useAppVisibility(): boolean`, one per stack:

- **customer / partner / dispatch** — subscribes to `AppState`, returns
  `state === 'active'`. Correct on native and, via react-native-web, on the web
  exports.
- **admin-web** — subscribes to `document.visibilitychange`, returns
  `document.visibilityState === 'visible'`.

Each is ~15 lines and is the only file in the change that knows what platform it
is on.

### 4.3 Call-site shape

Every site converts the same way. Today:

```ts
void guardedLoad();
const unsubscribe = subscribeToRealtimeChanges(supabase, [ORDERS_REALTIME_TOPIC], handler);
const interval = setInterval(() => { void guardedLoad('background'); }, 30000);

return () => { cancelled = true; clearInterval(interval); unsubscribe(); };
```

After:

```ts
void guardedLoad();
const unsubscribe = subscribeToRealtimeChanges(supabase, [ORDERS_REALTIME_TOPIC], handler);

return () => { cancelled = true; unsubscribe(); };
```

with the timer lifted out of the effect to a sibling hook call:

```ts
useVisiblePolling(() => void guardedLoad('background'), 30000, isVisible);
```

The realtime subscription, its handler, and its cleanup are untouched. Only the
timer moves.

## 5. Error handling

No new failure modes are introduced; the hook adds no I/O.

| Failure | Behaviour |
| --- | --- |
| `onTick` throws | Propagates exactly as today; each call site already handles its own fetch errors |
| Visibility API unavailable (`document` undefined, `AppState` missing) | Adapter returns `true` — degrades to today's always-polling behaviour rather than silently never polling |
| App backgrounded mid-flight | The in-flight request completes; existing `cancelled`/`activeRef` guards already discard its result on unmount |
| Realtime socket drops while hidden | No fallback poll fires, by design. The foreground refetch on resume is the recovery |
| Rapid visibility flapping | Each `false → true` fires one immediate `onTick`; acceptable, and bounded by how fast a human can switch apps |

The last row is the one genuine behaviour change worth stating plainly: while
hidden, a silently dropped realtime socket is no longer papered over by the
fallback timer. The compensating guarantee is that the socket's staleness cannot
be observed while hidden, and resume forces a fresh read before the user sees
anything.

## 6. Testing

**Hook unit tests** (fake timers) — this is where the real coverage belongs:

- Fires on each interval while visible.
- Fires zero times across many interval periods while hidden.
- Fires exactly once, immediately, on `false → true`, then resumes on interval.
- Clears on unmount; no fire after unmount.
- Does not restart the interval when `onTick` identity changes between renders.

**Adapter tests:** `AppState` transitions map to the right boolean; `document`
visibility transitions likewise; both return `true` when the API is missing.

**Per-app integration check** (one each for customer, partner, admin-web):
background the app or hide the tab, confirm zero `app-rpc` calls in the network
log across at least two interval periods; foreground it, confirm exactly one
catch-up call.

**Regression:** partner order list still updates within a second of an order
transition while the tab is visible — proving the realtime path was not disturbed.

## 7. Rollout

1. Add `packages/runtime/src/useVisiblePolling.ts` + unit tests. No consumers
   yet; nothing changes.
2. Add the `admin-web` adapter and convert its two sites. Highest value, smallest
   blast radius, and it ships on the next Pages deploy with no mobile build.
3. Convert partner's three sites; verify on `partner.feasty.com.ng` after deploy.
4. Convert customer's five sites.
5. Convert dispatch's three sites.

Steps 2–5 are independent and individually revertible.

**Dispatch note:** `DISPATCH_ENABLED = false` (`apps/dispatch/app/_layout.tsx:15`),
so step 5 saves nothing today and the 5-second rider location ping that the
zero-cost-scaling spec is built around is not running in production. It is
included anyway because it is the same mechanical edit, and leaving 3 of 13 sites
on the old pattern is how the pattern returns.

**Native builds:** customer and partner iOS/Android need rebuilds to pick this
up. Mobile builds are already pending from pricing v2; this should ride along
rather than trigger a build cycle of its own. All web surfaces (admin, partner
web, customer web) get it on next deploy.

## 8. A correction to the zero-cost-scaling spec

`2026-07-29-zero-cost-backend-scaling-design.md` §3 states: "This project does not
use `postgres_changes` — `_shared/realtime.ts` broadcasts explicitly through the
Realtime Broadcast API — so there is no impact."

That premise is inaccurate. `apps/customer` uses `postgres_changes` in two files:
`src/hooks/useCustomerOrder.ts` (on `CustomerOrder` and `DeliveryAssignment`) and
`app/(customer)/orders/index.tsx`.

This does not invalidate that spec's `UNLOGGED rider_live_location` decision —
that is a different table, and nothing subscribes to changes on it. But the
constraint it records ("nothing may subscribe to changes on this table") is
load-bearing and the surrounding justification is wrong, so anyone later moving
`DeliveryAssignment` or rider location onto an unlogged table would be reasoning
from a false premise. Flagged here rather than edited there, since that spec is
currently untracked in git.

## 9. Decisions log

- **Request count over payload size (measurement, 2026-07-29):** 972 kB of images
  and a 970-byte catalog leave nothing to compress. Invocations scale with users
  and hours-open; bytes do not.
- **Visibility gating over widening intervals:** gating has no freshness cost
  while visible, so it needs no UX tradeoff discussion. Widening intervals does,
  particularly for partners awaiting orders. Do the free thing first, measure,
  then decide if more is needed.
- **Intervals and redundant polls left alone:** deliberately out of scope so this
  change is purely about *when* timers fire, keeping it revertible per site.
- **`AppState` for RN apps rather than a web-only API:** react-native-web maps it
  to Page Visibility, so one adapter covers native and web export both.
- **Adapters split per stack rather than one clever shared module:** `admin-web`
  must not import `react-native`; platform-extension resolution differs between
  Metro and Vite. Two 15-line files beat a build-time resolution trick.
- **Fail-open when the visibility API is missing:** an adapter bug should degrade
  to today's behaviour (too many requests), never to no requests at all.
- **`admin-web` realtime migration deferred:** biggest win, but money-path work
  needing its own design.
