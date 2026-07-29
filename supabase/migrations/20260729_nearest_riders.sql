-- Nearest-rider search over the unlogged live-location table.
--
-- earth_box(...) @> ll_to_earth(...) is the index-usable bounding-box filter
-- (it can use rider_live_location_geo_idx); earth_distance then computes the
-- exact great-circle distance on the small surviving set. Filtering on
-- updated_at first excludes riders who stopped pinging — the 90s window matches
-- RIDER_LIVE_TTL_MS in _shared/riderLocation.ts. Keep the two in step.
--
-- rider_id is text, mirroring DispatchRiderRecord.id.

create or replace function public.ebuy_nearest_riders(
  p_latitude double precision,
  p_longitude double precision,
  p_radius_metres double precision default 5000,
  p_limit integer default 10
)
returns table (
  rider_id text,
  latitude double precision,
  longitude double precision,
  metres double precision
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    l.rider_id,
    l.latitude,
    l.longitude,
    extensions.earth_distance(
      extensions.ll_to_earth(p_latitude, p_longitude),
      extensions.ll_to_earth(l.latitude, l.longitude)
    ) as metres
  from public.rider_live_location l
  where l.updated_at > now() - interval '90 seconds'
    and extensions.earth_box(
          extensions.ll_to_earth(p_latitude, p_longitude),
          p_radius_metres
        ) @> extensions.ll_to_earth(l.latitude, l.longitude)
  order by metres asc
  limit greatest(p_limit, 1);
$$;

revoke all on function public.ebuy_nearest_riders(double precision, double precision, double precision, integer)
  from public, anon, authenticated;
grant execute on function public.ebuy_nearest_riders(double precision, double precision, double precision, integer)
  to service_role;
