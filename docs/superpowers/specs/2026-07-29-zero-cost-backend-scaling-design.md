# Zero-Cost Backend Scaling — Postgres-Native Equivalents to Redis

**Date:** 2026-07-29
**Status:** Design, supersedes the two Redis specs of the same date
**Supersedes:** `2026-07-29-redis-adoption-design.md`,
`2026-07-29-phase6-queue-workers-design.md` (both retained for the analysis they
contain; neither is scheduled)
**Constraint:** no added recurring cost. Every mechanism here uses an extension
already installed on the Frankfurt project or available to enable for free.

## 1. Why the Redis design was replaced

The Redis specs were written before the cost constraint. They are sound designs;
they are simply not free, and the anchor workload is the reason.

**The arithmetic.** Phase 4 (rider location) is the workload that justified
Redis. At 100 active riders pinging every 5 seconds
(`apps/dispatch/src/hooks/useRealTimeLocation.ts:22`):

```
100 riders x 12 pings/min x 1440 min/day = 1,728,000 commands/day
```

Upstash's free tier is on the order of 10,000 commands/day. The workload is
roughly two orders of magnitude over it. No amount of pipelining closes a 100x
gap — pipelining reduces round trips, not command count. Rider tracking on
managed Redis is a paid workload by construction.

Phase 6 additionally required an always-on container (~$5–10/mo).

**What replaced it.** A check of installed extensions found that the three
capabilities Redis was chosen for already have free, in-database equivalents:

| Extension | Version | State | Replaces |
| --- | --- | --- | --- |
| `pg_net` | 0.20.0 | **installed** | Redis-triggered job dispatch |
| `pgmq` | 1.5.1 | **installed** | Redis Streams / consumer groups |
| `postgis` | 3.3.7 | available, free | `GEOADD` / `GEOSEARCH` |
| `earthdistance` + `cube` | 1.2 / 1.5 | available, free | lighter geo alternative |

The remaining Redis-specific win — avoiding WAL writes for ephemeral data — is
achieved with an `UNLOGGED` table, which is a core Postgres feature.

## 2. Goals and non-goals

**Goals** — unchanged from the Redis design:

1. Rider location stops generating durable write churn before dispatch launches.
2. Nearest-rider assignment becomes possible.
3. Job pickup becomes sub-second with real delivery guarantees.
4. Auth rate limiting and catalog reads stop being needless Postgres load.

**Non-goals:**

- **Adding any paid service.** No Upstash, no container host, no new plan tier.
- **Replacing the existing `queue_*` tables.** They work, they are idempotent,
  and they sit on the money path. §6 adds a trigger; it does not migrate them.
- **Client-side changes.** All response shapes are preserved. No mobile builds.
- **Enabling PostGIS unless §5 measurement shows `earthdistance` is
  insufficient.** PostGIS is large; the lighter option is tried first.

## 3. Phase 1 — Rider location on an `UNLOGGED` table

This replaces Redis phase 4 and captures most of its benefit.

### The actual cost being removed

`syncDispatchRiderLocation` (`app-rpc/index.ts:6084`) currently does two round
trips per ping — a `SELECT` to verify the rider, then an `UPDATE` of
`latitude`/`longitude` on `DispatchRiderRecord`. The `UPDATE` is the expensive
half: it writes WAL and leaves a dead tuple on a table that is also read for
fleet listings, so the cost is paid twice (write amplification, then vacuum).

### The change

**New table:**

```sql
CREATE UNLOGGED TABLE rider_live_location (
  rider_id    uuid PRIMARY KEY,
  latitude    double precision NOT NULL,
  longitude   double precision NOT NULL,
  accuracy    double precision,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
```

`UNLOGGED` is the whole point: writes skip WAL entirely. The table is truncated
on crash recovery, which is correct — live rider position is rebuilt from the
next ping within 5 seconds. This is exactly the durability profile Redis offered,
without Redis.

**Write path** becomes a single statement, no read:

```sql
INSERT INTO rider_live_location (rider_id, latitude, longitude, accuracy)
VALUES ($1, $2, $3, $4)
ON CONFLICT (rider_id) DO UPDATE SET
  latitude = EXCLUDED.latitude,
  longitude = EXCLUDED.longitude,
  accuracy = EXCLUDED.accuracy,
  updated_at = now();
```

The existence `SELECT` is deleted: `ensureRole` already gates the action and for
a non-admin caller `riderId` is forced to `context.uid`, a JWT-verified identity
(line 6087). Verifying that against `DispatchRiderRecord` on every ping proves
something the token already proved. An admin-supplied `riderId` still gets
validated.

**Durable fallback,** preserving today's behaviour: `DispatchRiderRecord`
latitude/longitude is still refreshed, but throttled to once per minute per
rider by a conditional update requiring no extra read:

```sql
UPDATE "DispatchRiderRecord"
SET latitude = $2, longitude = $3, "updatedAt" = now()
WHERE id = $1 AND "updatedAt" < now() - interval '60 seconds';
```

