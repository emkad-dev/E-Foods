# Refunds and order intervention — specification

**Status:** proposed, not implemented. Written 2026-09-18.
**Why deferred:** both paths move real money through Paystack. Everything below was verified against the code and the production database before it was written, but none of it should be built until the open decisions in §6 are answered by the owner.

---

## 1. What exists today

Verified, not assumed:

- **`ADMIN_ACTIONS` contains no action that touches an order.** Every order-related admin capability is a read: `adminGetApprovalQueue`, `adminGetDashboardSnapshot`, `adminGetAccessOverview`, `adminGetRiskEvents`, `adminGetOperationalAlerts`. The only write that affects a live trading situation is `adminSetRestaurantPublished`, which unpublishes an entire restaurant.
- **No cancel action exists for anyone.** Not for the customer, not for an operator. An order reaches `cancelled` only through an automated sweep — the unpaid-checkout timeout and the acceptance-deadline sweep — or through the partner's own `rejected`.
- **No refund path exists anywhere.** Not in `ADMIN_ACTIONS`, not in `_shared/paystack.ts`, not in the `payment-verification` or `paystack-webhook` functions. The only occurrence of the word "refund" in the repository is an unrelated colour token.

So the operator's entire response to "my order never arrived" is: look at it, or unpublish the restaurant.

## 2. The constraint that shapes everything: money has already been split

`initializePaystackTransaction` sends `subaccount` plus a flat `transaction_charge`. That means **at the moment the customer pays, Paystack settles the restaurant's share directly into the restaurant's own subaccount.** FEASTY never holds it.

Paystack's refund endpoint debits the **main account balance**. It does not claw back from a subaccount.

Therefore a naive refund has FEASTY returning 100% of the order value to the customer while the restaurant keeps its share of a meal that was never delivered. At current pricing (`markupRate 0.2`, `markupFlat ₦100/unit`, `partnerServiceRate 0`) FEASTY's margin on an order is materially smaller than the restaurant's share, so **a single full refund can cost FEASTY several times its own revenue on that order.**

This is a business decision before it is an engineering one, and it is the reason this document exists rather than a pull request.

### Options

| Option | Mechanism | Cost lands on | Notes |
|---|---|---|---|
| **A. Platform absorbs** | Refund full amount from main balance | FEASTY | Simplest. Unbounded exposure; a bad actor restaurant costs FEASTY directly. |
| **B. Partial refund** | Refund only FEASTY's share | Customer | Customer is out of pocket for an undelivered meal. Not defensible. |
| **C. Refund now, recover later** | Full refund from main balance, debt recorded against the restaurant, netted off future settlements | Restaurant, eventually | Correct incentive. Requires a ledger and a negative-balance policy, and there is currently no settlement ledger at all — see §5. |
| **D. Stop splitting at payment time** | Drop `subaccount`, settle restaurants on a cycle via Paystack Transfers | FEASTY holds float | Makes refunds trivial and correct. Largest change: FEASTY becomes a money holder, with the compliance weight that carries. |

**Recommendation: C**, with A as the interim policy while the ledger is built — i.e. ship refunds that FEASTY absorbs, but record the restaurant's liability from day one so it is recoverable retrospectively once §5 exists. Do not ship refunds without recording that liability; the data cannot be reconstructed later.

## 3. Order intervention (no money movement)

This is separable from refunds and much safer. It should ship first.

**New action: `adminCancelOrder`.**

- Role: `admin` only, via `ensureRole`.
- Input: `orderId`, `reason` (required, free text), `notifyCustomer` (bool).
- Allowed only from non-terminal statuses. `TERMINAL_ORDER_STATUSES` is already defined (`delivered`, `cancelled`, `rejected`, `failed_delivery`) — reuse it rather than re-listing.
- Must reuse the **existing** cancellation path in `_shared/orders.ts` that the unpaid-checkout sweep uses, which already: sets `cancelledAt`, releases promo-cap holds, and sends the customer notification. Do not write a second cancellation that drifts from the first.
- Writes `createAuditEntry(context.uid, 'order_cancelled_by_admin', 'order', orderId, { previousStatus, reason })`.
- If the order was paid, it does **not** refund. It records that a refund is owed (see §4) and leaves the money decision explicit rather than implied.

