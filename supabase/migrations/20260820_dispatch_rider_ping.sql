-- Task 11 (D3): a rider position HISTORY, not just the one overwritten row
-- DispatchRiderRecord.latitude/longitude already carries.
--
-- WHY A PLAIN (LOGGED) TABLE, NOT UNLOGGED
-- -----------------------------------------
-- UNLOGGED was explicitly considered and rejected. The brief's own gate is
-- "check first whether any client subscribes to this table via
-- postgres_changes" - checked: grepping the whole app tree, `postgres_changes`
-- is used in exactly two places (apps/customer/app/(customer)/orders/index.tsx
-- and apps/customer/src/hooks/useCustomerOrder.ts), both for CustomerOrder /
-- order-tracking rows, never for DispatchRiderRecord or anything rider-location
-- shaped. So the immediate gate is clear. But UNLOGGED is still the wrong
-- choice, for a reason beyond that gate: Task 13 (E2, customer live tracking)
-- reads recent DispatchRiderPing rows from a service-role Edge Function and
-- relays position to the customer over the EXISTING `order-<id>` Realtime
-- BROADCAST topic - never postgres_changes, and never direct client access
-- (RLS stays on with no policies, exactly like DeliveryOffer in
-- 20260816_dispatch_delivery_offers.sql). That access pattern buys nothing
-- from UNLOGGED (there is no insert-heavy hot loop here - at most one row per
-- rider per DISPATCH_RIDER_PING_THROTTLE_SECONDS) and gives up something real:
-- UNLOGGED tables are truncated on crash recovery, so a Postgres restart mid-
-- shift would silently blank every rider's recent track, right when Task 13's
-- feature needs it. See docs/rls-posture.md for the same "logged, RLS-on,
-- no-policies" posture recorded for this table. FLAG: if a client ever starts
-- subscribing to this table directly via postgres_changes, revisit this
-- decision from scratch - UNLOGGED tables cannot replicate to logical
-- subscribers at all, so that combination would need to be ruled out again
-- from first principles, not just re-approved.
--
-- Additive and idempotent throughout, matching every other migration on this
-- branch: create table/index if not exists, create or replace function.
-- Re-applying this file is a no-op.

do $ext$
begin
  create extension if not exists pgcrypto;
exception
  when others then
    raise notice 'dispatch-rider-ping: pgcrypto unavailable (%), relying on the built-in gen_random_uuid()', sqlerrm;
end
$ext$;

-- ---------------------------------------------------------------------------
-- 1. The table.
-- ---------------------------------------------------------------------------

-- Exactly the columns the brief specifies. No foreign keys, matching the
-- surrounding schema (DispatchRiderRecord, DeliveryOffer, DeliveryAssignment
-- are all plain-text-id, FK-free).
create table if not exists public."DispatchRiderPing" (
  "id" text primary key,
  "riderId" text not null,
  "latitude" double precision not null,
  "longitude" double precision not null,
  "accuracy" double precision,
  "recordedAt" timestamptz not null default now()
);

-- Drives both the throttle check (most-recent ping for a rider) and any
-- future "last N minutes of track for this rider" read (Task 13).
create index if not exists "DispatchRiderPing_rider_recorded_idx"
  on public."DispatchRiderPing" ("riderId", "recordedAt" desc);

-- Drives the retention sweep's `recordedAt < cutoff` scan.
create index if not exists "DispatchRiderPing_recorded_idx"
  on public."DispatchRiderPing" ("recordedAt");

-- RLS on, NO policies: service-role only, the same posture as DeliveryOffer.
-- Nothing in any client app reads or writes this table through the Data API -
-- it is appended to and swept only from feasty-dispatch / queue-drainer, both
-- running under the service role. Documented in docs/rls-posture.md.
alter table public."DispatchRiderPing" enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Recording a ping - the race-safe throttle.
-- ---------------------------------------------------------------------------

