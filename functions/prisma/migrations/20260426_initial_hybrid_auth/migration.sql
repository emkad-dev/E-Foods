-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."AppRole" AS ENUM ('customer', 'restaurant', 'dispatch', 'admin');

-- CreateEnum
CREATE TYPE "public"."RestaurantApprovalStatus" AS ENUM ('pending', 'approved', 'unpublished');

-- CreateTable
CREATE TABLE "public"."UserAccount" (
    "uid" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "roleDisplay" "public"."AppRole",
    "activeSessionId" TEXT,
    "activeSessionUpdatedAt" TIMESTAMP(3),
    "restaurantId" TEXT,
    "restaurantName" TEXT,
    "restaurantLinkedAt" TIMESTAMP(3),
    "restaurantLinkSource" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserAccount_pkey" PRIMARY KEY ("uid")
);

-- CreateTable
CREATE TABLE "public"."UserRole" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "public"."AppRole" NOT NULL,
    "restaurantId" TEXT,
    "assignedByUid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RestaurantRecord" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "name" TEXT NOT NULL,
    "nameKey" TEXT,
    "cuisine" TEXT,
    "address" TEXT,
    "description" TEXT,
    "image" TEXT,
    "deliveryFee" DOUBLE PRECISION,
    "deliveryRadiusKm" DOUBLE PRECISION,
    "deliveryTime" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "minOrder" DOUBLE PRECISION,
    "supportsDelivery" BOOLEAN NOT NULL DEFAULT true,
    "supportsPickup" BOOLEAN NOT NULL DEFAULT true,
    "isOpen" BOOLEAN NOT NULL DEFAULT true,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RestaurantRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RestaurantApproval" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "status" "public"."RestaurantApprovalStatus" NOT NULL DEFAULT 'pending',
    "approvedByUid" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RestaurantApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CustomerOrder" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "restaurantName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "fulfillmentType" TEXT NOT NULL,
    "pricing" JSONB NOT NULL,
    "payment" JSONB NOT NULL,
    "deliveryAddress" TEXT,
    "deliveryLocation" JSONB,
    "cancellation" JSONB,
    "timeline" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OrderItem" (
    "id" SERIAL NOT NULL,
    "orderId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "quantity" INTEGER NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "restaurantName" TEXT NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DeliveryAssignment" (
    "orderId" TEXT NOT NULL,
    "dispatchId" TEXT,
    "courierId" TEXT,
    "courierName" TEXT,
    "assignedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryAssignment_pkey" PRIMARY KEY ("orderId")
);

-- CreateTable
CREATE TABLE "public"."AdminAuditLog" (
    "id" TEXT NOT NULL,
    "actorUid" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserRole_role_idx" ON "public"."UserRole"("role");

-- CreateIndex
CREATE INDEX "UserRole_restaurantId_idx" ON "public"."UserRole"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "UserRole_userId_role_key" ON "public"."UserRole"("userId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "RestaurantApproval_restaurantId_key" ON "public"."RestaurantApproval"("restaurantId");

-- CreateIndex
CREATE INDEX "RestaurantApproval_status_idx" ON "public"."RestaurantApproval"("status");

-- CreateIndex
CREATE INDEX "CustomerOrder_customerId_idx" ON "public"."CustomerOrder"("customerId");

-- CreateIndex
CREATE INDEX "CustomerOrder_restaurantId_idx" ON "public"."CustomerOrder"("restaurantId");

-- CreateIndex
CREATE INDEX "CustomerOrder_status_idx" ON "public"."CustomerOrder"("status");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "public"."OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "DeliveryAssignment_dispatchId_idx" ON "public"."DeliveryAssignment"("dispatchId");

-- CreateIndex
CREATE INDEX "DeliveryAssignment_courierId_idx" ON "public"."DeliveryAssignment"("courierId");

-- CreateIndex
CREATE INDEX "AdminAuditLog_actorUid_idx" ON "public"."AdminAuditLog"("actorUid");

-- CreateIndex
CREATE INDEX "AdminAuditLog_action_idx" ON "public"."AdminAuditLog"("action");

-- CreateIndex
CREATE INDEX "AdminAuditLog_targetType_idx" ON "public"."AdminAuditLog"("targetType");

-- AddForeignKey
ALTER TABLE "public"."UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."UserAccount"("uid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserRole" ADD CONSTRAINT "UserRole_assignedByUid_fkey" FOREIGN KEY ("assignedByUid") REFERENCES "public"."UserAccount"("uid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RestaurantRecord" ADD CONSTRAINT "RestaurantRecord_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."UserAccount"("uid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RestaurantApproval" ADD CONSTRAINT "RestaurantApproval_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "public"."RestaurantRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RestaurantApproval" ADD CONSTRAINT "RestaurantApproval_approvedByUid_fkey" FOREIGN KEY ("approvedByUid") REFERENCES "public"."UserAccount"("uid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CustomerOrder" ADD CONSTRAINT "CustomerOrder_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "public"."RestaurantRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."CustomerOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DeliveryAssignment" ADD CONSTRAINT "DeliveryAssignment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."CustomerOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_actorUid_fkey" FOREIGN KEY ("actorUid") REFERENCES "public"."UserAccount"("uid") ON DELETE SET NULL ON UPDATE CASCADE;

