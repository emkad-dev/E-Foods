# Zero-Cost Backend Scaling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move high-frequency rider location writes off the durable
`DispatchRiderRecord` table onto an `UNLOGGED` table, add distance-ranked courier
assignment, and make queue job pickup sub-second — all using Postgres features
already available on the project, with no added recurring cost.

**Architecture:** Live rider position moves to an `UNLOGGED` table
(`rider_live_location`) whose writes skip WAL entirely; `DispatchRiderRecord`
keeps a throttled once-per-minute copy as the durable fallback, so every read
path degrades to today's behaviour if the unlogged table is empty. Nearest-rider
search uses `earthdistance` + a GiST index through a `SECURITY DEFINER` SQL
function. Queue latency is fixed by a `pg_net` trigger that calls `queue-drainer`
on insert, reusing the exact Vault-credential pattern the existing cron job uses.

**Tech Stack:** Supabase Postgres 17, Deno edge functions, `supabase-js` v2,
`cube` + `earthdistance` extensions, `pg_net`, `pg_cron`, `supabase_vault`.
Tests are `deno test` (edge functions) and `node --test` (packages/apps).

## Global Constraints

- **No added recurring cost.** No new hosted service, plan tier, or always-on
  process. Only extensions already installed or free to enable.
- **Postgres stays authoritative.** `rider_live_location` is a cache; every read
  falls back to `DispatchRiderRecord`.
- **No client-side changes.** `buildDispatchRiderResponse` output shape is
  unchanged, so no mobile builds are required.
- **Nothing may subscribe to `postgres_changes` on `rider_live_location`** —
  `UNLOGGED` tables produce no WAL, so Realtime cannot observe them. This project
  broadcasts explicitly via `_shared/realtime.ts`, which is unaffected.
- **SQL function naming:** new functions use the existing `ebuy_` prefix.
- **Migration naming:** `supabase/migrations/YYYYMMDD_<name>.sql`.
- **New deno test files must be appended to the `test:deno` script in
  `package.json`** — that script names each file explicitly and will not pick up
  new tests automatically.
- **Migrations must be exception-guarded** in `do $$ ... $$` blocks following
  `supabase/migrations/20260624_queue_drainer_schedule.sql`, so a project missing
  an extension skips rather than fails.
- Branch: `feature/zero-cost-scaling`. Worktree: `C:\Users\emkad\EBuy\redis-free-wt`.

---

### Task 1: Migration — `rider_live_location` table, extensions, geo index

**Files:**
- Create: `supabase/migrations/20260729_rider_live_location.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: table `public.rider_live_location(rider_id uuid PK, latitude double
  precision, longitude double precision, accuracy double precision, updated_at
  timestamptz)`; GiST index `rider_live_location_geo_idx`; extensions `cube` and
  `earthdistance` in schema `extensions`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260729_rider_live_location.sql`:

```sql
-- Live rider position for dispatch. UNLOGGED on purpose: these rows are
-- rewritten every few seconds per rider and are worthless once superseded, so
-- paying WAL + vacuum cost for them is waste. The table is truncated on crash
-- recovery, which is correct — it repopulates from the next ping within ~5s.
-- DispatchRiderRecord keeps a throttled durable copy as the fallback.
--
-- NOTE: UNLOGGED tables emit no WAL, so Supabase Realtime `postgres_changes`
-- can never observe this table. Do not add a publication for it.

create unlogged table if not exists public.rider_live_location (
  rider_id   uuid primary key,
  latitude   double precision not null,
  longitude  double precision not null,
  accuracy   double precision,
  updated_at timestamptz not null default now()
);

alter table public.rider_live_location enable row level security;

-- No policies: only the service role (which bypasses RLS) touches this table.
-- RLS on with zero policies means any anon/authenticated access is denied.

do $ext$
begin
  create extension if not exists cube with schema extensions;
  create extension if not exists earthdistance with schema extensions;
exception
  when others then
    raise notice 'rider_live_location: geo extension unavailable (%), skipping index', sqlerrm;
end
$ext$;

do $idx$
begin
  create index if not exists rider_live_location_geo_idx
    on public.rider_live_location
    using gist (extensions.ll_to_earth(latitude, longitude));
exception
  when others then
    raise notice 'rider_live_location: could not create geo index (%), skipping', sqlerrm;
end
$idx$;

create index if not exists rider_live_location_updated_at_idx
  on public.rider_live_location (updated_at desc);
```

- [ ] **Step 2: Apply the migration and verify the table is UNLOGGED**

Apply via the Supabase MCP `apply_migration` tool with name
`rider_live_location`, then run this verification query with `execute_sql`:

```sql
select relname, relpersistence
from pg_class
where relname = 'rider_live_location';
```

Expected: one row, `relpersistence = 'u'` (`u` = unlogged; `p` would mean the
`unlogged` keyword did not take and the whole point of the task is lost).

- [ ] **Step 3: Verify the geo index exists and the extensions are installed**

