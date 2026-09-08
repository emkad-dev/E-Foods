-- RestaurantKyc gained two columns the 2026-08-07 onboarding spec requires:
-- documentType, so a partner can present a Tax ID instead of a NIN, and
-- status, so review outcome lives on the KYC row rather than being inferred
-- from the application. Existing rows are all manually-reviewed NINs, so the
-- defaults backfill them correctly without a data migration.
ALTER TABLE "public"."RestaurantKyc"
  ADD COLUMN IF NOT EXISTS "documentType" TEXT NOT NULL DEFAULT 'nin',
  ADD COLUMN IF NOT EXISTS "status"       TEXT NOT NULL DEFAULT 'pending';

ALTER TABLE "public"."RestaurantKyc"
  DROP CONSTRAINT IF EXISTS "RestaurantKyc_documentType_check";
ALTER TABLE "public"."RestaurantKyc"
  ADD CONSTRAINT "RestaurantKyc_documentType_check"
  CHECK ("documentType" IN ('nin', 'tax_id'));

ALTER TABLE "public"."RestaurantKyc"
  DROP CONSTRAINT IF EXISTS "RestaurantKyc_status_check";
ALTER TABLE "public"."RestaurantKyc"
  ADD CONSTRAINT "RestaurantKyc_status_check"
  CHECK ("status" IN ('pending', 'verified', 'rejected'));
