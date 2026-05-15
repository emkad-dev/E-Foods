CREATE TABLE IF NOT EXISTS "public"."PartnerApplicationRecord" (
  "id" TEXT NOT NULL,
  "uid" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "contactName" TEXT NOT NULL,
  "phoneNumber" TEXT NOT NULL,
  "restaurantName" TEXT NOT NULL,
  "cuisine" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "description" TEXT,
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "deliveryTime" TEXT,
  "status" TEXT NOT NULL,
  "restaurantId" TEXT,
  "submittedAt" TIMESTAMP(3) NOT NULL,
  "reviewedAt" TIMESTAMP(3),
  "approvedByUid" TEXT,
  "rejectionReason" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PartnerApplicationRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PartnerApplicationRecord_uid_key"
  ON "public"."PartnerApplicationRecord"("uid");

CREATE INDEX IF NOT EXISTS "PartnerApplicationRecord_status_idx"
  ON "public"."PartnerApplicationRecord"("status");

CREATE INDEX IF NOT EXISTS "PartnerApplicationRecord_submittedAt_idx"
  ON "public"."PartnerApplicationRecord"("submittedAt");

ALTER TABLE "public"."PartnerApplicationRecord"
  DROP CONSTRAINT IF EXISTS "PartnerApplicationRecord_approvedByUid_fkey";

ALTER TABLE "public"."PartnerApplicationRecord"
  ADD CONSTRAINT "PartnerApplicationRecord_approvedByUid_fkey"
  FOREIGN KEY ("approvedByUid")
  REFERENCES "public"."UserAccount"("uid")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "public"."DispatchApplicationRecord" (
  "id" TEXT NOT NULL,
  "uid" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "phoneNumber" TEXT NOT NULL,
  "region" TEXT NOT NULL,
  "lga" TEXT NOT NULL,
  "vehicleType" TEXT NOT NULL,
  "currentAddress" TEXT,
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "status" TEXT NOT NULL,
  "submittedAt" TIMESTAMP(3) NOT NULL,
  "reviewedAt" TIMESTAMP(3),
  "approvedByUid" TEXT,
  "rejectionReason" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DispatchApplicationRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DispatchApplicationRecord_uid_key"
  ON "public"."DispatchApplicationRecord"("uid");

CREATE INDEX IF NOT EXISTS "DispatchApplicationRecord_status_idx"
  ON "public"."DispatchApplicationRecord"("status");

CREATE INDEX IF NOT EXISTS "DispatchApplicationRecord_submittedAt_idx"
  ON "public"."DispatchApplicationRecord"("submittedAt");

ALTER TABLE "public"."DispatchApplicationRecord"
  DROP CONSTRAINT IF EXISTS "DispatchApplicationRecord_approvedByUid_fkey";

ALTER TABLE "public"."DispatchApplicationRecord"
  ADD CONSTRAINT "DispatchApplicationRecord_approvedByUid_fkey"
  FOREIGN KEY ("approvedByUid")
  REFERENCES "public"."UserAccount"("uid")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
