-- Task 14 (E3): the acceptance deadline — close the path where a paid customer
-- waits forever because a restaurant never opened the app.
--
-- Two stages, both swept every minute by queue-drainer (Task 10's every-minute
-- pg_cron schedule already posts {"queue":"all"} — no new cron entry, no new
-- secret, no new schedule to keep alive):
--
--   1. Escalation at `acceptanceDeadlineMinutes` (PlatformSettings, default 8)
--      past the order entering 'placed': page admin, flag the order
--      `needsAttention`. The order STAYS 'placed' — a restaurant can still
--      accept it — so this is a heads-up, not a state transition.
--   2. Auto-cancel at 2× the deadline: cancel with a FULL refund, notify both
--      sides, and count the miss on the restaurant.
--
-- THE COMPARE-AND-SWAP, and why a read-then-write will not do here.
-- ------------------------------------------------------------------
-- The sweep reads an order, decides it is overdue, and then acts — but a
-- restaurant tapping Accept races that decision. The transition is therefore a
-- compare-and-swap at WRITE time, not a status check at read time: both
-- functions take the same `for update` row lock a concurrent accept
-- (partnerUpdateOrderStatus's `update "CustomerOrder"`) takes, re-read the
-- committed status after the lock is granted (READ COMMITTED), and act only if
-- the order is STILL 'placed'. If the accept committed first, the lock returns
-- 'accepted', the guard fails, and the write no-ops — no escalation, no cancel,
-- no refund, no missed-count bump. If the sweep's function takes the lock
-- first, the accept blocks until this transaction commits, then re-reads
-- 'cancelled'/flagged and behaves accordingly. Same shape as
-- ebuy_lock_order_status / ebuy_claim_dispatch_assignment
-- (20260815_dispatch_reassignment_cas.sql).
--
-- ONE TRANSACTION for the cancel. ebuy_auto_cancel_unaccepted_order does the
-- status flip, the refund payload write, AND the restaurant miss-count
-- increment as ONE function call = ONE transaction, so a partial failure can
-- never refund without cancelling (or bump the count without cancelling), the
-- same atomicity ebuy_submit_order_rating relies on. The miss count is an
-- atomic in-SQL `coalesce(...) + 1` UPDATE — never read into the caller and
-- written back — so two different orders' misses landing on the same
-- restaurant serialize correctly through Postgres's own row-level MVCC.
--
-- THE ESCALATION ONCE-GUARD is the `needsAttention` flag itself, flipped by a
-- compare-and-swap (`where not coalesce(needsAttention, false)`), so even two
-- concurrent sweeps flip it at most once between them and admin is paged
-- exactly once. Same "guard is the write, not a pre-check SELECT" lesson as
-- 20260820_order_ratings.sql's unique constraint.
--
-- Additive and idempotent throughout: add column if not exists, create or
-- replace function. Re-applying it is a no-op. RLS unchanged.

-- ---------------------------------------------------------------------------
-- 1. The new columns.
-- ---------------------------------------------------------------------------

-- On the order: the escalation flag. Defaults false so every existing order is
-- un-escalated and the compare-and-swap below has a definite starting value.
alter table public."CustomerOrder"
  add column if not exists "needsAttention" boolean not null default false;

-- On the restaurant: how many orders it let time out unaccepted. Surfaced in
-- the admin dashboard snapshot. Incremented atomically in SQL only.
alter table public."RestaurantRecord"
  add column if not exists "missedOrderCount" integer not null default 0;

-- ---------------------------------------------------------------------------
-- 2. Escalation as a compare-and-swap on the flag.
-- ---------------------------------------------------------------------------

-- Returns escalated=true ONLY on the run that actually flips needsAttention
-- false->true. A second sweep (needsAttention already true), or an order that
-- left 'placed' between the sweep's candidate read and this call (accepted,
-- cancelled, rejected, ...), returns false and writes nothing — so the caller
-- pages admin exactly once and never re-pages.
--
-- Status normalization is inlined to match normalizeOrderStatus
-- (_shared/orders.ts) and ebuy_lock_order_status EXACTLY: btrim, '' -> draft,
-- pending/confirmed -> placed, ready -> ready_for_pickup, no lowercasing. The
-- SQL guard and the TypeScript guard must classify a row identically.
create or replace function public.ebuy_escalate_unaccepted_order(
  p_order_id text
)
returns table ("escalated" boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_raw text;
  v_status text;
  v_needs_attention boolean;
begin
  select btrim(coalesce("status", '')), coalesce("needsAttention", false)
    into v_raw, v_needs_attention
  from public."CustomerOrder"
  where "id" = p_order_id
  for update;

  if not found then
    return query select false;
    return;
  end if;

  if v_raw = '' then
    v_status := 'draft';
  elsif v_raw in ('pending', 'confirmed') then
    v_status := 'placed';
  elsif v_raw = 'ready' then
    v_status := 'ready_for_pickup';
  else
    v_status := v_raw;
  end if;

  -- Only a still-'placed' order escalates, and only if not already flagged.
  if v_status <> 'placed' or v_needs_attention then
    return query select false;
    return;
  end if;

  update public."CustomerOrder"
  set "needsAttention" = true,
      "updatedAt" = now()
  where "id" = p_order_id
    and not coalesce("needsAttention", false);

  -- get diagnostics guards the last narrow window: if a concurrent sweep's own
  -- escalation committed between our locked read and this update, the
  -- `not coalesce(...)` predicate matches zero rows and we report false too.
  if not found then
    return query select false;
    return;
  end if;

  return query select true;
end;
$$;

grant execute on function public.ebuy_escalate_unaccepted_order(text) to service_role;
revoke execute on function public.ebuy_escalate_unaccepted_order(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Auto-cancel as a compare-and-swap — cancel + refund + miss-count, atomic.
-- ---------------------------------------------------------------------------

-- Returns cancelled=true only when this call actually transitions a still-
-- 'placed' order to 'cancelled'. The refund payload, cancellation record, and
-- timeline are computed by the caller from its snapshot and passed in whole;
-- they are written only inside the same locked transaction that owns the
-- status flip, so a snapshot that has since gone stale (the order was accepted)
-- is simply never written — the guard fails first.
--
-- The restaurant miss-count increment is INSIDE this function on purpose: it is
-- not separable from the cancel. A partial failure between "the order is
-- cancelled + refunded" and "the restaurant's miss is counted" would either
-- refund without cancelling or lose the count; folding both into one
-- transaction makes that impossible.
create or replace function public.ebuy_auto_cancel_unaccepted_order(
  p_order_id text,
  p_payment jsonb,
  p_cancellation jsonb,
  p_timeline jsonb
)
returns table ("cancelled" boolean, "restaurantId" text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_raw text;
  v_status text;
  v_restaurant_id text;
begin
  select btrim(coalesce("status", '')), "restaurantId"
    into v_raw, v_restaurant_id
  from public."CustomerOrder"
  where "id" = p_order_id
  for update;

  if not found then
    return query select false, null::text;
    return;
  end if;

  if v_raw = '' then
    v_status := 'draft';
  elsif v_raw in ('pending', 'confirmed') then
    v_status := 'placed';
  elsif v_raw = 'ready' then
    v_status := 'ready_for_pickup';
  else
    v_status := v_raw;
  end if;

  -- The compare-and-swap: an order that left 'placed' between the sweep's read
  -- and now (accepted, cancelled, rejected, ...) is never touched.
  if v_status <> 'placed' then
    return query select false, v_restaurant_id;
    return;
  end if;

  update public."CustomerOrder"
  set "status" = 'cancelled',
      "payment" = p_payment,
      "cancellation" = p_cancellation,
      "timeline" = p_timeline,
      "needsAttention" = false,
      "updatedAt" = now()
  where "id" = p_order_id;

  -- Atomic in-SQL increment — never read-then-write.
  update public."RestaurantRecord"
  set "missedOrderCount" = coalesce("missedOrderCount", 0) + 1
  where "id" = v_restaurant_id;

  return query select true, v_restaurant_id;
end;
$$;

grant execute on function public.ebuy_auto_cancel_unaccepted_order(text, jsonb, jsonb, jsonb) to service_role;
revoke execute on function public.ebuy_auto_cancel_unaccepted_order(text, jsonb, jsonb, jsonb) from public, anon, authenticated;