A no-op update that matches no rows is cheap and writes nothing.

### Result

Per ping: 2 round trips → 1 RPC call executing 2 cheap statements, of which the
WAL-writing one fires roughly once per minute per rider. Durable write volume
drops ~96%, matching the Redis design's headline number, and the remaining
high-frequency write generates no WAL at all.

### Staleness

A rider is "live" if `updated_at > now() - interval '90 seconds'`. No sweep job
is needed — the filter is part of the read query. A periodic `DELETE` of rows
older than a day can ride on the existing pg_cron schedule if the table ever
needs trimming.

### Compatibility note

`UNLOGGED` tables are not replicated and do not appear in the WAL, so Supabase
Realtime's `postgres_changes` cannot observe them. This project does not use
`postgres_changes` — `_shared/realtime.ts` broadcasts explicitly through the
Realtime Broadcast API — so there is no impact. This constraint must be
respected by future work: nothing may subscribe to changes on this table.

## 4. Phase 2 — Nearest-rider assignment

`dispatchAssignOrderCourier` (`app-rpc/index.ts:6136`) gains distance-ranked
candidates. Two options, cheapest first.

**Option A — `earthdistance` + `cube` (try first).** Small extensions, great-circle
distance, GiST-indexable:

```sql
CREATE EXTENSION IF NOT EXISTS cube;
CREATE EXTENSION IF NOT EXISTS earthdistance;

CREATE INDEX rider_live_location_geo_idx
  ON rider_live_location USING gist (ll_to_earth(latitude, longitude));

SELECT rider_id,
       earth_distance(ll_to_earth($1, $2), ll_to_earth(latitude, longitude)) AS metres
FROM rider_live_location
WHERE updated_at > now() - interval '90 seconds'
  AND earth_box(ll_to_earth($1, $2), $3) @> ll_to_earth(latitude, longitude)
ORDER BY metres ASC
LIMIT 10;
```

**Option B — PostGIS,** if option A proves insufficient (polygon delivery zones,
routing, or geometry work beyond radius search). `ST_DWithin` on a `geography`
column with a GiST index. Also free, just heavier.

Start with A. Measure. This is the capability Redis `GEOSEARCH` was chosen for,
and Postgres does it well with the right index — the earlier claim that Postgres
cannot do this cheaply was true only of an unindexed table.

## 5. Phase 3 — Sub-second job pickup via `pg_net`

This replaces Redis phase 5 **and** most of phase 6, at zero cost.

`pg_net` is installed and performs async HTTP from inside Postgres. A trigger on
insert into the `queue_*` tables calls `queue-drainer` immediately:

