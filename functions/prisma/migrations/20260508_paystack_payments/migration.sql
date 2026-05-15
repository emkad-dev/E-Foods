-- AlterTable
ALTER TABLE "public"."RestaurantRecord"
ADD COLUMN "paystackSubaccountCode" TEXT;

-- CreateTable
CREATE TABLE "public"."PaymentTransaction" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "accessCode" TEXT,
    "authorizationUrl" TEXT,
    "externalTransactionId" TEXT,
    "channel" TEXT,
    "gatewayStatus" TEXT,
    "lastError" TEXT,
    "paidAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "splitSubaccountCode" TEXT,
    "initializeResponse" JSONB,
    "verificationResponse" JSONB,
    "webhookEvent" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_reference_key" ON "public"."PaymentTransaction"("reference");

-- CreateIndex
CREATE INDEX "PaymentTransaction_orderId_idx" ON "public"."PaymentTransaction"("orderId");

-- CreateIndex
CREATE INDEX "PaymentTransaction_customerId_idx" ON "public"."PaymentTransaction"("customerId");

-- CreateIndex
CREATE INDEX "PaymentTransaction_restaurantId_idx" ON "public"."PaymentTransaction"("restaurantId");

-- CreateIndex
CREATE INDEX "PaymentTransaction_status_idx" ON "public"."PaymentTransaction"("status");

-- AddForeignKey
ALTER TABLE "public"."PaymentTransaction"
ADD CONSTRAINT "PaymentTransaction_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "public"."CustomerOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
