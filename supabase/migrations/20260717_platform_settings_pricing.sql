-- Pricing v2 (embedded markup): server-owned pricing parameters + per-item base
-- price snapshot on order items. The edge functions read the 'pricing' row and
-- fall back to identical hardcoded defaults if it is missing.
-- Spec: docs/superpowers/specs/2026-07-17-pricing-v2-embedded-markup-design.md

create table if not exists public."PlatformSettings" (
  "id"        text primary key,
  "data"      jsonb not null default '{}'::jsonb,
  "updatedAt" timestamptz not null default now()
);

alter table public."PlatformSettings" enable row level security;
-- No policies: reads/writes are service-role only (edge functions / admin RPC).

insert into public."PlatformSettings" ("id", "data")
values ('pricing', '{"markupRate": 0.2, "markupFlat": 100, "partnerServiceRate": 0}'::jsonb)
on conflict ("id") do nothing;

-- Restaurant's own per-unit price at order time; display price stays in "price".
-- Nullable: rows created before pricing v2 have no base snapshot.
alter table public."OrderItem" add column if not exists "basePrice" double precision;
