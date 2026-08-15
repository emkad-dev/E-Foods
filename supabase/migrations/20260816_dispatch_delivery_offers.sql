-- Task 10 (D2): riders stop being assigned to and start accepting.
--
-- THE CLAIM-TIMING DECISION, AND WHY IT IS THE WHOLE DESIGN
-- ---------------------------------------------------------
-- Task 9 (D1) claimed the courier at the moment of automatic selection: one
-- transaction wrote the DeliveryAssignment row AND incremented that rider's
-- DispatchRiderRecord.activeLoad. The invariant its four review rounds
-- converged on is:
--
--     For each (order, courier) claim, exactly ONE decrement of activeLoad
--     ever lands - across the partner, dispatcher, cancel and reassignment
--     paths, under any interleaving.
--
-- enforced by DeliveryAssignment.loadReleasedAt as the single claim marker,
-- plus ebuy_claim_dispatch_assignment / ebuy_release_dispatch_assignment_load
-- / ebuy_reassign_dispatch_assignment_courier.
--
-- Offers move where the claim happens, and there were only two options:
--
--   (a) keep claiming on selection, and RELEASE on decline / expiry; or
--   (b) make selection create a pending offer that touches no ledger state at
--       all, and claim on ACCEPT.
--
-- (a) re-introduces exactly the bug class Task 9 spent four rounds on. Every
-- existing decrement is keyed on a TERMINAL order transition
-- (delivered / rejected / failed_delivery / cancelled) - the release marker
-- loadReleasedAt literally means "this claim was permanently returned because
-- the order ended". A declined or expired offer is not a terminal transition:
-- the order stays live and is about to be offered to somebody else. So (a)
-- would need a second, non-terminal kind of decrement that clears
-- loadReleasedAt again so the NEXT courier's claim can still be released -
-- which is precisely the "resurrect an already-released claim" shape round 4
-- had to close, generalised and made routine. It also multiplies the
-- interleavings: a cron-driven expiry sweep racing an accept, a decline racing
-- a cancel, a re-offer racing a manual reassignment, each with a +1/-1 pair in
-- flight.
--
-- (b) leaves the Task 9 ledger machinery COMPLETELY UNTOUCHED. There is no new
-- increment primitive and no new decrement primitive in this migration: accept
-- calls ebuy_claim_dispatch_assignment, unmodified, and every release still
-- goes through ebuy_release_dispatch_assignment_load, unmodified. Four of the
-- seven offer outcomes (decline, expire, supersede, exhaustion) never touch
-- activeLoad at all, so they cannot violate an invariant about activeLoad.
-- The two that can - accept, and accept-of-a-terminal-order - are exactly the
-- claim path Task 9 already proved, reached through one extra guard.
--
-- (b) it is. Selection creates a `pending` DeliveryOffer and nothing else.
--
-- WHAT THIS FILE ADDS
-- -------------------
--   1. The DeliveryOffer table, RLS on with NO policies (service-role only),
--      plus the three uniqueness constraints that make the state machine's
--      key properties structural rather than advisory.
--   2. ebuy_offer_dispatch_assignment  - create a pending offer, guarded.
--   3. ebuy_accept_dispatch_offer      - the ONLY winner, compare-and-swap.
--   4. ebuy_decline_dispatch_offer     - mark declined, no ledger effect.
--   5. ebuy_expire_dispatch_offers     - the idempotent sweep.
--   6. ebuy_list_dispatch_reoffer_candidates - what the sweep re-offers.
--
-- Additive and idempotent throughout: create table if not exists, create
-- index if not exists, constraint adds guarded on pg_constraint,
-- create or replace function. Re-applying it is a no-op.

-- ---------------------------------------------------------------------------
-- 0. Prerequisite, degraded rather than fatal.
-- ---------------------------------------------------------------------------

-- gen_random_uuid() is core from PG13 on (Supabase is well past that), so this
-- is belt-and-braces for an older local Postgres. Wrapped in the same
-- exception-guarded DO block style as 20260624_queue_drainer_schedule.sql's
-- extension block: a project where the extension cannot be created should skip
-- it with a notice, not fail the whole push. If gen_random_uuid() genuinely is
-- not available the CREATE FUNCTION below still succeeds (plpgsql bodies are
-- not resolved at definition time) and only an actual offer attempt fails,
-- which is the correct blast radius.
do $ext$
begin
  create extension if not exists pgcrypto;
