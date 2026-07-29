# Redis Adoption — Ephemeral State, Geo Dispatch, and Cache Invalidation

**Date:** 2026-07-29
**Status:** SUPERSEDED by `2026-07-29-zero-cost-backend-scaling-design.md`
(2026-07-29, user constraint: no added recurring cost). Retained for its
analysis of the rider-location workload and the queue-latency reasoning in §8,
both of which carry over. Not scheduled.
**Scope:** Phases 1–5 (Redis client wrapper, auth rate limiting, catalog cache
with write-through invalidation, rider location + geo dispatch, queue latency).
Phase 6 (Node service + Redis Streams) is explicitly deferred to its own spec.

## 1. Context and goals

FEASTY's backend is Deno edge functions over Supabase Postgres. Postgres
currently serves as data store, cache, queue, rate-limit counter, and scheduler.
Two of those roles are a poor fit and are already costing measurable work.

The user's stated drivers, in their words: real-time features Postgres can't do
well, and reducing dependence on Supabase as volume grows. A session goal of
"meet Chowdeck's standard" was set — Chowdeck runs Node + MySQL + Redis with
sub-second rider tracking and geo-ranked courier assignment.

**Anchor problem.** `syncDispatchRiderLocation`
(`supabase/functions/app-rpc/index.ts:6084`) performs two Postgres round trips
per rider ping — a `SELECT` to verify the rider exists, then an `UPDATE` of
`latitude`/`longitude` on the durable `DispatchRiderRecord` row. The dispatch
client pings every 5 seconds (`apps/dispatch/src/hooks/useRealTimeLocation.ts:22`).
At 100 active riders that is ~40 writes/sec of data that is worthless 10 seconds
later, each generating WAL and a dead tuple on a table also read for fleet
listings — paid for twice, in write amplification and in vacuum pressure.

Platform dispatch is currently gated behind `DispatchComingSoon.tsx` and is
expected to launch in weeks to months. This design lands before that, so rider
location never enters Postgres at volume in the first place.

## 2. Non-goals

- **Replacing Postgres.** Postgres remains the system of record in every phase.
  Redis holds only ephemeral or reconstructible state.
- **Moving job queues to Redis.** Analysed and rejected for this architecture —
  see §8. Deferred to phase 6.
- **Self-hosting Redis/Valkey now.** Evaluated (~$6–20/mo flat) and deferred;
  the operational commitment, not the cost, is the blocker. §3 keeps the door
  open.
- **Client-side changes.** All phases preserve existing response shapes. No
  mobile builds are required.
- **Replacing the edge-shield catalog Worker.** See §6 for how they layer.

## 3. Architecture overview

```
Edge functions ──► _shared/redis.ts ──► transport ──► Upstash REST (Frankfurt)
                         │                  └──[future]── Valkey over RESP
                         │
                         └── every call: 1s timeout, null on error, never throws
                                            │
Postgres ◄──────────────────────────────────┘  authoritative in all phases
```

Two layers, deliberately separated so the vendor is swappable:

- **Transport** — one method, `command(args: string[]): Promise<unknown>`.
  Today a single `upstashRest` implementation using `fetch`. Self-hosting later
  means writing a second implementation against `Deno.connect` (or `ioredis`
  from the phase-6 Node service). Nothing above this layer changes.
- **Commands** — narrow typed helpers only: `get`, `setEx`, `del`,
  `incrWithExpiry`, `geoAdd`, `geoSearch`, `zAdd`, `zRangeByScore`, `zRem`.
  No generic escape hatch; that constraint is what keeps the transport
  swappable.

**Portability, stated precisely:** Upstash speaks REST/HTTP, Valkey speaks RESP
over TCP. These are different protocols. The guarantee is *call sites never
change, one transport file does* — not "a connection-string change."

### Non-negotiables

1. **Time-boxed.** 1000 ms `AbortSignal.timeout` per call. An edge function
   stalling on a cache lookup is worse than a cache miss. This value is a
   starting point to be tuned after measuring real Frankfurt→Upstash latency
   (expected 5–20 ms); it is not a settled number.
2. **Non-throwing.** Helpers return `null` on error and log via `logEdgeEvent`.
   Redis errors never reach a client.