```sql
select indexname from pg_indexes
where tablename = 'rider_live_location';

select extname from pg_extension where extname in ('cube', 'earthdistance');
```

Expected: `rider_live_location_geo_idx`, `rider_live_location_updated_at_idx`,
and `rider_live_location_pkey`; both extensions present. If the extensions are
missing, the `do $ext$` block swallowed an error — read the notice and stop; Task
5 depends on them.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260729_rider_live_location.sql
git commit -m "feat(db): add unlogged rider_live_location table with geo index"
```

---

### Task 2: Pure helpers for rider live location

Extracting the logic into pure functions so it can be tested without a database,
matching the existing `_shared/pricing.ts` + `pricing.test.ts` convention.

**Files:**
- Create: `supabase/functions/_shared/riderLocation.ts`
- Create: `supabase/functions/_shared/riderLocation.test.ts`
- Modify: `package.json` (`test:deno` script)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `RIDER_LIVE_TTL_MS = 90_000`
  - `DURABLE_SYNC_INTERVAL_SECONDS = 60`
  - `type RiderLiveLocationRow = { rider_id: string; latitude: number; longitude: number; accuracy: number | null; updated_at: string }`
  - `buildRiderLocationUpsert(riderId: string, latitude: number, longitude: number, accuracy: number | null, nowIso: string): RiderLiveLocationRow`
  - `isRiderLocationLive(updatedAt: string | null | undefined, nowMs: number, ttlMs?: number): boolean`
  - `mergeRiderLiveLocation<T extends { id: string; latitude?: number | null; longitude?: number | null; updatedAt?: string | null }>(rider: T, live: RiderLiveLocationRow | undefined, nowMs: number): T`

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/riderLocation.test.ts`:

```ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  buildRiderLocationUpsert,
  isRiderLocationLive,
  mergeRiderLiveLocation,
  RIDER_LIVE_TTL_MS,
} from './riderLocation.ts';

const NOW_ISO = '2026-07-29T12:00:00.000Z';
const NOW_MS = Date.parse(NOW_ISO);

Deno.test('buildRiderLocationUpsert maps fields to snake_case row', () => {
  const row = buildRiderLocationUpsert('rider-1', 6.5244, 3.3792, 12.5, NOW_ISO);
  assertEquals(row, {
    rider_id: 'rider-1',
    latitude: 6.5244,
    longitude: 3.3792,
    accuracy: 12.5,
    updated_at: NOW_ISO,
  });
});

Deno.test('buildRiderLocationUpsert allows a null accuracy', () => {
  const row = buildRiderLocationUpsert('rider-1', 6.5, 3.3, null, NOW_ISO);
  assertEquals(row.accuracy, null);
});

Deno.test('isRiderLocationLive includes a ping inside the TTL', () => {
  const updatedAt = new Date(NOW_MS - (RIDER_LIVE_TTL_MS - 1_000)).toISOString();
  assertEquals(isRiderLocationLive(updatedAt, NOW_MS), true);
});

Deno.test('isRiderLocationLive excludes a ping outside the TTL', () => {
  const updatedAt = new Date(NOW_MS - (RIDER_LIVE_TTL_MS + 1_000)).toISOString();
  assertEquals(isRiderLocationLive(updatedAt, NOW_MS), false);
});

Deno.test('isRiderLocationLive treats the exact boundary as stale', () => {
  const updatedAt = new Date(NOW_MS - RIDER_LIVE_TTL_MS).toISOString();
  assertEquals(isRiderLocationLive(updatedAt, NOW_MS), false);
});

Deno.test('isRiderLocationLive rejects missing or unparseable timestamps', () => {
  assertEquals(isRiderLocationLive(null, NOW_MS), false);
  assertEquals(isRiderLocationLive(undefined, NOW_MS), false);
  assertEquals(isRiderLocationLive('not-a-date', NOW_MS), false);
});

Deno.test('mergeRiderLiveLocation prefers a live fix over the durable columns', () => {
  const rider = { id: 'rider-1', latitude: 1, longitude: 2, updatedAt: '2026-07-29T11:00:00.000Z' };
  const live = {
    rider_id: 'rider-1',
    latitude: 6.5244,
    longitude: 3.3792,
    accuracy: 10,
    updated_at: new Date(NOW_MS - 5_000).toISOString(),
  };
  const merged = mergeRiderLiveLocation(rider, live, NOW_MS);
  assertEquals(merged.latitude, 6.5244);
  assertEquals(merged.longitude, 3.3792);
  assertEquals(merged.updatedAt, live.updated_at);
});

Deno.test('mergeRiderLiveLocation keeps durable columns when the live fix is stale', () => {
  const rider = { id: 'rider-1', latitude: 1, longitude: 2, updatedAt: '2026-07-29T11:00:00.000Z' };
  const live = {
    rider_id: 'rider-1',
    latitude: 6.5244,
    longitude: 3.3792,
    accuracy: 10,
    updated_at: new Date(NOW_MS - (RIDER_LIVE_TTL_MS + 1_000)).toISOString(),
  };
  const merged = mergeRiderLiveLocation(rider, live, NOW_MS);
  assertEquals(merged.latitude, 1);
  assertEquals(merged.longitude, 2);
  assertEquals(merged.updatedAt, '2026-07-29T11:00:00.000Z');
});

Deno.test('mergeRiderLiveLocation keeps durable columns when there is no live row', () => {
  const rider = { id: 'rider-1', latitude: 1, longitude: 2, updatedAt: '2026-07-29T11:00:00.000Z' };
  const merged = mergeRiderLiveLocation(rider, undefined, NOW_MS);
  assertEquals(merged.latitude, 1);
  assertEquals(merged.longitude, 2);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from the worktree root:

```bash
deno test -A --no-lock supabase/functions/_shared/riderLocation.test.ts
```

Expected: FAIL — `Module not found "./riderLocation.ts"`.

- [ ] **Step 3: Write the implementation**

Create `supabase/functions/_shared/riderLocation.ts`:

```ts
// Live rider position lives in the UNLOGGED `rider_live_location` table.
// A fix older than RIDER_LIVE_TTL_MS is treated as absent — that is what makes
// a rider who closed the app drop off the fleet map without any sweep job.
export const RIDER_LIVE_TTL_MS = 90_000;

