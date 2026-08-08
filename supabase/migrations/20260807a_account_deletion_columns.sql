-- Deletion lifecycle state for the 30-day grace period.
-- Columns only; the enforcement that makes them meaningful is in 20260807b.

alter table public."UserAccount"
  add column if not exists "deletionRequestedAt" timestamptz,
  add column if not exists "purgeScheduledAt" timestamptz,
  add column if not exists "deletionCancelTokenHash" text,
  add column if not exists "purgeAttemptCount" integer not null default 0,
  add column if not exists "purgeLastAttemptAt" timestamptz,
  add column if not exists "purgeLastError" text;

-- The purge runner scans by due date over a tiny subset of rows.
create index if not exists "UserAccount_purge_due_idx"
  on public."UserAccount" ("purgeScheduledAt")
  where "deletionRequestedAt" is not null;

-- user_profiles is what getAuthenticatedRequestContext reads. Without these two
-- columns the C3a gate is blind and silently allows everything.
create or replace view public."user_profiles"
with (security_invoker = true) as
select
  uid,
  email,
  "displayName",
  "phoneNumber",
  "photoURL",
  "emailVerified",
  coalesce(public.ebuy_primary_role(uid), "roleDisplay"::text, 'customer'::text) as role,
  "partnerApplicationStatus",
  "partnerApplicationReviewedAt",
  "partnerApplicationRejectionReason",
  "dispatchApplicationStatus",
  "dispatchApplicationReviewedAt",
  "dispatchApplicationRejectionReason",
  "expoPushToken",
  "pushTokenUpdatedAt",
  "activeSessionId",
  "activeSessionUpdatedAt",
  "accountDisabled",
  "disabledAt",
  "disabledByUid",
  "lastPrivilegedRole"::text as "lastPrivilegedRole",
  "restaurantId",
  "restaurantName",
  "restaurantLinkedAt",
  "restaurantLinkSource",
  "createdAt",
  "updatedAt",
  "phoneVerifiedAt",
  "deletionRequestedAt",
  "purgeScheduledAt"
from public."UserAccount" ua;

grant select on public."user_profiles" to authenticated;
