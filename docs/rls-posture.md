# RLS posture for the Data-API–exposed tables

_Last reviewed: 2026-07-30_

Twelve `public` tables had Row Level Security **enabled** in production but **zero
policies** — the correct "deny all direct `authenticated`/`anon` access" posture
for tables whose only legitimate access path is a service-role Edge Function
(which bypasses RLS). This note records, per table, whether that policy-less state
is intentional, so nobody re-adds the abandoned policies.

## Background

The historical Prisma migration
`functions/prisma/migrations/20260701_enable_rls_exposed_tables/migration.sql`
authored customer/admin SELECT policies for these tables, targeting the
**pre-Broadcast** architecture where the customer app and admin console read live
data via Realtime `postgres_changes`. That file's **policy half was never applied**
to prod (only a bulk RLS-enable landed; the migration is not recorded in
`_prisma_migrations`). Since then:

- **Admin + support** live updates moved to **Realtime Broadcast** via the
  service-role `app-rpc` router (`supabase/migrations/20260708_broadcast_messaging.sql`,
  support-inbox spec). The admin app has **no** `postgres_changes` subscriber.
- **Partner / dispatch** read exclusively through the RPC layer.

`functions/prisma/migrations/` is now a frozen historical archive;
`supabase/migrations/` is the single source of truth.

## Decision, per table

| Table | Live direct/Realtime reader? | Posture | Policy source |
|---|---|---|---|
| **CustomerOrder** | ✅ customer app `postgres_changes` (own orders) | customer SELF-read SELECT | `20260730_customer_order_realtime_policies.sql` |
| **DeliveryAssignment** | ✅ customer app `postgres_changes` (own order's assignment) | customer SELF-read SELECT | `20260730_customer_order_realtime_policies.sql` |
| OrderItem | ❌ (items delivered to customer via RPC payload) | **service-role-only** (no policy) | — |
| DeliveryEvent | ❌ | **service-role-only** (no policy) | — |
| PaymentTransaction | ❌ (sensitive: accessCode / authorizationUrl) | **service-role-only** (no policy) | — |
| RestaurantRecord | ❌ (public catalog served by Edge Function) | **service-role-only** (no policy) | — |
| RestaurantApproval | ❌ | **service-role-only** (no policy) | — |
| PartnerApplicationRecord | ❌ | **service-role-only** (no policy) | — |
| DispatchApplicationRecord | ❌ | **service-role-only** (no policy) | — |
| DispatchRiderRecord | ❌ | **service-role-only** (no policy) | — |
| AdminAuditLog | ❌ | **service-role-only** (no policy) | — |
| IdempotencyRecord | ❌ (internal) | **service-role-only** (no policy) | — |

## Rules for future changes

- **Do not** re-introduce the admin-read or applicant-self-read policies from the
  20260701 archive. Admin/support/partner/dispatch reads go through the
  service-role `app-rpc` router (+ Broadcast for live updates), not the Data API.
- Add a policy **only** when a client genuinely subscribes to `postgres_changes`
  or queries the table directly with a user JWT — and scope it to the narrowest
  self-read predicate. Writes stay service-role-only.
- If order tracking is later migrated to Broadcast (mirroring
  `apps/customer/src/hooks/useSupportThreadRealtime.ts`), drop the two policies in
  `20260730_customer_order_realtime_policies.sql`, remove `CustomerOrder` /
  `DeliveryAssignment` from the `supabase_realtime` publication, and update this
  table.