// DispatchRiderRecord keeps a durable copy, refreshed at most this often per
// rider. The throttle is enforced in SQL by a WHERE on updatedAt, so it costs
// no extra round trip.
export const DURABLE_SYNC_INTERVAL_SECONDS = 60;

export type RiderLiveLocationRow = {
  rider_id: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  updated_at: string;
};

export const buildRiderLocationUpsert = (
  riderId: string,
  latitude: number,
  longitude: number,
  accuracy: number | null,
  nowIso: string
): RiderLiveLocationRow => ({
  rider_id: riderId,
  latitude,
  longitude,
  accuracy,
  updated_at: nowIso,
});

export const isRiderLocationLive = (
  updatedAt: string | null | undefined,
  nowMs: number,
  ttlMs: number = RIDER_LIVE_TTL_MS
): boolean => {
  if (!updatedAt) {
    return false;
  }
  const parsed = Date.parse(updatedAt);
  if (Number.isNaN(parsed)) {
    return false;
  }
  return nowMs - parsed < ttlMs;
};

export const mergeRiderLiveLocation = <
  T extends {
    id: string;
    latitude?: number | null;
    longitude?: number | null;
    updatedAt?: string | null;
  }
>(
  rider: T,
  live: RiderLiveLocationRow | undefined,
  nowMs: number
): T => {
  if (!live || !isRiderLocationLive(live.updated_at, nowMs)) {
    return rider;
  }
  return {
    ...rider,
    latitude: live.latitude,
    longitude: live.longitude,
    updatedAt: live.updated_at,
  };
};
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
deno test -A --no-lock supabase/functions/_shared/riderLocation.test.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Register the test file in the test script**

In `package.json`, in the `test:deno` script, append the new file to the list.
Find `supabase/functions/_shared/pricing.test.ts` and add
`supabase/functions/_shared/riderLocation.test.ts` immediately after it, keeping
the single-line format.

Verify the whole suite still runs:

```bash
npm run test:deno
```

Expected: PASS, including the 9 new tests.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/riderLocation.ts supabase/functions/_shared/riderLocation.test.ts package.json
git commit -m "feat(dispatch): add pure helpers for live rider location"
```

---

### Task 3: Rewrite the `syncDispatchRiderLocation` write path

**Files:**
- Modify: `supabase/functions/app-rpc/index.ts:6085-6135`

**Interfaces:**
- Consumes: `buildRiderLocationUpsert`, `DURABLE_SYNC_INTERVAL_SECONDS` from
  Task 2; `ebuy_touch_rider_durable_location` from this task's migration.
- Produces: unchanged JSON response shape
  `{ accuracy, latitude, longitude, riderId, timestamp }`.

The existence `SELECT` is deleted for the non-admin case: `ensureRole` already
gates the action and line 6088 forces `riderId` to `context.uid`, a JWT-verified
identity. An admin-supplied `riderId` is still validated, because an admin can
pass an arbitrary id.

- [ ] **Step 1: Write the throttled durable-update SQL function**

Create `supabase/migrations/20260729_rider_durable_location_sync.sql`:

```sql
-- Refreshes DispatchRiderRecord's durable lat/long at most once per interval per
-- rider. The WHERE clause is the throttle: a call inside the window matches no
-- rows and writes nothing, so no read is needed to decide whether to write.
-- Returns true when a durable write actually happened.

