-- Operational alerts are review-only, service-role-only records used by the
-- admin observability page. They are deduped by subject/window via the
-- service code, not by application-side retries.

do $$
begin
  perform gen_random_uuid();
exception
  when undefined_function then
    raise notice 'operational-alerts: pgcrypto unavailable (%), relying on the built-in gen_random_uuid()', sqlerrm;
end $$;

create table if not exists public."OperationalAlert" (
  "id"          text primary key default (gen_random_uuid())::text,
  "dedupeKey"   text not null unique,
  "alertType"   text not null,
  "severity"    text not null,
  "subjectType" text not null,
  "subjectId"   text not null,
  "title"       text not null,
  "details"     text not null,
  "metadata"    jsonb not null default '{}'::jsonb,
  "createdAt"   timestamptz not null default now(),
  "updatedAt"   timestamptz not null default now()
);

create index if not exists "OperationalAlert_severity_updatedAt_idx"
  on public."OperationalAlert" ("severity", "updatedAt" desc);
create index if not exists "OperationalAlert_alertType_idx"
  on public."OperationalAlert" ("alertType");
create index if not exists "OperationalAlert_subjectType_subjectId_idx"
  on public."OperationalAlert" ("subjectType", "subjectId");

alter table public."OperationalAlert" enable row level security;

revoke all on table public."OperationalAlert" from public, anon, authenticated;
grant select, insert, update, delete on table public."OperationalAlert" to service_role;
