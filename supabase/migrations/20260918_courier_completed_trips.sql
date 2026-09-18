-- Give riders a delivery count that is true.
--
-- `DispatchRiderRecord.completedTrips` is written as 0 when a rider is
-- approved, carried forward verbatim on every profile save
-- (_shared/domains/dispatch.ts keeps `existingRider?.completedTrips`), and
-- incremented NOWHERE: no handler, no trigger. A rider on their five hundredth
-- delivery had a 0 next to their name. The dispatch profile showed it in a
-- trophy pill until that pill was removed, precisely because the number was
-- not real.
--
-- Nothing new has to be built to make it real. `CourierEarning_on_delivery`
-- already fires on the transition into 'delivered', already resolves the
-- courier through DeliveryAssignment, and already holds `v_courier_id` at
-- exactly the moment a delivery completes. This adds the count to that same
-- protected block.
--
-- WHY A RECOUNT AND NOT `completedTrips + 1`.
--
-- The trigger's guard is "fire when status becomes 'delivered' and was not
-- 'delivered' before". That is once per transition, NOT once per order: an
-- order moved delivered -> cancelled -> delivered fires it twice. The earnings
-- insert survives that because it is `on conflict ("orderId") do update` --
-- idempotent by key. An increment is not. It would drift upward every time an
-- order was reopened, and drift is worse than zero because it looks credible.
--
-- Deriving the figure from the ledger is idempotent by construction. One
-- CourierEarning row per orderId, so the count cannot double no matter how
-- many times the trigger runs, and it self-heals: any backfill or correction
-- to CourierEarning corrects the rider's total on the next delivery.
-- `CourierEarning_courierId_deliveredAt_idx` leads on courierId, so the count
-- is an index scan.
--
-- The whole body stays inside the existing exception block, per this file's
-- own rule: an earnings row can be backfilled, a rider stuck unable to
-- complete a delivery cannot. A failure to count degrades to a warning.
--
-- The function is reproduced verbatim from 20260827_dispatch_courier_supply.sql
-- apart from the marked block.
create or replace function public.ebuy_record_courier_earning_on_delivery()
returns trigger
language plpgsql
as $$
declare
  v_courier_id text;
  v_amount numeric(12, 2);
  v_currency text;
  v_delivered_at timestamptz;
  v_numeric constant text := '^[[:space:]]*-?[0-9]+(\.[0-9]+)?[[:space:]]*$';
begin
  if coalesce(new."status", '') <> 'delivered' or coalesce(old."status", '') = 'delivered' then
    return new;
  end if;

  begin
    select da."courierId"
      into v_courier_id
      from public."DeliveryAssignment" da
     where da."orderId" = new."id"
     limit 1;

    if v_courier_id is null or btrim(v_courier_id) = '' then
      return new;
    end if;

    -- First value that actually looks like a number wins; otherwise 0.
    v_amount := coalesce(
      (case when (new."pricing"->>'dispatchFee') ~ v_numeric
            then (new."pricing"->>'dispatchFee')::numeric end),
      (case when (new."pricing"->>'deliveryFee') ~ v_numeric
            then (new."pricing"->>'deliveryFee')::numeric end),
      0
    );

    v_currency := coalesce(nullif(btrim(coalesce(new."pricing"->>'currency', '')), ''), 'NGN');

    -- No safe regex for a timestamp, so try the cast in its own block and fall
    -- back to the row's own timestamps.
    begin
      v_delivered_at := nullif(btrim(coalesce(new."timeline"->>'deliveredAt', '')), '')::timestamptz;
    exception
      when others then
        v_delivered_at := null;
    end;
    v_delivered_at := coalesce(v_delivered_at, new."updatedAt", new."createdAt", now());

    insert into public."CourierEarning" (
      "id",
      "courierId",
      "orderId",
      "amount",
      "currency",
      "deliveredAt",
      "restaurantId",
      "restaurantName",
      "createdAt",
      "updatedAt"
    ) values (
      'earning_' || new."id",
      v_courier_id,
      new."id",
      round(v_amount::numeric, 2),
      v_currency,
      v_delivered_at,
      new."restaurantId",
      new."restaurantName",
      coalesce(new."updatedAt", now()),
      coalesce(new."updatedAt", now())
    )
    on conflict ("orderId") do update set
      "courierId" = excluded."courierId",
      "amount" = excluded."amount",
      "currency" = excluded."currency",
      "deliveredAt" = excluded."deliveredAt",
      "restaurantId" = excluded."restaurantId",
      "restaurantName" = excluded."restaurantName",
      "updatedAt" = excluded."updatedAt";

    -- >>> ADDED. Everything above this line is unchanged. <<<
    -- Recomputed, never incremented -- see the header. Runs after the insert
    -- so this delivery is already in the count.
    update public."DispatchRiderRecord"
       set "completedTrips" = (
             select count(*)
               from public."CourierEarning" ce
              where ce."courierId" = v_courier_id
           ),
           "updatedAt" = now()
     where "id" = v_courier_id;
  exception
    when others then
      raise warning 'courier earning not recorded for order %: %', new."id", sqlerrm;
  end;

  return new;
end;
$$;

-- Backfill. Riders already have earnings rows from deliveries made while the
-- counter sat at 0, and without this they would keep reading 0 until their
-- next delivery. Touches only riders who actually have earnings; a rider with
-- none is already correct at 0 and is left alone rather than rewritten.
update public."DispatchRiderRecord" r
   set "completedTrips" = counts."total",
       "updatedAt" = now()
  from (
    select "courierId", count(*) as "total"
      from public."CourierEarning"
     group by "courierId"
  ) as counts
 where r."id" = counts."courierId"
   and coalesce(r."completedTrips", 0) is distinct from counts."total";
