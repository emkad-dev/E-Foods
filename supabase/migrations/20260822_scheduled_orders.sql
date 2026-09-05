-- Scheduled orders (Task 18 / G2).
--
-- Additive and idempotent. RLS is unchanged: CustomerOrder's existing policies
-- (see 20260701 / the customer-order RLS fix) continue to govern access; this
-- migration only adds a nullable column and a partial index the release sweep
-- reads.
--
-- `scheduledFor` holds the customer-requested slot as a UTC instant. When it is
-- NULL the order behaves exactly as an immediate order (status 'placed' at
-- creation). When it is set, placement lands the order in the NEW 'scheduled'
-- status (a plain TEXT value in CustomerOrder.status — there is no enum type to
-- extend) and the queue-drainer release sweep flips it to 'placed' at
-- `scheduledFor − prepTimeMinutes`. 'scheduled' is deliberately NOT a terminal
-- status and is NOT in the acceptance-deadline sweep's candidate set, so a
-- scheduled order is never auto-cancelled while it waits.

ALTER TABLE "public"."CustomerOrder"
  ADD COLUMN IF NOT EXISTS "scheduledFor" TIMESTAMP(3);

-- The release sweep selects `status = 'scheduled' AND scheduledFor <= <due>`
-- every minute; a partial index keeps that bounded scan cheap and touches only
-- the (few) rows currently waiting for release.
CREATE INDEX IF NOT EXISTS "CustomerOrder_scheduled_release_idx"
  ON "public"."CustomerOrder" ("scheduledFor")
  WHERE "status" = 'scheduled';
