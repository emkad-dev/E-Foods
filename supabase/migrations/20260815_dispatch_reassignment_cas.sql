-- Task 9 (D1) review fix round 4: reassignment is a compare-and-swap, and a
-- release is keyed on the assignment row, not on the caller's snapshot.
--
-- Round 3 classified dispatchAssignOrderCourier's two bare
-- adjustDispatchRiderLoad calls (-1 previous courier, +1 new courier) as
-- safe because assertNonTerminalOrder gates the handler. That reasoning was
-- wrong: assertNonTerminalOrder checks an order bundle read once at the top
-- of the handler - a stale snapshot - and none of the writes underneath it
-- (the DeliveryAssignment upsert, updateOrderRecord) were conditioned on the
-- order's currently-committed state. A reassignment A->B racing a terminal
-- transition (customer cancel, partner reject/delivered, dispatcher
-- delivered/failed_delivery - all reachable in the ACCEPTED/PREPARING/
-- READY_FOR_PICKUP window reassignment permits) leaked B's load permanently,
-- in BOTH orderings:
--
--   * terminal first: release(A) succeeded and set loadReleasedAt, then the
--     reassignment's unconditional upsert set courierId=B and cleared
--     loadReleasedAt back to null (making a terminal order look live),
--     decremented A a second time (silently absorbed by the greatest(0,...)
--     clamp) and incremented B. Nothing ever releases B - the order is
--     already terminal, so no further transition runs.
--   * reassignment first: courierId became B, then the terminal transition's
--     release fired with its own stale courier id A, so its
--     `where "courierId" = p_courier_id` matched zero rows and decremented
--     nothing. B is up by one forever, same as above.
--
-- Unrecoverable rather than merely racy, which is what makes it worse than
-- the over/under-counts of rounds 1-3.
--
-- Three changes here, each closing one half of that shape:
--
--   1. ebuy_lock_order_status - a locked, normalized read of an order's
--      status, so a write can be conditioned on the order's committed state
--      instead of on what the edge function read some awaits ago.
--   2. ebuy_reassign_dispatch_assignment_courier - the whole reassignment
--      (status check, row update, decrement of A, increment of B) as ONE
--      function call, i.e. one transaction, guarded in the WHERE rather than
--      in the caller. The same shape ebuy_claim_dispatch_assignment and
--      ebuy_release_dispatch_assignment_load already use.
--   3. ebuy_release_dispatch_assignment_load now decrements whoever the
--      assignment row currently names, instead of whoever the caller thought
--      it named. The row is the authority on who holds the claim; a caller's
--      courier id is by construction a stale read.
--
-- ebuy_claim_dispatch_assignment gets the same status guard as (2), for the
-- same reason: automatic assignment runs after partnerUpdateOrderStatus has
-- already committed its transition, so a cancel/reject committing in between
-- would otherwise let the claim land a +1 on an order that can never release
-- it.

-- ---------------------------------------------------------------------------
-- 1. The lock.
-- ---------------------------------------------------------------------------

