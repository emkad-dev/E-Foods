-- CreateTable
CREATE TABLE "public"."DispatchRiderRecord" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "zone" TEXT NOT NULL,
    "vehicleType" TEXT NOT NULL,
    "acceptanceRate" DOUBLE PRECISION,
    "activeLoad" INTEGER NOT NULL DEFAULT 0,
    "completedTrips" INTEGER NOT NULL DEFAULT 0,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DispatchRiderRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DeliveryEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actorUid" TEXT,
    "note" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."IdempotencyRecord" (
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "actorUid" TEXT NOT NULL,
    "response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "DispatchRiderRecord_status_idx" ON "public"."DispatchRiderRecord"("status");

-- CreateIndex
CREATE INDEX "DispatchRiderRecord_zone_idx" ON "public"."DispatchRiderRecord"("zone");

-- CreateIndex
CREATE INDEX "DeliveryEvent_orderId_idx" ON "public"."DeliveryEvent"("orderId");

-- CreateIndex
CREATE INDEX "DeliveryEvent_eventType_idx" ON "public"."DeliveryEvent"("eventType");

-- CreateIndex
CREATE INDEX "DeliveryEvent_actorUid_idx" ON "public"."DeliveryEvent"("actorUid");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_actorUid_scope_idx" ON "public"."IdempotencyRecord"("actorUid", "scope");

-- AddForeignKey
ALTER TABLE "public"."DeliveryEvent" ADD CONSTRAINT "DeliveryEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."CustomerOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
