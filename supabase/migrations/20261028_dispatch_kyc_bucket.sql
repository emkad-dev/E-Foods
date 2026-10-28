-- The dispatch-kyc storage bucket the rider onboarding submit flow has always
-- written to (uploadDispatchDocument, _shared/courierSupply.ts,
-- DISPATCH_DOCUMENT_BUCKET = 'dispatch-kyc') was never actually created. Every
-- real submitDispatchApplication call has been failing with Supabase's
-- "Bucket not found" the entire time this flow has existed -- no rider could
-- ever successfully submit, regardless of any other validation passing.
--
-- Private, matching the partner-verification-documents pattern
-- (20260807_partner_onboarding_single_flow_kyc_bank_subaccount.sql): a licence
-- photo is identity-adjacent KYC material, so no storage.objects policies are
-- created here either -- absent policies mean the only read/write path is the
-- service-role key or a signed URL it mints, same posture as partner's bucket.
--
-- Limits mirror assertUploadAllowed / DISPATCH_DOCUMENT_MAX_BYTES in
-- _shared/rateLimit.ts and _shared/courierSupply.ts: image only (no PDF --
-- dispatch never accepted one), 5 MB cap.
INSERT INTO "storage"."buckets" ("id", "name", "public", "file_size_limit", "allowed_mime_types")
VALUES (
  'dispatch-kyc',
  'dispatch-kyc',
  false,
  5000000,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT ("id") DO UPDATE
SET
  "public" = EXCLUDED."public",
  "file_size_limit" = EXCLUDED."file_size_limit",
  "allowed_mime_types" = EXCLUDED."allowed_mime_types";
