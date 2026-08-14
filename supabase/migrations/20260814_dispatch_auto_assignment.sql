-- Task 9 (D1): automatic courier selection. Two additive, idempotent pieces:
--
-- 1. Seeds the 'dispatchWeights' row in PlatformSettings (which already
--    exists - see 20260717_platform_settings_pricing.sql - and is already
--    RLS-enabled with no policies, service-role only). No new table. The
--    edge function loader (loadDispatchWeights in _shared/platformSettings.ts)
--    falls back to identical hardcoded defaults if this row is ever missing,
--    same contract as the 'pricing' row, so seeding it is not strictly
--    required for correctness - it is seeded anyway so an admin editing
--    dispatch weights has a row to find and edit rather than having to
--    insert one blind.
--
-- 2. A single atomic claim-and-increment function. This one IS genuinely
--    needed: the automatic-assignment call site can run twice for the same
--    order (a re-delivered status webhook, a queue retry, two rapid
--    `accepted` transitions), and the two writes involved - creating the
--    DeliveryAssignment row and incrementing the winning rider's activeLoad -
--    must happen together exactly once. Doing this from the edge function as
--    separate read-then-write calls (the shape _shared/dispatchRiders.ts's
--    adjustDispatchRiderLoad already uses) is exactly the race the brief
--    flags as a hazard: two concurrent invocations can both read
--    "unclaimed"/"activeLoad=N" and both write, double-assigning or
--    double-incrementing. A single SQL function call executes as one
--    statement from the caller's perspective, so Postgres's own row locking
--    makes the claim-then-increment atomic without any application-level
--    locking.

insert into public."PlatformSettings" ("id", "data")
values ('dispatchWeights', '{"load": 1.0, "distance": 0.15}'::jsonb)
on conflict ("id") do nothing;

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
  -- First try to claim an existing-but-unassigned row (the common case: a
  -- manual assignment or a prior automatic attempt already created the row
  -- via DispatchAssignOrderCourier / this same function, but no courier is
  -- attached yet). `courierId is null` is the guard: a concurrent caller
  -- racing this one will see the row locked until this transaction commits,
  -- then re-evaluate the WHERE clause against the now-committed row and find
  -- courierId already set, updating zero rows.
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
    -- No row to claim - this may be the very first assignment for this
    -- order (no DeliveryAssignment row exists yet), or a concurrent caller
    -- already claimed it. Try to insert; a unique-violation on the orderId
    -- primary key means the latter, so fall back to one more conditional
    -- update against whatever the racer just committed.
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

  -- Only the caller that actually won the claim bumps the rider's load, so a
  -- retry that loses the claim (v_updated = 0) never double-increments.
  if v_updated > 0 then
    update public."DispatchRiderRecord"
    set "activeLoad" = coalesce("activeLoad", 0) + 1,
        "updatedAt" = v_now
    where "id" = p_courier_id;
  end if;

  return query select (v_updated > 0);
end;
$$;

grant execute on function public.ebuy_claim_dispatch_assignment(text, text, text, text) to service_role;
revoke execute on function public.ebuy_claim_dispatch_assignment(text, text, text, text) from public, anon, authenticated;