-- Mirrors normalizeOrderStatus (_shared/orders.ts) exactly: sanitizeText's
-- trim with a 'draft' fallback, then the two historical aliases
-- ('pending'/'confirmed' -> 'placed', 'ready' -> 'ready_for_pickup').
-- Deliberately does NOT lowercase, because normalizeOrderStatus does not
-- either - the two must classify a row identically or the SQL guard and the
-- TypeScript guard disagree about what "terminal" means.
--
-- `for update` is the entire point: it takes the same row lock a concurrent
-- terminal transition's `update "CustomerOrder"` takes, so a caller either
-- observes that transition's committed status (READ COMMITTED re-reads the
-- row after the lock is granted) or holds the row until its own writes
-- commit. Returns null when the order does not exist.
create or replace function public.ebuy_lock_order_status(p_order_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  select btrim(coalesce("status", '')) into v_status
  from public."CustomerOrder"
  where "id" = p_order_id
  for update;

  if not found then
    return null;
  end if;

  if v_status = '' then
    return 'draft';
  elsif v_status in ('pending', 'confirmed') then
    return 'placed';
  elsif v_status = 'ready' then
    return 'ready_for_pickup';
  end if;

  return v_status;
end;
$$;

grant execute on function public.ebuy_lock_order_status(text) to service_role;
revoke execute on function public.ebuy_lock_order_status(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Reassignment as a compare-and-swap.
-- ---------------------------------------------------------------------------

-- Returns reassigned=false (never an exception) when the order has moved out
-- of the window a manual assignment is allowed in, or when the assignment's
-- capacity claim has already been released. The caller turns that into the
-- same 412 the pre-flight snapshot check produces, so a precondition that
-- fails late is indistinguishable to the client from one that fails early.
--
-- The allowed set mirrors dispatchAssignOrderCourier's own gate
-- (ACCEPTED/PREPARING/READY_FOR_PICKUP) rather than merely "not terminal":
-- the guard exists to make the write-time condition identical to the
-- pre-flight one, and any gap between them is exactly where this bug lived.
--
-- Both load adjustments are inside this function on purpose. They are not
-- separable from the row update: a partial failure between "the row now says
-- B" and "A was decremented, B incremented" leaves the ledger permanently
-- wrong with nothing to reconcile it, and the decrement of A would no longer
-- be covered by the same compare-and-swap that authorises the row change.
create or replace function public.ebuy_reassign_dispatch_assignment_courier(
  p_order_id text,
  p_courier_id text,
  p_courier_name text,
  p_dispatch_id text
)
returns table ("reassigned" boolean, "previousCourierId" text, "orderStatus" text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_status text;
  v_previous text;
  v_released timestamptz;
  v_inserted boolean := false;
begin
  v_status := public.ebuy_lock_order_status(p_order_id);

  if v_status is null then
    return query select false, null::text, null::text;
    return;
  end if;

  if v_status not in ('accepted', 'preparing', 'ready_for_pickup') then
    return query select false, null::text, v_status;
    return;
  end if;

  -- Standard upsert loop: lock the existing row, or insert one and retry the
  -- lock if a concurrent insert beat us. Locking the row (rather than a bare
  -- update) is what serialises two simultaneous reassignments of the same
  -- order: the second one re-reads the committed courier the first one
  -- wrote, so it decrements THAT courier rather than both of them
  -- decrementing the original.
  loop
    select "courierId", "loadReleasedAt"
      into v_previous, v_released
    from public."DeliveryAssignment"
    where "orderId" = p_order_id
    for update;

    exit when found;

    begin
      insert into public."DeliveryAssignment"
        ("orderId", "courierId", "courierName", "dispatchId", "dispatchOwnerId",
         "assignedAt", "createdAt", "updatedAt", "loadReleasedAt")
      values (p_order_id, p_courier_id, p_courier_name, p_dispatch_id, p_courier_id,
              v_now, v_now, v_now, null);
      v_previous := null;
      v_released := null;
      v_inserted := true;
      exit;
    exception when unique_violation then
      -- Concurrent insert between our select and our insert: go round again
      -- and take the lock on the row that now exists.
    end;
  end loop;

  if not v_inserted then
    -- An already-released claim must never be resurrected. loadReleasedAt is
    -- only ever set by a terminal transition's release, so seeing it here
    -- means that release committed after this call's status read - the
    -- narrow window the status lock above cannot cover, because the
    -- release is a separate transaction from the status write that precedes
    -- it. Clearing it (which the old upsert did unconditionally) is what
    -- made a terminal order look live again and stranded the incoming
    -- courier's +1 forever.
    if v_released is not null then
      return query select false, v_previous, v_status;
      return;
    end if;

    update public."DeliveryAssignment"
    set "courierId" = p_courier_id,
        "courierName" = p_courier_name,
        "dispatchId" = p_dispatch_id,
        "dispatchOwnerId" = p_courier_id,
        "assignedAt" = v_now,
        "updatedAt" = v_now,
        "loadReleasedAt" = null
    where "orderId" = p_order_id;
  end if;

  -- Assigning the courier who already holds the order is a no-op for the
  -- ledger (their claim never lapsed), so neither adjustment runs.
  if v_previous is distinct from p_courier_id then
    if v_previous is not null and btrim(v_previous) <> '' then
      perform public.ebuy_adjust_dispatch_rider_load(v_previous, -1);
    end if;
    perform public.ebuy_adjust_dispatch_rider_load(p_courier_id, 1);
  end if;

  return query select true, v_previous, v_status;
end;
$$;

grant execute on function public.ebuy_reassign_dispatch_assignment_courier(text, text, text, text) to service_role;
revoke execute on function public.ebuy_reassign_dispatch_assignment_courier(text, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Release the courier the ROW names.
-- ---------------------------------------------------------------------------

-- The two-argument form is replaced rather than kept: its p_courier_id was
-- always a value the edge function read before its own status write, so
-- matching on it meant a release could silently no-op against a row that had
-- legitimately moved to a different courier in between (round 4's second
-- ordering). Keeping a compatibility wrapper would keep exactly the argument
-- that made the bug possible available to the next caller.
--
-- Migration and edge-function deploy must ship together: between applying
-- this and deploying the functions, a still-running old build would call the
-- dropped two-argument form and its release would fail (non-fatally - it is
-- wrapped in try/catch at every call site - but the load would not be
-- released). The whole Task 9 stack is unmerged and undeployed, so there is
-- no live two-argument caller today.
drop function if exists public.ebuy_release_dispatch_assignment_load(text, text);

create or replace function public.ebuy_release_dispatch_assignment_load(
  p_order_id text
)
returns table ("released" boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_courier text;
begin
  update public."DeliveryAssignment"
  set "loadReleasedAt" = now()
  where "orderId" = p_order_id
    and "courierId" is not null
    and btrim("courierId") <> ''
    and "loadReleasedAt" is null
  returning "courierId" into v_courier;

  if not found then
    return query select false;
    return;
  end if;

  perform public.ebuy_adjust_dispatch_rider_load(v_courier, -1);

  return query select true;
end;
$$;

grant execute on function public.ebuy_release_dispatch_assignment_load(text) to service_role;
revoke execute on function public.ebuy_release_dispatch_assignment_load(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The claim gets the same status guard.
-- ---------------------------------------------------------------------------

-- runAutomaticDispatchAssignment is called from partnerUpdateOrderStatus
-- AFTER that handler has already committed its own status write, and it
-- scores a candidate pool (several round trips) before claiming. A customer
-- cancel or a partner reject committing during that window would otherwise
-- let the claim land a +1 on an order that is already terminal - and a
-- terminal order is never transitioned again, so nothing would ever release
-- it. Same permanent leak as the reassignment one, reached from the
-- automatic side; guarded the same way.
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
  v_status text;
  v_updated int;
begin
  v_status := public.ebuy_lock_order_status(p_order_id);

  if v_status is null or v_status not in ('accepted', 'preparing', 'ready_for_pickup') then
    return query select false;
    return;
  end if;

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
