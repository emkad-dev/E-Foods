-- Customer-facing Realtime read policies for order tracking.
--
-- WHY THIS EXISTS
--   The customer app subscribes to Realtime `postgres_changes` on two tables so
--   the order-tracking screens update live:
--     * apps/customer/src/hooks/useCustomerOrder.ts      -> CustomerOrder (by id),
--                                                           DeliveryAssignment (by orderId)
--     * apps/customer/app/(customer)/orders/index.tsx     -> CustomerOrder (by customerId)
--   Both tables are in the `supabase_realtime` publication
--   (supabase/migrations/20260629_admin_live_updates.sql) and both have RLS
--   ENABLED with NO policies in production. Realtime evaluates table RLS for the
--   `authenticated` role before delivering a change; with RLS on and no SELECT
--   policy the customer sees no rows, so NO events are delivered and the screens
--   silently fall back to their 30s polling loop.
--
--   The historical Prisma migration
--   functions/prisma/migrations/20260701_enable_rls_exposed_tables/migration.sql
--   authored equivalent policies but its policy half was never applied to prod
--   (only a bulk RLS-enable landed). functions/prisma/migrations/ is now a frozen
--   historical archive; supabase/migrations/ is the single source of truth, so we
--   re-establish the two policies the live client actually needs here.
--
-- SCOPE (deliberately narrow -- see docs/rls-posture.md)
--   Only CustomerOrder + DeliveryAssignment get a policy, and only a customer
--   SELF-read SELECT. No admin clause: admin/support live updates go through the
--   service-role app-rpc router + Realtime Broadcast, so admins must NOT gain
--   direct Data-API read of every customer's orders. Writes stay service-role-only
--   (no INSERT/UPDATE/DELETE policies). The other 10 tables enabled by the
--   20260701 archive remain intentionally policy-less (service-role-only).
--
-- ASSUMPTION (matches the 20260701 archive and existing app code)
--   CustomerOrder.customerId holds the Supabase auth uid as text (auth.uid()::text).
--
-- Idempotent: ENABLE RLS is a no-op where already on; policies are dropped first.

-- =====================================================================
-- CustomerOrder -- a customer may read their own orders
-- =====================================================================
ALTER TABLE "public"."CustomerOrder" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "CustomerOrder self read" ON "public"."CustomerOrder";
CREATE POLICY "CustomerOrder self read"
  ON "public"."CustomerOrder"
  FOR SELECT
  TO authenticated
  USING ("customerId" = auth.uid()::text);

-- =====================================================================
-- DeliveryAssignment -- a customer may read the assignment for their own order
-- =====================================================================
ALTER TABLE "public"."DeliveryAssignment" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "DeliveryAssignment self order read" ON "public"."DeliveryAssignment";
CREATE POLICY "DeliveryAssignment self order read"
  ON "public"."DeliveryAssignment"
  FOR SELECT
  TO authenticated
  USING (
    "orderId" IN (
      SELECT "id" FROM "public"."CustomerOrder" WHERE "customerId" = auth.uid()::text
    )
  );