```sql
CREATE OR REPLACE FUNCTION notify_queue_drainer() RETURNS trigger AS $$
BEGIN
  PERFORM net.http_post(
    url     := current_setting('app.queue_drainer_url'),
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-queue-worker-token', current_setting('app.queue_worker_token')),
    body    := jsonb_build_object('queue', TG_ARGV[0])
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

`queue-drainer` already accepts exactly this shape — POST, `x-queue-worker-token`
header, and a `queue` selector (`supabase/functions/queue-drainer/index.ts:63-79`).
No function changes are required.

**Why this is better than the Redis phase-5 design it replaces:** the invoke
fires inside the same transaction boundary as the enqueue, so a job cannot be
inserted without a dispatch attempt being made. The edge-function fire-and-forget
approach could drop the invoke silently. `pg_net` also retries and records
responses in `net._http_response`, giving observability the fire-and-forget path
never had.

**Backstop unchanged:** the pg_cron `queue-drainer` schedule keeps running.
`runWithBackpressure` (line 270) already prevents concurrent drains, so a trigger
firing alongside a cron tick is safe today.

**Debounce:** `runWithBackpressure` with `maxConcurrent: 1` returns 429 for
overlapping calls, which is the debounce. The Redis `drain:<queue>` TTL key is
unnecessary.

## 6. Phase 4 — Rate limiting and catalog cache: deliberately unchanged

Both were included in the Redis design. Neither justifies work under a zero-cost
constraint, and saying so is more useful than building them.

**Rate limiting** already works. `auth_rl_hit` is a single Postgres RPC per auth
attempt with a considered fail-open/fail-closed split
(`auth-gateway/ratelimit.ts:37-44`). At current auth volume this is a trivial
load. Revisit only if `pg_stat_statements` shows it in the top queries.

**Catalog cache:** the Redis win was instant invalidation on menu edit. The same
result is available for free by shortening the existing `Cache-Control` max-age
(`public-catalog/index.ts:134`) — at the cost of more origin hits, which are
cheap at current volume. The Cloudflare edge-cache Worker in
`2026-07-18-cloudflare-edge-shield-design.md` already covers surge absorption and
outage resilience on the free plan.

One genuine inefficiency remains worth a small separate fix:
`customerGetPublishedRestaurantDetail` loads the entire catalog to find one
restaurant (`public-catalog/index.ts:157`). That is a query-narrowing change, not
a caching one, and is tracked separately.

## 7. Phase 5 — `pgmq`, only if measurement demands it

`pgmq` 1.5.1 is installed and provides SQS-style queues in Postgres: visibility
timeouts, at-least-once delivery, archival. It is the free analogue of Redis
Streams.

It is **not** scheduled, because the existing `queue_*` tables already implement
visibility timeouts, exponential backoff, retry limits, and idempotent handlers
(`_shared/queue.ts`), and they sit on the money path. Migrating working
money-path machinery for architectural tidiness is the same trade the Redis spec
rejected in its §8, and the reasoning does not change just because the
destination is now free.

Revisit if the `queue_*` tables show measurable contention under real load —
`claimPendingQueueJobs` issues one `UPDATE` per job (`_shared/queue.ts:204-223`)
rather than a set-based claim, and that is the first thing to fix if queue
throughput becomes a problem, with or without `pgmq`.

## 8. Error handling summary

| Failure | Behaviour |
| --- | --- |
| Crash / restart | `rider_live_location` truncated; repopulates within 5 s from pings; `DispatchRiderRecord` still holds ≤60 s-old fallback |
| `rider_live_location` unavailable | Read path falls back to `DispatchRiderRecord` lat/long, as today |
| Geo index missing | Query still correct, just slower — a sequential scan on a table of at most a few hundred rows |
| `pg_net` call fails | Logged in `net._http_response`; pg_cron backstop drains on its normal tick |
| Trigger fires during a cron drain | `runWithBackpressure` returns 429; the drain in progress covers the work |
| Rider stops pinging | Excluded from live queries after 90 s by the `updated_at` filter |

Every row degrades to current behaviour. No new external dependency exists to
fail.

## 9. Testing

- **Write path:** assert one ping issues no `SELECT`, and that the durable
  `UPDATE` matches zero rows when fired twice inside 60 s.
- **Unlogged semantics:** confirm the table survives a normal restart and that a
  truncation is recovered from by the next ping.
- **Geo:** fixed-coordinate ordering test against known distances; `EXPLAIN` to
  confirm the GiST index is used rather than a sequential scan.
- **Staleness:** a rider whose `updated_at` is 91 s old is excluded; 89 s is
  included.
- **`pg_net` trigger:** insert a queue row, assert a row appears in
  `net._http_response` and that the job reaches `completed` without waiting for
  a cron tick.
- **Backpressure:** fire the trigger during an in-flight drain, assert 429 and
  no duplicate processing.
- **Load:** simulate 100 riders at 5 s intervals; confirm WAL generation is flat
  and durable writes land near 1.7/sec.

## 10. Rollout order

1. Migration: create `rider_live_location`, `cube` + `earthdistance`, the GiST
   index.
2. `syncDispatchRiderLocation` write path (§3) — must land before dispatch
   launches.
3. `dispatchGetRiders` read path with `DispatchRiderRecord` fallback.
4. `dispatchAssignOrderCourier` distance ranking (§4).
5. `pg_net` trigger (§5) — set `app.queue_drainer_url` and
   `app.queue_worker_token` via Vault, mirroring the existing
   `project_url`/`queue_worker_token` pattern already used by the cron jobs.

Steps 2–4 are behind the same code paths that exist today and fall back to
`DispatchRiderRecord`, so each is independently revertible. Step 5 is reverted by
dropping the trigger.

## 11. Where this lands against the Chowdeck bar

| Capability | Status |
| --- | --- |
| Sub-second rider tracking | Yes — `UNLOGGED` table, no WAL |
| Geo-ranked courier assignment | Yes — GiST index on `ll_to_earth` |
| Surge absorption | Yes — existing Cloudflare edge cache, free plan |
| Real queue workers | Partial — `pg_net` gives sub-second dispatch with retry and observability, but not a blocking consumer |

The fourth is honestly partial. A true blocking consumer needs an always-on
process, and there is no free way to run one. What `pg_net` delivers —
transactional dispatch, automatic retry, recorded responses — covers the
practical gap for a single-city operation. Revisit if throughput ever justifies
the container.

## 12. Decisions log

- **Redis dropped on cost, not merit (user constraint, 2026-07-29):** 1.7M
  commands/day at 100 riders is ~100x any free tier. The Redis specs are retained
  for their analysis but are not scheduled.
- **`UNLOGGED` table over Redis for live location:** same durability profile
  (ephemeral, rebuilt on restart), same WAL avoidance, zero new dependencies.
- **`earthdistance` before PostGIS:** radius search is all that is needed today;
  PostGIS is available free if requirements grow.
- **`pg_net` trigger over edge-function fire-and-forget:** transactional with the
  enqueue and observable via `net._http_response`; strictly better than the
  design it replaces, and free.
- **Rate limiting and catalog cache explicitly not changed (§6):** neither shows
  measured load; building them would be work without evidence.
- **`pgmq` installed but unscheduled (§7):** migrating working money-path queues
  needs a measured reason, and free is not a reason.
- **Existence `SELECT` deleted rather than cached:** the JWT already proves
  identity.