-- "At most one ping every N seconds per rider" is enforced here, under a
-- per-rider advisory transaction lock, NOT as a TypeScript read-then-write.
--
-- A naive "SELECT the most recent ping's recordedAt, then INSERT if it's old
-- enough" is racy under two overlapping calls for the SAME rider (a retried
-- request, a flaky client firing twice, two Deno isolates): both could read
-- "nothing recent" from their own snapshot before either write commits, and
-- both insert - which is exactly the read-then-write shape this plan's
-- postmortems keep finding bugs in (see dispatchLoadRelease.test.ts's header
-- for the load-ledger version of the same lesson).
--
-- pg_advisory_xact_lock(hashtext(p_rider_id)) closes that gap. It is a
-- transaction-scoped lock keyed by the rider id's hash, so unrelated riders
-- never contend with each other, and it is released automatically at commit
-- or rollback - no matching unlock call, and nothing can leak a held lock
-- across a crash. Two overlapping calls for the SAME rider serialise: the
-- second blocks until the first's transaction actually commits (or rolls
-- back), and only then evaluates its own "is there a recent ping" check -
-- against data that is now genuinely committed, not a stale snapshot. This is
-- the "conditional insert" shape the brief calls race-safe, made airtight by
-- the lock rather than relying on an unenforced race between two NOT EXISTS
-- checks.
--
-- Returns `recorded = false` (never raises) when throttled - dropping a
-- too-frequent ping is the expected, normal outcome of a device polling every
-- few seconds, not a failure the caller should treat as an error.
create or replace function public.ebuy_record_dispatch_rider_ping(
  p_rider_id text,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy double precision,
  p_throttle_seconds integer
)
returns table ("recorded" boolean, "pingId" text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_ping_id text;
begin
  if p_rider_id is null or btrim(p_rider_id) = '' then
    return query select false, null::text;
    return;
  end if;

  if p_latitude is null or p_longitude is null then
    return query select false, null::text;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext(p_rider_id));

  if exists (
    select 1 from public."DispatchRiderPing"
    where "riderId" = p_rider_id
      and "recordedAt" > v_now - make_interval(secs => greatest(1, coalesce(p_throttle_seconds, 10)))
  ) then
    return query select false, null::text;
    return;
  end if;

  v_ping_id := gen_random_uuid()::text;

  insert into public."DispatchRiderPing"
    ("id", "riderId", "latitude", "longitude", "accuracy", "recordedAt")
  values (v_ping_id, p_rider_id, p_latitude, p_longitude, p_accuracy, v_now);

  return query select true, v_ping_id;
end;
$$;

grant execute on function public.ebuy_record_dispatch_rider_ping(text, double precision, double precision, double precision, integer) to service_role;
revoke execute on function public.ebuy_record_dispatch_rider_ping(text, double precision, double precision, double precision, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Retention - deletes pings older than the cutoff, run by queue-drainer.
-- ---------------------------------------------------------------------------

-- `for update skip locked` mirrors ebuy_expire_dispatch_offers: two concurrent
-- drainer invocations (an overlapping cron tick, a manual retry) take disjoint
-- batches rather than blocking on or double-deleting the same rows. Bounded by
-- p_limit per call so one sweep can never turn into an unbounded delete on a
-- table that has been neglected for a while - the next minute's tick picks up
-- wherever this one left off.
create or replace function public.ebuy_delete_expired_dispatch_rider_pings(
  p_retention_hours integer,
  p_limit integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  with due as (
    select "id"
    from public."DispatchRiderPing"
    where "recordedAt" < now() - make_interval(hours => greatest(1, coalesce(p_retention_hours, 24)))
    order by "recordedAt"
    limit greatest(1, coalesce(p_limit, 500))
    for update skip locked
  )
  delete from public."DispatchRiderPing" p
  using due
  where p."id" = due."id";

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

grant execute on function public.ebuy_delete_expired_dispatch_rider_pings(integer, integer) to service_role;
revoke execute on function public.ebuy_delete_expired_dispatch_rider_pings(integer, integer) from public, anon, authenticated;
