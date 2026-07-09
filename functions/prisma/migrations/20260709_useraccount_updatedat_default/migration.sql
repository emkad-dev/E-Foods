ALTER TABLE "UserAccount"
  ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

UPDATE "UserAccount"
SET "updatedAt" = COALESCE("updatedAt", "createdAt", CURRENT_TIMESTAMP)
WHERE "updatedAt" IS NULL;
