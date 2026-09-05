-- Task 12 (E1): a quality signal on both sides of the marketplace.
--
-- THE IDEMPOTENCY MECHANISM. `OrderRating.orderId` carries a UNIQUE
-- constraint, and that constraint — not a read-then-write SELECT — is what
-- makes "only once" hold. ebuy_submit_order_rating attempts the INSERT
-- directly; a second submission for the same order hits unique_violation and
-- is translated into a clean `already_rated` outcome. This plan has been bitten
-- repeatedly by exactly the read-then-write shape a pre-check SELECT would
-- reintroduce here (see docs/rls-posture.md's DispatchRiderPing section and
-- 20260816_dispatch_delivery_offers.sql's own header for two earlier instances
-- of the same lesson) — a SELECT "have they already rated?" followed by an
-- INSERT leaves a window between the two statements where two concurrent
-- submissions both read "not yet rated" and both insert, defeating the guard
-- entirely. Relying on the constraint instead closes that window structurally:
-- whichever INSERT's row lands first wins, and the loser's own statement fails.
--
-- THE AVERAGE STAYS RACE-SAFE UNDER A CONCURRENT DOUBLE-SUBMIT for the same
-- reason: the aggregate UPDATE on RestaurantRecord/DispatchRiderRecord runs
-- only AFTER the INSERT has committed within this function's own statement,
-- inside the same function invocation (one RPC call = one transaction). A
-- losing second call's INSERT raises unique_violation before it ever reaches
-- the aggregate UPDATE, so the average is never double-counted — the loser's
-- transaction contributes nothing at all, not even a partial write. And the
-- increment itself is computed in one atomic UPDATE statement entirely inside
-- Postgres (never read into the caller and written back), so two DIFFERENT
-- orders' ratings landing concurrently on the same restaurant still serialize
-- correctly through Postgres's own row-level MVCC write serialization on that
-- one RestaurantRecord row — there is no TypeScript-side read/modify/write gap
-- for a second concurrent call to land in.
--
-- WHAT THIS FILE ADDS
-- -------------------
--   1. OrderRating table — RLS on, NO policies (service-role only; reads go
--      through the RPC). See docs/rls-posture.md.
--   2. ratingAverage/ratingCount on RestaurantRecord and DispatchRiderRecord,
--      additive (ADD COLUMN IF NOT EXISTS).
--   3. ebuy_submit_order_rating — insert the rating (ownership + delivered-
--      status enforced server-side) and update both aggregates, as ONE
--      function call / ONE transaction, so a partial failure (e.g. the
--      restaurant aggregate update erroring) rolls back the rating insert
--      too rather than leaving them out of sync.
--
-- Additive and idempotent throughout: create table if not exists, add column
-- if not exists, constraint adds guarded on pg_constraint, create or replace
-- function. Re-applying it is a no-op.

-- ---------------------------------------------------------------------------
-- 0. Prerequisite, degraded rather than fatal (same pattern as
--    20260816_dispatch_delivery_offers.sql).
-- ---------------------------------------------------------------------------

do $ext$
begin
  create extension if not exists pgcrypto;
exception
  when others then
    raise notice 'order-ratings: pgcrypto unavailable (%), relying on the built-in gen_random_uuid()', sqlerrm;
end
$ext$;

-- ---------------------------------------------------------------------------
-- 1. The table.
-- ---------------------------------------------------------------------------

create table if not exists public."OrderRating" (
  "id" text primary key,
  "orderId" text not null,
  "customerId" text not null,
  "restaurantId" text not null,
  "courierId" text,
  "restaurantScore" integer not null,
  "courierScore" integer,
  "comment" text,
  "createdAt" timestamptz not null default now()
);

do $score_check$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'OrderRating_restaurantScore_check'
  ) then
    alter table public."OrderRating"
      add constraint "OrderRating_restaurantScore_check"
      check ("restaurantScore" between 1 and 5);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'OrderRating_courierScore_check'
  ) then
    alter table public."OrderRating"
      add constraint "OrderRating_courierScore_check"
      check ("courierScore" is null or "courierScore" between 1 and 5);
  end if;
end
$score_check$;

-- THE idempotency guard. One rating per order, structurally — see the header
-- above for why this constraint (not a pre-check SELECT) is the mechanism.
create unique index if not exists "OrderRating_orderId_key"
  on public."OrderRating" ("orderId");

-- customerGetPendingRatings filters delivered orders down to the ones with no
-- OrderRating row yet; this drives that anti-join efficiently per customer.
create index if not exists "OrderRating_customerId_idx"
  on public."OrderRating" ("customerId");

create index if not exists "OrderRating_restaurantId_idx"
  on public."OrderRating" ("restaurantId");

-- RLS on, NO policies: service-role only, the same posture as DeliveryOffer /
-- DispatchRiderPing. No client touches this table through the Data API —
-- customerSubmitOrderRating / customerGetPendingRatings are the only access
-- path, both feasty-orders Edge Function actions running under the service
-- role. Documented in docs/rls-posture.md.
alter table public."OrderRating" enable row level security;

