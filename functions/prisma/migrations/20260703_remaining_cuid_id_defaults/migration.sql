CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "DeliveryEvent"
ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;

ALTER TABLE "RestaurantApproval"
ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;

ALTER TABLE "CustomerFavoriteRestaurant"
ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;

ALTER TABLE "UserPolicyAcceptance"
ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;