create or replace function public.ebuy_touch_rider_durable_location(
  p_rider_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_min_interval_seconds integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  update public."DispatchRiderRecord"
  set latitude = p_latitude,
      longitude = p_longitude,
      "updatedAt" = now()
  where id = p_rider_id
    and ("updatedAt" is null
         or "updatedAt" < now() - make_interval(secs => p_min_interval_seconds));

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.ebuy_touch_rider_durable_location(uuid, double precision, double precision, integer) from public, anon, authenticated;
grant execute on function public.ebuy_touch_rider_durable_location(uuid, double precision, double precision, integer) to service_role;
```

Apply it with the Supabase MCP `apply_migration` tool, name
`rider_durable_location_sync`.

- [ ] **Step 2: Verify the function exists and throttles**

Run with `execute_sql`, substituting a real rider id from
`select id from "DispatchRiderRecord" limit 1`:

```sql
select public.ebuy_touch_rider_durable_location('<rider-id>'::uuid, 6.5244, 3.3792, 60) as first_call,
       public.ebuy_touch_rider_durable_location('<rider-id>'::uuid, 6.5244, 3.3792, 60) as second_call;
```

Expected: `first_call = true`, `second_call = false` — the second is inside the
60 s window. If both are true the `WHERE` throttle is not working; stop and fix
before continuing.

- [ ] **Step 3: Replace the handler body**

In `supabase/functions/app-rpc/index.ts`, replace lines 6085–6135 (the whole
`if (action === 'syncDispatchRiderLocation') { ... }` block) with:

```ts
  if (action === 'syncDispatchRiderLocation') {
    ensureRole(context.role, ['dispatch', 'admin']);
    const requestedRiderId = sanitizeText(data.riderId);
    const riderId = context.role === 'admin' ? requestedRiderId || context.uid : context.uid;
    const latitude = parseNumber(data.latitude, Number.NaN);
    const longitude = parseNumber(data.longitude, Number.NaN);
    const accuracy = parseNumber(data.accuracy, null);
    if (!riderId) {
      fail(400, 'A rider id is required.');
    }
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      fail(400, 'A valid rider location is required.');
    }

    // An admin may target an arbitrary rider id, so that case still needs
    // validating. A dispatch caller can only ever be itself (riderId is forced
    // to context.uid above), and the JWT already proves that identity — so the
    // existence check is skipped on the hot path.
    if (context.role === 'admin' && requestedRiderId) {
      const { data: existingRider, error: riderError } = await serviceClient
        .from('DispatchRiderRecord')
        .select('id')
        .eq('id', riderId)
        .maybeSingle<{ id: string }>();

      if (riderError) {
        throw new Error(riderError.message);
      }

      if (!existingRider) {
        fail(404, 'The selected rider could not be found.');
      }
    }

    const timestamp = nowIso();

    // Unlogged write: no WAL, no dead tuple on DispatchRiderRecord.
    const { error: liveError } = await serviceClient
      .from('rider_live_location')
      .upsert(
        buildRiderLocationUpsert(riderId, latitude, longitude, accuracy, timestamp),
        { onConflict: 'rider_id' }
      );

    if (liveError) {
      throw new Error(liveError.message);
    }

    // Durable fallback, throttled in SQL. A failure here must not fail the ping —
    // the live row is already written and is what every read path prefers.
    const { error: durableError } = await serviceClient.rpc(
      'ebuy_touch_rider_durable_location',
      {
        p_rider_id: riderId,
        p_latitude: latitude,
        p_longitude: longitude,
        p_min_interval_seconds: DURABLE_SYNC_INTERVAL_SECONDS,
      }
    );

    if (durableError) {
      logEdgeEvent('error', 'durable rider location sync failed', {
        reason: durableError.message,
        riderId,
      });
    }

    return json(200, {
      data: {
        accuracy,
        latitude,
        longitude,
        riderId,
        timestamp,
      },
    });
  }
```

- [ ] **Step 4: Add the import**

At the top of `supabase/functions/app-rpc/index.ts`, alongside the other
`_shared` imports, add:

```ts
import {
  buildRiderLocationUpsert,
  DURABLE_SYNC_INTERVAL_SECONDS,
  mergeRiderLiveLocation,
  type RiderLiveLocationRow,
} from '../_shared/riderLocation.ts';
```

`mergeRiderLiveLocation` and `RiderLiveLocationRow` are used in Task 4; importing
them now keeps the import block edited once.

Confirm `logEdgeEvent` is already imported in this file — it is used elsewhere.
If it is not in the import list, add it to the existing
`from '../_shared/observability.ts'` import.

- [ ] **Step 5: Typecheck**

```bash
deno check supabase/functions/app-rpc/index.ts
```

Expected: no errors. A "declared but never used" error for
`mergeRiderLiveLocation` is expected here and is resolved by Task 4 — if the
checker treats it as fatal, complete Task 4 before committing.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260729_rider_durable_location_sync.sql supabase/functions/app-rpc/index.ts
git commit -m "perf(dispatch): write rider pings to unlogged table, throttle durable sync"
```

---

### Task 4: Read live position in `dispatchGetRiders`