3. **Env-gated,** following the `IMAGE_CDN_BASE_URL` precedent in
   `_shared/media.ts`. `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`
   unset ⇒ every helper no-ops and each call site takes its existing Postgres
   path. Phases can deploy before Redis is provisioned; rollback is unsetting
   one secret.
4. **Never authoritative.** Postgres stays the source of truth throughout. This
   is what makes each phase independently reversible with no data loss.

### Key schema

Namespaced `feasty:<env>:` so staging cannot corrupt production.

| Key | Type | TTL | Phase |
| --- | --- | --- | --- |
| `rl:<sha256(key)>` | string counter | policy window | 2 |
| `rl:lock:<sha256(key)>` | string | policy lockout | 2 |
| `cat:pub:v1` | string (JSON) | 300 s | 3 |
| `riders:live` | geo (zset) | none — swept | 4 |
| `riders:beat` | sorted set | none — swept | 4 |
| `rider:meta:<id>` | string (JSON) | 90 s | 4 |
| `rider:pgsync:<id>` | string | 60 s | 4 |
| `drain:<queue>` | string | 2 s | 5 |

The `v1` suffix on the catalog key is a schema version; bumping it invalidates
everything after a payload shape change without a flush.

## 4. Phase 2 — Auth rate limiting

`auth-gateway/ratelimit.ts` keeps its exact signature, its `POLICIES` table, and
the fail-open/fail-closed split at lines 37–44. Only counter storage changes.

- **Hit:** pipelined `INCR rl:<hash>` plus a conditional `EXPIRE` issued only
  when the counter returns 1. One HTTP round trip via Upstash's pipeline
  endpoint.
- **Lockout:** explicit `SETEX rl:lock:<hash> <lockoutSecs> 1`, checked before
  the counter.
- **Fallback:** a `null` from Redis (disabled, timeout, error) falls through to
  the existing `auth_rl_hit` RPC. Behaviour is a strict superset of today's, so
  this phase cannot regress.

**Intentional behaviour change:** a separate lock key fixes the quirk documented
at `ratelimit.ts:7-10`, where a caller already over the limit is re-locked on
its first post-lockout hit because the counter window has not yet reset. With an
explicit lock key, lockout expiry is clean. That comment is rewritten, not
carried over.

Chosen as phase 2 because it has the smallest blast radius and proves the
wrapper in production on a non-money path.

## 5. Phase 3 — Catalog cache with write-through invalidation

`loadPublishedRestaurantCatalog()` in `public-catalog/index.ts` becomes
read-through: `get('cat:pub:v1')` on hit returns parsed JSON; on miss it queries
Postgres and writes back via `setEx(..., 300, ...)`.

The 300 s TTL is a backstop only. **Invalidation is the primary mechanism**, and
it is the capability an HTTP/edge cache structurally cannot provide. Every
mutation that can change published catalog content invalidates the key:

| Action | `app-rpc/index.ts` |
| --- | --- |
| `upsertPartnerRestaurantMenu` | 5686 |
| `upsertPartnerRestaurantProfile` | 5520 |
| `claimPartnerRestaurantLink` | 5617 |
| `adminReviewPartnerApplication` | 4664 |

Invalidation goes through a single exported `invalidatePublishedCatalog()`
helper rather than scattered `del` calls, so any future action that flips
`isPublished`/`isOpen` or edits catalog-visible fields has one obvious place to
hook into.

Net product effect: a partner edits a menu and it is live immediately rather
than up to 60 s later.

This also blunts an existing inefficiency — `customerGetPublishedRestaurantDetail`
loads the entire catalog to find one restaurant
(`public-catalog/index.ts:157`). Still wasteful in principle, but served from
cache it no longer costs a full Postgres read per detail view. Narrowing that
query is deliberately out of scope here.

## 6. Relationship to the Cloudflare edge-shield spec

`2026-07-18-cloudflare-edge-shield-design.md` phase A1b specifies a Worker that
caches `public-catalog` at the Cloudflare edge. It is **not** superseded by
phase 3 — the two cache different things:

- **Worker cache:** skips the entire function invocation; serves stale up to 24 h
  during a Supabase outage. Cannot be invalidated on write.
- **Redis cache (phase 3):** skips the Postgres query; invalidated the instant a
  partner edits a menu.

