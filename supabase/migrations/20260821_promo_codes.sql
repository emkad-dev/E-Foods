-- Task 17 (G1): the promotions engine — discount codes and automatic campaigns
-- validated and REDEEMED server-side at checkout. This is a NEW, separate system
-- from the existing banner/analytics "Promo"/"PromoEvent" tables
-- (20260714_promo_analytics.sql): those are marketing banners + click analytics,
-- these are money-moving discount codes with usage caps.
--
-- THE ATOMIC CAP MECHANISM. A promo code carries a global usage cap and a
-- per-user usage cap. `PromoRedemption` enforces both. The naive shape — SELECT
-- count(*), compare to the cap, then INSERT — is a race: two concurrent orders
-- for the same code both read count = cap−1 and both insert, busting the cap.
-- This plan has been bitten by exactly that read-then-write shape repeatedly
-- (see 20260820_order_ratings.sql's header, 20260816_dispatch_delivery_offers.sql,
-- and docs/rls-posture.md's DispatchRiderPing section for three earlier
-- instances). `ebuy_redeem_promo_code` closes it structurally: it takes a
-- `SELECT … FOR UPDATE` row lock on the PromoCode row FIRST, so all concurrent
-- redemptions of the same code serialize through that one lock; it counts live
-- redemptions UNDER the lock; and it inserts-or-refuses in the same transaction.
-- Whichever transaction gets the lock first sees the true count and either the
-- last slot or none; the next transaction blocks until the first commits, then
-- re-reads the now-updated count and refuses. Two orders racing a cap of 1
-- therefore resolve to exactly one redemption, never two.
--
-- WHY FOR UPDATE and not just a UNIQUE(promoCodeId,userId): a UNIQUE only
-- expresses "one per user" (per-user cap = 1). Multi-use caps (global N,
-- per-user M > 1) need the count-under-lock. The one UNIQUE that IS here is
-- UNIQUE(orderId): a redemption is bound to exactly one order, so re-driving the
-- same order id can never double-count a slot, and a rolled-back order's
-- redemption is released by orderId (ebuy_release_promo_redemption).
--
-- CONSISTENCY WITH ORDER CREATION. The handler redeems atomically BEFORE it
-- inserts the order row, and RELEASES the redemption (delete by orderId) if
-- order creation — or synchronous payment initialization — then fails. So a
-- discount is never applied to an order without a redemption recorded (no silent
-- cap bypass), and a cap is never consumed by an order that did not survive
-- placement. The failure mode is deliberately conservative: if the process died
-- between redeem and release, the orphaned redemption over-counts the cap
-- slightly (the code under-allows), never the reverse.
--
-- Additive and idempotent throughout: create table if not exists, add column if
-- not exists, constraint adds guarded on pg_constraint, create or replace
-- function. Re-applying it is a no-op.

-- ---------------------------------------------------------------------------
-- 0. Prerequisite, degraded rather than fatal (same pattern as
--    20260820_order_ratings.sql).
-- ---------------------------------------------------------------------------

do $ext$
begin
  create extension if not exists pgcrypto;
exception
  when others then
    raise notice 'promo-codes: pgcrypto unavailable (%), relying on the built-in gen_random_uuid()', sqlerrm;
end
$ext$;

-- ---------------------------------------------------------------------------
-- 1. PromoCode — the discount definition.
-- ---------------------------------------------------------------------------

create table if not exists public."PromoCode" (
  "id"            text primary key default (gen_random_uuid())::text,
  "code"          text not null,
  "type"          text not null,                 -- 'percent' | 'fixed' | 'free_delivery'
  "value"         numeric not null default 0,    -- percent points, fixed naira, or delivery cap
  "minBasket"     numeric not null default 0,    -- restaurant BASE basis threshold
  "perUserCap"    integer,                       -- null = unlimited per user
  "globalCap"     integer,                       -- null = unlimited overall
  "startsAt"      timestamptz,                   -- null = no lower bound
  "endsAt"        timestamptz,                   -- null = no upper bound
  "restaurantId"  text,                          -- null = platform-wide, else scoped to one restaurant
  "fundingSource" text not null default 'platform', -- 'platform' | 'restaurant'
  "isActive"      boolean not null default true,
  "isAutomatic"   boolean not null default false,   -- auto-applies when the basket qualifies (no code entry)
  "createdByUid"  text,
  "createdAt"     timestamptz not null default now(),
  "updatedAt"     timestamptz not null default now()
);

-- Codes are matched case-insensitively; store them already upper-cased and the
-- UNIQUE guarantees no two rows collide. A functional unique index on upper()
-- would also work, but normalizing on write keeps lookups a plain equality.
create unique index if not exists "PromoCode_code_key"
  on public."PromoCode" ("code");

create index if not exists "PromoCode_restaurantId_idx"
  on public."PromoCode" ("restaurantId");

-- Drives the "eligible automatic offers for this restaurant" lookup.
create index if not exists "PromoCode_automatic_active_idx"
  on public."PromoCode" ("isAutomatic", "isActive");

