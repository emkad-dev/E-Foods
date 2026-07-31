-- Partner readiness audit. Re-run this before enabling the geo-gate (spec §2)
-- and again before the re-verification cutover (spec §11).
--
-- Baseline recorded 2026-07-31 in spec §13:
--   total 6, published 6, published_missing_coords 5, missing_subaccount 6,
--   zero_or_null_min_order 4, missing_hours 3, delivery_without_coords 1.
--
-- The single most important number is published_missing_coords: enabling the
-- geo-gate while it is non-zero removes those restaurants from the customer app.

SELECT
  COUNT(*)                                                                   AS total_restaurants,
  COUNT(*) FILTER (WHERE "isPublished")                                      AS published,
  COUNT(*) FILTER (WHERE "isPublished"
                     AND ("latitude" IS NULL OR "longitude" IS NULL))         AS published_missing_coords,
  COUNT(*) FILTER (WHERE "paystackSubaccountCode" IS NULL
                     OR "paystackSubaccountCode" = '')                        AS missing_subaccount,
  COUNT(*) FILTER (WHERE "minOrder" IS NULL OR "minOrder" = 0)               AS zero_or_null_min_order,
  COUNT(*) FILTER (WHERE "detailsConfirmedAt" IS NULL)                       AS details_never_confirmed,
  COUNT(*) FILTER (WHERE "openingTime" IS NULL OR "closingTime" IS NULL)     AS missing_hours,
  COUNT(*) FILTER (WHERE "supportsDelivery"
                     AND ("latitude" IS NULL OR "longitude" IS NULL))         AS delivery_without_coords
FROM "RestaurantRecord";