**New action: `adminReassignDelivery`** — lower priority. Only meaningful once dispatch is live.

**Deliberately not proposed: `adminUpdateOrderStatus` as a general-purpose status setter.** An operator who can move an order to any state can mark an undelivered order `delivered`, which silently fires the `CourierEarning_on_delivery` trigger and pays a rider for a delivery that did not happen. Intervention should be a small set of named, auditable verbs, not a state editor.

## 4. Refunds

**New table: `OrderRefund`.**

```
id            text pk
orderId       text not null            -- unique: one refund record per order
amount        numeric(12,2) not null
currency      text not null default 'NGN'
reason        text not null
status        text not null            -- 'pending' | 'submitted' | 'succeeded' | 'failed'
paystackRef   text                     -- the original transaction reference
paystackId    text                     -- Paystack's refund id, once returned
restaurantLiability numeric(12,2) not null  -- see §2 option C; record it even under policy A
requestedByUid text not null
createdAt / updatedAt
lastError     text
```

RLS on, no policies — service-role only, matching `docs/rls-posture.md`.

**New action: `adminRefundOrder`.**

Non-negotiables:

1. **Idempotency by unique key, not by check-then-act.** The `orderId` unique constraint is the guard, exactly as `OrderRating.orderId` is for ratings. Insert first with `status='pending'`; a `unique_violation` means a refund already exists and the call returns that one. Never "select, then decide, then insert" — two operators clicking at once is the normal case, not the edge case.
2. **Never call Paystack before the row exists.** If the process dies between a successful Paystack call and the local write, money has moved with no record. Write `pending` → call Paystack → write `submitted` with the refund id → let the webhook move it to `succeeded`/`failed`.
3. **Amount is derived server-side from the order**, never taken from the request body. A refund amount supplied by the client is a way to refund more than was paid.
4. **Partial refunds are out of scope for v1.** They multiply the reconciliation cases and there is no ledger yet.
5. Audit entry on every attempt, including failures. `createAuditEntry` already throws rather than failing quietly, which is correct here.

**Webhook.** `paystack-webhook` must handle `refund.processed` and `refund.failed`. It already verifies signatures; extend its event switch rather than adding a second endpoint. The existing invariants test file (`paystack-webhook/invariants.test.ts`) is where the new cases belong.

## 5. The gap underneath both: there is no settlement ledger

A restaurant's "Earnings" figure in the partner app is computed client-side from order documents at menu prices (`partnerAnalytics.ts` calls it *"exactly what the kitchen is paid"*). It is an estimate, not a statement. Nothing records what Paystack actually settled, when, or against which transfer.

That gap is why option C cannot be implemented today, and it is worth closing on its own merits: a restaurant currently cannot answer "did I get paid for Tuesday?" from anything FEASTY provides.

Note the precedent already in the codebase: `CourierPayout` exists as a table with a writer function (`upsertCourierPayout`) that **has exactly one reference in the entire repository — its own declaration.** It is never called, so the rider payout card always fell through to a fallback. A settlement ledger that nothing writes to is worse than none, because it looks like one.

## 6. Open decisions for the owner

1. **Which refund-cost option (§2) is policy?** Everything else follows from this.
2. **Who may refund?** Any admin, or a narrower role? There is currently one admin role and no concept of a refund limit.
3. **Is there a value ceiling** above which a refund needs a second approver?
4. **What is the customer-facing story?** Today a customer cannot request a refund at all — there is no control and no support flow that reaches one. An operator-only refund tool assumes the customer reached a human some other way.
5. **Partial refunds** — needed at v1, or deferrable as proposed?

## 7. Suggested order of work

1. `adminCancelOrder` — no money, reuses the existing cancellation path, immediately useful. **Ship this first.**
2. Settlement ledger (§5) — unblocks correct refund accounting and fixes the partner's money-visibility gap at the same time.
3. `OrderRefund` + `adminRefundOrder` + webhook events, under whichever policy §6.1 selects.
4. Customer-facing refund request, if §6.4 calls for it.
