-- Partner onboarding stage 2 foundation.
--
-- Stage 1 already created RestaurantKyc and RestaurantPayout. This migration
-- adds the private verification storage bucket and the generic document columns
-- that the single-flow onboarding wizard needs.

ALTER TABLE "public"."RestaurantKyc"
  ADD COLUMN IF NOT EXISTS "documentType" TEXT NOT NULL DEFAULT 'nin',
  ADD COLUMN IF NOT EXISTS "documentNumberHash" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "documentLast4" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "documentFrontPath" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "documentBackPath" TEXT NOT NULL DEFAULT '';

UPDATE "public"."RestaurantKyc"
SET
  "documentType" = COALESCE(NULLIF("documentType", ''), 'nin'),
  "documentNumberHash" = COALESCE(NULLIF("documentNumberHash", ''), COALESCE("ninHash", '')),
  "documentLast4" = COALESCE(NULLIF("documentLast4", ''), COALESCE("ninLast4", '')),
  "documentFrontPath" = COALESCE(NULLIF("documentFrontPath", ''), COALESCE("ninFrontPath", '')),
  "documentBackPath" = COALESCE(NULLIF("documentBackPath", ''), COALESCE("ninBackPath", ''))
WHERE
  "documentNumberHash" = ''
  OR "documentLast4" = ''
  OR "documentFrontPath" = ''
  OR "documentBackPath" = '';

INSERT INTO "storage"."buckets" ("id", "name", "public", "file_size_limit", "allowed_mime_types")
VALUES (
  'partner-verification-documents',
  'partner-verification-documents',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'application/pdf']
)
ON CONFLICT ("id") DO UPDATE
SET
  "public" = EXCLUDED."public",
  "file_size_limit" = EXCLUDED."file_size_limit",
  "allowed_mime_types" = EXCLUDED."allowed_mime_types";
