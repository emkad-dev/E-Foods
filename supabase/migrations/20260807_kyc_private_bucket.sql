-- Identity documents must never sit in the public restaurant asset bucket.
-- public = false means no anon/authenticated read path exists at all; the only
-- way to read an object is the service-role key or a signed URL minted by a
-- service-role caller. Deliberately NO storage.objects policies are created:
-- absent policies mean absent client access, which is the posture we want.
INSERT INTO storage.buckets (id, name, public)
VALUES ('restaurant-kyc', 'restaurant-kyc', false)
ON CONFLICT (id) DO UPDATE SET public = false;