Phase 3 ships first because it needs no Worker deploy and no client base-URL
change. A1b's remaining unique value after that is outage resilience, which
remains worth having but drops in priority.

## 7. Phase 4 — Rider location and geo dispatch (the anchor)

### 7.1 Write path

`syncDispatchRiderLocation` (`app-rpc/index.ts:6084`) drops from two Postgres
queries per ping to roughly one per minute:

1. **Remove the existence `SELECT` for the common case.** `ensureRole` already
   gates the action, and for a non-admin caller `riderId` is forced to
   `context.uid`, a JWT-verified identity (line 6087). Re-verifying that against
   `DispatchRiderRecord` on every ping proves something the token already
   proved. An admin-supplied `riderId` still gets validated.
2. **Redis write, pipelined:** `GEOADD riders:live <lon> <lat> <riderId>`,
   `ZADD riders:beat <nowMs> <riderId>`, `SETEX rider:meta:<id> 90
   {accuracy,timestamp}`.
3. **Throttled Postgres write,** guarded by `rider:pgsync:<id>` with a 60 s TTL.
   Key present ⇒ skip the `UPDATE`. `DispatchRiderRecord.latitude/longitude`
   therefore remains a valid last-known fallback, refreshed once a minute.

At 100 riders this takes Postgres from ~40 writes/sec to ~1.7 — a 96% reduction —
while durable state survives total Redis loss with at most 60 s of staleness.

### 7.2 Read path

`dispatchGetRiders` (`app-rpc/index.ts:5871`) merges the durable profile from
Postgres (`displayName`, `status`, `zone`, `vehicleType`, `acceptanceRate`,
`activeLoad`, `completedTrips`) with live position from Redis, falling back to
the Postgres `latitude`/`longitude` columns when Redis is empty or disabled.
`buildDispatchRiderResponse` keeps its current output shape, so the dispatch and
admin clients need no changes.

### 7.3 Staleness sweep

Opportunistic rather than scheduled. Each `dispatchGetRiders` call runs
`zRangeByScore('riders:beat', '-inf', nowMs - 90_000)`, capped at 50 ids per
call to bound latency, and `ZREM`s each from both `riders:beat` and
`riders:live` (a geo key is a sorted set, so `ZREM` removes geo members). A
rider who closes the app disappears from the fleet map within ~90 s with no
cron job.

### 7.4 New capability — nearest-rider assignment

`dispatchAssignOrderCourier` (`app-rpc/index.ts:6136`) gains
`GEOSEARCH riders:live FROMLONLAT <lon> <lat> BYRADIUS <km> ASC COUNT 10` to
rank couriers by true distance. This is the Chowdeck-standard capability and the
strongest justification for Redis here — Postgres does not do this cheaply
without PostGIS.

Realtime is unchanged: `broadcastRidersChanged` still fires on assignment.

## 8. Phase 5 — Queue latency (and why queues do not move to Redis)

The user initially selected job queues for Redis migration. Analysis says the
migration would not deliver the intended win on this architecture, and the
reasoning is recorded here because it changes as soon as phase 6 lands.

**The queue problem is latency, not storage.** A job waits for the next
`queue-drainer` cron tick. Redis makes queues fast through *blocking* reads
(`BLPOP`, `XREADGROUP`) — a persistent worker parked on a connection. There is
no persistent process in this architecture, and Upstash's REST transport cannot
hold a blocking connection regardless. A Redis-backed queue drained by a
cron-triggered edge function has the *same* latency as today, while discarding
the idempotency, visibility timeouts, and exponential backoff already built and
tested in `_shared/queue.ts` — on the money path.

**What actually fixes latency:** invoke the drainer directly on enqueue.
`_shared/queue.ts` fires an un-awaited call to `queue-drainer` using the existing
`QUEUE_WORKER_TOKEN`; the pg_cron schedule remains as the safety net. Pickup
goes from "next tick" to sub-second, with no Redis involved.

Redis earns a small supporting role: a `drain:<queue>` key with a 2 s TTL
debounces the invoke so a burst of enqueues triggers one drain rather than
fifty.

Redis Streams with consumer groups become the correct answer the day a
persistent Node service exists — that is phase 6.

## 9. Error handling summary

Every failure degrades to current behaviour. This is the property that makes the
design safe to ship beside a money path.

