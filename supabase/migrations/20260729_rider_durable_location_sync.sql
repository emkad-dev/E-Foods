-- Throttled durable copy of a rider's last known position.
--
-- Live position lives in the UNLOGGED rider_live_location table, but that table
-- is lost on crash recovery, so DispatchRiderRecord keeps a durable fallback.
-- Refreshing it on every ping would defeat the point, so the WHERE clause is
-- the throttle: a call inside the window matches no rows and writes nothing.
-- No read is needed to decide whether to write.
--
-- Returns true when a durable write actually happened, which lets callers log
-- or measure the real durable write rate.
--
-- Type notes (both verified against the live schema, do not "simplify"):
--   * DispatchRiderRecord.id is TEXT, not uuid.
--   * DispatchRiderRecord."updatedAt" is TIMESTAMP WITHOUT TIME ZONE, while
--     now() is timestamptz. Comparing them directly would coerce through the
--     session TimeZone. The app writes ISO-8601 UTC strings into that column,
--     so we pin both sides to UTC explicitly via (now() at time zone 'utc').

create or replace function public.ebuy_touch_rider_durable_location(
  p_rider_id text,
  p_latitude double precision,
  p_longitude double precision,
  p_min_interval_seconds integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamp := now() at time zone 'utc';
  v_updated integer;
begin
  update public."DispatchRiderRecord"
  set latitude = p_latitude,
      longitude = p_longitude,
      "updatedAt" = v_now
  where id = p_rider_id
    and ("updatedAt" is null
         or "updatedAt" < v_now - make_interval(secs => p_min_interval_seconds));

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.ebuy_touch_rider_durable_location(text, double precision, double precision, integer)
  from public, anon, authenticated;
grant execute on function public.ebuy_touch_rider_durable_location(text, double precision, double precision, integer)
  to service_role;
