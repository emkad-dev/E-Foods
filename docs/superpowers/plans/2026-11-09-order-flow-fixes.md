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