**Files:**
- Modify: `supabase/functions/app-rpc/index.ts:5872-5890`

**Interfaces:**
- Consumes: `mergeRiderLiveLocation`, `RiderLiveLocationRow` from Task 2.
- Produces: unchanged `{ data: { riders: [...] } }` response shape.

- [ ] **Step 1: Replace the handler body**

Replace lines 5872–5890 with:

```ts
  if (action === 'dispatchGetRiders') {
    ensureRole(context.role, ['dispatch', 'admin']);
    const { data: riders, error } = await serviceClient
      .from('DispatchRiderRecord')
      .select(
        'id,displayName,status,zone,vehicleType,acceptanceRate,activeLoad,completedTrips,latitude,longitude,createdAt,updatedAt'
      )
      .order('updatedAt', { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    // Live positions come from the unlogged table. A failure here is not fatal:
    // the durable DispatchRiderRecord columns are the fallback, at most
    // DURABLE_SYNC_INTERVAL_SECONDS stale.
    const { data: liveRows, error: liveError } = await serviceClient
      .from('rider_live_location')
      .select('rider_id,latitude,longitude,accuracy,updated_at');

    if (liveError) {
      logEdgeEvent('error', 'live rider location read failed', {
        reason: liveError.message,
      });
    }

    const liveById = new Map<string, RiderLiveLocationRow>(
      ((liveRows ?? []) as RiderLiveLocationRow[]).map((row) => [row.rider_id, row])
    );
    const nowMs = Date.now();

    return json(200, {
      data: {
        riders: ((riders ?? []) as DispatchRiderRow[]).map((rider) =>
          buildDispatchRiderResponse(
            mergeRiderLiveLocation(rider, liveById.get(rider.id), nowMs)
          )
        ),
      },
    });
  }
```

- [ ] **Step 2: Typecheck**

```bash
deno check supabase/functions/app-rpc/index.ts
```

Expected: no errors, and the unused-import warning from Task 3 is gone.

- [ ] **Step 3: Run the full deno suite**

```bash
npm run test:deno
```

Expected: PASS. No existing test touches these handlers; this confirms nothing
regressed.

- [ ] **Step 4: Verify end to end against the database**

Insert a live row for a real rider and confirm the merge wins:

```sql
insert into public.rider_live_location (rider_id, latitude, longitude, accuracy, updated_at)
values ('<rider-id>'::uuid, 6.5244, 3.3792, 10, now())
on conflict (rider_id) do update set
  latitude = excluded.latitude,
  longitude = excluded.longitude,
  updated_at = excluded.updated_at;
```

