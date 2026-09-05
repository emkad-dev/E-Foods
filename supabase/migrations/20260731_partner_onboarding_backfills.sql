-- Partner onboarding stage 1 backfills. All are behaviour-preserving:
-- existing values are copied forward, never invented.
--
-- Coordinates are deliberately NOT backfilled here. Per the spec audit,
-- 5 of 6 published restaurants have null coordinates; they are geocoded or
-- re-pinned in a later stage. The geo-gate stays off until that is done.

-- Hours: seed 7 days per restaurant from the existing single open/close pair.
-- isClosed = false everywhere, so a restaurant open 08:00-22:00 today keeps
-- exactly those hours on every day, and its "open now" result is unchanged.
INSERT INTO "public"."RestaurantHours" ("id", "restaurantId", "dayOfWeek", "isClosed", "opensAt", "closesAt")
SELECT
  gen_random_uuid()::text,
  r."id",
  d."dayOfWeek",
  false,
  r."openingTime",
  r."closingTime"
FROM "public"."RestaurantRecord" r
CROSS JOIN generate_series(0, 6) AS d("dayOfWeek")
ON CONFLICT ("restaurantId", "dayOfWeek") DO NOTHING;

-- Cuisines: single string -> array. Empty string and NULL both become '{}'.
UPDATE "public"."RestaurantRecord"
SET "cuisines" = ARRAY["cuisine"]
WHERE "cuisine" IS NOT NULL
  AND "cuisine" <> ''
  AND COALESCE(array_length("cuisines", 1), 0) = 0;

-- Formatted address: seed from the existing free-text address.
UPDATE "public"."RestaurantRecord"
SET "formattedAddress" = "address"
WHERE "formattedAddress" IS NULL
  AND "address" IS NOT NULL
  AND "address" <> '';
