# Customer order confirmation — implementation plan

Branch: `feature/customer-order-confirmation` (off `main` at `93cc785`). Repo root: `C:\Users\emkad\EBuy\E-Foods`.

## Spec (agreed with the user, binding)

After a RESTAURANT marks an order delivered/collected, the customer closes the loop:

1. Applies to orders the restaurant completes through the partner `delivered` action: delivery AND collection
   (`fulfillmentType` `delivery` and `pickup`). Rider orders completed with the customer's delivery code are already
   confirmed by the code and never enter this flow. Orders delivered before this ships never enter it (no backfill).
2. Customer order screen shows two actions while awaiting confirmation:
   - Primary: "I received my order" (delivery) / "I've collected my order" (collection). Closes the order.
   - Secondary: "Report a problem": asks for a short description (required, max 500 chars), STOPS the auto-close
     timer, flags the order for FEASTY (`needsAttention = true`, admins notified) and posts it to the customer's
     support thread with the order number. The customer can still confirm afterwards.
3. Auto-close: 3 hours after the restaurant marked it complete, unless reported or already confirmed.
4. Exactly 3 reminders while unconfirmed and unreported: 30, 90 and 150 minutes after completion. The 150-minute one
   says the order closes in 30 minutes.
5. Quiet hours: no reminder pushes 22:00-07:00 Africa/Lagos (UTC+1, no DST). A stage falling due in quiet hours is
   not sent then; the first sweep after 07:00 sends at most ONE reminder (the latest due stage) and marks earlier
   stages consumed. Auto-close still happens during quiet hours, silently.
6. Push is not the only signal: web customers have no push. Customer order screen AND home screen show an
   in-app prompt while an order is awaiting confirmation.
7. Restaurant's order screen shows the state: "Waiting for customer to confirm" / "Customer confirmed" /
   "Closed automatically" / "Customer reported a problem".
8. Confirming does not move money. `status` stays `delivered`; confirmation is recorded in new fields. No new status:
   stats, ratings and reports treat `delivered` as final and must keep working unchanged.

Out of scope (parked by the user): pickup codes, blocking restaurants from completing rider orders, admin screens.

## Data model

Migration `supabase/migrations/20261104_customer_order_confirmation.sql` on `CustomerOrder`, additive and nullable:
- `customerConfirmDueAt timestamptz` (set ONLY by the partner `delivered` action to completion + 3h; null = not in flow)
- `customerConfirmedAt timestamptz`
- `customerConfirmationSource text` check in ('customer','auto')
- `customerConfirmRemindersSent integer not null default 0`
- `customerIssueReportedAt timestamptz`
- Partial index on `customerConfirmDueAt` where `customerConfirmedAt is null and customerConfirmDueAt is not null`.

## Global Constraints

- DEPLOY ORDER IS CRITICAL. `CUSTOMER_ORDER_COLUMNS` is selected on every order read: if code naming these columns
  deploys before the migration is applied, ALL order reads fail (this exact drift took down checkout on 2026-09-19).
  Merging to main auto-deploys functions. The human applies the migration first. Never apply it, never deploy, never
  push from a task. Migration must be idempotent (`add column if not exists`).
- Adding an RPC action needs FOUR count updates plus the handlers map: `supabase/functions/_shared/rpc/actions.ts`,
  `scripts/rpc-routes-lib.mjs` (`EXPECTED_DOMAIN_ACTION_COUNTS`, `EXPECTED_TOTAL_ACTION_COUNT`), then
  `npm run generate:rpc-routes`, `packages/domain/src/rpcRoutes.test.ts` (map, total, and literal counts in two test
  NAMES), `supabase/functions/_shared/rpc/registry.test.ts` (list, `DOMAIN_ACTION_LISTS`, count literals),
  `supabase/functions/_shared/rpc/registry.real-domains.test.ts`. The last only fails in the full `npm run test:deno`.
- Node tests are `.ts` and registered by hand in root `package.json` `test:node`; deno tests in `test:deno`
  (handler tests that import domain modules go in the `--no-check` list, see
  `supabase/functions/_shared/domains/adminApprovalQueueOnboarding.test.ts` for the real-handler harness).
- deno may need `C:\Users\emkad\AppData\Local\Microsoft\WinGet\Links` prepended to PATH (PowerShell works). Run
  `npm run -s test` for everything.
- `Alert` from react-native is a no-op on web: never use it. Use design-system `useConfirm`, inline notices, `BusyLabel`.
- Touchables need a style and a 44pt minimum (`scripts/uiContract.test.ts`).
- Errors to clients go through the existing safe-error conventions (`fail(...)`, `toUserMessage`).
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Match surrounding code; comments say WHY.

## Tasks

### Task 1: Migration, pure rules, confirm + report RPCs, partner sets the deadline

