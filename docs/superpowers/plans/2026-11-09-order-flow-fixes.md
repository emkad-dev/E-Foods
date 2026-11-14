# Order flow fixes — implementation plan

Branch: `feature/order-flow-fixes` (off `main` at `6bb8ab2`). Repo root: `C:\Users\emkad\EBuy\E-Foods`.

## Spec (from the 9 Nov 2026 investigation, binding)

Evidence: order `c7655e4a` (John's Kitchen, pickup). Partner "Mark collected" succeeded at 11:18:37 but a second
`partnerUpdateOrderStatus` 9 s later got 412 "This order can no longer be updated"; the customer web screen never showed
the confirm card; `needsAttention` stayed true after completion; the acceptance escalation fired 8 s after payment.

1. Customer stale order (customer app). `apps/customer/src/services/customerReadModel.ts` caches `getCustomerOrderDetail` and
   `getCustomerOrders` for 12 s. A realtime change within 12 s of the last fetch re-reads the stale copy, and with the channel
   SUBSCRIBED no further load happens, so the screen stays stale indefinitely. Fix: a realtime-triggered or post-action reload
   always fetches fresh (bypass and refresh the cache); the cache may still dedupe ordinary first loads.
2. Partner false failure (partner app and shared auth). `packages/auth/src/backendRpc.ts` re-sends any request through
   `supabase.functions.invoke` after a transport failure, writes included. A lost 200 then produces a 412 and the partner screen
   pins "Update failed" over an order that succeeded. Fix: writes are never re-sent automatically (an opt-out the write callers
   use; reads keep the relay). On the partner order screen, after any action error, reload the order; if it is now at or past the
   status the action aimed for, treat it as success. Show a short success notice after every successful action
   ("Order accepted", "Marked ready for pickup", "Order collected. Waiting for the customer to confirm.", and so on).
3. Acceptance clock and attention flag (server). The acceptance deadline is measured from order creation, not payment, so a slow
   bank transfer eats the kitchen's time. Fix: measure from `paidAt` (falling back to creation when unpaid fields are absent,
   for old rows). `needsAttention` is cleared when the restaurant accepts, and when the order reaches a terminal status, unless a
   customer problem report set it (`customerIssueReportedAt`), which must stay flagged.
4. Pickup tracker (customer app). The pickup progress steps (`PICKUP_TRACKING_STEPS`, `packages/domain/src/orders.ts`) end at
   ready for pickup; add the collected step so a collected order reads as complete.

5. Payment refresh integrity (server). `refreshCustomerPaymentStatus` → `syncOrderPaymentState` (_shared/domains/orders.ts ~1343-1525, ~2093-2129) writes
   unconditionally: it marks money on a cancelled/rejected order as plainly paid (no needsAttention, no alert; the webhook then returns
   early), turns a refunded payment back into paid, can downgrade paid on a later 'reversed', and double-sends payment notifications
   (production: exactly 2 payment_confirmed events per paid order). Fix: one code path with the webhook's handlePaymentVerification
   (compare-and-set on the previous payment status, closed-order safeguard, single notification); never move a payment backwards.
6. Unpaid expiry (server). `maybeExpireUnpaidOrder` (_shared/orders.ts ~571-660) runs only when someone reads the order, writes
   unconditionally (can cancel an order the webhook just marked paid), uses 15 min for every method (bank transfers in production paid at
   9.5 and 31.5 min), and never updates PaymentTransaction (47 rows stuck pending). Fix: conditional update (still placed AND payment still
   pending), a scheduled sweep in queue-drainer like the other sweeps, 15 min for card and 35 min for bank transfer, PaymentTransaction
   updated in the same step. Orders whose payment FAILED are cancelled by the same sweep (three are stuck placed since 25 Jun).
7. Acceptance sweep starvation (server). `sweepUnacceptedOrders` (`_shared/acceptanceDeadlineSweep.ts`) takes the oldest 100 placed-like orders and skips unpaid ones, so 100 stale
   unpaid orders would stop every new paid order being escalated. Fix: query only paid orders.
8. Restaurant rejects a paid order (server). The reject path leaves payment 'paid' with no refund record and the promo slot held. Fix: record
   the full refund the same way cancellation does (buildRefundUpdate rate 1), release the promo redemption, set needsAttention and alert
   admins so the money can be returned by hand (real Paystack refunds remain out of scope). Record the same for dispatch failed_delivery.