do $promo_checks$
begin
  if not exists (select 1 from pg_constraint where conname = 'PromoCode_type_check') then
    alter table public."PromoCode"
      add constraint "PromoCode_type_check"
      check ("type" in ('percent', 'fixed', 'free_delivery'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'PromoCode_fundingSource_check') then
    alter table public."PromoCode"
      add constraint "PromoCode_fundingSource_check"
      check ("fundingSource" in ('platform', 'restaurant'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'PromoCode_value_check') then
    alter table public."PromoCode"
      add constraint "PromoCode_value_check"
      check ("value" >= 0);
  end if;
end
$promo_checks$;

-- RLS on, NO policies: service-role only, the same posture as OrderRating /
-- DeliveryOffer. No client touches PromoCode through the Data API — the customer
-- validate/preview + placement re-validation and the admin CRUD are all Edge
-- Function actions under the service role. Documented in docs/rls-posture.md.
alter table public."PromoCode" enable row level security;

-- ---------------------------------------------------------------------------
-- 2. PromoRedemption — one row per code actually applied to an order.
-- ---------------------------------------------------------------------------

create table if not exists public."PromoRedemption" (
  "id"             text primary key default (gen_random_uuid())::text,
  "promoCodeId"    text not null,
  "userId"         text not null,
  "orderId"        text not null,
  "discountAmount" numeric not null default 0,
  "redeemedAt"     timestamptz not null default now()
);

-- One redemption per order: re-driving the same order id can never double-count
-- a cap slot, and the row is releasable by orderId when an order fails to land.
create unique index if not exists "PromoRedemption_orderId_key"
  on public."PromoRedemption" ("orderId");

-- Global-cap counting.
create index if not exists "PromoRedemption_promoCodeId_idx"
  on public."PromoRedemption" ("promoCodeId");

-- Per-user-cap counting.
create index if not exists "PromoRedemption_promoCodeId_userId_idx"
  on public."PromoRedemption" ("promoCodeId", "userId");

alter table public."PromoRedemption" enable row level security;

-- ---------------------------------------------------------------------------
-- 3. ebuy_redeem_promo_code — atomic cap check + insert, one transaction.
-- ---------------------------------------------------------------------------
--
-- Returns a structured (redeemed, reason, redemptionId) row rather than raising
-- for an ordinary "cap reached" refusal — the same "refuse via return value"
-- shape ebuy_submit_order_rating uses — so the caller gets a clean mapped client
-- error instead of a raw Postgrest message.
--
-- The FOR UPDATE on the PromoCode row is the whole race-safety argument. Two
-- transactions T1, T2 redeeming the same code on a cap of 1:
--   * one acquires the row lock first (say T1); the other blocks on it.
--   * T1 counts under the lock (0 < 1), inserts, commits, releases the lock.
--   * T2 now acquires the lock, counts (1 >= 1), refuses.
-- The symmetric interleaving (T2 first) is identical. Without the lock both
-- snapshots would read 0 and both would insert (MVCC does not show one
-- transaction the other's uncommitted row) — the classic cap bust. The lock
-- forces the count→insert critical section to serialize.
create or replace function public.ebuy_redeem_promo_code(
  p_promo_code_id text,
  p_user_id text,
  p_order_id text,
  p_discount_amount numeric
)
returns table ("redeemed" boolean, "reason" text, "redemptionId" text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_global_cap integer;
  v_per_user_cap integer;
  v_is_active boolean;
  v_global_count bigint;
  v_user_count bigint;
  v_redemption_id text;
begin
  -- Row lock FIRST: serializes every concurrent redemption of THIS code.
  select "globalCap", "perUserCap", "isActive"
    into v_global_cap, v_per_user_cap, v_is_active
  from public."PromoCode"
  where "id" = p_promo_code_id
  for update;

  if not found then
    return query select false, 'not_found'::text, null::text;
    return;
  end if;

  if v_is_active is not true then
    return query select false, 'inactive'::text, null::text;
    return;
  end if;

  -- Counts read UNDER the row lock, so no other redemption of this code can
  -- commit between the count and the insert below.
  if v_global_cap is not null then
    select count(*) into v_global_count
      from public."PromoRedemption"
      where "promoCodeId" = p_promo_code_id;

    if v_global_count >= v_global_cap then
      return query select false, 'global_cap_reached'::text, null::text;
      return;
    end if;
  end if;

  if v_per_user_cap is not null then
    select count(*) into v_user_count
      from public."PromoRedemption"
      where "promoCodeId" = p_promo_code_id and "userId" = p_user_id;

    if v_user_count >= v_per_user_cap then
      return query select false, 'user_cap_reached'::text, null::text;
      return;
    end if;
  end if;

  v_redemption_id := gen_random_uuid()::text;

  begin
    insert into public."PromoRedemption"
      ("id", "promoCodeId", "userId", "orderId", "discountAmount", "redeemedAt")
    values (v_redemption_id, p_promo_code_id, p_user_id, p_order_id, coalesce(p_discount_amount, 0), now());
  exception
    when unique_violation then
      -- UNIQUE(orderId): this order already redeemed a code (an idempotent
      -- retry of the same placement). Nothing new is written.
      return query select false, 'already_redeemed'::text, null::text;
      return;
  end;

  return query select true, 'redeemed'::text, v_redemption_id;
end;
$$;

grant execute on function public.ebuy_redeem_promo_code(text, text, text, numeric) to service_role;
revoke execute on function public.ebuy_redeem_promo_code(text, text, text, numeric) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. ebuy_release_promo_redemption — void a redemption whose order never landed.
-- ---------------------------------------------------------------------------
--
-- Deleting by orderId (which is UNIQUE) frees the cap slot the failed placement
-- reserved. Idempotent: deleting a non-existent redemption is a clean no-op, so
-- calling it on an order that never redeemed anything is harmless.
create or replace function public.ebuy_release_promo_redemption(
  p_order_id text
)
returns table ("released" boolean, "promoCodeId" text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_promo_code_id text;
begin
  delete from public."PromoRedemption"
  where "orderId" = p_order_id
  returning "promoCodeId" into v_promo_code_id;

  if v_promo_code_id is null then
    return query select false, null::text;
  else
    return query select true, v_promo_code_id;
  end if;
end;
$$;

grant execute on function public.ebuy_release_promo_redemption(text) to service_role;
revoke execute on function public.ebuy_release_promo_redemption(text) from public, anon, authenticated;