- Write the migration above.
- New pure module `supabase/functions/_shared/customerConfirmation.ts` (no client imports), with tests:
  `CUSTOMER_CONFIRM_WINDOW_MS` (3h), reminder offsets 30/90/150 min, `isLagosQuietHours(now)`,
  `getReminderDecision({ dueAt, remindersSent, now })` returning the stage to send (1-3) or null per Spec 4-5 (latest
  due stage only; null in quiet hours; null at/after dueAt), `isAwaitingCustomerConfirmation(order)`.
- Add the five columns to `CUSTOMER_ORDER_COLUMNS` and the row type; expose `customerConfirmDueAt`,
  `customerConfirmedAt`, `customerConfirmationSource`, `customerIssueReportedAt` in `toOrderSnapshotResponse`
  (`supabase/functions/_shared/orders.ts`), and as optional fields on `OrderDocument`
  (`packages/domain/src/entities.ts`). Reminder count stays server-only.
- Partner `delivered` action (`supabase/functions/_shared/domains/partner.ts`): set `customerConfirmDueAt` to now + 3h in
  the same write that sets `delivered`. No other path sets it (dispatch delivery-code completion must not).
- Two feasty-orders RPCs in `supabase/functions/_shared/domains/orders.ts`, owner-only like the neighbouring customer
  actions:
  - `customerConfirmOrderReceived { orderId }`: only when in the flow and `delivered`; compare-and-swap on
    `customerConfirmedAt is null`; source `customer`; already-confirmed returns success without a second write;
    broadcast order changed; tell the restaurant with an order-update push.
  - `customerReportOrderProblem { orderId, message }`: required, sanitized, max 500 chars; only while unconfirmed and
    in the flow; sets `customerIssueReportedAt` once and `needsAttention = true`; posts the message prefixed with the
    short order number to the customer's support thread the way `customerSendSupportMessage` does (reuse its logic and
    rate limit, don't duplicate it; read around `orders.ts:2318`); `notifyAdmins`; a repeat report returns success
    without duplicating anything.
- Tests: real-handler deno tests for ownership, state guards, CAS/idempotence, partner deadline set, rider path not set.
- Commit: `feat(orders): customer confirmation fields, rules and confirm/report actions`.

### Task 2: Reminder + auto-close sweep

- `supabase/functions/_shared/customerConfirmationSweep.ts`, modelled on `acceptanceDeadlineSweep.ts` (never throws,
  bounded per run, one bad order can't abort the batch), called from `supabase/functions/queue-drainer/index.ts` next to
  the other sweeps when `queueSelection === 'all'`, and included in its response/heartbeat like them.
- Candidates: `customerConfirmDueAt not null`, `customerConfirmedAt null`, `customerIssueReportedAt null`, status delivered.
- Reminder: claim with compare-and-swap on `customerConfirmRemindersSent` BEFORE pushing so overlapping sweeps can't
  double-send. `notifyUsers` to the customer with `routeKey: 'customer_order_detail'`; copy per stage, wording by
  fulfilment type; stage 3 says it closes in 30 minutes.
- Auto-close at/after due: compare-and-swap, source `auto`, no push, broadcast order changed.
- Deno tests: each stage once, quiet hours, catch-up sends one, reported/confirmed skipped, CAS loser doesn't push,
  auto-close, a throwing order doesn't stop the rest.
- Commit: `feat(orders): reminder and auto-close sweep for customer confirmation`.

### Task 3: Customer app

- Service functions for both RPCs next to the existing cancel-order service; add `order.customerConfirm*` usage.
- `apps/customer/app/(customer)/orders/[id].tsx`: awaiting state card with the two actions (labels per Spec 2), the deadline
  as a friendly time ("Closes automatically at 9:40 PM"), `BusyLabel` while working. Report opens an in-screen form
  (multi-line input, 500 limit, required) rather than a native alert. States after: confirmed ("Thanks, order closed"),
  auto-closed ("Closed automatically. Problem? Contact support" linking to support), reported ("We're looking into this"
  with support link, confirm still available).
- Home screen prompt: a small card for the most recent order awaiting confirmation, from data the home screen already
  has or a cheap existing read (do NOT add a new poll); tapping opens the order. Absent when nothing is awaiting.
- Pure helper with tests for which state to show, `apps/customer/src/domain/orderConfirmation.ts`, registered in `test:node`.
- Commit: `feat(customer): confirm received or report a problem after delivery`.

### Task 4: Partner app

- `apps/partner/app/(partner)/order/[id].tsx`: one status line per Spec 7, from the snapshot fields, only when in the flow.
  Pure helper + test if there's any logic worth testing; add optional fields to the partner order type if it has its own.
- Commit: `feat(partner): show customer confirmation state on the order`.