9. Transition guards (server). Partner 'delivered' is allowed for platform-rider deliveries, skipping the rider and delivery code: allow it only
   for pickup and restaurant-run delivery. Customer cancel uses an unconditional update and can cancel an order the kitchen just moved to
   preparing: make it conditional on the status it checked. Scheduled release must not release an unpaid order. Delivery-code attempts must
   not be used up by a correct code or a 409 retry.
10. Admin way out (server + admin-web). No admin action can cancel or complete a pickup order past accepted, or resolve a customer problem
   report, so orders like fdc652fa stay stuck forever. Fix: admin actions to force-cancel (with the refund recorded and needsAttention set),
   force-complete, and resolve a report, each audited; buttons on the admin order view with a confirm step.
11. Admin visibility (admin-web + server reads). Dashboard hides cancelled and rejected orders, so needsAttention never shows for late payments
   on closed orders or paid rejections: attention items show regardless of status. Payouts sum PaymentTransaction 'paid' at the gross amount
   and count refunded orders: show what is owed to each restaurant (restaurantPayable) and exclude refunded or rejected orders.

Out of scope, owner decision pending: real Paystack refunds (today refunds are recorded only and no money moves) and who funds
the restaurant's share on a refunded split order. Do not change refund behaviour or wording.

## Global Constraints
- Never push, deploy, apply migrations or write to production. This plan adds no columns; if a task finds it needs one, stop and report.
- Merging to main auto-deploys functions; the controller handles that, not tasks.
- Adding an RPC action needs the four count updates (see `scripts/rpc-routes-lib.mjs` and its tests); avoid adding actions.
- Node tests are `.ts`, registered by hand in root `package.json` `test:node`; deno tests in `test:deno`. Run `npm run -s test`.
  deno: PowerShell with `$env:Path = "$env:LOCALAPPDATA\Microsoft\WinGet\Links;" + $env:Path`.
- react-native `Alert` is a no-op on web: use design-system notices. Touchables need a style and 44pt minimum.
- Each commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Match surrounding code; comments say WHY.

## Tasks

### Task 1: Fresh customer order data after a change (Spec 1, 4)
- Fresh-read path in `customerReadModel.ts` used by realtime and post-action reloads (order detail, orders list, home prompt).
- Pickup tracker collected step.
- Tests for the cache behaviour and the tracker steps.
- Commit: `fix(customer): an order change always shows, never a 12-second-old copy`.

### Task 2: No automatic resend of writes; partner success feedback (Spec 2)
- Opt-out in `backendRpc.ts` for writes; partner status actions (and other partner and customer write calls that go through it) use it.
- Partner order screen: reload-and-reconcile on error, success notice on success. Pure helper with tests for "has the order reached
  the target" across statuses and fulfilment types.
- Commit: `fix(partner): a completed action never shows as failed`.

### Task 3: Acceptance clock from payment; attention flag cleared (Spec 3)
- Server changes in the acceptance deadline logic and its sweep, and in the accept and terminal-status paths. Deno tests,
  including a slow bank transfer, an unpaid legacy row, and a reported order keeping its flag.
- Commit: `fix(orders): the acceptance clock starts at payment and completed orders stop asking for attention`.

### Task 4: Payment state integrity (Spec 5, 6, 7)
- Refresh path shares the webhook's verification; expiry sweep with conditional writes, per-method windows, PaymentTransaction kept in step,
  failed-payment orders cancelled; acceptance sweep queries paid orders only. Deno tests for each race named in the spec.
- Commit: `fix(payments): a payment never moves backwards and closed orders stay closed`.

### Task 5: Transition guards and paid rejection (Spec 8, 9)
- Reject and failed_delivery record the refund and flag attention; partner delivered guard; conditional customer cancel; scheduled release
  checks payment; delivery-code attempt counting. Deno tests.
- Commit: `fix(orders): every transition checks what it assumed`.

### Task 6: Admin way out and visibility (Spec 10, 11)
- Admin RPC actions (update all four RPC count places), admin-web order actions with confirm, dashboard attention, payouts owed.
- Commit: `feat(admin): resolve stuck orders and see what is owed`.
