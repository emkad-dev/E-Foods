-- ============================================================================
-- FEASTY — PRE-PUSH migration bundle (apply in Supabase SQL editor, in order)
-- Generated 2026-10-23. Run this WHOLE file once, top to bottom.
-- After it succeeds: (1) run the VACUUM line at the very bottom in ITS OWN query
-- (it cannot run inside a transaction), then (2) push main so CI deploys the
-- functions, then (3) hand-deploy rider-payouts and apply the POST-DEPLOY file.
-- Each section is an original migration file, concatenated unmodified.
-- ============================================================================


-- ===== 20261020c_security_hardening.sql =====

-- 20261020c_security_hardening.sql
--
-- Database hardening pass driven by the Supabase security + performance
-- advisors (snapshot 2026-10-20, project rgfbheorvtolixdcpjhy). Every object
-- definition below was read from prod's catalog (pg_get_functiondef,
-- pg_policies, storage.buckets) on 2026-10-20, not from older migrations.
--
-- Filename note: `20261020_...` would collide with 20261020_rider_payouts.sql
-- on the CLI's version key (the part before the first underscore), so this
-- follows the existing letter-suffix convention (20260807a/b, 20261020b).
--
-- Apply in the Supabase SQL editor as `postgres`. Wrapped in one transaction
-- and re-runnable: every statement is either CREATE OR REPLACE, DROP ... IF
-- EXISTS + CREATE, REVOKE/GRANT, ALTER ... SET, or an idempotent UPDATE.
--
-- CHANGES
--   1. auth_rl_hit(text,int,int,int): revoke EXECUTE from public/anon/
--      authenticated, grant to service_role only. It is SECURITY DEFINER and
--      was callable by anyone at /rest/v1/rpc/auth_rl_hit, so an anonymous
--      caller could burn or lock out any rate-limit key (e.g. lock a victim's
--      login/OTP key). 20260712_auth_gateway.sql already revoked it, but prod's
--      ACL shows anon=X and authenticated=X (Supabase default privileges
--      re-granted it). The only callers - supabase/functions/_shared/
--      rateLimit.ts and supabase/functions/auth-gateway/ratelimit.ts - use
--      `serviceClient` (SERVICE_ROLE_KEY); no app or package calls it.
--   2. ebuy_guard_useraccount_sensitive_update(): add "phoneVerifiedAt" and
--      "email" to the columns a non-admin, non-service-role session may not
--      change on UserAccount. Before this, any signed-in user could mark their
--      own phone verified (the OTP flow writes it via the service role) or
--      rewrite the email the backend mails to. Client write paths checked:
--      packages/auth/src/profileApi.ts and apps/customer/src/services/
--      supabase/profile.ts only send email on the first-profile upsert
--      (an INSERT; this is a BEFORE UPDATE trigger) and never send
--      phoneVerifiedAt. Trigger order is safe: BEFORE triggers fire by name,
--      so ebuy_useraccount_sensitive_update_guard runs before
--      useraccount_clear_phone_verification - a client changing phoneNumber
--      passes the guard (phoneVerifiedAt unchanged), then the second trigger
--      nulls phoneVerifiedAt. Everything else in the function is unchanged
--      apart from the pinned search_path (change 3).
--   3. Pin search_path = public, pg_temp on the 5 functions the advisor flags
--      as role-mutable: clear_phone_verification(), ebuy_primary_role(text),
--      ebuy_custom_access_token_hook(jsonb),
--      ebuy_guard_useraccount_sensitive_update(),
--      ebuy_record_courier_earning_on_delivery(). All of them already
--      schema-qualify auth.* and public.* references.
--   4. public.notes (Supabase demo table, 3 rows, unused by the repo): drop the
--      anon "public can read notes" policy (the only one), keep RLS enabled,
--      revoke all from anon and authenticated. Table and rows are kept.
--   5. storage bucket promo-assets: file_size_limit 5 MB, allowed_mime_types
--      image/jpeg, image/png, image/webp (the set apps/admin-web/src/services/
--      promoAssetUpload.ts maps to extensions; matches restaurant-assets).
--      Previously unlimited and any type in a PUBLIC bucket (SVG/HTML upload).
--   6. Rewrite the 13 public-schema RLS policies flagged by the auth_rls_initplan
--      advisor so auth.uid() / auth.jwt() are wrapped as (select auth.uid()) /
--      (select auth.jwt()) and evaluated once per statement instead of per row.
--      Names, PERMISSIVE, roles, commands and USING / WITH CHECK are reproduced
--      from pg_policies verbatim except for the wrap.
--
-- DELIBERATELY NOT CHANGED
--   - storage.objects policies (owned by supabase_storage_admin; the advisor
--     does not flag them, and a failed DROP POLICY there would abort this
--     whole transaction).
--   - ebuy_account_pending_deletion() / rls_auto_enable() anon EXECUTE
--     (flagged too, but out of scope here; the first is used inside RLS
--     policies by `authenticated` and must stay executable by it).
--
-- REVERSE STEPS (run in one transaction if this has to be rolled back)
--   1. grant execute on function public.auth_rl_hit(text, integer, integer, integer)
--        to anon, authenticated;
--   2. Re-run the CREATE OR REPLACE of ebuy_guard_useraccount_sensitive_update
--      below without the two lines marked "added 20261020c".
--   3. alter function public.clear_phone_verification() reset search_path;
--      (and the same RESET for the other four functions listed in change 3)
--   4. grant select, insert, update, delete, truncate, references, trigger
--        on public.notes to anon, authenticated;
--      create policy "public can read notes" on public.notes
--        as permissive for select to anon using (true);
--   5. update storage.buckets set file_size_limit = null, allowed_mime_types = null
--        where id = 'promo-assets';
--   6. Recreate each policy in section 6 with bare auth.uid() / auth.jwt()
--      (functionally identical; only the per-row evaluation comes back).

begin;

