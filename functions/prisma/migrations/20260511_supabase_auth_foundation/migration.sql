ALTER TABLE "public"."UserAccount"
  ADD COLUMN IF NOT EXISTS "phoneNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "photoURL" TEXT,
  ADD COLUMN IF NOT EXISTS "partnerApplicationStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "partnerApplicationReviewedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "partnerApplicationRejectionReason" TEXT,
  ADD COLUMN IF NOT EXISTS "dispatchApplicationStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "dispatchApplicationReviewedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "dispatchApplicationRejectionReason" TEXT,
  ADD COLUMN IF NOT EXISTS "expoPushToken" TEXT,
  ADD COLUMN IF NOT EXISTS "pushTokenUpdatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "accountDisabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "disabledAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "disabledByUid" TEXT,
  ADD COLUMN IF NOT EXISTS "lastPrivilegedRole" "public"."AppRole";

ALTER TABLE "public"."UserAccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."UserRole" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "UserAccount self read or admin" ON "public"."UserAccount";
CREATE POLICY "UserAccount self read or admin"
  ON "public"."UserAccount"
  FOR SELECT
  TO authenticated
  USING (
    "uid" = auth.uid()::text
    OR COALESCE(auth.jwt()->'app_metadata'->>'user_role', auth.jwt()->>'user_role') = 'admin'
  );

DROP POLICY IF EXISTS "UserAccount self update or admin" ON "public"."UserAccount";
CREATE POLICY "UserAccount self update or admin"
  ON "public"."UserAccount"
  FOR UPDATE
  TO authenticated
  USING (
    "uid" = auth.uid()::text
    OR COALESCE(auth.jwt()->'app_metadata'->>'user_role', auth.jwt()->>'user_role') = 'admin'
  )
  WITH CHECK (
    "uid" = auth.uid()::text
    OR COALESCE(auth.jwt()->'app_metadata'->>'user_role', auth.jwt()->>'user_role') = 'admin'
  );

DROP POLICY IF EXISTS "UserAccount self insert or admin" ON "public"."UserAccount";
CREATE POLICY "UserAccount self insert or admin"
  ON "public"."UserAccount"
  FOR INSERT
  TO authenticated
  WITH CHECK (
    "uid" = auth.uid()::text
    OR COALESCE(auth.jwt()->'app_metadata'->>'user_role', auth.jwt()->>'user_role') = 'admin'
  );

DROP POLICY IF EXISTS "UserRole self read or admin" ON "public"."UserRole";
CREATE POLICY "UserRole self read or admin"
  ON "public"."UserRole"
  FOR SELECT
  TO authenticated
  USING (
    "userId" = auth.uid()::text
    OR COALESCE(auth.jwt()->'app_metadata'->>'user_role', auth.jwt()->>'user_role') = 'admin'
  );

DROP POLICY IF EXISTS "UserRole self insert customer or admin" ON "public"."UserRole";
CREATE POLICY "UserRole self insert customer or admin"
  ON "public"."UserRole"
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (
      "userId" = auth.uid()::text
      AND "role" = 'customer'
      AND "assignedByUid" IS NULL
    )
    OR COALESCE(auth.jwt()->'app_metadata'->>'user_role', auth.jwt()->>'user_role') = 'admin'
  );

GRANT SELECT, INSERT, UPDATE ON TABLE "public"."UserAccount" TO authenticated;
GRANT SELECT, INSERT ON TABLE "public"."UserRole" TO authenticated;

CREATE OR REPLACE FUNCTION "public"."ebuy_primary_role"(target_uid text)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (
      SELECT ur."role"::text
      FROM "public"."UserRole" ur
      WHERE ur."userId" = target_uid
      ORDER BY
        CASE ur."role"
          WHEN 'admin' THEN 1
          WHEN 'restaurant' THEN 2
          WHEN 'dispatch' THEN 3
          ELSE 4
        END,
        ur."updatedAt" DESC
      LIMIT 1
    ),
    'customer'
  );
$$;

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
  ua."updatedAt"
FROM "public"."UserAccount" ua;

GRANT SELECT ON "public"."user_profiles" TO authenticated;

CREATE OR REPLACE FUNCTION "public"."ebuy_custom_access_token_hook"(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  claims jsonb;
  next_role text;
BEGIN
  SELECT "public"."ebuy_primary_role"(event->>'user_id') INTO next_role;

  claims := COALESCE(event->'claims', '{}'::jsonb);
  claims := jsonb_set(claims, '{user_role}', to_jsonb(COALESCE(next_role, 'customer')), true);
  claims := jsonb_set(claims, '{app_role}', to_jsonb(COALESCE(next_role, 'customer')), true);

  RETURN jsonb_set(event, '{claims}', claims, true);
END;
$$;

GRANT USAGE ON SCHEMA "public" TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION "public"."ebuy_custom_access_token_hook"(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION "public"."ebuy_custom_access_token_hook"(jsonb) FROM authenticated, anon, public;
