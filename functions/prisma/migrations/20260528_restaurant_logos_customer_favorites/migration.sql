ALTER TABLE "public"."RestaurantRecord"
ADD COLUMN IF NOT EXISTS "logoImage" TEXT;

ALTER TABLE "public"."PartnerApplicationRecord"
ADD COLUMN IF NOT EXISTS "logoImage" TEXT;

CREATE TABLE IF NOT EXISTS "public"."CustomerFavoriteRestaurant" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerFavoriteRestaurant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CustomerFavoriteRestaurant_customerId_restaurantId_key"
  ON "public"."CustomerFavoriteRestaurant"("customerId", "restaurantId");

CREATE INDEX IF NOT EXISTS "CustomerFavoriteRestaurant_customerId_idx"
  ON "public"."CustomerFavoriteRestaurant"("customerId");

CREATE INDEX IF NOT EXISTS "CustomerFavoriteRestaurant_restaurantId_idx"
  ON "public"."CustomerFavoriteRestaurant"("restaurantId");

ALTER TABLE "public"."CustomerFavoriteRestaurant"
  DROP CONSTRAINT IF EXISTS "CustomerFavoriteRestaurant_customerId_fkey";

ALTER TABLE "public"."CustomerFavoriteRestaurant"
  ADD CONSTRAINT "CustomerFavoriteRestaurant_customerId_fkey"
  FOREIGN KEY ("customerId")
  REFERENCES "public"."UserAccount"("uid")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "public"."CustomerFavoriteRestaurant"
  DROP CONSTRAINT IF EXISTS "CustomerFavoriteRestaurant_restaurantId_fkey";

ALTER TABLE "public"."CustomerFavoriteRestaurant"
  ADD CONSTRAINT "CustomerFavoriteRestaurant_restaurantId_fkey"
  FOREIGN KEY ("restaurantId")
  REFERENCES "public"."RestaurantRecord"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "public"."CustomerFavoriteRestaurant" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Customer favorites are visible to the owner" ON "public"."CustomerFavoriteRestaurant";
CREATE POLICY "Customer favorites are visible to the owner"
  ON "public"."CustomerFavoriteRestaurant"
  FOR SELECT
  TO authenticated
  USING ("customerId" = auth.uid()::text);

DROP POLICY IF EXISTS "Customers can add their own favorites" ON "public"."CustomerFavoriteRestaurant";
CREATE POLICY "Customers can add their own favorites"
  ON "public"."CustomerFavoriteRestaurant"
  FOR INSERT
  TO authenticated
  WITH CHECK ("customerId" = auth.uid()::text);

DROP POLICY IF EXISTS "Customers can update their own favorites" ON "public"."CustomerFavoriteRestaurant";
CREATE POLICY "Customers can update their own favorites"
  ON "public"."CustomerFavoriteRestaurant"
  FOR UPDATE
  TO authenticated
  USING ("customerId" = auth.uid()::text)
  WITH CHECK ("customerId" = auth.uid()::text);

DROP POLICY IF EXISTS "Customers can delete their own favorites" ON "public"."CustomerFavoriteRestaurant";
CREATE POLICY "Customers can delete their own favorites"
  ON "public"."CustomerFavoriteRestaurant"
  FOR DELETE
  TO authenticated
  USING ("customerId" = auth.uid()::text);

INSERT INTO "storage"."buckets" ("id", "name", "public", "file_size_limit", "allowed_mime_types")
VALUES (
  'restaurant-assets',
  'restaurant-assets',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT ("id") DO UPDATE
SET
  "public" = EXCLUDED."public",
  "file_size_limit" = EXCLUDED."file_size_limit",
  "allowed_mime_types" = EXCLUDED."allowed_mime_types";

DROP POLICY IF EXISTS "Restaurant assets are publicly readable" ON "storage"."objects";
CREATE POLICY "Restaurant assets are publicly readable"
  ON "storage"."objects"
  FOR SELECT
  TO public
  USING ("bucket_id" = 'restaurant-assets');

DROP POLICY IF EXISTS "Restaurant owners can upload assets" ON "storage"."objects";
CREATE POLICY "Restaurant owners can upload assets"
  ON "storage"."objects"
  FOR INSERT
  TO authenticated
  WITH CHECK (
    "bucket_id" = 'restaurant-assets'
    AND (
      ("storage"."foldername"("name"))[1] = 'logos'
      OR ("storage"."foldername"("name"))[1] = 'covers'
    )
    AND ("storage"."foldername"("name"))[2] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Restaurant owners can replace assets" ON "storage"."objects";
CREATE POLICY "Restaurant owners can replace assets"
  ON "storage"."objects"
  FOR UPDATE
  TO authenticated
  USING (
    "bucket_id" = 'restaurant-assets'
    AND ("storage"."foldername"("name"))[2] = auth.uid()::text
  )
  WITH CHECK (
    "bucket_id" = 'restaurant-assets'
    AND ("storage"."foldername"("name"))[2] = auth.uid()::text
  );
