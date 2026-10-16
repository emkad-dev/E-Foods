-- CustomerOrder delivery proof-of-delivery code (dispatch SP-2).
-- Per-order 4-digit handoff code: generated at placement for delivery orders,
-- held by the customer, entered by the rider. Attempts are capped in the edge function.
--
-- Reverse with:
--   ALTER TABLE public."CustomerOrder" DROP COLUMN "deliveryCode",
--     DROP COLUMN "deliveryCodeVerifiedAt", DROP COLUMN "deliveryCodeAttempts";

ALTER TABLE public."CustomerOrder" ADD COLUMN IF NOT EXISTS "deliveryCode" text;
ALTER TABLE public."CustomerOrder" ADD COLUMN IF NOT EXISTS "deliveryCodeVerifiedAt" timestamptz;
ALTER TABLE public."CustomerOrder" ADD COLUMN IF NOT EXISTS "deliveryCodeAttempts" integer NOT NULL DEFAULT 0;

NOTIFY pgrst, 'reload schema';
