-- Phone OTP verification (NG/GB mobiles): one-time codes are HMAC-hashed,
-- service-role mediated only (auth-gateway edge function). No RLS policies
-- => anon/authenticated see nothing.

create table if not exists public.phone_otps (
  id          uuid primary key default gen_random_uuid(),
  uid         text        not null,               -- auth user id (UserAccount.uid)
  phone_e164  text        not null,               -- normalized +234… / +44…
  channel     text        not null check (channel in ('sms', 'whatsapp')),
  code_hash   text        not null,               -- HMAC-SHA-256(code, OTP_PEPPER); never raw
  expires_at  timestamptz not null,
  attempts    integer     not null default 0,
  consumed_at timestamptz,                        -- set on success or when superseded
  created_at  timestamptz not null default now()
);

create index if not exists phone_otps_uid_created_idx on public.phone_otps (uid, created_at desc);

alter table public.phone_otps enable row level security;

-- Verified-phone timestamp on the profile. Cleared whenever phoneNumber
-- changes outside the OTP flow.
alter table public."UserAccount" add column if not exists "phoneVerifiedAt" timestamptz;

-- Recreate the profile view with phoneVerifiedAt appended (new columns must go
-- last for CREATE OR REPLACE VIEW). Body otherwise identical to
-- functions/prisma/migrations/20260511_supabase_auth_foundation.
CREATE OR REPLACE VIEW "public"."user_profiles"
WITH (security_invoker = true) AS
SELECT
  ua."uid",
  ua."email",
  ua."displayName",
  ua."phoneNumber",
  ua."photoURL",
  ua."emailVerified",
  COALESCE("public"."ebuy_primary_role"(ua."uid"), ua."roleDisplay"::text, 'customer') AS "role",
  ua."partnerApplicationStatus",
  ua."partnerApplicationReviewedAt",
  ua."partnerApplicationRejectionReason",
  ua."dispatchApplicationStatus",
  ua."dispatchApplicationReviewedAt",
  ua."dispatchApplicationRejectionReason",
  ua."expoPushToken",
  ua."pushTokenUpdatedAt",
  ua."activeSessionId",
  ua."activeSessionUpdatedAt",
  ua."accountDisabled",
  ua."disabledAt",
  ua."disabledByUid",
  ua."lastPrivilegedRole"::text AS "lastPrivilegedRole",
  ua."restaurantId",
  ua."restaurantName",
  ua."restaurantLinkedAt",
  ua."restaurantLinkSource",
  ua."createdAt",
  ua."updatedAt",
  ua."phoneVerifiedAt"
FROM "public"."UserAccount" ua;

GRANT SELECT ON "public"."user_profiles" TO authenticated;

-- A phone number change outside the OTP flow invalidates the verification.
-- The gateway's verify path updates phoneNumber AND phoneVerifiedAt in one
-- statement, so its write keeps the timestamp; any other phoneNumber change
-- (profile edit, admin tooling) leaves phoneVerifiedAt untouched in the same
-- statement and gets it cleared here.
create or replace function public.clear_phone_verification()
returns trigger
language plpgsql
as $$
begin
  if new."phoneNumber" is distinct from old."phoneNumber"
     and new."phoneVerifiedAt" is not distinct from old."phoneVerifiedAt" then
    new."phoneVerifiedAt" := null;
  end if;
  return new;
end;
$$;

drop trigger if exists useraccount_clear_phone_verification on public."UserAccount";
create trigger useraccount_clear_phone_verification
  before update on public."UserAccount"
  for each row execute function public.clear_phone_verification();
