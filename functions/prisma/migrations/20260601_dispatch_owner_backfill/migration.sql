UPDATE "DeliveryAssignment"
SET "dispatchOwnerId" = NULLIF(BTRIM("dispatchId"), '')
WHERE "dispatchOwnerId" IS NULL
  AND NULLIF(BTRIM("dispatchId"), '') IS NOT NULL;