-- ---------------------------------------------------------------------------
-- 2. The aggregate columns, maintained incrementally (no full recompute).
-- ---------------------------------------------------------------------------

alter table public."RestaurantRecord" add column if not exists "ratingAverage" numeric;
alter table public."RestaurantRecord" add column if not exists "ratingCount" integer not null default 0;

alter table public."DispatchRiderRecord" add column if not exists "ratingAverage" numeric;
alter table public."DispatchRiderRecord" add column if not exists "ratingCount" integer not null default 0;

-- ---------------------------------------------------------------------------
-- 3. Submitting a rating — insert + both aggregate updates, one transaction.
-- ---------------------------------------------------------------------------

-- Returns a structured (submitted, reason, ...) row rather than raising for
-- every ordinary refusal (order missing, not yours, not delivered, already
-- rated) — the same "refuse via return value, not exception" shape
-- ebuy_offer_dispatch_assignment uses, so the caller gets a clean mapped
-- client error instead of a raw Postgrest message.
--
-- Ownership and delivered-status are checked via an ordinary (unlocked) read.
-- No compare-and-swap is needed for either: nothing else can move an order OUT
-- of 'delivered' (delivery is a terminal state — TERMINAL_ORDER_STATUSES in
-- _shared/orders.ts), so there is no committed-state race to close there, only
-- the already-rated race, which the UNIQUE constraint closes at the INSERT
-- itself regardless of what any earlier read saw.
create or replace function public.ebuy_submit_order_rating(
  p_order_id text,
  p_customer_id text,
  p_restaurant_score integer,
  p_courier_score integer,
  p_comment text
)
returns table ("submitted" boolean, "reason" text, "ratingId" text, "restaurantId" text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_customer_id text;
  v_restaurant_id text;
  v_status text;
  v_courier_id text;
  v_rating_id text;
begin
  select "customerId", "restaurantId", btrim(coalesce("status", ''))
    into v_order_customer_id, v_restaurant_id, v_status
  from public."CustomerOrder"
  where "id" = p_order_id;

  if not found then
    return query select false, 'order_not_found'::text, null::text, null::text;
    return;
  end if;

  if v_order_customer_id is distinct from p_customer_id then
    return query select false, 'not_owner'::text, null::text, v_restaurant_id;
    return;
  end if;

  if v_status <> 'delivered' then
    return query select false, 'not_delivered'::text, null::text, v_restaurant_id;
    return;
  end if;

  select "courierId" into v_courier_id
  from public."DeliveryAssignment"
  where "orderId" = p_order_id;

  v_rating_id := gen_random_uuid()::text;

  begin
    insert into public."OrderRating"
      ("id", "orderId", "customerId", "restaurantId", "courierId", "restaurantScore", "courierScore", "comment", "createdAt")
    values (
      v_rating_id,
      p_order_id,
      p_customer_id,
      v_restaurant_id,
      nullif(btrim(coalesce(v_courier_id, '')), ''),
      p_restaurant_score,
      p_courier_score,
      nullif(btrim(coalesce(p_comment, '')), ''),
      now()
    );
  exception
    when unique_violation then
      -- Nothing was written by this call — the loser of a concurrent
      -- double-submit contributes nothing, so the aggregate below is never
      -- reached and never double-counted for this rating.
      return query select false, 'already_rated'::text, null::text, v_restaurant_id;
      return;
  end;

  -- THE INCREMENTAL AVERAGE, computed entirely in one atomic UPDATE — never
  -- read into the caller and written back. Runs only now that the insert has
  -- definitely landed (the exception block above already returned on a
  -- unique_violation), so it can never fire for a rating that was not
  -- actually stored.
  update public."RestaurantRecord"
  set "ratingCount" = coalesce("ratingCount", 0) + 1,
      "ratingAverage" = (coalesce("ratingAverage", 0) * coalesce("ratingCount", 0) + p_restaurant_score)
        / (coalesce("ratingCount", 0) + 1)
  where "id" = v_restaurant_id;

  -- Courier aggregate only when a score was actually given AND the order had
  -- a courier — a pickup order, or a delivery with no rider on record, must
  -- not touch DispatchRiderRecord at all.
  if p_courier_score is not null and v_courier_id is not null and btrim(v_courier_id) <> '' then
    update public."DispatchRiderRecord"
    set "ratingCount" = coalesce("ratingCount", 0) + 1,
        "ratingAverage" = (coalesce("ratingAverage", 0) * coalesce("ratingCount", 0) + p_courier_score)
          / (coalesce("ratingCount", 0) + 1)
    where "id" = v_courier_id;
  end if;

  return query select true, 'submitted'::text, v_rating_id, v_restaurant_id;
end;
$$;

grant execute on function public.ebuy_submit_order_rating(text, text, integer, integer, text) to service_role;
revoke execute on function public.ebuy_submit_order_rating(text, text, integer, integer, text) from public, anon, authenticated;
