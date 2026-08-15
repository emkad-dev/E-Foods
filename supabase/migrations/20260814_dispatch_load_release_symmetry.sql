-- Task 9 (D1) review fix round 2: a single release claim per (order, courier).
--
-- Round 1 added releaseDispatchAssignmentLoad (guarded by
-- DeliveryAssignment.loadReleasedAt) but only wired it into the
-- partner-driven DELIVERED/REJECTED transition. The dispatcher-driven
-- DELIVERED/FAILED_DELIVERY transition (dispatchUpdateOrderStatus) kept
-- calling the plain adjustDispatchRiderLoad(-1), which does not touch
-- loadReleasedAt at all - so the two paths could not see each other's work.
-- partnerUpdateOrderStatus reads its order/assignment snapshot once at
-- request start and `updateOrderRecord` is a blind UPDATE with no
-- compare-and-swap, so a slow partner request that read READY_FOR_PICKUP
-- before a dispatcher took the same order all the way to delivered could
-- still fire its own release after the dispatcher's, landing two
-- decrements for one claimed unit (an undercount - the inverse of the
-- original leak). The application-side fix (this migration's counterpart:
-- dispatch.ts now calls releaseDispatchAssignmentLoad too, the same
-- function partner.ts calls) makes both paths share the same guard, so
-- only the one that actually flips loadReleasedAt from null gets to
-- decrement.
--
-- This migration is the other half: ebuy_claim_dispatch_assignment now
-- clears loadReleasedAt back to null whenever it (re)claims a row, so a
-- courier who is claimed after a previous release can still be released
-- themselves later. Not reachable through today's application code
-- (assertNonTerminalOrder blocks any further assignment change once an
-- order is terminal, and loadReleasedAt is only ever set on a terminal
-- transition), but the invariant - "claiming a courier for an assignment
-- always means their capacity claim is live, not pre-released" - is worth
-- holding structurally rather than relying on an application-level gate
-- that happens to make the alternative unreachable today.

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
      "updatedAt" = v_now,
      "loadReleasedAt" = null
  where "orderId" = p_order_id
    and "courierId" is null;

  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    begin
      insert into public."DeliveryAssignment"
        ("orderId", "courierId", "courierName", "dispatchOwnerId", "assignedAt", "createdAt", "updatedAt", "loadReleasedAt")
      values (p_order_id, p_courier_id, p_courier_name, p_dispatch_owner_id, v_now, v_now, v_now, null);
      v_updated := 1;
    exception when unique_violation then
      update public."DeliveryAssignment"
      set "courierId" = p_courier_id,
          "courierName" = p_courier_name,
          "dispatchOwnerId" = p_dispatch_owner_id,
          "assignedAt" = v_now,
          "updatedAt" = v_now,
          "loadReleasedAt" = null
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
