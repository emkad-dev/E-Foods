-- SUPERSEDED - DO NOT APPLY. Audited 2026-09-10 against production.
--
-- This creates a 'restaurant-kyc' bucket that NO code references. The KYC
-- upload path (_shared/partnerOnboarding.ts, PARTNER_VERIFICATION_BUCKET) uses
-- 'partner-verification-documents', created by
-- 20260807_partner_onboarding_single_flow_kyc_bank_subaccount.sql, which IS
-- applied. Applying this would leave an empty orphan bucket and nothing else.
--
-- Kept rather than deleted so the history of the decision survives; skipped
-- deliberately in the production rollout.

-- Identity documents must never sit in the public restaurant asset bucket.
-- public = false means no anon/authenticated read path exists at all; the only
-- way to read an object is the service-role key or a signed URL minted by a
-- service-role caller. Deliberately NO storage.objects policies are created:
-- absent policies mean absent client access, which is the posture we want.
INSERT INTO storage.buckets (id, name, public)
VALUES ('restaurant-kyc', 'restaurant-kyc', false)
ON CONFLICT (id) DO UPDATE SET public = false;
