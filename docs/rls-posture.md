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

## Rules for future changes

- Add a policy to `DeliveryOffer` **only** if a client app starts subscribing to
  `postgres_changes` on it or querying it directly with a user JWT. If that
  happens, the policy is a `SELECT` scoped to
  `"courierId" = (select auth.uid())::text` and nothing wider. Writes stay
  service-role-only in every case.
- If offers ever join the `supabase_realtime` publication, revisit this file in
  the same commit.
