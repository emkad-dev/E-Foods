CREATE OR REPLACE FUNCTION "public"."ebuy_guard_useraccount_sensitive_update"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(auth.role(), '') = 'service_role'
     OR COALESCE(auth.jwt()->'app_metadata'->>'user_role', auth.jwt()->>'user_role') = 'admin' THEN
    RETURN NEW;
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
     OR NEW."emailVerified" IS DISTINCT FROM OLD."emailVerified" THEN
    RAISE EXCEPTION 'direct updates to sensitive UserAccount fields are not allowed';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "ebuy_useraccount_sensitive_update_guard" ON "public"."UserAccount";
CREATE TRIGGER "ebuy_useraccount_sensitive_update_guard"
BEFORE UPDATE ON "public"."UserAccount"
FOR EACH ROW
EXECUTE FUNCTION "public"."ebuy_guard_useraccount_sensitive_update"();
