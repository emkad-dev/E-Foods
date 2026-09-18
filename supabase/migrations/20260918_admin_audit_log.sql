-- Bring AdminAuditLog under migration control, and index the column the
-- console actually reads it by.
--
-- THE DRIFT. `createAuditEntry` (_shared/auditLog.ts) writes one row here for
-- every privileged mutation -- partner and dispatch approvals, restaurant
-- publish/unpublish, role grants and revocations, access disable/enable, staff
-- provisioning, promo codes. It deliberately throws when the insert fails, on
-- the stated principle that "a failure propagates so the caller cannot report
-- success for an action that left no trace". That is the right design, and it
-- is exactly what makes the missing migration dangerous: no migration in this
-- repository creates this table. It exists in production because it arrived
-- some other way, so a fresh environment -- a new project, a restore, a branch
-- database -- would have EVERY privileged admin action throw on its audit
-- write. Approvals included.
--
-- This file is therefore a faithful capture of the live table, not a redesign:
-- every column type, nullability and default below was read back from
-- production before it was written here, and the three existing indexes are
-- reproduced as they are. `if not exists` throughout, so applying this to the
-- environment that already has the table is a no-op.
create table if not exists public."AdminAuditLog" (
  "id" text primary key default (gen_random_uuid())::text,
  "actorUid" text,
  "action" text not null,
  "targetType" text not null,
  "targetId" text,
  "details" jsonb,
  -- Reproduced as-is: `timestamp without time zone`, defaulting to
  -- CURRENT_TIMESTAMP. Not changed here on purpose -- altering the type of a
  -- timestamp column on a live audit table is a separate, deliberate migration,
  -- not a side effect of documenting the schema. Worth doing: an audit trail
  -- without an offset relies on every writer sharing a clock, and the writers
  -- are edge functions.
  "createdAt" timestamp not null default current_timestamp
);

-- The three that already exist in production, reproduced so a fresh
-- environment gets them too.
create index if not exists "AdminAuditLog_actorUid_idx"
  on public."AdminAuditLog" ("actorUid");
create index if not exists "AdminAuditLog_action_idx"
  on public."AdminAuditLog" ("action");
create index if not exists "AdminAuditLog_targetType_idx"
  on public."AdminAuditLog" ("targetType");

-- NEW, and the reason this is more than a documentation exercise. The question
-- an audit trail is asked first is "what happened recently", which sorts by
-- createdAt descending -- and that was the one column with no index, so the
-- read path being added alongside this migration would sequentially scan the
-- whole table and sort it on every page load. The other three indexes serve
-- filters; this one serves the default view.
create index if not exists "AdminAuditLog_createdAt_idx"
  on public."AdminAuditLog" ("createdAt" desc);

-- Matches production: RLS enabled with NO policies, i.e. service-role only,
-- the posture docs/rls-posture.md sets for every table the Data API must not
-- expose. Deliberate and load-bearing -- an audit trail an admin client could
-- write to, or delete from, is not an audit trail. The only writer is the edge
-- function under the service key; reads go through an admin RPC.
alter table public."AdminAuditLog" enable row level security;

comment on table public."AdminAuditLog" is
  'Append-only record of privileged admin actions, written by _shared/auditLog.ts. Service-role only; never exposed through the Data API. Keep personal data out of details -- store identifiers and decisions, not documents, account numbers or message bodies.';
