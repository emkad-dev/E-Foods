-- In-app promo notifications (Phase 1): persistence + public read of live promos.
-- Delivery is via the `promos` Realtime *broadcast* topic (emitted by app-rpc),
-- mirroring orders/support. The table exists so a client that opens the app
-- AFTER a promo was broadcast can still fetch what is currently active — the
-- broadcast itself is fire-and-forget and is not replayed.
create table if not exists public."Promo" (
  "id"           text primary key default (gen_random_uuid())::text,
  "title"        text not null,
  "body"         text not null,
  "actionUrl"    text,
  "active"       boolean not null default true,
  "startsAt"     timestamptz,
  "endsAt"       timestamptz,
  "createdByUid" text not null,
  "createdAt"    timestamptz not null default now(),
  "updatedAt"    timestamptz not null default now()
);

create index if not exists "Promo_active_idx" on public."Promo" ("active");
create index if not exists "Promo_createdAt_idx" on public."Promo" ("createdAt");

alter table public."Promo" enable row level security;

-- Promos are public marketing content. Anyone (anon or authenticated) may read
-- the ones that are live right now; the window bounds are optional. Writes have
-- no policy, so they remain service-role only via the app-rpc edge function.
drop policy if exists "Public can read live promos" on public."Promo";
create policy "Public can read live promos" on public."Promo"
  for select
  using (
    "active" = true
    and ("startsAt" is null or "startsAt" <= now())
    and ("endsAt" is null or "endsAt" >= now())
  );

-- Base table privilege for the read path (RLS above is what actually filters rows).
grant select on public."Promo" to anon, authenticated;
