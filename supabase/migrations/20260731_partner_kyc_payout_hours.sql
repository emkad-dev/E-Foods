-- Partner onboarding stage 1: KYC, payout, and per-day trading hours.
--
-- Access model: these three tables are service-role only. All reads and writes
-- go through Edge Functions using the service_role key, which BYPASSES RLS.
-- RLS is enabled with NO policies so nothing is reachable through the Data API
-- or Realtime. See docs/rls-posture.md.
--
-- RestaurantKyc holds national ID data. It must never be exposed to the Data API
-- and its image columns hold storage PATHS, never public URLs.

-- =====================================================================
-- RestaurantKyc
-- =====================================================================
CREATE TABLE IF NOT EXISTS "public"."RestaurantKyc" (
  "id"            TEXT PRIMARY KEY,
  "uid"           TEXT NOT NULL UNIQUE,
  "restaurantId"  TEXT,
  "legalName"     TEXT NOT NULL,
  "ninNumber"     TEXT,
  "ninLast4"      TEXT NOT NULL,
  "ninHash"       TEXT NOT NULL,
  "ninFrontPath"  TEXT NOT NULL,
  "ninBackPath"   TEXT NOT NULL,
  "verification"  TEXT NOT NULL DEFAULT 'manual',
  "verifiedByUid" TEXT,
  "verifiedAt"    TIMESTAMP(3),
  "reviewNotes"   TEXT,
  "purgedAt"      TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "RestaurantKyc_restaurantId_idx"
  ON "public"."RestaurantKyc" ("restaurantId");

ALTER TABLE "public"."RestaurantKyc" ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- RestaurantPayout
-- =====================================================================
CREATE TABLE IF NOT EXISTS "public"."RestaurantPayout" (
  "id"                     TEXT PRIMARY KEY,
  "uid"                    TEXT NOT NULL UNIQUE,
  "restaurantId"           TEXT,
  "bankCode"               TEXT NOT NULL,
  "bankName"               TEXT NOT NULL,
  "accountNumber"          TEXT NOT NULL,
  "accountLast4"           TEXT NOT NULL,
  "resolvedAccountName"    TEXT NOT NULL,
  "paystackSubaccountCode" TEXT,
  "status"                 TEXT NOT NULL DEFAULT 'pending',
  "lastError"              TEXT,
  "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "RestaurantPayout_restaurantId_idx"
  ON "public"."RestaurantPayout" ("restaurantId");
CREATE INDEX IF NOT EXISTS "RestaurantPayout_status_idx"
  ON "public"."RestaurantPayout" ("status");

ALTER TABLE "public"."RestaurantPayout" ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- RestaurantHours  (7 rows per restaurant; 0 = Sunday .. 6 = Saturday)
-- =====================================================================
CREATE TABLE IF NOT EXISTS "public"."RestaurantHours" (
  "id"           TEXT PRIMARY KEY,
  "restaurantId" TEXT NOT NULL,
  "dayOfWeek"    INTEGER NOT NULL,
  "isClosed"     BOOLEAN NOT NULL DEFAULT false,
  "opensAt"      TEXT,
  "closesAt"     TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RestaurantHours_restaurantId_fkey"
    FOREIGN KEY ("restaurantId") REFERENCES "public"."RestaurantRecord" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RestaurantHours_dayOfWeek_check"
    CHECK ("dayOfWeek" >= 0 AND "dayOfWeek" <= 6)
);

CREATE UNIQUE INDEX IF NOT EXISTS "RestaurantHours_restaurantId_dayOfWeek_key"
  ON "public"."RestaurantHours" ("restaurantId", "dayOfWeek");

ALTER TABLE "public"."RestaurantHours" ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- RestaurantRecord additive columns
-- =====================================================================
ALTER TABLE "public"."RestaurantRecord"
  ADD COLUMN IF NOT EXISTS "cuisines"                 TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "customCuisine"            TEXT,
  ADD COLUMN IF NOT EXISTS "customCuisineStatus"      TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "formattedAddress"         TEXT,
  ADD COLUMN IF NOT EXISTS "addressComponents"        JSONB,
  ADD COLUMN IF NOT EXISTS "buildingInfo"             TEXT,
  ADD COLUMN IF NOT EXISTS "deliveryNotes"            TEXT,
  ADD COLUMN IF NOT EXISTS "detailsConfirmedAt"       TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reverificationStatus"     TEXT NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS "reverificationDueAt"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reverificationNotifiedAt" TIMESTAMP(3);
