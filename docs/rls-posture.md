# RLS posture for the Data-API-exposed tables

_Last reviewed: 2026-09-07_

Two audits, folded together when `fix/customer-order-rls-policies` merged
into the parity line: the twelve pre-existing Data-API-exposed tables
reviewed on 2026-07-30, and the tables the parity branch itself added. The
earlier scope note - asking whichever branch merged second to fold its table
into the other's rather than replace it - is discharged by this document.

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

## Decision, per table - pre-existing Data-API tables

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

## Decision, per table - added on the parity branch

| Table | Added by | Live direct/Realtime reader? | Posture |
|---|---|---|---|
| **DeliveryOffer** | `supabase/migrations/20260816_dispatch_delivery_offers.sql` (Task 10 / D2) | ❌ | **service-role-only** (RLS enabled, no policies) |
| **DispatchRiderPing** | `supabase/migrations/20260820_dispatch_rider_ping.sql` (Task 11 / D3) | ❌ | **service-role-only** (RLS enabled, no policies) |
| **OrderRating** | `supabase/migrations/20260820_order_ratings.sql` (Task 12 / E1) | ❌ | **service-role-only** (RLS enabled, no policies) |
| **OrderGroup** | `supabase/migrations/20260827_multi_store_cart.sql` (Task 20 / G4) | ❌ | **service-role-only** (RLS enabled, no policies) |
| **PromoCode** | `supabase/migrations/20260821_promo_codes.sql` (Task 17 / G1) | ❌ | **service-role-only** (RLS enabled, no policies) |
| **PromoRedemption** | `supabase/migrations/20260821_promo_codes.sql` (Task 17 / G1) | ❌ | **service-role-only** (RLS enabled, no policies) |

### `DeliveryOffer`

Pending/accepted/declined/expired/superseded delivery offers made to dispatch
riders. Reasons the policy-less posture is correct rather than provisional:

- **No client touches it through the Data API.** A rider sees their own offers
  only in `dispatchGetDeliveryQueue`'s `offers` array, and acts on them only
  through `dispatchAcceptOffer` / `dispatchDeclineOffer` — all three are
  `feasty-dispatch` Edge Function actions running under the service role.
- **Live updates are Broadcast, not `postgres_changes`.** Creating, accepting or
  declining an offer calls `broadcastOrderChanged(orderId)`, which the dispatch
  app already subscribes to via the `orders` topic. The table is deliberately
  **not** added to the `supabase_realtime` publication, so there is no
  `postgres_changes` subscriber that a SELECT policy would need to serve.
