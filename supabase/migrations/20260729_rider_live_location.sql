-- Live rider position for dispatch.
--
-- UNLOGGED on purpose: these rows are rewritten every few seconds per rider and
-- are worthless once superseded, so paying WAL + vacuum cost for them is waste.
-- Previously every ping UPDATEd DispatchRiderRecord, which generated WAL and
-- left a dead tuple on a table also read for fleet listings — paid for twice.
--
-- The table is truncated on crash recovery. That is correct: it repopulates
-- from the next ping within ~5s, and DispatchRiderRecord still holds a durable
-- copy refreshed at most once a minute (see 20260729_rider_durable_location_sync).
--
-- NOTE: UNLOGGED tables emit no WAL, so Supabase Realtime `postgres_changes`
-- can never observe this table. Do not add it to a publication. This project
-- broadcasts explicitly via _shared/realtime.ts, so nothing depends on that.

-- rider_id is text, not uuid: DispatchRiderRecord.id is a text column
-- (Prisma `id String @id`), and this key mirrors it.
create unlogged table if not exists public.rider_live_location (
  rider_id   text primary key,
  latitude   double precision not null,
  longitude  double precision not null,
  accuracy   double precision,
  updated_at timestamptz not null default now()
);

-- RLS on with zero policies: only the service role (which bypasses RLS) touches
-- this table, so anon/authenticated access is denied by default.
alter table public.rider_live_location enable row level security;

do $ext$
begin
  create extension if not exists cube with schema extensions;
  create extension if not exists earthdistance with schema extensions;
exception
  when others then
    raise notice 'rider_live_location: geo extension unavailable (%), skipping index', sqlerrm;
end
$ext$;

-- GiST index backing the earth_box() containment filter in ebuy_nearest_riders.
-- ll_to_earth is IMMUTABLE, so it is indexable.
do $idx$
begin
  create index if not exists rider_live_location_geo_idx
    on public.rider_live_location
    using gist (extensions.ll_to_earth(latitude, longitude));
exception
  when others then
    raise notice 'rider_live_location: could not create geo index (%), skipping', sqlerrm;
end
$idx$;

create index if not exists rider_live_location_updated_at_idx
  on public.rider_live_location (updated_at desc);
