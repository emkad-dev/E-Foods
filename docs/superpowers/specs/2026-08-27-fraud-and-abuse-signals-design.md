# Fraud and Abuse Signals

**Date:** 2026-08-27
**Status:** Draft for review

## Summary

Add a non-blocking fraud and abuse signal pipeline that surfaces suspicious
behavior to admins without changing order execution outcomes automatically.

The feature has three parts:

- **Signal capture** from the existing order, refund, and payment-verification
  flows.
- **A `RiskEvent` ledger** that stores normalized, reviewable signals.
- **A separate admin page** that lists the queue and lets an admin inspect the
  evidence behind each event.

This task is intentionally advisory only. It does **not** auto-block checkout,
refunds, or payment verification. It flags risk for human review.

## Current state being replaced

- Order placement and refund flows already exist in `supabase/functions/_shared/domains/orders.ts`.
- Payment verification already exists in
  `supabase/functions/payment-verification/handler.ts`.
- There is no shared fraud-signal model today.
- Admin review surfaces already exist in `apps/admin-web`, but the fraud queue
  is not separate yet.
- The platform already has rate-limited and idempotent patterns in several
  domains, so this task should reuse those conventions rather than inventing a
  parallel style.

## Design

### 1. RiskEvent ledger

Add a new private table, `RiskEvent`, in Supabase.

Proposed shape:

| column | type | notes |
|---|---|---|
| `id` | String | primary key |
| `eventType` | String | normalized signal name |
| `severity` | String | `low`, `medium`, `high` |
| `subjectType` | String | `order`, `account`, `device`, `card`, `payment` |
| `subjectId` | String | the thing being scored |
| `actorUid` | String? | the authenticated user, when available |
| `orderId` | String? | linked order, when relevant |
| `score` | Int | integer score for ranking |
| `reason` | String | human-readable summary |
| `metadata` | Json | small structured payload for review |
| `createdAt` | DateTime | |
| `updatedAt` | DateTime | |

Rules:

- Rows are append-only for signal capture. If the same logical signal is
  re-evaluated for the same subject, upsert by a stable `dedupeKey` rather than
  creating duplicates.
- The table remains service-role only.
- Admins read it through an RPC, not directly from the client.

### 2. Signal sources

Capture three classes of signals:

1. **Velocity checks**
   - orders per account per hour
   - orders per device per hour
   - orders per card per hour
2. **Refund-abuse scoring**
   - repeated refunds on the same account
   - repeated refunds on the same payment instrument
   - repeated refunds on the same order history pattern
3. **Duplicate / replay / anomaly signals**
   - duplicate checkout attempts for the same order draft
   - repeated payment-verification failures for the same transaction
   - suspicious timing patterns that already exist in the flow and can be scored
     from current state

The scoring rules should be deterministic and threshold-based. Each rule
produces a `RiskEvent` row when it crosses the threshold and produces nothing
below it.

### 3. Where signals are emitted

Emit signals from the existing backend flows:

- `placeCustomerOrder` and the shared order-draft helpers in
  `supabase/functions/_shared/domains/orders.ts`
- refund or reversal handling in the same domain where the refund state is
  finalized
- `payment-verification/handler.ts` when the payment state indicates a pattern
  worth review

The capture points should be thin. They should calculate or fetch the counters,
derive the risk result, and write a `RiskEvent` row. They should not move money,
cancel orders, or change payment state.

### 4. Admin review page

Add a separate admin page in `apps/admin-web`, not the existing approvals page.

Page behavior:

- Default view is the queue, sorted by severity and recency.
- Each row shows the event type, subject, score, reason, and created time.
- The detail panel shows the attached metadata and linked order or payment
  context.
- The page supports filtering by event type and severity.
- There is no approve/reject action that mutates the underlying order or
  payment. Review is observational only in this task.

The page is meant to give admins context quickly, not to be a workflow engine.

### 5. API surface

Add one or two RPC actions, depending on how much reuse the data model allows:

- `adminGetRiskEvents`
- `adminGetRiskEventDetail`

If the detail page can be built from the list payload alone, keep the API to one
action. Prefer the smallest surface that still keeps the UI responsive.

### 6. Thresholds

Keep thresholds explicit and testable.

Initial design:

- account velocity: flag at a high count per hour, with a lower count as a
  medium-severity warning
- device velocity: flag at a slightly higher count than account velocity, since
  one device can legitimately serve multiple family members
- card velocity: flag aggressively, because one payment instrument should not
  fan out across many unrelated accounts in a short window
- refund abuse: flag when repeated refund attempts or refund-heavy histories
  exceed a per-user threshold

The exact numbers should be coded once and covered by tests. They should not be
spread across the UI.

### 7. Admin UX

Use a dedicated admin route with the same visual system as the rest of the admin
web app:

- table/list on desktop
- stacked cards on mobile
- clear severity badges
- compact metadata rows
- empty state that explains the queue is advisory, not a blocklist

The page should feel operational, not noisy.

## Error handling

- Signal capture failures must not block checkout, payment verification, or
  refund completion.
- If RiskEvent persistence fails, log server-side and continue the primary flow.
- The admin page should degrade gracefully when the queue is empty or the RPC
  errors.
- All user-facing messages stay generic. Do not leak scoring internals into
  customer flows.

## Testing

Unit tests:

- each velocity rule fires at or above threshold
- each velocity rule stays silent below threshold
- refund-abuse scoring fires only when the history pattern crosses the limit
- duplicate/replay detection does not emit repeated rows for the same logical
  signal
- admin queue sorting respects severity and recency

Integration tests:

- order placement can still succeed when a signal is written
- payment verification can still succeed when a signal is written
- refund completion can still succeed when a signal is written
- the admin queue renders the emitted risk row in the separate page

## Rollout

1. Add the `RiskEvent` table and the RPC actions.
2. Wire the signal capture points into the existing flows.
3. Add the separate admin page.
4. Verify the queue with unit and integration tests.

## Out of scope

- Auto-blocking or auto-canceling orders
- Automated account bans
- Machine-learning scoring
- External fraud-provider integration
- Customer-visible fraud messaging

