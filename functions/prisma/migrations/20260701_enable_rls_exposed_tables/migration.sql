-- Enable Row Level Security on the remaining public tables that were reachable
-- through the Data API and the supabase_realtime publication with RLS disabled.
--
-- Access model (see audit):
--   * All privileged reads/writes go through Edge Functions using the service_role
--     key, which BYPASSES RLS. These policies therefore only need to cover the
--     roles that read directly or via Realtime postgres_changes.
--   * Only the customer app (own order tracking) and the admin console subscribe
--     to Realtime on these tables. Partner/dispatch read via the RPC layer.
--   * No client writes these tables directly, so no INSERT/UPDATE/DELETE policies
--     are granted here -- writes remain service_role-only.
--
-- Admin claim reuses the existing convention (app_metadata, not user_metadata):
--   COALESCE(auth.jwt()->'app_metadata'->>'user_role', auth.jwt()->>'user_role') = 'admin'
--
-- REVIEW BEFORE APPLYING (assumptions to verify against the live schema):
--   1. CustomerOrder.customerId / PartnerApplicationRecord.uid / DispatchApplicationRecord.uid
--      hold the Supabase auth uid (auth.uid()::text).
--   2. Realtime postgres_changes correctly evaluates the sub-select policies below
--      (CustomerOrder / DeliveryAssignment) for the authenticated role. Test the
--      customer order-tracking screen and the admin dashboard after applying.
--   3. DispatchRiderRecord has no direct client reader; kept admin-only. Add a
--      rider self-select policy if a rider app later reads it directly.

-- =====================================================================
-- CustomerOrder  (customer subscribes to own order; admin subscribes to all)
-- =====================================================================
ALTER TABLE "public"."CustomerOrder" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "CustomerOrder self read or admin" ON "public"."CustomerOrder";
CREATE POLICY "CustomerOrder self read or admin"
  ON "public"."CustomerOrder"
  FOR SELECT
  TO authenticated
  USING (
    "customerId" = auth.uid()::text
    OR COALESCE(auth.jwt()->'app_metadata'->>'user_role', auth.jwt()->>'user_role') = 'admin'
  );

-- =====================================================================
-- OrderItem  (admin dashboard subscribes; customers get items via RPC)
-- =====================================================================
ALTER TABLE "public"."OrderItem" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "OrderItem admin read" ON "public"."OrderItem";
CREATE POLICY "OrderItem admin read"
  ON "public"."OrderItem"
  FOR SELECT
  TO authenticated
  USING (
    COALESCE(auth.jwt()->'app_metadata'->>'user_role', auth.jwt()->>'user_role') = 'admin'
  );

-- =====================================================================
-- DeliveryAssignment  (customer tracks own order; admin subscribes)
-- =====================================================================
ALTER TABLE "public"."DeliveryAssignment" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "DeliveryAssignment self order or admin" ON "public"."DeliveryAssignment";
CREATE POLICY "DeliveryAssignment self order or admin"
  ON "public"."DeliveryAssignment"
  FOR SELECT
  TO authenticated
  USING (
    "orderId" IN (
      SELECT "id" FROM "public"."CustomerOrder" WHERE "customerId" = auth.uid()::text
    )
    OR COALESCE(auth.jwt()->'app_metadata'->>'user_role', auth.jwt()->>'user_role') = 'admin'
  );

-- =====================================================================
-- DeliveryEvent  (no direct client reader; admin only)
-- =====================================================================
ALTER TABLE "public"."DeliveryEvent" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "DeliveryEvent admin read" ON "public"."DeliveryEvent";
CREATE POLICY "DeliveryEvent admin read"
  ON "public"."DeliveryEvent"
  FOR SELECT
  TO authenticated
  USING (
    COALESCE(auth.jwt()->'app_metadata'->>'user_role', auth.jwt()->>'user_role') = 'admin'
  );

