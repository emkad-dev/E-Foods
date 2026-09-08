-- Data API enforcement for the deletion grace period.
--
-- The edge-function gate (getAuthenticatedRequestContext) does not cover
-- PostgREST. The apps read and write UserAccount directly, and its UPDATE
-- policy is self-access with no column restriction, so without this a
-- pending-deletion user could clear their own deletionRequestedAt.

-- Does the CALLING user's own account have a deletion pending?
-- security definer so a policy on another table can consult UserAccount
-- without depending on UserAccount's own RLS.
create or replace function public.ebuy_account_pending_deletion()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public."UserAccount"
    where uid = (auth.uid())::text
      and "deletionRequestedAt" is not null
  );
$$;

revoke all on function public.ebuy_account_pending_deletion() from public;
grant execute on function public.ebuy_account_pending_deletion() to authenticated;

-- Full replacement of the existing guard. Everything before the deletion
-- columns is carried over verbatim from 20260613_useraccount_sensitive_update_guard.
create or replace function public.ebuy_guard_useraccount_sensitive_update()
returns trigger
language plpgsql
as $$
BEGIN
  IF COALESCE(auth.role(), '') = 'service_role'
     OR COALESCE(auth.jwt()->'app_metadata'->>'user_role', auth.jwt()->>'user_role') = 'admin' THEN
    RETURN NEW;
  END IF;

  -- While a deletion is pending, the row is frozen to its owner entirely.
  -- Checked before the column list so no self-write slips through.
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
$$;

-- The other three client-writable tables. Admins stay unaffected; only the
-- self-service branch gains the condition.
alter policy "UserRole self insert customer or admin"
  on public."UserRole"
  with check (
    (
      "userId" = (auth.uid())::text
      and role = 'customer'::"AppRole"
      and "assignedByUid" is null
      and not public.ebuy_account_pending_deletion()
    )
    or coalesce(
      (auth.jwt() -> 'app_metadata') ->> 'user_role',
      auth.jwt() ->> 'user_role'
    ) = 'admin'
  );

alter policy "Users can create their own policy acceptances"
  on public."UserPolicyAcceptance"
  with check (
    "userId" = (auth.uid())::text
    and not public.ebuy_account_pending_deletion()
  );

alter policy "Customers can add their own favorites"
  on public."CustomerFavoriteRestaurant"
  with check (
    "customerId" = (auth.uid())::text
    and not public.ebuy_account_pending_deletion()
  );

alter policy "Customers can update their own favorites"
  on public."CustomerFavoriteRestaurant"
  using (
    "customerId" = (auth.uid())::text
    and not public.ebuy_account_pending_deletion()
  )
  with check (
    "customerId" = (auth.uid())::text
    and not public.ebuy_account_pending_deletion()
  );

alter policy "Customers can delete their own favorites"
  on public."CustomerFavoriteRestaurant"
  using (
    "customerId" = (auth.uid())::text
    and not public.ebuy_account_pending_deletion()
  );
