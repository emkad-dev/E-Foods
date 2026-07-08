-- Broadcast messaging (Phase 3a): broadcasts + email suppression
create table if not exists public."Broadcast" (
  "id"             text primary key default (gen_random_uuid())::text,
  "title"          text not null,
  "category"       text not null,
  "channels"       jsonb not null default '[]'::jsonb,
  "segment"        jsonb not null default '{}'::jsonb,
  "emailSubject"   text,
  "emailBody"      text,
  "pushTitle"      text,
  "pushBody"       text,
  "status"         text not null default 'draft',
  "scheduledAt"    timestamptz,
  "recipientCount" integer not null default 0,
  "sentEmail"      integer not null default 0,
  "failedEmail"    integer not null default 0,
  "sentPush"       integer not null default 0,
  "failedPush"     integer not null default 0,
  "createdByUid"   text not null,
  "createdAt"      timestamptz not null default now(),
  "updatedAt"      timestamptz not null default now(),
  "sentAt"         timestamptz
);

create table if not exists public."EmailSuppression" (
  "id"        text primary key default (gen_random_uuid())::text,
  "email"     text not null unique,
  "reason"    text not null,
  "createdAt" timestamptz not null default now()
);

create index if not exists "Broadcast_status_idx" on public."Broadcast" ("status");
create index if not exists "Broadcast_scheduledAt_idx" on public."Broadcast" ("scheduledAt");
create index if not exists "Broadcast_createdAt_idx" on public."Broadcast" ("createdAt");
create index if not exists "EmailSuppression_reason_idx" on public."EmailSuppression" ("reason");

-- No policies: anon/authenticated get zero rows. Access is service-role via
-- app-rpc / broadcast-runner / unsubscribe edge functions only.
alter table public."Broadcast" enable row level security;
alter table public."EmailSuppression" enable row level security;