-- ---------------------------------------------------------------------------
-- 1. auth_rl_hit: service role only
-- ---------------------------------------------------------------------------
revoke execute on function public.auth_rl_hit(text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.auth_rl_hit(text, integer, integer, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- 2. UserAccount sensitive-column guard (+ phoneVerifiedAt, email)
-- ---------------------------------------------------------------------------
create or replace function public.ebuy_guard_useraccount_sensitive_update()
 returns trigger
 language plpgsql
 set search_path = public, pg_temp
as $function$
BEGIN
  IF COALESCE(auth.role(), '') = 'service_role'
     OR COALESCE(auth.jwt()->'app_metadata'->>'user_role', auth.jwt()->>'user_role') = 'admin' THEN
    RETURN NEW;
  END IF;
  IF OLD."deletionRequestedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'account is pending deletion; direct updates are not allowed';
  END IF;
  IF NEW."accountDisabled" IS DISTINCT FROM OLD."accountDisabled"
     OR NEW."disabledAt" IS DISTINCT FROM OLD."disabledAt"
     OR NEW."disabledByUid" IS DISTINCT FROM OLD."disabledByUid"
     OR NEW."lastPrivilegedRole" IS DISTINCT FROM OLD."lastPrivilegedRole"
     OR NEW."roleDisplay" IS DISTINCT FROM OLD."roleDisplay"
     OR NEW."partnerApplicationStatus" IS DISTINCT FROM OLD."partnerApplicationStatus"
     OR NEW."partnerApplicationReviewedAt" IS DISTINCT FROM OLD."partnerApplicationReviewedAt"
     OR NEW."partnerApplicationRejectionReason" IS DISTINCT FROM OLD."partnerApplicationRejectionReason"
     OR NEW."dispatchApplicationStatus" IS DISTINCT FROM OLD."dispatchApplicationStatus"
     OR NEW."dispatchApplicationReviewedAt" IS DISTINCT FROM OLD."dispatchApplicationReviewedAt"
     OR NEW."dispatchApplicationRejectionReason" IS DISTINCT FROM OLD."dispatchApplicationRejectionReason"
     OR NEW."restaurantId" IS DISTINCT FROM OLD."restaurantId"
     OR NEW."restaurantName" IS DISTINCT FROM OLD."restaurantName"
     OR NEW."restaurantLinkedAt" IS DISTINCT FROM OLD."restaurantLinkedAt"
     OR NEW."restaurantLinkSource" IS DISTINCT FROM OLD."restaurantLinkSource"
     OR NEW."emailVerified" IS DISTINCT FROM OLD."emailVerified"
     OR NEW."email" IS DISTINCT FROM OLD."email"                      -- added 20261020c
     OR NEW."phoneVerifiedAt" IS DISTINCT FROM OLD."phoneVerifiedAt"  -- added 20261020c
     OR NEW."deletionRequestedAt" IS DISTINCT FROM OLD."deletionRequestedAt"
     OR NEW."purgeScheduledAt" IS DISTINCT FROM OLD."purgeScheduledAt"
     OR NEW."deletionCancelTokenHash" IS DISTINCT FROM OLD."deletionCancelTokenHash"
     OR NEW."purgeAttemptCount" IS DISTINCT FROM OLD."purgeAttemptCount"
     OR NEW."purgeLastAttemptAt" IS DISTINCT FROM OLD."purgeLastAttemptAt"
     OR NEW."purgeLastError" IS DISTINCT FROM OLD."purgeLastError" THEN
    RAISE EXCEPTION 'direct updates to sensitive UserAccount fields are not allowed';
  END IF;
  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Pin search_path on advisor-flagged functions
-- ---------------------------------------------------------------------------
alter function public.clear_phone_verification() set search_path = public, pg_temp;
alter function public.ebuy_primary_role(text) set search_path = public, pg_temp;
alter function public.ebuy_custom_access_token_hook(jsonb) set search_path = public, pg_temp;
alter function public.ebuy_guard_useraccount_sensitive_update() set search_path = public, pg_temp;
alter function public.ebuy_record_courier_earning_on_delivery() set search_path = public, pg_temp;

-- ---------------------------------------------------------------------------
-- 4. public.notes: unreachable via the Data API (kept, not dropped)
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.notes') is not null then
    execute 'drop policy if exists "public can read notes" on public.notes';
    execute 'alter table public.notes enable row level security';
    execute 'revoke all on table public.notes from anon, authenticated';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 5. promo-assets bucket limits
-- ---------------------------------------------------------------------------
update storage.buckets
   set file_size_limit = 5242880,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'promo-assets';

-- ---------------------------------------------------------------------------
-- 6. RLS: evaluate auth.uid() / auth.jwt() once per statement
-- ---------------------------------------------------------------------------

-- CustomerFavoriteRestaurant
drop policy if exists "Customer favorites are visible to the owner" on public."CustomerFavoriteRestaurant";
create policy "Customer favorites are visible to the owner" on public."CustomerFavoriteRestaurant"
  as permissive for select to authenticated
  using ("customerId" = ((select auth.uid()))::text);

drop policy if exists "Customers can add their own favorites" on public."CustomerFavoriteRestaurant";
create policy "Customers can add their own favorites" on public."CustomerFavoriteRestaurant"
  as permissive for insert to authenticated
  with check (("customerId" = ((select auth.uid()))::text) and (not ebuy_account_pending_deletion()));

drop policy if exists "Customers can delete their own favorites" on public."CustomerFavoriteRestaurant";
create policy "Customers can delete their own favorites" on public."CustomerFavoriteRestaurant"
  as permissive for delete to authenticated
  using (("customerId" = ((select auth.uid()))::text) and (not ebuy_account_pending_deletion()));

drop policy if exists "Customers can update their own favorites" on public."CustomerFavoriteRestaurant";
create policy "Customers can update their own favorites" on public."CustomerFavoriteRestaurant"
  as permissive for update to authenticated
  using (("customerId" = ((select auth.uid()))::text) and (not ebuy_account_pending_deletion()))
  with check (("customerId" = ((select auth.uid()))::text) and (not ebuy_account_pending_deletion()));

-- CustomerOrder
drop policy if exists "CustomerOrder self read" on public."CustomerOrder";
create policy "CustomerOrder self read" on public."CustomerOrder"
  as permissive for select to authenticated
  using ("customerId" = ((select auth.uid()))::text);

-- DeliveryAssignment
drop policy if exists "DeliveryAssignment self order read" on public."DeliveryAssignment";
create policy "DeliveryAssignment self order read" on public."DeliveryAssignment"
  as permissive for select to authenticated
  using ("orderId" in (
    select "CustomerOrder".id
      from "CustomerOrder"
     where ("CustomerOrder"."customerId" = ((select auth.uid()))::text)
  ));

-- UserAccount
drop policy if exists "UserAccount self insert or admin" on public."UserAccount";
create policy "UserAccount self insert or admin" on public."UserAccount"
  as permissive for insert to authenticated
  with check ((uid = ((select auth.uid()))::text)
    or (coalesce((((select auth.jwt()) -> 'app_metadata'::text) ->> 'user_role'::text), ((select auth.jwt()) ->> 'user_role'::text)) = 'admin'::text));

drop policy if exists "UserAccount self read or admin" on public."UserAccount";
create policy "UserAccount self read or admin" on public."UserAccount"
  as permissive for select to authenticated
  using ((uid = ((select auth.uid()))::text)
    or (coalesce((((select auth.jwt()) -> 'app_metadata'::text) ->> 'user_role'::text), ((select auth.jwt()) ->> 'user_role'::text)) = 'admin'::text));

drop policy if exists "UserAccount self update or admin" on public."UserAccount";
create policy "UserAccount self update or admin" on public."UserAccount"
  as permissive for update to authenticated
  using ((uid = ((select auth.uid()))::text)
    or (coalesce((((select auth.jwt()) -> 'app_metadata'::text) ->> 'user_role'::text), ((select auth.jwt()) ->> 'user_role'::text)) = 'admin'::text))
  with check ((uid = ((select auth.uid()))::text)
    or (coalesce((((select auth.jwt()) -> 'app_metadata'::text) ->> 'user_role'::text), ((select auth.jwt()) ->> 'user_role'::text)) = 'admin'::text));

-- UserPolicyAcceptance
drop policy if exists "Users can create their own policy acceptances" on public."UserPolicyAcceptance";
create policy "Users can create their own policy acceptances" on public."UserPolicyAcceptance"
  as permissive for insert to authenticated
  with check (("userId" = ((select auth.uid()))::text) and (not ebuy_account_pending_deletion()));

drop policy if exists "Users can view their own policy acceptances" on public."UserPolicyAcceptance";
create policy "Users can view their own policy acceptances" on public."UserPolicyAcceptance"
  as permissive for select to authenticated
  using ("userId" = ((select auth.uid()))::text);

-- UserRole
drop policy if exists "UserRole self insert customer or admin" on public."UserRole";
create policy "UserRole self insert customer or admin" on public."UserRole"
  as permissive for insert to authenticated
  with check (((("userId" = ((select auth.uid()))::text) and (role = 'customer'::"AppRole") and ("assignedByUid" is null) and (not ebuy_account_pending_deletion())))
    or (coalesce((((select auth.jwt()) -> 'app_metadata'::text) ->> 'user_role'::text), ((select auth.jwt()) ->> 'user_role'::text)) = 'admin'::text));

drop policy if exists "UserRole self read or admin" on public."UserRole";
create policy "UserRole self read or admin" on public."UserRole"
  as permissive for select to authenticated
  using ((("userId" = ((select auth.uid()))::text))
    or (coalesce((((select auth.jwt()) -> 'app_metadata'::text) ->> 'user_role'::text), ((select auth.jwt()) ->> 'user_role'::text)) = 'admin'::text));

commit;


-- ===== 20261021_push_devices.sql =====

-- Per-app Expo push tokens.
--
-- UserAccount.expoPushToken is ONE column shared by three apps (customer,
-- partner, dispatch), each of which is a separate Expo project with its own
-- token. Whichever app registered last overwrote the others, so a restaurant
-- owner or rider who also uses the customer app had their kitchen/offer pushes
-- routed into the customer app (where the `offers` channel does not exist, so
-- Android drops them) or lost them entirely.
--
-- PushDevice keeps one token per (user, app). The token itself is unique: an
-- Expo token identifies one app install on one device, so when someone else
-- signs in on that phone the row moves to them instead of both accounts
-- receiving each other's pushes.
--
-- Purely additive. Edge functions read this table when it exists and fall back
-- to the legacy column when it does not (or holds no row for the user), and
-- clients keep writing the legacy column, so applying this migration is never
-- a prerequisite for a deploy and nothing regresses before it lands.

create table if not exists public."PushDevice" (
  id uuid primary key default gen_random_uuid(),
  "userId" text not null,
  app text not null check (app in ('customer', 'partner', 'dispatch', 'admin')),
  token text not null,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint "PushDevice_userId_app_key" unique ("userId", app),
  constraint "PushDevice_token_key" unique (token)
);

create index if not exists "PushDevice_userId_idx" on public."PushDevice" ("userId");

-- Service-role only: RLS on with no policies, and no table grants to clients.
-- Clients register through the two security-definer functions below, which
-- act only on auth.uid().
alter table public."PushDevice" enable row level security;
revoke all on table public."PushDevice" from anon, authenticated;

create or replace function public.ebuy_register_push_device(p_app text, p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text := auth.uid()::text;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_app not in ('customer', 'partner', 'dispatch') then
    raise exception 'unsupported app';
  end if;
  if p_token is null or p_token !~ '^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$' then
    raise exception 'invalid push token';
  end if;

  -- The device changed hands: detach the token from whoever held it before.
  delete from public."PushDevice" where token = p_token and "userId" <> v_uid;

  insert into public."PushDevice" ("userId", app, token, "updatedAt")
    values (v_uid, p_app, p_token, now())
    on conflict ("userId", app) do update
      set token = excluded.token, "updatedAt" = now();

  -- Same for the legacy column, which older builds and the fallback read path
  -- still use. Isolated so a guard-trigger refusal on some other account (e.g.
  -- one pending deletion) can never fail this caller's registration.
  begin
    update public."UserAccount"
      set "expoPushToken" = null, "pushTokenUpdatedAt" = now()
      where "expoPushToken" = p_token and uid <> v_uid and "deletionRequestedAt" is null;
  exception when others then
    raise notice 'legacy push token cleanup skipped: %', sqlerrm;
  end;
end;
$$;

create or replace function public.ebuy_unregister_push_device(p_app text, p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text := auth.uid()::text;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  delete from public."PushDevice"
    where "userId" = v_uid and app = p_app and (p_token is null or token = p_token);
end;
$$;

revoke all on function public.ebuy_register_push_device(text, text) from public, anon;
revoke all on function public.ebuy_unregister_push_device(text, text) from public, anon;
grant execute on function public.ebuy_register_push_device(text, text) to authenticated;
grant execute on function public.ebuy_unregister_push_device(text, text) to authenticated;


-- ===== 20261021b_drainer_heartbeat.sql =====

-- queue-drainer liveness heartbeat + an independent watchdog.
--
-- Acceptance-deadline auto-cancel/refund, delivery-offer expiry, scheduled-
-- order release and rider-ping cleanup ALL ride on the one every-minute
-- queue-drainer invocation (20260624_queue_drainer_schedule.sql). It has
-- failed silently before (missing Vault secrets, 2026-07-13), and nothing
-- noticed: paid orders simply stopped auto-cancelling.
--
-- 1. CronHeartbeat: queue-drainer stamps `lastRunAt` after its sweeps finish.
-- 2. ebuy_check_drainer_heartbeat(): if that stamp is older than 5 minutes,
--    upsert a HIGH OperationalAlert (visible in the admin console).
-- 3. A pg_cron job runs (2) every 5 minutes inside Postgres - deliberately NOT
--    through an Edge Function, so it still fires when the functions runtime,
--    the Vault secrets or the worker token are what broke.
--    broadcast-runner performs the same check from the edge side and also
--    emails the admins (Postgres cannot send email here).
--
-- A missing heartbeat row (drainer not yet redeployed with the stamping code)
-- is "unknown", not "stale", so applying this before the deploy raises no
-- false alarm. Additive and idempotent.
-- To remove: select cron.unschedule('queue-drainer-heartbeat-watch');

create table if not exists public."CronHeartbeat" (
  name text primary key,
  "lastRunAt" timestamptz not null,
  details jsonb not null default '{}'::jsonb
);

alter table public."CronHeartbeat" enable row level security;
revoke all on table public."CronHeartbeat" from anon, authenticated;

create or replace function public.ebuy_check_drainer_heartbeat()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last timestamptz;
begin
  select "lastRunAt" into v_last from public."CronHeartbeat" where name = 'queue-drainer';

  if v_last is null or v_last >= now() - interval '5 minutes' then
    return false;
  end if;

  insert into public."OperationalAlert" (
    "dedupeKey", "alertType", severity, "subjectType", "subjectId", title, details, metadata, "createdAt", "updatedAt"
  ) values (
    'queue-drainer-heartbeat-stale',
    'queue_drainer_stale',
    'high',
    'system',
    'queue-drainer',
    'queue-drainer has stopped running',
    'No successful queue-drainer run since ' || to_char(v_last at time zone 'UTC', 'YYYY-MM-DD HH24:MI') ||
      ' UTC. Acceptance-deadline refunds, offer expiry and scheduled-order release are not happening. ' ||
      'Check the queue-drainer-every-minute cron job, the Vault secrets project_url/queue_worker_token, ' ||
      'the QUEUE_WORKER_TOKEN function secret, and the function logs.',
    jsonb_build_object('lastRunAt', v_last, 'checkedAt', now(), 'source', 'pg_cron'),
    now(),
    now()
  )
  on conflict ("dedupeKey") do update
    set details = excluded.details, metadata = excluded.metadata, severity = 'high', "updatedAt" = now();

  return true;
end;
$$;

revoke all on function public.ebuy_check_drainer_heartbeat() from public, anon, authenticated;

do $sched$
begin
  perform cron.schedule(
    'queue-drainer-heartbeat-watch',
    '*/5 * * * *',
    $cron$ select public.ebuy_check_drainer_heartbeat(); $cron$
  );
exception
  when others then
    raise notice 'queue-drainer heartbeat watch: could not schedule cron (%), skipping', sqlerrm;
end
$sched$;


-- ===== 20261020_rider_payouts.sql =====

-- Rider pay: the money ledger for FEASTY platform riders.
--
-- ADDITIVE ONLY. Nothing here alters or drops an existing column, table,
-- trigger or function. CourierEarning and its trigger are left exactly as they
-- are: CourierEarning stays the rider-app activity/trip-count ledger (one row
-- per delivered assignment, any rider, amount = pricing.dispatchFee, upserted
-- on re-delivery). It cannot be the payable ledger because its trigger
-- REWRITES courierId/amount on a re-delivery, which would corrupt a row that
-- had already been paid. RiderEarning below is insert-once and never rewritten
-- by a trigger; for a platform order its deliveryPay equals CourierEarning's
-- amount (both read pricing.dispatchFee), so the two agree where they overlap.
--
-- Money flow this ledger serves (see _shared/pricing.ts + deliveryProvider.ts):
--   * A 'platform' order (pricing.deliveryProvider = 'platform') settles only
--     restaurantPayable to the restaurant subaccount. The delivery fee and the
--     tip stay in the FEASTY Paystack balance.
--   * When a FEASTY rider (dispatch UserRole with restaurantId NULL) delivers
--     it AND the customer's handoff code was verified, one RiderEarning row is
--     created: deliveryPay = pricing.dispatchFee (the full delivery fee),
--     tipAmount = pricing.tip.
--   * The rider-payouts edge function batches pending earnings per rider into
--     a RiderPayout and sends a Paystack transfer with a deterministic
--     reference. Paystack transfer webhooks settle the payout.
--
-- Status machine (enforced by the two functions at the bottom, under row
-- locks, never by the edge code alone):
--   RiderEarning: pending -> processing (attached to a payout) -> paid
--                 processing -> pending (payout failed / reversed)
--   RiderPayout:  processing -> paid | failed | reversed ; paid -> reversed
--
-- All three tables are RLS-enabled with NO policies and are revoked from
-- anon/authenticated: service-role only, like OperationalAlert.
--
-- Apply order: this file first, then deploy functions, then (optionally)
-- 20261020b_rider_payouts_schedule.sql. Safe to apply before the deploy: the
-- new column defaults to 'restaurant' (today's behaviour) and the
-- rider_auto_payouts flag is seeded OFF.

-- ---------------------------------------------------------------------------
-- 1. Restaurant opt-in to FEASTY riders.
-- ---------------------------------------------------------------------------
alter table public."RestaurantRecord"
  add column if not exists "deliveryProvider" text not null default 'restaurant';

do $$
begin
  alter table public."RestaurantRecord"
    add constraint "RestaurantRecord_deliveryProvider_check"
    check ("deliveryProvider" in ('restaurant', 'platform'));
exception
  when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Ledger tables.
-- ---------------------------------------------------------------------------
create table if not exists public."RiderPayoutRecipient" (
  "riderId"           text primary key,
  "recipientCode"     text not null,
  "accountName"       text not null,
  -- Masked only ('******1234'). The full number lives with Paystack.
  "accountNumberMasked" text not null,
  "bankCode"          text not null,
  "bankName"          text,
  "verifiedAt"        timestamptz,
  -- TWO independent holds; payouts are skipped while EITHER is live:
  --   holdUntil/holdReason - set to 'infinity' when a transfer fails or is
  --     reversed; cleared when the rider re-submits bank details.
  --   bankChangedAt - stamped when an existing rider switches to a different
  --     account (account-takeover brake); payouts wait until bankChangedAt +
  --     the bank-change hold (24h, passed in by the caller). Never cleared or
  --     overwritten by a transfer outcome, so a failure hold followed by a
  --     re-submit cannot shortcut it.
  "holdUntil"         timestamptz,
  "holdReason"        text,
  "bankChangedAt"     timestamptz,
  "createdAt"         timestamptz not null default now(),
  "updatedAt"         timestamptz not null default now()
);

create table if not exists public."RiderPayout" (
  "id"             text primary key,
  "riderId"        text not null,
  "amount"         numeric(12, 2) not null check ("amount" > 0),
  "currency"       text not null default 'NGN',
  -- Deterministic: 'feasty_rp_' || id. Paystack refuses a second transfer
  -- with the same reference, so a retried initiation can never pay twice.
  "reference"      text not null unique,
  "recipientCode"  text not null,
  "status"         text not null default 'processing'
                   check ("status" in ('processing', 'paid', 'failed', 'reversed')),
  "earningCount"   integer not null default 0,
  "transferCode"   text,
  "paystackStatus" text,
  "failureReason"  text,
  "initiatedAt"    timestamptz,
  "paidAt"         timestamptz,
  "settledAt"      timestamptz,
  "lastEvent"      text,
  "lastEventAt"    timestamptz,
  "createdAt"      timestamptz not null default now(),
  "updatedAt"      timestamptz not null default now()
);

create index if not exists "RiderPayout_riderId_createdAt_idx"
  on public."RiderPayout" ("riderId", "createdAt" desc);
create index if not exists "RiderPayout_status_updatedAt_idx"
  on public."RiderPayout" ("status", "updatedAt");
-- At most one in-flight payout per rider.
create unique index if not exists "RiderPayout_one_processing_per_rider_idx"
  on public."RiderPayout" ("riderId") where "status" = 'processing';

create table if not exists public."RiderEarning" (
  "id"                     text primary key default (gen_random_uuid())::text,
  -- One earning per order, ever: the idempotency key for the trigger.
  "orderId"                text not null unique,
  "riderId"                text not null,
  "restaurantId"           text,
  "deliveryPay"            numeric(12, 2) not null default 0 check ("deliveryPay" >= 0),
  "tipAmount"              numeric(12, 2) not null default 0 check ("tipAmount" >= 0),
  "amount"                 numeric(12, 2) generated always as ("deliveryPay" + "tipAmount") stored,
  "currency"               text not null default 'NGN',
  "status"                 text not null default 'pending'
                           check ("status" in ('pending', 'processing', 'paid')),
  "payoutId"               text references public."RiderPayout" ("id"),
  "deliveredAt"            timestamptz,
  "deliveryCodeVerifiedAt" timestamptz not null,
  "createdAt"              timestamptz not null default now(),
  "updatedAt"              timestamptz not null default now(),
  -- An earning is attached to a payout exactly while it is processing or paid.
  constraint "RiderEarning_payout_matches_status"
    check (("status" = 'pending') = ("payoutId" is null))
);

create index if not exists "RiderEarning_riderId_status_idx"
  on public."RiderEarning" ("riderId", "status", "deliveredAt");
create index if not exists "RiderEarning_payoutId_idx"
  on public."RiderEarning" ("payoutId");

alter table public."RiderPayoutRecipient" enable row level security;
alter table public."RiderPayout" enable row level security;
alter table public."RiderEarning" enable row level security;

revoke all on table public."RiderPayoutRecipient" from public, anon, authenticated;
revoke all on table public."RiderPayout" from public, anon, authenticated;
revoke all on table public."RiderEarning" from public, anon, authenticated;
grant select, insert, update, delete on table public."RiderPayoutRecipient" to service_role;
grant select, insert, update, delete on table public."RiderPayout" to service_role;
grant select, insert, update, delete on table public."RiderEarning" to service_role;

-- ---------------------------------------------------------------------------
-- 3. Feature flag, seeded OFF. Nothing transfers money until an admin turns
--    this on (admin web -> feature flags).
-- ---------------------------------------------------------------------------
insert into public."FeatureFlag" ("key", "enabled", "description", "updatedAt")
values (
  'rider_auto_payouts',
  false,
  'Automatic Paystack transfers of FEASTY rider earnings (delivery pay + tips). Leave OFF until Transfers are enabled, transfer OTP is disabled and the balance is funded.',
  now()
)
on conflict ("key") do nothing;

-- ---------------------------------------------------------------------------
-- 4. Alert helper. Never raises: an alert is a signal, not a gate.
-- ---------------------------------------------------------------------------
create or replace function public.ebuy_rider_pay_alert(
  p_dedupe_key text,
  p_alert_type text,
  p_severity text,
  p_subject_type text,
  p_subject_id text,
  p_title text,
  p_details text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public."OperationalAlert" (
    "dedupeKey", "alertType", "severity", "subjectType", "subjectId", "title", "details", "metadata"
  ) values (
    p_dedupe_key, p_alert_type, p_severity, p_subject_type, p_subject_id, p_title, p_details,
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict ("dedupeKey") do update set
    "details" = excluded."details",
    "metadata" = excluded."metadata",
    "updatedAt" = now();
exception
  when others then
    raise warning 'rider pay alert % not recorded: %', p_dedupe_key, sqlerrm;
end;
$$;

revoke all on function public.ebuy_rider_pay_alert(text, text, text, text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.ebuy_rider_pay_alert(text, text, text, text, text, text, text, jsonb)
  to service_role;

-- ---------------------------------------------------------------------------
-- 5. Earning on verified delivery.
--
-- Fires on the transition into "delivered with a verified handoff code"
-- (status and deliveryCodeVerifiedAt land in ONE update in dispatch.ts, but
-- either order of writes is handled). Creates an earning ONLY when:
--   * the order was paid under platform delivery (pricing.deliveryProvider),
--   * it is a delivery order whose payment.status is 'paid',
--   * the assigned courier is a FEASTY platform rider (global pool),
--   * deliveryCodeVerifiedAt is set (proof of delivery).
-- `on conflict ("orderId") do nothing` makes reruns (delivered -> other ->
-- delivered) a no-op and never touches an earning already being paid.
-- Anything that SHOULD have earned but cannot (admin override with no code,
-- unpaid, non-platform courier, error) raises an OperationalAlert for manual
-- review instead of silently paying or silently dropping.
-- The whole body is exception-guarded: a rider must never be unable to
-- complete a delivery because the ledger write failed.
-- ---------------------------------------------------------------------------
create or replace function public.ebuy_record_rider_earning_on_delivery()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_courier_id text;
  v_is_platform_rider boolean;
  v_delivery_pay numeric(12, 2);
  v_tip numeric(12, 2);
  v_delivered_at timestamptz;
  v_numeric constant text := '^[[:space:]]*[0-9]+(\.[0-9]+)?[[:space:]]*$';
begin
  if coalesce(new."status", '') <> 'delivered' then
    return new;
  end if;
  if coalesce(new."pricing"->>'deliveryProvider', '') <> 'platform' then
    return new;
  end if;
  -- Already handled: was delivered-and-verified before this update.
  if coalesce(old."status", '') = 'delivered' and old."deliveryCodeVerifiedAt" is not null then
    return new;
  end if;

  begin
    if new."deliveryCodeVerifiedAt" is null then
      -- Only alert on the transition into delivered, not on later edits.
      if coalesce(old."status", '') <> 'delivered' then
        perform public.ebuy_rider_pay_alert(
          'ops:rider_earning_unverified:' || new."id",
          'rider_earning_needs_review', 'medium', 'order', new."id",
          'Platform delivery completed without a verified code',
          'Order ' || new."id" || ' was marked delivered without the customer handoff code (admin override?). No rider earning was created; review and pay the rider manually if appropriate.',
          jsonb_build_object('reason', 'delivery_code_not_verified')
        );
      end if;
      return new;
    end if;

    if coalesce(new."fulfillmentType", 'delivery') <> 'delivery' then
      return new;
    end if;

    select da."courierId" into v_courier_id
      from public."DeliveryAssignment" da
     where da."orderId" = new."id"
     limit 1;

    if v_courier_id is null or btrim(v_courier_id) = '' then
      perform public.ebuy_rider_pay_alert(
        'ops:rider_earning_no_courier:' || new."id",
        'rider_earning_needs_review', 'medium', 'order', new."id",
        'Platform delivery has no assigned courier',
        'Order ' || new."id" || ' was delivered with a verified code but has no DeliveryAssignment courier. No rider earning was created.',
        jsonb_build_object('reason', 'no_courier')
      );
      return new;
    end if;

    if coalesce(new."payment"->>'status', '') <> 'paid' then
      perform public.ebuy_rider_pay_alert(
        'ops:rider_earning_unpaid_order:' || new."id",
        'rider_earning_needs_review', 'high', 'order', new."id",
        'Platform delivery on an order that is not paid',
        'Order ' || new."id" || ' was delivered by rider ' || v_courier_id || ' but its payment status is ' || coalesce(new."payment"->>'status', 'missing') || '. No rider earning was created.',
        jsonb_build_object('reason', 'order_not_paid', 'riderId', v_courier_id)
      );
      return new;
    end if;

    select exists (
      select 1 from public."UserRole" ur
       where ur."userId" = v_courier_id
         and ur."role"::text = 'dispatch'
         and ur."restaurantId" is null
    ) into v_is_platform_rider;

    if not v_is_platform_rider then
      perform public.ebuy_rider_pay_alert(
        'ops:rider_earning_not_platform_rider:' || new."id",
        'rider_earning_needs_review', 'high', 'order', new."id",
        'Platform-paid order delivered by a non-FEASTY rider',
        'Order ' || new."id" || ' kept its delivery fee with FEASTY but was delivered by ' || v_courier_id || ', who is not a FEASTY platform rider. No rider earning was created; the fee may be owed to the restaurant.',
        jsonb_build_object('reason', 'courier_not_platform_rider', 'courierId', v_courier_id)
      );
      return new;
    end if;

    -- Same source and precedence as CourierEarning: dispatchFee, then
    -- deliveryFee, then 0. Non-negative numbers only.
    v_delivery_pay := coalesce(
      (case when (new."pricing"->>'dispatchFee') ~ v_numeric then (new."pricing"->>'dispatchFee')::numeric end),
      (case when (new."pricing"->>'deliveryFee') ~ v_numeric then (new."pricing"->>'deliveryFee')::numeric end),
      0
    );
    v_tip := coalesce(
      (case when (new."pricing"->>'tip') ~ v_numeric then (new."pricing"->>'tip')::numeric end),
      0
    );

    begin
      v_delivered_at := nullif(btrim(coalesce(new."timeline"->>'deliveredAt', '')), '')::timestamptz;
    exception
      when others then
        v_delivered_at := null;
    end;
    v_delivered_at := coalesce(v_delivered_at, new."deliveryCodeVerifiedAt", now());

    insert into public."RiderEarning" (
      "orderId", "riderId", "restaurantId", "deliveryPay", "tipAmount", "currency",
      "status", "deliveredAt", "deliveryCodeVerifiedAt"
    ) values (
      new."id", v_courier_id, new."restaurantId", round(v_delivery_pay, 2), round(v_tip, 2),
      coalesce(nullif(btrim(coalesce(new."pricing"->>'currency', '')), ''), 'NGN'),
      'pending', v_delivered_at, new."deliveryCodeVerifiedAt"
    )
    on conflict ("orderId") do nothing;
  exception
    when others then
      raise warning 'rider earning not recorded for order %: %', new."id", sqlerrm;
      perform public.ebuy_rider_pay_alert(
        'ops:rider_earning_failed:' || new."id",
        'rider_earning_needs_review', 'high', 'order', new."id",
        'Rider earning could not be recorded',
        'Recording the rider earning for order ' || new."id" || ' failed: ' || sqlerrm || '. Create it manually.',
        jsonb_build_object('reason', 'insert_failed')
      );
  end;

  return new;
end;
$$;

revoke all on function public.ebuy_record_rider_earning_on_delivery() from public, anon, authenticated;

drop trigger if exists "RiderEarning_on_verified_delivery" on public."CustomerOrder";
create trigger "RiderEarning_on_verified_delivery"
  after update of "status", "deliveryCodeVerifiedAt" on public."CustomerOrder"
  for each row
  execute function public.ebuy_record_rider_earning_on_delivery();

-- ---------------------------------------------------------------------------
-- 6. Create a payout: the authority on never-double-pay and on the caps.
--
-- The edge function PLANS a batch (riderPayouts.ts, unit-tested); this
-- function re-validates every hard invariant under locks and either creates
-- the payout atomically or refuses with a reason. Serialized platform-wide by
-- an advisory xact lock because the daily caps are read-then-write.
--
-- Eligibility it enforces beyond the caps:
--   * CLEARING DELAY: every earning must have been delivered more than
--     p_clearing_days ago, so card chargebacks/refunds surface before the
--     rider is paid. An earning with no deliveredAt never clears.
--   * the rider is approved (DispatchRiderRecord.verificationStatus) and not
--     suspended (UserAccount.accountDisabled);
--   * neither recipient hold is live (failure hold, bank-change hold).
-- ---------------------------------------------------------------------------
create or replace function public.ebuy_create_rider_payout(
  p_payout_id text,
  p_rider_id text,
  p_earning_ids text[],
  p_amount numeric,
  p_min_payout numeric,
  p_max_per_transfer numeric,
  p_max_per_rider_day numeric,
  p_max_platform_day numeric,
  p_clearing_days integer,
  p_bank_change_hold_hours integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_recipient public."RiderPayoutRecipient"%rowtype;
  v_requested integer;
  v_locked integer;
  v_sum numeric(12, 2);
  v_day_start timestamptz := date_trunc('day', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos';
  v_rider_today numeric(12, 2);
  v_platform_today numeric(12, 2);
  v_reference text;
  v_uncleared integer;
begin
  perform pg_advisory_xact_lock(hashtext('ebuy_rider_payouts'));

  if p_payout_id is null or p_payout_id !~ '^[0-9a-f]{32}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payout_id');
  end if;
  if p_min_payout is null or p_max_per_transfer is null or p_max_per_rider_day is null or p_max_platform_day is null
     or p_min_payout <= 0 or p_max_per_transfer <= 0 or p_max_per_rider_day <= 0 or p_max_platform_day <= 0
     or p_min_payout > p_max_per_transfer
     or p_clearing_days is null or p_clearing_days < 0
     or p_bank_change_hold_hours is null or p_bank_change_hold_hours < 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_caps');
  end if;

  select count(distinct x) into v_requested from unnest(coalesce(p_earning_ids, '{}'::text[])) as x;
  if v_requested = 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_earnings');
  end if;

  select * into v_recipient from public."RiderPayoutRecipient" where "riderId" = p_rider_id for update;
  if not found or v_recipient."verifiedAt" is null then
    return jsonb_build_object('ok', false, 'reason', 'no_verified_recipient');
  end if;
  if v_recipient."holdUntil" is not null and v_recipient."holdUntil" > now() then
    return jsonb_build_object('ok', false, 'reason', 'recipient_on_hold');
  end if;
  if v_recipient."bankChangedAt" is not null
     and v_recipient."bankChangedAt" + make_interval(hours => p_bank_change_hold_hours) > now() then
    return jsonb_build_object('ok', false, 'reason', 'recipient_on_hold');
  end if;

  if not exists (
    select 1 from public."DispatchRiderRecord" r
     where r."id" = p_rider_id and r."verificationStatus" = 'approved'
  ) or exists (
    select 1 from public."UserAccount" a
     where a."uid" = p_rider_id and coalesce(a."accountDisabled", false)
  ) or not exists (
    select 1 from public."UserAccount" a where a."uid" = p_rider_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'rider_not_eligible');
  end if;

  if exists (
    select 1 from public."RiderPayout" where "riderId" = p_rider_id and "status" = 'processing'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'payout_in_flight');
  end if;

  select count(*),
         coalesce(sum(e."amount"), 0),
         count(*) filter (
           where e."deliveredAt" is null
              or e."deliveredAt" >= now() - make_interval(days => p_clearing_days)
         )
    into v_locked, v_sum, v_uncleared
    from (
      select "amount", "deliveredAt" from public."RiderEarning"
       where "id" = any(p_earning_ids)
         and "riderId" = p_rider_id
         and "status" = 'pending'
         and "payoutId" is null
       for update
    ) as e;

  if v_locked <> v_requested then
    return jsonb_build_object('ok', false, 'reason', 'earnings_changed');
  end if;
  if v_uncleared > 0 then
    return jsonb_build_object('ok', false, 'reason', 'earnings_not_cleared');
  end if;
  if v_sum <> round(p_amount, 2) then
    return jsonb_build_object('ok', false, 'reason', 'amount_mismatch', 'amount', v_sum);
  end if;
  if v_sum < p_min_payout then
    return jsonb_build_object('ok', false, 'reason', 'below_minimum', 'amount', v_sum);
  end if;
  if v_sum > p_max_per_transfer then
    return jsonb_build_object('ok', false, 'reason', 'over_transfer_cap', 'amount', v_sum);
  end if;

  -- Money that left or may still leave today: processing + paid. A failed or
  -- reversed payout returned its earnings and does not count.
  select coalesce(sum("amount"), 0) into v_rider_today
    from public."RiderPayout"
   where "riderId" = p_rider_id and "status" in ('processing', 'paid') and "createdAt" >= v_day_start;
  if v_rider_today + v_sum > p_max_per_rider_day then
    return jsonb_build_object('ok', false, 'reason', 'over_rider_daily_cap', 'amount', v_sum);
  end if;

  select coalesce(sum("amount"), 0) into v_platform_today
    from public."RiderPayout"
   where "status" in ('processing', 'paid') and "createdAt" >= v_day_start;
  if v_platform_today + v_sum > p_max_platform_day then
    return jsonb_build_object('ok', false, 'reason', 'over_platform_daily_cap', 'amount', v_sum);
  end if;

  v_reference := 'feasty_rp_' || p_payout_id;

  insert into public."RiderPayout" (
    "id", "riderId", "amount", "currency", "reference", "recipientCode", "status", "earningCount"
  ) values (
    p_payout_id, p_rider_id, v_sum, 'NGN', v_reference, v_recipient."recipientCode", 'processing', v_locked
  );

  update public."RiderEarning"
     set "status" = 'processing', "payoutId" = p_payout_id, "updatedAt" = now()
   where "id" = any(p_earning_ids);

  return jsonb_build_object(
    'ok', true,
    'payoutId', p_payout_id,
    'reference', v_reference,
    'recipientCode', v_recipient."recipientCode",
    'amount', v_sum
  );
end;
$$;

revoke all on function public.ebuy_create_rider_payout(text, text, text[], numeric, numeric, numeric, numeric, numeric, integer, integer)
  from public, anon, authenticated;
grant execute on function public.ebuy_create_rider_payout(text, text, text[], numeric, numeric, numeric, numeric, numeric, integer, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- 7. Settle a payout from a Paystack outcome (webhook, reconcile, or an
--    immediate initiation answer). Idempotent: a repeated or out-of-order
--    event is a no-op or a reported anomaly, never a second state change.
--
--   outcome   from processing        from paid               from failed/reversed
--   success   -> paid (+earnings)    no-op                   ANOMALY, no change
--   failed    -> failed (release)    ANOMALY, no change      no-op
--   reversed  -> reversed (release)  -> reversed (release)   no-op
--
-- "release" = the payout's earnings go back to pending (payoutId null) so the
-- next run can pay them; p_hold_recipient additionally puts the rider's
-- recipient on indefinite hold so they are not retried into a bad account.
-- An amount that disagrees with the payout is an anomaly and changes nothing.
-- ---------------------------------------------------------------------------
create or replace function public.ebuy_settle_rider_payout(
  p_reference text,
  p_outcome text,
  p_transfer_code text,
  p_amount_kobo bigint,
  p_reason text,
  p_hold_recipient boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payout public."RiderPayout"%rowtype;
  v_previous text;
  v_released integer := 0;
begin
  if p_outcome not in ('success', 'failed', 'reversed') then
    return jsonb_build_object('matched', false, 'changed', false, 'reason', 'invalid_outcome');
  end if;

  select * into v_payout from public."RiderPayout" where "reference" = p_reference for update;
  if not found then
    return jsonb_build_object('matched', false, 'changed', false);
  end if;
  v_previous := v_payout."status";

  update public."RiderPayout"
     set "lastEvent" = p_outcome,
         "lastEventAt" = now(),
         "transferCode" = coalesce("transferCode", nullif(btrim(coalesce(p_transfer_code, '')), '')),
         "updatedAt" = now()
   where "id" = v_payout."id";

  if p_amount_kobo is not null and p_amount_kobo <> round(v_payout."amount" * 100)::bigint then
    return jsonb_build_object(
      'matched', true, 'changed', false, 'previousStatus', v_previous, 'status', v_previous,
      'anomaly', 'amount_mismatch', 'payoutId', v_payout."id", 'riderId', v_payout."riderId"
    );
  end if;

  if p_outcome = 'success' then
    if v_previous = 'paid' then
      return jsonb_build_object('matched', true, 'changed', false, 'previousStatus', v_previous, 'status', 'paid',
        'payoutId', v_payout."id", 'riderId', v_payout."riderId");
    elsif v_previous = 'processing' then
      update public."RiderPayout"
         set "status" = 'paid', "paidAt" = now(), "settledAt" = now(), "paystackStatus" = 'success', "updatedAt" = now()
       where "id" = v_payout."id";
      update public."RiderEarning"
         set "status" = 'paid', "updatedAt" = now()
       where "payoutId" = v_payout."id";
      return jsonb_build_object('matched', true, 'changed', true, 'previousStatus', v_previous, 'status', 'paid',
        'payoutId', v_payout."id", 'riderId', v_payout."riderId");
    else
      return jsonb_build_object('matched', true, 'changed', false, 'previousStatus', v_previous, 'status', v_previous,
        'anomaly', 'success_after_release', 'payoutId', v_payout."id", 'riderId', v_payout."riderId");
    end if;
  end if;

  if p_outcome = 'failed' then
    if v_previous in ('failed', 'reversed') then
      return jsonb_build_object('matched', true, 'changed', false, 'previousStatus', v_previous, 'status', v_previous,
        'payoutId', v_payout."id", 'riderId', v_payout."riderId");
    elsif v_previous = 'paid' then
      return jsonb_build_object('matched', true, 'changed', false, 'previousStatus', v_previous, 'status', v_previous,
        'anomaly', 'failed_after_paid', 'payoutId', v_payout."id", 'riderId', v_payout."riderId");
    end if;
  end if;

  if p_outcome = 'reversed' and v_previous in ('failed', 'reversed') then
    return jsonb_build_object('matched', true, 'changed', false, 'previousStatus', v_previous, 'status', v_previous,
      'payoutId', v_payout."id", 'riderId', v_payout."riderId");
  end if;

  -- failed from processing, or reversed from processing/paid: release.
  update public."RiderPayout"
     set "status" = p_outcome,
         "failureReason" = left(coalesce(nullif(btrim(coalesce(p_reason, '')), ''), p_outcome), 500),
         "paystackStatus" = p_outcome,
         "settledAt" = now(),
         "updatedAt" = now()
   where "id" = v_payout."id";

  update public."RiderEarning"
     set "status" = 'pending', "payoutId" = null, "updatedAt" = now()
   where "payoutId" = v_payout."id";
  get diagnostics v_released = row_count;

  if coalesce(p_hold_recipient, false) then
    update public."RiderPayoutRecipient"
       set "holdUntil" = 'infinity'::timestamptz,
           "holdReason" = 'transfer_' || p_outcome,
           "updatedAt" = now()
     where "riderId" = v_payout."riderId";
  end if;

  return jsonb_build_object('matched', true, 'changed', true, 'previousStatus', v_previous, 'status', p_outcome,
    'released', v_released, 'payoutId', v_payout."id", 'riderId', v_payout."riderId");
end;
$$;

revoke all on function public.ebuy_settle_rider_payout(text, text, text, bigint, text, boolean)
  from public, anon, authenticated;
grant execute on function public.ebuy_settle_rider_payout(text, text, text, bigint, text, boolean)
  to service_role;

-- ---------------------------------------------------------------------------
-- 8. Run lease: at most one payout run at a time.
--
-- Two overlapping runs (a slow run still going when the next cron tick or a
-- manual invocation starts) could both pick the same stale 'processing'
-- payout in reconcile and both re-send it. Paystack's reference uniqueness
-- should refuse the second, but the platform should not rely on that alone.
--
-- Why a lease row and not pg_try_advisory_lock: a run is many separate
-- PostgREST calls, each possibly on a different pooled connection. A
-- transaction-scoped advisory lock ends with the first call, and a
-- session-scoped one would stay held by whichever pooled connection took it
-- (and could only be released from that same connection). The lease below is
-- acquired atomically in one statement and expires on its own if a run dies
-- without releasing it.
-- ---------------------------------------------------------------------------
create table if not exists public."RiderPayoutRunLease" (
  "id"          text primary key default 'rider-payouts',
  "holder"      text not null,
  "lockedUntil" timestamptz not null,
  "updatedAt"   timestamptz not null default now(),
  constraint "RiderPayoutRunLease_singleton" check ("id" = 'rider-payouts')
);

alter table public."RiderPayoutRunLease" enable row level security;
revoke all on table public."RiderPayoutRunLease" from public, anon, authenticated;
grant select, insert, update, delete on table public."RiderPayoutRunLease" to service_role;

create or replace function public.ebuy_acquire_rider_payout_lease(p_holder text, p_ttl_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_acquired text;
begin
  if p_holder is null or btrim(p_holder) = '' or p_ttl_seconds is null or p_ttl_seconds < 1 or p_ttl_seconds > 3600 then
    return false;
  end if;

  insert into public."RiderPayoutRunLease" ("id", "holder", "lockedUntil", "updatedAt")
  values ('rider-payouts', p_holder, now() + make_interval(secs => p_ttl_seconds), now())
  on conflict ("id") do update set
    "holder" = excluded."holder",
    "lockedUntil" = excluded."lockedUntil",
    "updatedAt" = now()
  where public."RiderPayoutRunLease"."lockedUntil" <= now()
     or public."RiderPayoutRunLease"."holder" = excluded."holder"
  returning "holder" into v_acquired;

  return v_acquired is not null;
end;
$$;

create or replace function public.ebuy_release_rider_payout_lease(p_holder text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public."RiderPayoutRunLease"
     set "lockedUntil" = now(), "updatedAt" = now()
   where "id" = 'rider-payouts' and "holder" = p_holder;
$$;

revoke all on function public.ebuy_acquire_rider_payout_lease(text, integer) from public, anon, authenticated;
grant execute on function public.ebuy_acquire_rider_payout_lease(text, integer) to service_role;
revoke all on function public.ebuy_release_rider_payout_lease(text) from public, anon, authenticated;
grant execute on function public.ebuy_release_rider_payout_lease(text) to service_role;

notify pgrst, 'reload schema';


-- ===== 20261022_fn_warmer.sql =====

-- Keep the hot domain Edge Functions warm so a Nigeria-to-Frankfurt sign-in
-- does not pay a cold start. Every 5 minutes, pg_cron + pg_net send a cheap
-- GET to each function. serveRpcFunction (and public-catalog) answer a non-POST
-- with HTTP 405 BEFORE authenticating and WITHOUT touching the database, so the
-- ping warms the isolate without doing real work, needing a JWT, or writing
-- anything. Only the project_url Vault secret is required (no worker token).
--
-- Budget: 4 functions x 12 pings/hour x 24h x ~31 days ~= 35.7K invocations/mo,
-- a small slice of the 500K/mo Free-tier budget, and well clear of it alongside
-- the queue-drainer/broadcast-runner crons.
--
-- Additive and exception-guarded: it applies cleanly even where pg_cron/pg_net/
-- supabase_vault are unavailable, and stays dormant until project_url exists
-- (the cron body's WHERE clause then matches no rows and sends nothing).

do $ext$
begin
  create extension if not exists pg_cron;
  create extension if not exists pg_net;
  create extension if not exists supabase_vault;
exception
  when others then
    raise notice 'fn-warmer: prerequisite extension unavailable (%), skipping cron schedule', sqlerrm;
end
$ext$;

do $sched$
begin
  perform cron.schedule(
    'fn-warmer-every-5-min',
    '*/5 * * * *',
    $cron$
      with credentials as (
        select
          (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') as project_url
      )
      select net.http_get(
        url := credentials.project_url || '/functions/v1/' || warm_target.fn,
        timeout_milliseconds := 4000
      ) as request_id
      from credentials
      cross join (
        values ('feasty-account'), ('feasty-orders'), ('app-rpc'), ('public-catalog')
      ) as warm_target(fn)
      where credentials.project_url is not null;
    $cron$
  );
exception
  when others then
    raise notice 'fn-warmer: could not schedule cron (%), skipping', sqlerrm;
end
$sched$;


-- ============================================================================
-- RUN SEPARATELY, in its own query, AFTER the above succeeds (not in a txn):
--   VACUUM FULL net."_http_response";
-- Then push main. POST-DEPLOY (after rider-payouts fn is live): apply
--   supabase/migrations/20261020b_rider_payouts_schedule.sql
-- ============================================================================