-- =====================================================================
-- PaymentTransaction  (sensitive: accessCode/authorizationUrl; admin only)
-- =====================================================================
ALTER TABLE "public"."PaymentTransaction" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "PaymentTransaction admin read" ON "public"."PaymentTransaction";
CREATE POLICY "PaymentTransaction admin read"
  ON "public"."PaymentTransaction"
  FOR SELECT
  TO authenticated
  USING (
    COALESCE(auth.jwt()->'app_metadata'->>'user_role', auth.jwt()->>'user_role') = 'admin'
  );

-- =====================================================================
-- RestaurantRecord  (admin subscribes; public catalog served via Edge Function)
-- =====================================================================
ALTER TABLE "public"."RestaurantRecord" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "RestaurantRecord admin read" ON "public"."RestaurantRecord";
CREATE POLICY "RestaurantRecord admin read"
  ON "public"."RestaurantRecord"
  FOR SELECT
  TO authenticated
  USING (
    COALESCE(auth.jwt()->'app_metadata'->>'user_role', auth.jwt()->>'user_role') = 'admin'
  );

-- =====================================================================
-- RestaurantApproval  (admin approvals queue only)
-- =====================================================================
ALTER TABLE "public"."RestaurantApproval" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "RestaurantApproval admin read" ON "public"."RestaurantApproval";
CREATE POLICY "RestaurantApproval admin read"
  ON "public"."RestaurantApproval"
  FOR SELECT
  TO authenticated
  USING (
    COALESCE(auth.jwt()->'app_metadata'->>'user_role', auth.jwt()->>'user_role') = 'admin'
  );

-- =====================================================================
-- PartnerApplicationRecord  (admin + applicant's own row)
-- =====================================================================
ALTER TABLE "public"."PartnerApplicationRecord" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "PartnerApplication self read or admin" ON "public"."PartnerApplicationRecord";
CREATE POLICY "PartnerApplication self read or admin"
  ON "public"."PartnerApplicationRecord"
  FOR SELECT
  TO authenticated
  USING (
    "uid" = auth.uid()::text
    OR COALESCE(auth.jwt()->'app_metadata'->>'user_role', auth.jwt()->>'user_role') = 'admin'
  );

-- =====================================================================
-- DispatchApplicationRecord  (admin + applicant's own row)
-- =====================================================================
ALTER TABLE "public"."DispatchApplicationRecord" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "DispatchApplication self read or admin" ON "public"."DispatchApplicationRecord";
CREATE POLICY "DispatchApplication self read or admin"
  ON "public"."DispatchApplicationRecord"
  FOR SELECT
  TO authenticated
  USING (
    "uid" = auth.uid()::text
    OR COALESCE(auth.jwt()->'app_metadata'->>'user_role', auth.jwt()->>'user_role') = 'admin'
  );

-- =====================================================================
-- DispatchRiderRecord  (admin only; add rider self-read if needed later)
-- =====================================================================
ALTER TABLE "public"."DispatchRiderRecord" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "DispatchRiderRecord admin read" ON "public"."DispatchRiderRecord";
CREATE POLICY "DispatchRiderRecord admin read"
  ON "public"."DispatchRiderRecord"
  FOR SELECT
  TO authenticated
  USING (
    COALESCE(auth.jwt()->'app_metadata'->>'user_role', auth.jwt()->>'user_role') = 'admin'
  );

-- =====================================================================
-- AdminAuditLog  (admin only)
-- =====================================================================
ALTER TABLE "public"."AdminAuditLog" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "AdminAuditLog admin read" ON "public"."AdminAuditLog";
CREATE POLICY "AdminAuditLog admin read"
  ON "public"."AdminAuditLog"
  FOR SELECT
  TO authenticated
  USING (
    COALESCE(auth.jwt()->'app_metadata'->>'user_role', auth.jwt()->>'user_role') = 'admin'
  );

-- =====================================================================
-- IdempotencyRecord  (internal; no client access -- RLS with no policy = deny all
-- non-service_role reads/writes)
-- =====================================================================
ALTER TABLE "public"."IdempotencyRecord" ENABLE ROW LEVEL SECURITY;
