-- Customer order confirmation.
--
-- After a RESTAURANT marks an order delivered/collected (the partner
-- `delivered` action), the customer confirms receipt or reports a problem; an
-- order nobody confirms closes itself 3 hours after completion. Confirmation is
-- recorded here, NOT as a new status: `status` stays 'delivered' so stats,
-- ratings and reports keep working unchanged, and no money moves.
--
-- Additive and nullable (the one NOT NULL column has a default), so existing
-- rows are untouched and orders delivered before this ships never enter the
-- flow (customerConfirmDueAt stays null = "not in flow").
--
-- DEPLOY ORDER: apply this BEFORE the edge functions that select these columns
-- ship. CUSTOMER_ORDER_COLUMNS is read on every order read; code naming a
-- missing column fails all of them.
--
-- Reverse with:
--   DROP INDEX IF EXISTS public."CustomerOrder_customerConfirmDueAt_open_idx";
--   ALTER TABLE public."CustomerOrder"
--     DROP COLUMN "customerConfirmDueAt",
--     DROP COLUMN "customerConfirmedAt",
--     DROP COLUMN "customerConfirmationSource",
--     DROP COLUMN "customerConfirmRemindersSent",
--     DROP COLUMN "customerIssueReportedAt";

-- Set ONLY by the partner `delivered` action, to completion + 3h.
ALTER TABLE public."CustomerOrder" ADD COLUMN IF NOT EXISTS "customerConfirmDueAt" timestamptz;
ALTER TABLE public."CustomerOrder" ADD COLUMN IF NOT EXISTS "customerConfirmedAt" timestamptz;
ALTER TABLE public."CustomerOrder" ADD COLUMN IF NOT EXISTS "customerConfirmationSource" text;
ALTER TABLE public."CustomerOrder" ADD COLUMN IF NOT EXISTS "customerConfirmRemindersSent" integer NOT NULL DEFAULT 0;
ALTER TABLE public."CustomerOrder" ADD COLUMN IF NOT EXISTS "customerIssueReportedAt" timestamptz;

-- ADD CONSTRAINT has no IF NOT EXISTS; guard it so the migration can be re-run.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'CustomerOrder_customerConfirmationSource_check'
      AND conrelid = 'public."CustomerOrder"'::regclass
  ) THEN
    ALTER TABLE public."CustomerOrder"
      ADD CONSTRAINT "CustomerOrder_customerConfirmationSource_check"
      CHECK ("customerConfirmationSource" IN ('customer', 'auto'));
  END IF;
END
$$;

-- The auto-close / reminder sweep only ever looks at orders still waiting, so
-- index just those.
CREATE INDEX IF NOT EXISTS "CustomerOrder_customerConfirmDueAt_open_idx"
  ON public."CustomerOrder" ("customerConfirmDueAt")
  WHERE "customerConfirmedAt" IS NULL AND "customerConfirmDueAt" IS NOT NULL;

NOTIFY pgrst, 'reload schema';