- **Every state transition is a compare-and-swap.** `pending -> accepted` in
  particular is the single point at which a rider's `DispatchRiderRecord.
  activeLoad` is incremented (via `ebuy_claim_dispatch_assignment`). A write
  policy would put that ledger transition behind a predicate a client could
  satisfy directly, bypassing the guards in
  `ebuy_accept_dispatch_offer`. Writes must stay service-role-only,
  unconditionally.
- **A self-read policy would still be wrong today.** Even a narrow
  `courierId = auth.uid()` SELECT would expose `respondsBy` and `sequence` for
  rows a rider has no route to use, and buys nothing while the only reader is an
  Edge Function.

### `DispatchRiderPing`

The rider position track: one row appended (throttled to at most one every 10
seconds per rider) each time `syncDispatchRiderLocation` runs, in addition to
the current-position columns it keeps overwriting on `DispatchRiderRecord`.
Reasons the policy-less posture is correct rather than provisional:

- **No client touches it through the Data API today, and is not expected to.**
  Only `syncDispatchRiderLocation` (append) and `queue-drainer`'s 24-hour
  retention sweep (delete) ever reach this table, both under the service role.
- **UNLOGGED was considered and explicitly rejected**, not merely left as the
  default. See `20260820_dispatch_rider_ping.sql`'s own header: the gate the
  Task 11 brief asks for (no client subscribes via `postgres_changes`) is
  clear today, but Task 13 (E2, customer live tracking) is planned to read
  this table from a service-role Edge Function and relay position to the
  customer over the **existing `order-<id>` Broadcast topic** - never
  `postgres_changes`, and never direct client access. A plain table costs
  nothing extra at this write volume (at most one row per rider per 10s) and
  stays durable across a crash/restart, which UNLOGGED does not guarantee -
  losing the whole in-shift track to a Postgres restart would land right when
  Task 13 needs it most.
- **The throttle and retention are both structural, not advisory.** Recording
  a ping takes a per-rider `pg_advisory_xact_lock` before its
  "any recent ping?" check, so two overlapping calls for the same rider cannot
  both pass the check and both insert - closing the read-then-write race this
  plan has hit before (see `dispatchLoadRelease.test.ts`'s header for the
  load-ledger version of the same lesson). A write policy would let a client
  bypass that lock-guarded function and insert directly, so writes must stay
  service-role-only in every case, symmetric with `DeliveryOffer`.

**If Task 13 lands and needs this table's data exposed differently** - a
direct client read, or `postgres_changes` - revisit BOTH the RLS posture here
AND the UNLOGGED decision above from scratch; they were evaluated together and
the UNLOGGED rejection specifically depends on nothing subscribing that way.

### `OrderRating`

One row per rated order (`orderId` UNIQUE — the idempotency guard; see the
migration's own header for why that's a constraint rather than a read-then-
write check). Reasons the policy-less posture is correct rather than
provisional:

- **No client touches it through the Data API.** A customer submits a rating
  only through `customerSubmitOrderRating`, and lists what still needs rating
  only through `customerGetPendingRatings` — both `feasty-orders` Edge
  Function actions running under the service role. The aggregate columns it
  feeds (`RestaurantRecord.ratingAverage`/`ratingCount`,
  `DispatchRiderRecord.ratingAverage`/`ratingCount`) are what the customer app
  actually reads, via `customerGetRestaurantList` / `customerGetRestaurantDetail`
  — never this table directly.
- **The insert and both aggregate updates are one function call.**
  `ebuy_submit_order_rating` does the ownership check, the delivered-status
  check, the insert, and the incremental average update(s) as a single
  transaction. A write policy here would let a client bypass that function and
  insert a rating (or worse, only half of the ledger effect) directly.
- **A self-read policy would still be wrong today.** Even a narrow
  `customerId = auth.uid()` SELECT buys nothing while
  `customerGetPendingRatings` — an Edge Function action — is the only reader,
  and would expose `courierId`/`restaurantId`/`comment` on rows with no client
  code path that needs them read directly.

### `OrderGroup`

Shared placement/payment anchor for multi-store baskets. One row per placed
basket, even when the basket only contains a single restaurant. Reasons the
policy-less posture is correct rather than provisional:

- **No client touches it through the Data API.** The customer order flow
  creates and reads it only through `placeCustomerOrder`,
  `initializeCustomerPayment`, `refreshCustomerPaymentStatus`, and
  `customerGetOrderDetail` â€” all Edge Function paths under the service role.
- **It is a coordination record, not a user-owned resource.** The row ties a
  basket together, but the customer-visible order rows remain `CustomerOrder`
  rows. A SELECT policy would buy nothing while the only readers are Edge
  Functions.
- **Broadcast and RLS stay aligned with the existing posture.** Order updates
  still reach the customer app through the existing `orders` Broadcast topic;
  no `postgres_changes` subscription is introduced on `OrderGroup`.

### `PromoCode` / `PromoRedemption`

The discount-code engine (Task 17 / G1). Reasons the policy-less posture is
correct rather than provisional:

- **No client touches either table through the Data API.** A customer previews a
  code via `customerValidatePromoCode` and applies it via `placeCustomerOrder` /
  `initializeCustomerPayment`; an admin manages codes via
  `adminListPromoCodes` / `adminCreatePromoCode` / `adminSetPromoCodeActive` —
  all `feasty-orders` / `feasty-admin` Edge Function actions under the service
  role.
- **A read policy on `PromoCode` would leak the code space.** The whole point of
  the generic "not valid" refusal (`promoRejectionMessage`) is that a client
  cannot enumerate which codes exist; a `SELECT` policy would hand the client the
  entire table and defeat that.
- **`PromoRedemption` is the cap ledger.** Its counts are read only under the
  `SELECT … FOR UPDATE` row lock inside `ebuy_redeem_promo_code`; a client write
  policy would let a caller forge or delete a redemption and bust a usage cap
  directly, bypassing the atomic guard entirely. Reads expose who redeemed what,
  which no client path needs.
- **Live updates are not needed.** Activating or exhausting a code does not push
  to open apps — a stale client simply gets a clean refusal at placement, which
  re-validates and re-counts server-side. No `postgres_changes`, no Broadcast.

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

Additionally, for the parity-branch tables above:

- Add a policy to `DeliveryOffer` **only** if a client app starts subscribing to
  `postgres_changes` on it or querying it directly with a user JWT. If that
  happens, the policy is a `SELECT` scoped to
  `"courierId" = (select auth.uid())::text` and nothing wider. Writes stay
  service-role-only in every case.
- If offers ever join the `supabase_realtime` publication, revisit this file in
  the same commit.