exception
  when others then
    raise notice 'delivery-offers: pgcrypto unavailable (%), relying on the built-in gen_random_uuid()', sqlerrm;
end
$ext$;

-- ---------------------------------------------------------------------------
-- 1. The table.
-- ---------------------------------------------------------------------------

-- Exactly the columns the brief specifies, and no more. `offeredAt` is the
-- row's creation time (no separate createdAt), `respondedAt` is null until the
-- offer leaves `pending` by any route - accepted, declined, expired or
-- superseded - so "is this offer still live" is `status = 'pending'` and
-- nothing else has to be consulted.
--
-- No foreign keys, matching the surrounding schema: CustomerOrder /
-- DeliveryAssignment / DispatchRiderRecord ids are plain text throughout this
-- database and DeliveryAssignment carries no FK to CustomerOrder either.
create table if not exists public."DeliveryOffer" (
  "id" text primary key,
  "orderId" text not null,
  "courierId" text not null,
  "status" text not null default 'pending',
  "offeredAt" timestamptz not null default now(),
  "respondsBy" timestamptz not null,
  "respondedAt" timestamptz,
  "sequence" integer not null default 1
);

do $status_check$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'DeliveryOffer_status_check'
  ) then
    alter table public."DeliveryOffer"
      add constraint "DeliveryOffer_status_check"
      check ("status" in ('pending', 'accepted', 'declined', 'expired', 'superseded'));
  end if;
end
$status_check$;

-- At most one LIVE offer per order, enforced by the database rather than by
-- the caller. Two riders holding pending offers for the same order is the
-- state in which "only one offer per order can win" becomes a race worth
-- worrying about; this partial index makes that state unreachable in the first
-- place. It is not the only guard - ebuy_accept_dispatch_offer's claim
-- compare-and-swap independently refuses a second winner even if two pending
-- rows somehow coexist (which is what the double-accept test drives) - but
-- defence-in-depth here costs one index.
create unique index if not exists "DeliveryOffer_pending_order_idx"
  on public."DeliveryOffer" ("orderId")
  where "status" = 'pending';

-- THE EXCLUSION MECHANISM, structurally. "Re-offer to the next-best courier,
-- excluding everyone who has already seen this order" is implemented in the
-- edge function by filtering the candidate pool against the courier ids that
-- already have an offer row for the order - but a filter computed from a read
-- is a stale read, and two concurrent re-offers could both pick the same
-- next-best rider. This index is what makes the exclusion actually hold: the
-- second insert raises unique_violation, which
-- ebuy_offer_dispatch_assignment turns into `already_offered` rather than an
-- error. One offer per (order, courier), for the life of the order.
create unique index if not exists "DeliveryOffer_order_courier_idx"
  on public."DeliveryOffer" ("orderId", "courierId");

-- Sequence is 1-based and dense per order (it is assigned as
-- count(existing offers) + 1 under the order row lock), so it doubles as the
-- exhaustion counter. Unique so a lost lock could never silently produce two
-- "offer #2"s.
create unique index if not exists "DeliveryOffer_order_sequence_idx"
  on public."DeliveryOffer" ("orderId", "sequence");

-- Drives the expiry sweep's `status = 'pending' and respondsBy <= now()` scan.
create index if not exists "DeliveryOffer_pending_expiry_idx"
  on public."DeliveryOffer" ("status", "respondsBy");

-- A rider's own offer inbox (dispatchGetDeliveryQueue's `offers` array).
create index if not exists "DeliveryOffer_courier_status_idx"
  on public."DeliveryOffer" ("courierId", "status");

-- RLS on, NO policies: service-role only, the same posture as
-- PlatformSettings (20260717_platform_settings_pricing.sql). Nothing in any
-- client app reads or writes this table through the Data API - offers reach
-- the dispatch app only through the feasty-dispatch Edge Function, which uses
-- the service role - so a policy here would only widen the surface. Documented
-- in docs/rls-posture.md.
alter table public."DeliveryOffer" enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Creating an offer.
-- ---------------------------------------------------------------------------

