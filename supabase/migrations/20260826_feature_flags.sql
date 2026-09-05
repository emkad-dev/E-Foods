-- Feature flags are admin-owned, service-role-only toggles for dark launches.

create table if not exists public."FeatureFlag" (
  "key" text primary key,
  "enabled" boolean not null default false,
  "description" text,
  "updatedAt" timestamptz not null default now()
);

alter table public."FeatureFlag" enable row level security;
-- No policies: feature flags are read and written by service role / admin RPC only.
