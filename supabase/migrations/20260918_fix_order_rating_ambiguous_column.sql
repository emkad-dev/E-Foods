-- ebuy_submit_order_rating raised on its very first statement, so order rating
-- has never once worked.
--
--   column reference "restaurantId" is ambiguous
--
-- The function declares `returns table (..., "restaurantId" text)`. In plpgsql
-- a RETURNS TABLE column is in scope as a variable for the whole body, so the
-- unqualified `"restaurantId"` in the opening SELECT could mean either that
-- OUT parameter or the column on CustomerOrder. Postgres refuses to guess and
-- raises before anything else runs.
--
-- Confirmed against production before writing this: the deployed definition was
-- byte-identical to 20260820_order_ratings.sql, and OrderRating held zero rows
-- with zero restaurants carrying a rating count, against three delivered
-- orders. Every submission since the feature shipped has failed.
--
-- The fix is an alias. The signature is deliberately unchanged -- the handler
-- reads `result.restaurantId` off the row -- so qualifying the read is the
-- whole change; the rest of the body is reproduced verbatim from the original
-- migration.
--
-- Only that first SELECT was ambiguous. The other statements name columns that
-- collide with nothing: `courierId` / `orderId` on DeliveryAssignment, the
-- INSERT's target list (resolved against the target table, never against
-- variables), and `ratingCount` / `ratingAverage` / `id` on the two aggregate
-- updates.
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
  -- Aliased and qualified. Unqualified, `"restaurantId"` here is ambiguous
  -- against the RETURNS TABLE column of the same name and the function raises.
  select o."customerId", o."restaurantId", btrim(coalesce(o."status", ''))
    into v_order_customer_id, v_restaurant_id, v_status
  from public."CustomerOrder" o
  where o."id" = p_order_id;

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

  select d."courierId" into v_courier_id
  from public."DeliveryAssignment" d
  where d."orderId" = p_order_id;

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
