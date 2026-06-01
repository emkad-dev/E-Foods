CREATE TABLE IF NOT EXISTS "public"."UserPolicyAcceptance" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "app" TEXT NOT NULL,
  "termsVersion" TEXT NOT NULL,
  "privacyVersion" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserPolicyAcceptance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserPolicyAcceptance_userId_app_termsVersion_privacyVersion_key"
  ON "public"."UserPolicyAcceptance"("userId", "app", "termsVersion", "privacyVersion");

CREATE INDEX IF NOT EXISTS "UserPolicyAcceptance_userId_idx"
  ON "public"."UserPolicyAcceptance"("userId");

CREATE INDEX IF NOT EXISTS "UserPolicyAcceptance_app_idx"
  ON "public"."UserPolicyAcceptance"("app");

CREATE INDEX IF NOT EXISTS "UserPolicyAcceptance_acceptedAt_idx"
  ON "public"."UserPolicyAcceptance"("acceptedAt");

ALTER TABLE "public"."UserPolicyAcceptance"
  DROP CONSTRAINT IF EXISTS "UserPolicyAcceptance_userId_fkey";

ALTER TABLE "public"."UserPolicyAcceptance"
  ADD CONSTRAINT "UserPolicyAcceptance_userId_fkey"
  FOREIGN KEY ("userId")
  REFERENCES "public"."UserAccount"("uid")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "public"."UserPolicyAcceptance" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own policy acceptances" ON "public"."UserPolicyAcceptance";
CREATE POLICY "Users can view their own policy acceptances"
  ON "public"."UserPolicyAcceptance"
  FOR SELECT
  TO authenticated
  USING ("userId" = auth.uid()::text);

DROP POLICY IF EXISTS "Users can create their own policy acceptances" ON "public"."UserPolicyAcceptance";
CREATE POLICY "Users can create their own policy acceptances"
  ON "public"."UserPolicyAcceptance"
  FOR INSERT
  TO authenticated
  WITH CHECK ("userId" = auth.uid()::text);
