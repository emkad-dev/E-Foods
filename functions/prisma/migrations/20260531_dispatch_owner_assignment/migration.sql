ALTER TABLE "DeliveryAssignment"
ADD COLUMN IF NOT EXISTS "dispatchOwnerId" TEXT;

CREATE INDEX IF NOT EXISTS "DeliveryAssignment_dispatchOwnerId_idx"
ON "DeliveryAssignment"("dispatchOwnerId");
