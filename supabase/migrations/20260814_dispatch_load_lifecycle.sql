-- Task 9 (D1) review fix round: activeLoad lifecycle.
--
-- Review found that promoting activeLoad from a cosmetic field into the
-- scorer's dominant term (w_load 1.0 vs w_distance 0.15) exposed two real
-- gaps, both fixed here:
--
-- 1. (CRITICAL) Nothing released activeLoad on DELIVERED or REJECTED in
--    partnerUpdateOrderStatus - the platform's default self-delivery flow
--    (accept -> auto-assign -> restaurant marks delivered from the partner
--    app, never touching the dispatch app) left a rider's load climbing
--    without bound, forever. ebuy_release_dispatch_assignment_load() is the
--    fix, called from partner.ts on those two transitions.
--
-- 2. adjustDispatchRiderLoad (_shared/dispatchRiders.ts) was a read-then-
--    write. That was tolerable when every activeLoad write was
--    human-triggered (a collision needed two humans on the same rider in
--    the same second); it stopped being tolerable once one writer
--    (automatic assignment) fires on every accept/preparing/ready,
--    concurrently with dispatch activity by construction. Its four call
--    sites (dispatch.ts:652,655,760, orders.ts:1134) now go through
--    ebuy_adjust_dispatch_rider_load() - a single atomic relative UPDATE -
--    instead of a select then an update as two separate round trips.
--
-- Both new/changed functions are additive and idempotent (create or
-- replace; the new column uses add column if not exists).

-- A single atomic relative update: `greatest(0, ...)` keeps the existing
-- clamp-at-zero behaviour (a double-release or an over-eager -1 can't go
-- negative), but now the read-modify-write happens in one statement instead
-- of a select round-trip followed by a separate update, so two concurrent
-- deltas can no longer race each other into a lost update.
create or replace function public.ebuy_adjust_dispatch_rider_load(
  p_id text,
  p_delta int
)
returns void
language sql
security definer
set search_path = public
as $$
  update public."DispatchRiderRecord"
  set "activeLoad" = greatest(0, coalesce("activeLoad", 0) + p_delta),
      "updatedAt" = now()
  where "id" = p_id;
$$;

grant execute on function public.ebuy_adjust_dispatch_rider_load(text, int) to service_role;
revoke execute on function public.ebuy_adjust_dispatch_rider_load(text, int) from public, anon, authenticated;

-- ebuy_claim_dispatch_assignment (20260814_dispatch_auto_assignment.sql)
-- re-defined to route its increment through the same primitive rather than
-- its own inline UPDATE - same behaviour, one fewer place the +1 logic
-- lives.
create or replace function public.ebuy_claim_dispatch_assignment(
  p_order_id text,
  p_courier_id text,
  p_courier_name text,
  p_dispatch_owner_id text
)
returns table ("claimed" boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_updated int;
begin
  update public."DeliveryAssignment"
  set "courierId" = p_courier_id,
      "courierName" = p_courier_name,
      "dispatchOwnerId" = p_dispatch_owner_id,
      "assignedAt" = v_now,
      "updatedAt" = v_now
  where "orderId" = p_order_id
    and "courierId" is null;

  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    begin
      insert into public."DeliveryAssignment"
        ("orderId", "courierId", "courierName", "dispatchOwnerId", "assignedAt", "createdAt", "updatedAt")
      values (p_order_id, p_courier_id, p_courier_name, p_dispatch_owner_id, v_now, v_now, v_now);
      v_updated := 1;
    exception when unique_violation then
      update public."DeliveryAssignment"
      set "courierId" = p_courier_id,
          "courierName" = p_courier_name,
          "dispatchOwnerId" = p_dispatch_owner_id,
          "assignedAt" = v_now,
          "updatedAt" = v_now
      where "orderId" = p_order_id
        and "courierId" is null;
      get diagnostics v_updated = row_count;
    end;
  end if;

  if v_updated > 0 then
    perform public.ebuy_adjust_dispatch_rider_load(p_courier_id, 1);
  end if;

  return query select (v_updated > 0);
end;
$$;

grant execute on function public.ebuy_claim_dispatch_assignment(text, text, text, text) to service_role;
revoke execute on function public.ebuy_claim_dispatch_assignment(text, text, text, text) from public, anon, authenticated;

-- Marks the moment an assignment's load was released back, so the release
-- can only ever fire once per (order, courier) pair - the same
-- "claim guard" shape as ebuy_claim_dispatch_assignment's `courierId is
-- null`, just on the other end of the lifecycle. Needed because
-- partnerUpdateOrderStatus's DELIVERED/REJECTED transition has the same
-- double-fire shape the accept path does (two near-simultaneous requests
-- can both pass assertNonTerminalOrder before either write commits), and
-- without a guard both would decrement the same rider's load once each.
alter table public."DeliveryAssignment"
  add column if not exists "loadReleasedAt" timestamptz;

create or replace function public.ebuy_release_dispatch_assignment_load(
  p_order_id text,
  p_courier_id text
)
returns table ("released" boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated int;
begin
  update public."DeliveryAssignment"
  set "loadReleasedAt" = now()
  where "orderId" = p_order_id
    and "courierId" = p_courier_id
    and "loadReleasedAt" is null;

  get diagnostics v_updated = row_count;

  if v_updated > 0 then
    perform public.ebuy_adjust_dispatch_rider_load(p_courier_id, -1);
  end if;

  return query select (v_updated > 0);
end;
$$;

grant execute on function public.ebuy_release_dispatch_assignment_load(text, text) to service_role;
revoke execute on function public.ebuy_release_dispatch_assignment_load(text, text) from public, anon, authenticated;