Then call `dispatchGetRiders` (admin token) and confirm that rider's `latitude`
is `6.5244`. Then set `updated_at = now() - interval '2 minutes'` and confirm the
response falls back to the `DispatchRiderRecord` value.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/app-rpc/index.ts
git commit -m "feat(dispatch): serve live rider position with durable fallback"
```

---

### Task 5: Distance-ranked courier candidates

**Files:**
- Create: `supabase/migrations/20260729_nearest_riders.sql`
- Modify: `supabase/functions/app-rpc/index.ts` — add `findNearestRiders` after
  `buildDispatchRiderResponse` (ends line 798), and a new
  `dispatchGetNearestRiders` action immediately before
  `if (action === 'dispatchAssignOrderCourier') {` (line 6137 pre-Task-3;
  re-locate by searching for the string)

**Interfaces:**
- Consumes: `rider_live_location` and the GiST index from Task 1;
  `buildDispatchRiderResponse` and `DispatchRiderRow` (existing, line 782/153).
- Produces: new RPC action `dispatchGetNearestRiders` accepting
  `{ latitude, longitude, radiusMetres?, limit? }` and returning
  `{ data: { riders: Array<DispatchRiderResponse & { metres: number }> } }`,
  ordered nearest-first; TS helper `findNearestRiders`; SQL function
  `ebuy_nearest_riders(p_latitude double precision, p_longitude double precision, p_radius_metres double precision, p_limit integer)`
  returning `(rider_id uuid, latitude double precision, longitude double precision, metres double precision)`
  ordered nearest-first.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260729_nearest_riders.sql`:

```sql
-- Nearest-rider search over the unlogged live-location table.
--
-- earth_box(...) @> ll_to_earth(...) is the index-usable bounding-box filter
-- (it can use rider_live_location_geo_idx); earth_distance then computes the
-- exact great-circle distance on the small surviving set. Filtering on
-- updated_at first excludes riders who stopped pinging.

create or replace function public.ebuy_nearest_riders(
  p_latitude double precision,
  p_longitude double precision,
  p_radius_metres double precision default 5000,
  p_limit integer default 10
)
returns table (
  rider_id uuid,
  latitude double precision,
  longitude double precision,
  metres double precision
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    l.rider_id,
    l.latitude,
    l.longitude,
    extensions.earth_distance(
      extensions.ll_to_earth(p_latitude, p_longitude),
      extensions.ll_to_earth(l.latitude, l.longitude)
    ) as metres
  from public.rider_live_location l
  where l.updated_at > now() - interval '90 seconds'
    and extensions.earth_box(extensions.ll_to_earth(p_latitude, p_longitude), p_radius_metres)
        @> extensions.ll_to_earth(l.latitude, l.longitude)
  order by metres asc
  limit greatest(p_limit, 1);
$$;

revoke all on function public.ebuy_nearest_riders(double precision, double precision, double precision, integer) from public, anon, authenticated;
grant execute on function public.ebuy_nearest_riders(double precision, double precision, double precision, integer) to service_role;
```

Apply with `apply_migration`, name `nearest_riders`.

- [ ] **Step 2: Verify ordering with known coordinates**

Seed three riders at known distances from Lagos Island (6.4550, 3.4210) and
check the ordering:

```sql
insert into public.rider_live_location (rider_id, latitude, longitude, updated_at)
values
  (gen_random_uuid(), 6.4550, 3.4210, now()),   -- ~0 m
  (gen_random_uuid(), 6.4650, 3.4210, now()),   -- ~1.1 km north
  (gen_random_uuid(), 6.5244, 3.3792, now());   -- ~9 km north-west

select round(metres::numeric) as metres
from public.ebuy_nearest_riders(6.4550, 3.4210, 20000, 10);
```

Expected: three rows, ascending, approximately `0`, `1100`, `9000`. Exact values
will vary slightly; the ordering is what matters.

- [ ] **Step 3: Verify the index is used, not a sequential scan**

```sql
explain (costs off)
select * from public.ebuy_nearest_riders(6.4550, 3.4210, 5000, 10);
```

Expected: the plan mentions `rider_live_location_geo_idx`. On a table of only a
few rows Postgres may legitimately prefer a sequential scan — if so, confirm the
index is at least considered by re-running with
`set enable_seqscan = off;` first. Record which you saw.

- [ ] **Step 4: Clean up the seeded test rows**

```sql
delete from public.rider_live_location
where rider_id not in (select id from public."DispatchRiderRecord");
```

- [ ] **Step 5: Add the `dispatchGetNearestRiders` action**

**Why a new action rather than changing assignment:** `dispatchAssignOrderCourier`
requires an explicit `courierId` and fails 400 without one
(`app-rpc/index.ts:6141`) — there is no auto-assign path to improve. Orders also
carry no delivery coordinates; only `RestaurantRecord` has lat/long. So ranking
is exposed as a read-only lookup the dispatcher UI calls to populate its rider
picker, taking coordinates explicitly from the caller. This changes no existing
behaviour.

Add this helper immediately after `buildDispatchRiderResponse` (which ends at
line 798):

```ts
type NearestRiderRow = {
  rider_id: string;
  latitude: number;
  longitude: number;
  metres: number;
};

// Ranks live riders by true distance from a point. Returns [] when the geo
// function is unavailable or nothing is in range, so callers always have a
// well-formed list to fall back on.
const findNearestRiders = async (
  latitude: number,
  longitude: number,
  radiusMetres: number,
  limit: number
): Promise<NearestRiderRow[]> => {
  const { data, error } = await serviceClient.rpc('ebuy_nearest_riders', {
    p_latitude: latitude,
    p_longitude: longitude,
    p_radius_metres: radiusMetres,
    p_limit: limit,
  });

  if (error) {
    logEdgeEvent('error', 'nearest rider lookup failed', { reason: error.message });
    return [];
  }

  return (data ?? []) as NearestRiderRow[];
};
```

Then add the action handler. Place it immediately before
`if (action === 'dispatchAssignOrderCourier') {`:

```ts
  if (action === 'dispatchGetNearestRiders') {
    ensureRole(context.role, ['dispatch', 'admin']);
    const latitude = parseNumber(data.latitude, Number.NaN);
    const longitude = parseNumber(data.longitude, Number.NaN);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      fail(400, 'A valid pickup location is required.');
    }

    const radiusMetres = Math.min(
      Math.max(parseNumber(data.radiusMetres, 5000) ?? 5000, 100),
      50_000
    );
    const limit = Math.min(Math.max(parseNumber(data.limit, 10) ?? 10, 1), 50);

    const nearest = await findNearestRiders(latitude, longitude, radiusMetres, limit);
    if (nearest.length === 0) {
      return json(200, { data: { riders: [] } });
    }

    const { data: riderRows, error: ridersError } = await serviceClient
      .from('DispatchRiderRecord')
      .select(
        'id,displayName,status,zone,vehicleType,acceptanceRate,activeLoad,completedTrips,latitude,longitude,createdAt,updatedAt'
      )
      .in(
        'id',
        nearest.map((row) => row.rider_id)
      );

    if (ridersError) {
      throw new Error(ridersError.message);
    }

    const ridersById = new Map(
      ((riderRows ?? []) as DispatchRiderRow[]).map((rider) => [rider.id, rider])
    );

    // Preserve the distance ordering from the geo query — the `in` filter above
    // returns rows in arbitrary order.
    const ordered = nearest.flatMap((row) => {
      const rider = ridersById.get(row.rider_id);
      if (!rider) {
        return [];
      }
      return [
        {
          ...buildDispatchRiderResponse({
            ...rider,
            latitude: row.latitude,
            longitude: row.longitude,
          }),
          metres: Math.round(row.metres),
        },
      ];
    });

    return json(200, { data: { riders: ordered } });
  }
```

A rider present in `rider_live_location` but absent from `DispatchRiderRecord`
is skipped by the `flatMap` rather than emitting a partial record — that can
happen if a rider profile is deleted while a live row survives.

- [ ] **Step 6: Typecheck and run the suite**

```bash
deno check supabase/functions/app-rpc/index.ts
npm run test:deno
```

Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260729_nearest_riders.sql supabase/functions/app-rpc/index.ts
git commit -m "feat(dispatch): rank courier candidates by live distance"
```

---

### Task 6: Sub-second queue pickup via `pg_net` trigger

**Files:**
- Create: `supabase/migrations/20260729_queue_drainer_trigger.sql`

**Interfaces:**
- Consumes: Vault secrets `project_url` and `queue_worker_token` (already set —
  used by `20260624_queue_drainer_schedule.sql`); the `queue-drainer` function's
  existing POST interface (`x-queue-worker-token` header, `{ queue }` body).
- Produces: trigger `queue_notify_drainer` on each `queue_*` table.

No edge-function change is required: `queue-drainer/index.ts:75` already reads
`x-queue-worker-token` and line 264 already parses a `queue` selector.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260729_queue_drainer_trigger.sql`:

```sql
-- Fire queue-drainer immediately when a job is enqueued, instead of waiting up
-- to a minute for the pg_cron tick. The cron schedule from
-- 20260624_queue_drainer_schedule.sql stays as the backstop.
--
-- Safe against pile-up: queue-drainer wraps its work in runWithBackpressure
-- with maxConcurrent 1, so an overlapping call returns 429 and does nothing.
--
-- Credentials come from the same Vault secrets the cron job uses. If either is
-- missing the SELECT yields no row and no request is sent — the trigger becomes
-- a no-op rather than an error, so enqueueing never fails because of this.

create or replace function public.ebuy_notify_queue_drainer()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_project_url text;
  v_worker_token text;
begin
  select decrypted_secret into v_project_url
  from vault.decrypted_secrets where name = 'project_url';

  select decrypted_secret into v_worker_token
  from vault.decrypted_secrets where name = 'queue_worker_token';

  if v_project_url is null or v_worker_token is null then
    return null;
  end if;

  perform net.http_post(
    url := v_project_url || '/functions/v1/queue-drainer',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-queue-worker-token', v_worker_token
    ),
    body := jsonb_build_object(
      'batchSize', 10,
      'concurrency', 4,
      'queue', tg_argv[0]
    ),
    timeout_milliseconds := 5000
  );

  return null;
exception
  when others then
    -- Never let a dispatch failure roll back the enqueue. The cron backstop
    -- will pick the job up on its next tick.
    raise notice 'queue drainer notify failed: %', sqlerrm;
    return null;
end;
$$;

revoke all on function public.ebuy_notify_queue_drainer() from public, anon, authenticated;

do $trg$
begin
  drop trigger if exists queue_notify_drainer on public.queue_order_placement;
  create trigger queue_notify_drainer
    after insert on public.queue_order_placement
    for each statement
    execute function public.ebuy_notify_queue_drainer('order-placement');

  drop trigger if exists queue_notify_drainer on public.queue_payment_verification;
  create trigger queue_notify_drainer
    after insert on public.queue_payment_verification
    for each statement
    execute function public.ebuy_notify_queue_drainer('payment-verification');

  drop trigger if exists queue_notify_drainer on public.queue_notifications;
  create trigger queue_notify_drainer
    after insert on public.queue_notifications
    for each statement
    execute function public.ebuy_notify_queue_drainer('notifications');
exception
  when others then
    raise notice 'queue drainer trigger install skipped: %', sqlerrm;
end
$trg$;
```

`for each statement` (not `for each row`) is deliberate: a bulk insert of ten
jobs should cause one drain, not ten.

Apply with `apply_migration`, name `queue_drainer_trigger`.

- [ ] **Step 2: Verify the triggers exist**

```sql
select event_object_table, trigger_name, action_timing, event_manipulation
from information_schema.triggers
where trigger_name = 'queue_notify_drainer'
order by event_object_table;
```

Expected: three rows — `queue_notifications`, `queue_order_placement`,
`queue_payment_verification` — all `AFTER INSERT`.

- [ ] **Step 3: Verify a real enqueue triggers an HTTP call**

Insert a harmless notification job and check `pg_net`'s response table:

```sql
insert into public.queue_notifications (id, payload, status, retry_count, created_at)
values (
  'plan-smoke-' || extract(epoch from now())::text,
  jsonb_build_object('payload', jsonb_build_object('title', 'plan smoke', 'body', 'plan smoke', 'data', '{}'::jsonb)),
  'pending', 0, now()
);

select id, status_code, created
from net._http_response
order by created desc
limit 3;
```

Expected: a row within a few seconds with `status_code` 200 (drained) or 429
(a drain was already in flight — also correct).

- [ ] **Step 4: Confirm the job actually drained**

```sql
select id, status, error
from public.queue_notifications
where id like 'plan-smoke-%'
order by created_at desc
limit 1;
```

Expected: `completed`. If it is still `pending` after a minute, the cron backstop
also failed — check Vault secrets before assuming the trigger is at fault.

- [ ] **Step 5: Clean up the smoke-test row**

```sql
delete from public.queue_notifications where id like 'plan-smoke-%';
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260729_queue_drainer_trigger.sql
git commit -m "perf(queue): drain immediately on enqueue via pg_net trigger"
```

---

### Task 7: Documentation and spec status

**Files:**
- Modify: `docs/superpowers/specs/2026-07-29-zero-cost-backend-scaling-design.md`
- Create: `docs/superpowers/plans/2026-07-29-zero-cost-backend-scaling.md` (this
  file — already exists; only its status line changes)

- [ ] **Step 1: Mark the spec implemented**

In `docs/superpowers/specs/2026-07-29-zero-cost-backend-scaling-design.md`,
change the `**Status:**` line to:

```markdown
**Status:** Implemented 2026-07-29 on branch `feature/zero-cost-scaling`
(§6 rate limiting and catalog cache intentionally not implemented — see that
section for why). Supersedes the two Redis specs of the same date.
```

- [ ] **Step 2: Record the measured numbers**

Append to §11 of the spec a short "Measured" subsection with the actual values
observed during Task 5 step 3 (index used or sequential scan) and Task 6 step 3
(observed `status_code` and latency between insert and drain). Replace estimates
with what was actually seen. Do not leave the estimates unqualified.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-07-29-zero-cost-backend-scaling-design.md
git commit -m "docs: mark zero-cost scaling spec implemented with measured results"
```

---

## Deferred — not in this plan

Recorded so a reader does not assume they were forgotten:

- **Rate limiting and catalog cache** (spec §6): deliberately unchanged. Neither
  shows measured load. Revisit only if `pg_stat_statements` surfaces them.
- **`pgmq` migration** (spec §7): the existing `queue_*` tables already have
  visibility timeouts, backoff, and idempotency. Migrating working money-path
  machinery needs a measured reason.
- **Set-based job claiming** (`_shared/queue.ts:204-223` issues one `UPDATE` per
  job): the first thing to fix if queue throughput becomes a problem. Not a
  problem yet.
- **Narrowing `customerGetPublishedRestaurantDetail`** (loads the whole catalog
  to find one restaurant): a query fix, tracked separately.

## Self-Review

**Spec coverage:**

| Spec section | Task |
| --- | --- |
| §3 `UNLOGGED` table, write path, durable throttle | 1, 3 |
| §3 staleness via `updated_at` filter | 2 (`isRiderLocationLive`), 5 (SQL filter) |
| §3 read path with fallback | 4 |
| §4 nearest-rider (`earthdistance` option A) | 5 |
| §5 `pg_net` sub-second pickup | 6 |
| §6 rate limiting / catalog cache — intentionally unchanged | Deferred, documented |
| §7 `pgmq` — unscheduled | Deferred, documented |
| §8 error handling | Covered per-task: non-fatal live read (4), non-fatal durable sync (3), exception-guarded trigger (6) |
| §9 testing | Task 2 unit tests; DB verification steps in 1, 3, 5, 6 |
| §10 rollout order | Task order matches |

**Placeholder scan:** no TBD/TODO. Every code step contains complete, literal
code. An earlier draft of Task 5 told the implementer to locate an integration
point inside `dispatchAssignOrderCourier` and infer field names; reading that
handler showed the premise was wrong — it requires an explicit `courierId`
(line 6141) and orders carry no coordinates — so the task was rewritten as a
self-contained new action with every line given.

**Type consistency:** `RiderLiveLocationRow` uses snake_case
(`rider_id`, `updated_at`) throughout — it mirrors database columns, and Tasks 3
and 4 both use it that way. `DispatchRiderRow` (camelCase, `latitude`,
`updatedAt`) is the domain shape and is what `mergeRiderLiveLocation` returns,
so `buildDispatchRiderResponse` keeps its existing input type. `NearestRiderRow`
is snake_case for the same reason. `DURABLE_SYNC_INTERVAL_SECONDS` (60) and the
SQL default `p_min_interval_seconds default 60` agree. `RIDER_LIVE_TTL_MS`
(90 000) and the SQL `interval '90 seconds'` agree.
