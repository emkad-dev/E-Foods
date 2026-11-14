alter table public."OperationalAlert"
  add column if not exists "resolvedAt" timestamptz,
  add column if not exists "resolvedBy" text;

create index if not exists "OperationalAlert_unresolved_createdAt_idx"
  on public."OperationalAlert" ("createdAt" desc)
  where "resolvedAt" is null;
