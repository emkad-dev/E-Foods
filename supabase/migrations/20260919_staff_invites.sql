-- Let a restaurant give its staff their own logins.
--
-- THE PROBLEM. One account per restaurant, shared by the owner, the manager
-- and whoever is on the pass. Every action a restaurant takes -- accepting an
-- order, changing a price, pausing the store, editing payout details --
-- resolves to that one uid, so AdminAuditLog can say what a restaurant did and
-- never who did it. Shared credentials also survive the person: a cook who
-- leaves still knows the password to a console wired to a Paystack subaccount.
--
-- WHY NOT JUST EXPOSE provisionStaffAccount. It is admin-only and must stay
-- that way. It takes `role` from the request body and accepts 'admin'; it takes
-- `restaurantId` from the body rather than the caller; and when the email
-- already exists it falls through to updateSupabaseAuthUser with the supplied
-- password and role and `ban_duration: 'none'`. That last branch is reasonable
-- for an admin re-provisioning staff and is an account-takeover primitive in
-- anyone else's hands: type an existing email, receive that account. Handing it
-- to partners would let any restaurant owner seize any account, including an
-- administrator's.
--
-- WHAT THIS DOES INSTEAD. The invite carries no authority to create anything.
-- The staff member signs up through the ordinary partner signup -- their own
-- password, the existing email OTP -- and then redeems a code that attaches
-- their EXISTING account to the restaurant. Three consequences worth stating:
-- no new code path mints auth users, ANONYMOUS_ACTIONS stays at two so the
-- pre-auth surface does not widen, and the owner never learns the credential,
-- which is the only way an action logged against a staff member is evidence
-- that the staff member took it.
create table if not exists public."StaffInvite" (
  "id" text primary key default (gen_random_uuid())::text,
  "restaurantId" text not null,
  -- Stored lowercased. Redemption compares against the signed-in account's own
  -- email, so an invite cannot be redeemed by whoever happens to hold the code.
  "email" text not null,
  -- THE CODE IS NEVER STORED. Only its hash, the same posture auth-gateway
  -- takes with its audit values. A readable invite column is a list of live
  -- credentials for anyone who reaches the table.
  "codeHash" text not null,
  -- Pinned to 'restaurant' by the handler, never taken from the request. The
  -- column exists so the constraint is visible in the schema rather than
  -- living only in TypeScript.
  "role" text not null default 'restaurant',
  "invitedByUid" text not null,
  "status" text not null default 'pending',
  "expiresAt" timestamptz not null,
  "acceptedAt" timestamptz,
  "acceptedUid" text,
  -- Brute-force guard. Six digits is a million combinations, which is a lot for
  -- a human and nothing for a script, so the count is the real protection and
  -- the code length is not.
  "attempts" integer not null default 0,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint "StaffInvite_status_check"
    check ("status" in ('pending', 'accepted', 'revoked')),
  constraint "StaffInvite_role_check"
    check ("role" in ('restaurant'))
);

-- One live invite per address per restaurant. Partial, so a superseded or
-- redeemed invite does not block re-inviting someone -- a code that went to a
-- mistyped address must be reissuable.
create unique index if not exists "StaffInvite_pending_unique"
  on public."StaffInvite" ("restaurantId", "email")
  where "status" = 'pending';

-- Redemption looks the invite up by the email of the account redeeming it.
create index if not exists "StaffInvite_email_status_idx"
  on public."StaffInvite" ("email", "status");

-- The owner's own list.
create index if not exists "StaffInvite_restaurant_idx"
  on public."StaffInvite" ("restaurantId", "createdAt" desc);

-- RLS on with NO policies: service-role only, the posture docs/rls-posture.md
-- sets for every table the Data API must not expose. Load-bearing here beyond
-- the usual reason -- this table holds invite hashes and their attempt counts,
-- and a client that could read it could enumerate pending invites, or reset
-- `attempts` and remove the brute-force limit entirely.
alter table public."StaffInvite" enable row level security;

comment on table public."StaffInvite" is
  'Pending invitations for restaurant staff. Service-role only. The invite code is stored hashed and never in plaintext; redemption requires an already-signed-in account whose own email matches the invite.';