| Failure | Behaviour |
| --- | --- |
| Upstash secrets unset | All helpers no-op; every path takes its current Postgres route |
| Redis timeout / 5xx | Logged via `logEdgeEvent`, treated as a miss; Postgres serves |
| Redis down during rate limiting | Falls through to `auth_rl_hit` RPC; fail-closed policies still lock |
| Redis down during rider ping | `rider:pgsync` guard absent ⇒ every ping writes durably; today's cost, no data loss |
| Redis loses all data | Fleet map falls back to Postgres lat/long, ≤60 s stale; self-heals on next ping |
| Missed catalog invalidation | 300 s TTL backstop bounds the staleness |
| Geo index drifts from `riders:beat` | Sweep removes from both; a leaked geo member is invisible without a heartbeat |
| Upstash quota exhausted | Helpers return null; full Postgres fallback, degraded but correct |

## 10. Testing

- **Wrapper:** a fake transport makes command construction unit-testable with no
  network, matching the existing `*.test.ts` convention in `_shared/`.
- **Rate limiting:** parity tests asserting the Redis and RPC paths produce
  identical allow/deny decisions across all seven policies in `POLICIES`,
  including both fail-open and fail-closed branches.
- **Catalog:** invalidation tests confirming each of the four mutating actions
  clears `cat:pub:v1`; a stale-read test confirming the TTL backstop.
- **Geo:** sweep tests for the 90 s boundary and the 50-id cap; a `GEOSEARCH`
  ordering test with fixed coordinates.
- **Phase 4 load check:** simulate 100 riders at 5 s intervals and confirm the
  observed Postgres write rate lands near 1.7/sec.
- **Latency measurement:** before tuning the 1000 ms timeout, record real
  Frankfurt→Upstash round-trip times from a deployed function.

## 11. Rollout order and operator actions

Strictly ordered; each phase is independently reversible by unsetting one secret.

1. Provision Upstash Redis, **Frankfurt region** to sit beside Supabase (user
   action; free tier covers current volume).
2. Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` as Supabase edge
   secrets. Note the footgun recorded in memory: the deploy script syncs
   `functions/.env` to secrets on every run, so both values must be added there,
   not set only via the dashboard.
3. Phase 1 (wrapper) + phase 2 (rate limiting) — deploy `auth-gateway`, measure
   latency, tune the timeout.
4. Phase 3 (catalog cache) — deploy `public-catalog` and `app-rpc`.
5. Phase 4 (rider geo) — must land **before** dispatch launches.
6. Phase 5 (queue latency) — independent of Redis; can ship any time after
   phase 1.

## 12. Where this leaves us against the Chowdeck bar

| Capability | After phases 1–5 | + Phase 6 |
| --- | --- | --- |
| Sub-second rider tracking | Yes | Yes |
| Geo-ranked courier assignment | Yes | Yes |
| Surge absorption at cache layer | Yes | Yes |
| Real queue workers (blocking consumers) | No | Yes |

Phase 6 is designed in `2026-07-29-phase6-queue-workers-design.md` — a Redis
Streams consumer running as a small always-on Node service. It depends on the
phase-1 wrapper and is not scheduled; the four-capability bar is met only once
it ships.

## 13. Decisions log

- **Managed Upstash over self-hosted Valkey (user decision, 2026-07-29):**
  software is free either way; the blocker is operational commitment, not the
  ~$6–20/mo. A single VPS in the order path with no failover is a worse trade
  than a vendor dependency at current scale.
- **Command-level wrapper over a Redis SDK:** keeps the transport swappable and
  the dependency surface at zero, serving the stated goal of reduced lock-in.
- **Postgres stays authoritative in every phase:** makes each phase reversible
  and bounds the blast radius of any Redis failure to degraded performance.
- **Queues deliberately not migrated (§8):** Redis cannot fix queue latency
  without a persistent consumer; migrating would trade working money-path
  machinery for no measured gain.
- **Rider existence `SELECT` removed rather than cached:** the JWT already
  proves identity; caching a redundant check is slower than deleting it.
- **Opportunistic sweep over a cron job:** no new scheduled infrastructure, and
  the sweep runs exactly when someone is looking at the fleet.
- **Edge-shield A1b retained, not superseded (§6):** the two caches solve
  different problems; only their priority changes.
