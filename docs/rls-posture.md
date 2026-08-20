# RLS posture for tables introduced on `feature/parity`

_Last reviewed: 2026-08-15_

The default posture in this database for a table whose only legitimate access
path is a service-role Edge Function is **RLS enabled with zero policies**:
`authenticated` and `anon` are denied everything through the Data API, and the
service role bypasses RLS entirely. This note records, per table added on this
branch, that the policy-less state is deliberate — so nobody later reads "RLS on,
no policies" as an unfinished migration and adds policies to `fix` it.

> **Scope note.** A fuller audit of the twelve pre-existing Data-API-exposed
> tables lives in this same path on the unmerged branch
> `fix/customer-order-rls-policies` (commit `9056ff3`), which also adds the two
> customer self-read policies on `CustomerOrder` / `DeliveryAssignment` that
> order-tracking Realtime needs. That branch and this one both create
> `docs/rls-posture.md`; whichever merges second should fold its table into the
> other's, not replace it. Nothing in this file contradicts that audit — it only
> adds rows it does not have.

## Decision, per table

| Table | Added by | Live direct/Realtime reader? | Posture |
|---|---|---|---|
| **DeliveryOffer** | `supabase/migrations/20260816_dispatch_delivery_offers.sql` (Task 10 / D2) | ❌ | **service-role-only** (RLS enabled, no policies) |
| **DispatchRiderPing** | `supabase/migrations/20260820_dispatch_rider_ping.sql` (Task 11 / D3) | ❌ | **service-role-only** (RLS enabled, no policies) |
| **OrderRating** | `supabase/migrations/20260820_order_ratings.sql` (Task 12 / E1) | ❌ | **service-role-only** (RLS enabled, no policies) |

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

## Rules for future changes

- Add a policy to `DeliveryOffer` **only** if a client app starts subscribing to
  `postgres_changes` on it or querying it directly with a user JWT. If that
  happens, the policy is a `SELECT` scoped to
  `"courierId" = (select auth.uid())::text` and nothing wider. Writes stay
  service-role-only in every case.
- If offers ever join the `supabase_realtime` publication, revisit this file in
  the same commit.
