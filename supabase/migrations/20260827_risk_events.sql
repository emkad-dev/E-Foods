-- Risk queue ledger: service-role only advisory fraud and abuse signals.
--
-- The table is intentionally internal. Signal capture happens through Edge
-- Functions using the service role, which bypasses RLS. We still enable RLS
-- and keep no policies as defense in depth, then revoke public/client access
-- so the Data API cannot reach the table from anon/authenticated sessions.

do $risk_events$
begin
  create extension if not exists pgcrypto;
exception
  when others then
    raise notice 'risk-events: pgcrypto unavailable (%), relying on the built-in gen_random_uuid()', sqlerrm;
end
$risk_events$;

create table if not exists public."RiskEvent" (
  "id"          text primary key default (gen_random_uuid())::text,
  "dedupeKey"   text not null unique,
  "eventType"   text not null,
  "severity"    text not null,
  "subjectType" text not null,
  "subjectId"   text not null,
  "actorUid"    text,
  "orderId"     text,
  "score"       integer not null default 0,
  "reason"      text not null,
  "metadata"    jsonb not null default '{}'::jsonb,
  "createdAt"   timestamptz not null default now(),
  "updatedAt"   timestamptz not null default now()
);

create index if not exists "RiskEvent_severity_updatedAt_idx"
  on public."RiskEvent" ("severity", "updatedAt" desc);
create index if not exists "RiskEvent_eventType_idx"
  on public."RiskEvent" ("eventType");
create index if not exists "RiskEvent_subjectType_subjectId_idx"
  on public."RiskEvent" ("subjectType", "subjectId");
create index if not exists "RiskEvent_orderId_idx"
  on public."RiskEvent" ("orderId");

alter table public."RiskEvent" enable row level security;

revoke all on table public."RiskEvent" from public, anon, authenticated;
grant select, insert, update, delete on table public."RiskEvent" to service_role;