-- Returns `offered = false` with a machine-readable reason rather than raising:
-- every refusal here is an ordinary outcome of a concurrent world (the order
-- ended, someone already accepted, another offer is still outstanding, we ran
-- out of riders to ask), and automatic selection runs on a best-effort path
-- that must never unwind the status transition that triggered it.
--
-- ebuy_lock_order_status is taken FIRST, for two reasons. It is the same
-- committed-status compare-and-swap ebuy_claim_dispatch_assignment and
-- ebuy_reassign_dispatch_assignment_courier use, so an offer can never be
-- created against an order that has gone terminal since the edge function
-- read it (the exact window review round 4 closed on the claim side - selection
-- runs AFTER partnerUpdateOrderStatus has committed, and scores a pool over
-- several round trips before getting here). And because it locks the
-- CustomerOrder row, everything below it is serialised per order: the
-- offer-count read, the exhaustion check and the insert cannot interleave with
-- another offer attempt for the same order.
--
-- Lock order is CustomerOrder -> DeliveryOffer here and in
-- ebuy_accept_dispatch_offer; ebuy_decline_dispatch_offer and
-- ebuy_expire_dispatch_offers take DeliveryOffer locks only and never reach
-- for the order row. No cycle, so no deadlock between the four.
create or replace function public.ebuy_offer_dispatch_assignment(
  p_order_id text,
  p_courier_id text,
  p_ttl_seconds integer,
  p_max_offers integer
)
returns table ("offered" boolean, "offerId" text, "sequence" integer, "reason" text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_status text;
  v_courier text;
  v_total integer;
  v_pending integer;
  v_sequence integer;
  v_offer_id text;
begin
  if p_courier_id is null or btrim(p_courier_id) = '' then
    return query select false, null::text, null::integer, 'courier_missing'::text;
    return;
  end if;

  v_status := public.ebuy_lock_order_status(p_order_id);

  if v_status is null then
    return query select false, null::text, null::integer, 'order_missing'::text;
    return;
  end if;

  -- Identical to the claim's and the reassignment's allowed set, deliberately:
  -- the whole point of the lock is that the write-time condition matches the
  -- pre-flight one, and any gap between them is where Task 9's bugs lived.
  if v_status not in ('accepted', 'preparing', 'ready_for_pickup') then
    return query select false, null::text, null::integer, 'order_not_offerable'::text;
    return;
  end if;

  -- Somebody already holds this order - an earlier offer that was accepted, or
  -- a dispatcher's manual override. Offering again would be asking a second
  -- rider to accept work that is already claimed.
  select "courierId" into v_courier
  from public."DeliveryAssignment"
  where "orderId" = p_order_id;

  if v_courier is not null and btrim(v_courier) <> '' then
    return query select false, null::text, null::integer, 'already_assigned'::text;
    return;
  end if;

  -- Lazy expiry, under the order lock. The cron sweep is the durable path, but
  -- an offer whose deadline passed 3 seconds ago must not block the next one
  -- for the rest of the minute. Idempotent by construction: the predicate is
  -- `status = 'pending'`, so a row this already flipped matches nothing on any
  -- later pass, here or in the sweep.
  update public."DeliveryOffer"
  set "status" = 'expired',
      "respondedAt" = v_now
  where "orderId" = p_order_id
    and "status" = 'pending'
    and "respondsBy" <= v_now;

  select count(*), count(*) filter (where "status" = 'pending')
    into v_total, v_pending
  from public."DeliveryOffer"
  where "orderId" = p_order_id;

  -- A live offer is outstanding: the rider it went to still has time on the
  -- clock. Not an error - this is what a retry (automatic selection runs again
  -- on every accepted/preparing/ready transition) is supposed to hit.
  if v_pending > 0 then
    return query select false, null::text, null::integer, 'offer_outstanding'::text;
    return;
  end if;

  -- Exhaustion. p_max_offers offers have been made and none of them stuck, so
  -- this order stops being offered and falls back to the manual queue. The
  -- caller records the event and pages an admin ONCE per order; returning a
  -- distinct reason (rather than treating it as a generic refusal) is what
  -- lets it tell "stop trying" from "try again next transition".
  if v_total >= p_max_offers then
    return query select false, null::text, null::integer, 'exhausted'::text;
    return;
  end if;

  if exists (
    select 1 from public."DeliveryOffer"
    where "orderId" = p_order_id and "courierId" = p_courier_id
  ) then
    return query select false, null::text, null::integer, 'already_offered'::text;
    return;
  end if;

  v_sequence := v_total + 1;
  v_offer_id := gen_random_uuid()::text;

  insert into public."DeliveryOffer"
    ("id", "orderId", "courierId", "status", "offeredAt", "respondsBy", "respondedAt", "sequence")
  values (
    v_offer_id,
    p_order_id,
    p_courier_id,
    'pending',
    v_now,
    v_now + make_interval(secs => greatest(1, coalesce(p_ttl_seconds, 45))),
    null,
    v_sequence
  );

  return query select true, v_offer_id, v_sequence, 'offered'::text;
exception
  -- Belt and braces against both unique indexes. The order lock above makes
  -- either violation unreachable for two callers racing on the SAME order, but
  -- an index is a fact about the data and the checks above are a fact about
  -- one transaction's reads; if they ever disagree the index wins and the
  -- caller gets a refusal, not a 500 propagating up through a best-effort
  -- selection path.
  when unique_violation then
    return query select
      false,
      null::text,
      null::integer,
      case
        when exists (
          select 1 from public."DeliveryOffer"
          where "orderId" = p_order_id and "courierId" = p_courier_id
        ) then 'already_offered'
        else 'offer_outstanding'
      end::text;
end;
$$;

grant execute on function public.ebuy_offer_dispatch_assignment(text, text, integer, integer) to service_role;
revoke execute on function public.ebuy_offer_dispatch_assignment(text, text, integer, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Accepting - the only place an offer can win, and the only place this
--    whole task touches activeLoad.
-- ---------------------------------------------------------------------------

-- "Only one offer per order can ever win" is enforced HERE, in SQL, not in the
-- caller. Three layers, each of which alone would be sufficient for one shape
-- of race and none of which is sufficient for all three:
--
--   1. `for update` on the offer row, plus `status = 'pending'`. Two calls for
--      the SAME offer (a double-tapped Accept button, a retried request)
--      serialise on the row lock; the second re-reads `status = 'accepted'`
--      and refuses. Also covers accepting an offer that was superseded or
--      expired while the screen sat open.
--   2. ebuy_claim_dispatch_assignment's own `courierId is null` guard. Two
--      calls for DIFFERENT offers on the same order (only reachable if the
--      pending-per-order index were dropped, but the guard must not depend on
--      an index) both reach the claim; exactly one UPDATE affects a row, so
--      exactly one +1 lands. The loser's offer is marked `superseded` - NOT
--      `accepted` - and it never incremented anything, so there is nothing to
--      release.
--   3. ebuy_claim_dispatch_assignment's committed-status guard
--      (via ebuy_lock_order_status). A rider accepting an offer for an order
--      that went terminal while the offer was outstanding gets claimed = false
--      and a clean refusal. This is the case that would have been a permanent
--      leak under design (a): a +1 landing on an order that will never
--      transition again, so nothing ever releases it.
--
-- The claim is called, not reimplemented. That is the point: the single
-- increment in this system stays in one function, with one guard, proved once.
--
-- The order row is locked BEFORE the offer row (via the claim's own
-- ebuy_lock_order_status, hoisted up here explicitly) so the lock order matches
-- ebuy_offer_dispatch_assignment's. The unlocked read that finds the order id
-- is safe to do first because DeliveryOffer."orderId" is immutable once the row
-- exists.
create or replace function public.ebuy_accept_dispatch_offer(
  p_offer_id text,
  p_courier_id text,
  p_courier_name text
)
returns table ("accepted" boolean, "orderId" text, "reason" text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_order_id text;
  v_status text;
  v_responds_by timestamptz;
  v_claimed boolean;
begin
  -- Scoped to the calling courier: a rider can never act on another rider's
  -- offer, and "not yours" is indistinguishable from "does not exist" so the
  -- handler cannot be used to probe for other riders' offer ids.
  select "orderId" into v_order_id
  from public."DeliveryOffer"
  where "id" = p_offer_id and "courierId" = p_courier_id;

  if not found then
    return query select false, null::text, 'offer_not_found'::text;
    return;
  end if;

  perform public.ebuy_lock_order_status(v_order_id);

  select "status", "respondsBy" into v_status, v_responds_by
  from public."DeliveryOffer"
  where "id" = p_offer_id and "courierId" = p_courier_id
  for update;

  if not found then
    return query select false, v_order_id, 'offer_not_found'::text;
    return;
  end if;

  if v_status <> 'pending' then
    return query select false, v_order_id, ('offer_' || v_status)::text;
    return;
  end if;

  -- Deadline passed but the sweep has not run yet. Flip it here rather than
  -- accepting: the rider whose 45 seconds elapsed has no more claim on this
  -- order than one whose offer the sweep already expired, and letting the
  -- sweep's timing decide which of them wins would make the outcome depend on
  -- cron latency.
  if v_responds_by <= v_now then
    update public."DeliveryOffer"
    set "status" = 'expired',
        "respondedAt" = v_now
    where "id" = p_offer_id;

    return query select false, v_order_id, 'offer_expired'::text;
    return;
  end if;

  select "claimed" into v_claimed
  from public.ebuy_claim_dispatch_assignment(v_order_id, p_courier_id, p_courier_name, p_courier_id);

  if not coalesce(v_claimed, false) then
    -- The order went terminal, or another courier / a manual override already
    -- holds it. Nothing was incremented (the claim only increments when its
    -- own UPDATE affects a row), so there is nothing to release and no
    -- (order, courier) claim was ever created for this rider.
    update public."DeliveryOffer"
    set "status" = 'superseded',
        "respondedAt" = v_now
    where "id" = p_offer_id;

    return query select false, v_order_id, 'claim_refused'::text;
    return;
  end if;

  update public."DeliveryOffer"
  set "status" = 'accepted',
      "respondedAt" = v_now
  where "id" = p_offer_id;

  -- Any other still-pending offer for this order loses. Unreachable while the
  -- pending-per-order index stands (there can be at most one), kept because
  -- the winner-uniqueness guarantee must not be an index's side effect. Runs
  -- AFTER the winner leaves 'pending' so it cannot collide with that index.
  update public."DeliveryOffer"
  set "status" = 'superseded',
      "respondedAt" = v_now
  where "orderId" = v_order_id
    and "id" <> p_offer_id
    and "status" = 'pending';

  return query select true, v_order_id, 'accepted'::text;
end;
$$;

grant execute on function public.ebuy_accept_dispatch_offer(text, text, text) to service_role;
revoke execute on function public.ebuy_accept_dispatch_offer(text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Declining - a pure state change, zero ledger effect.
-- ---------------------------------------------------------------------------

-- Takes the DeliveryOffer row lock and nothing else: it never needs the order's
-- status, because declining is legal from any order state (an order that ended
-- while the offer sat open should still let the rider clear it off their
-- screen) and because it changes no shared counter. Not reaching for the
-- CustomerOrder lock is also what keeps the four functions' lock order acyclic.
create or replace function public.ebuy_decline_dispatch_offer(
  p_offer_id text,
  p_courier_id text
)
returns table ("declined" boolean, "orderId" text, "reason" text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_order_id text;
  v_status text;
begin
  select "orderId", "status" into v_order_id, v_status
  from public."DeliveryOffer"
  where "id" = p_offer_id and "courierId" = p_courier_id
  for update;

  if not found then
    return query select false, null::text, 'offer_not_found'::text;
    return;
  end if;

  -- Includes the already-declined case: a retried decline is a clean refusal,
  -- not a second state change and not an error.
  if v_status <> 'pending' then
    return query select false, v_order_id, ('offer_' || v_status)::text;
    return;
  end if;

  update public."DeliveryOffer"
  set "status" = 'declined',
      "respondedAt" = v_now
  where "id" = p_offer_id;

  return query select true, v_order_id, 'declined'::text;
end;
$$;

grant execute on function public.ebuy_decline_dispatch_offer(text, text) to service_role;
revoke execute on function public.ebuy_decline_dispatch_offer(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The expiry sweep, run by queue-drainer on its existing every-minute
--    pg_cron schedule (20260624_queue_drainer_schedule.sql - no new cron
--    entry is needed, that job already posts {"queue":"all"}).
-- ---------------------------------------------------------------------------

-- IDEMPOTENT ON EVERY AXIS:
--   * the predicate is `status = 'pending'`, so a row already expired by a
--     previous sweep - or by ebuy_offer_dispatch_assignment's /
--     ebuy_accept_dispatch_offer's lazy expiry - matches nothing;
--   * `for update skip locked` means two concurrent drainer invocations take
--     disjoint batches instead of blocking on each other;
--   * the outer UPDATE re-checks `status = 'pending'` after acquiring the row,
--     so even a row that changed between the sub-select and the update is not
--     double-flipped;
--   * it returns only the rows it actually changed, so a caller counting
--     expiries counts each one once.
-- Re-running it a thousand times over the same data expires each offer exactly
-- once.
create or replace function public.ebuy_expire_dispatch_offers(p_limit integer)
returns table ("offerId" text, "orderId" text, "courierId" text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with due as (
    select "id"
    from public."DeliveryOffer"
    where "status" = 'pending'
      and "respondsBy" <= now()
    order by "respondsBy"
    limit greatest(1, coalesce(p_limit, 50))
    for update skip locked
  )
  update public."DeliveryOffer" o
  set "status" = 'expired',
      "respondedAt" = now()
  from due
  where o."id" = due."id"
    and o."status" = 'pending'
  returning o."id", o."orderId", o."courierId";
end;
$$;

grant execute on function public.ebuy_expire_dispatch_offers(integer) to service_role;
revoke execute on function public.ebuy_expire_dispatch_offers(integer) from public, anon, authenticated;

-- What the sweep re-offers, decoupled from what it just expired.
--
-- The obvious design - "re-offer each order whose offer I just expired" -
-- loses work: if the drainer dies (or its 5s pg_net timeout fires) between the
-- expiry UPDATE committing and the re-offer being issued, that order has no
-- pending offer and nothing will ever create one again, because the next
-- sweep's expiry pass finds nothing due. Driving the re-offer off the ORDER's
-- state instead of off the sweep's own return value makes the two passes
-- independent and the whole sweep crash-safe: the straggler is simply picked
-- up on the next minute's run.
--
-- Deliberately a hint, not an authority. The definitive gate is
-- ebuy_offer_dispatch_assignment's own locked status check; a row that slips
-- through here (the status changed a millisecond later, 'ready' vs
-- 'ready_for_pickup' aliasing) costs one refused call and nothing else. That is
-- why the status filter can afford to be inclusive rather than exact.
create or replace function public.ebuy_list_dispatch_reoffer_candidates(
  p_limit integer,
  p_max_offers integer
)
returns table ("orderId" text)
language sql
security definer
set search_path = public
as $$
  select o."orderId"
  from public."DeliveryOffer" o
  join public."CustomerOrder" c on c."id" = o."orderId"
  left join public."DeliveryAssignment" a on a."orderId" = o."orderId"
  where btrim(coalesce(c."status", '')) in ('accepted', 'preparing', 'ready', 'ready_for_pickup')
    and (a."courierId" is null or btrim(a."courierId") = '')
  group by o."orderId"
  having count(*) filter (where o."status" = 'pending') = 0
     and count(*) < greatest(1, coalesce(p_max_offers, 3))
  order by min(o."offeredAt")
  limit greatest(1, coalesce(p_limit, 50));
$$;

grant execute on function public.ebuy_list_dispatch_reoffer_candidates(integer, integer) to service_role;
revoke execute on function public.ebuy_list_dispatch_reoffer_candidates(integer, integer) from public, anon, authenticated;
