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
