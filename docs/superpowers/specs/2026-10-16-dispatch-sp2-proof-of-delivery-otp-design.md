# Dispatch SP-2 — Proof of delivery (delivery OTP) design spec

Date: 2026-10-16. Branch: `feature/dispatch-glovo-sp1` (SP-2 stacks on SP-1; one accumulating dispatch feature branch, merged by the owner once). Worktree: `C:\Users\emkad\EBuy\dispatch-glovo-wt`.

## Context & intent

Second sub-project of the dispatch Glovo-standard overhaul. SP-1 (security hardening) is complete and review-clean. SP-2 adds **proof of delivery**: a short code the customer holds and the rider must enter to complete the handoff, so an order cannot be marked `delivered` without the customer confirming receipt. This is the single most important integrity control for a delivery network — it stops a rider (or a bug) closing an order the customer never received, and it is the Glovo/Uber Eats default.

Standing decisions carried in: one-city pilot (~30 riders), phased rollout, **cash strictly removed platform-wide (SP-4)**. OTP is the user-selected safeguard (alongside live-tracking, already present, and SOS in SP-5). Photo proof was explicitly deferred.

Success = a rider-dispatched delivery order can only reach `delivered` when the rider supplies the customer's delivery code (or an admin overrides for a dispute); the code is visible to the customer and never to the rider before handoff; brute-forcing the code is bounded; and the whole thing is migration-committed (owner-applied) + tested, with the customer-facing display live and the rider-facing entry built behind the still-off dispatch gate.

## Scope

### Data model (one migration, committed, OWNER-APPLIED — never `supabase db push`)
Add to `CustomerOrder` (via a new migration file following the repo's existing migration conventions — check `functions/prisma/migrations` vs `supabase/migrations` placement used by recent dispatch migrations and match it):
- `deliveryCode text` — the plaintext 4-digit handoff code (nullable; set when the order enters a delivery flow).
- `deliveryCodeVerifiedAt timestamptz` — stamped when a rider enters the correct code.
- `deliveryCodeAttempts integer not null default 0` — wrong-entry counter for brute-force bounding.

Ruling — plaintext not hashed: the customer must display the code, so it has to be retrievable in clear. It is a low-value, per-order, single-use 4-digit code with a 5-attempt lock; hashing it would break the customer display for no real gain. It is protected by *access scoping* (below), not secrecy at rest. Cost if wrong: a later migration hashes it and moves display to a reveal endpoint.

### Code generation
- A 4-digit numeric code (`1000`–`9999`; leading-zero-safe stored as text) is generated server-side and written to `deliveryCode` when an order first enters a delivery fulfilment flow — specifically at order placement for any `fulfillmentType === 'delivery'` order (so it exists before any rider is involved and the customer can see it early). Reuse the repo's existing secure RNG in `_shared/crypto.ts` (the same module behind other OTPs) rather than `Math.random`.
- Ruling — 4 digits: matches Glovo/Uber, easy to read aloud at a doorstep; the 5-attempt lock makes 4 digits safe enough (≤5/9000 guess chance). Cost if wrong: widen to 6 in a migration + generator change.

### Access scoping (the security core)
- `customerGetOrderDetail` includes `deliveryCode` **only for the order's own customer** (it already gates on ownership) and only while the order is live (not after `delivered`/terminal — once verified it may be nulled or simply hidden).
- The code MUST NOT appear in ANY dispatch/rider-facing payload: audit `toOrderSnapshotResponse` and every dispatch handler (`dispatchGetDeliveryQueue`, `dispatchGetOrderDetail`, offer snapshots) to confirm `deliveryCode` is never selected into a rider-visible shape. `CUSTOMER_ORDER_COLUMNS` likely feeds both customer and dispatch reads — if so, the dispatch path must project it out. This is the SP-1 discipline applied to the new field; a leak here defeats the whole control.

### Enforcement on the delivered transition
- In `dispatchUpdateOrderStatus` (`domains/dispatch.ts` ~1152), for `nextAction === 'delivered'`:
  - Require `data.deliveryCode` (a 4-digit string). Compare against the order's `deliveryCode` using the constant-time compare in `_shared/crypto.ts`.
  - On match: allow the transition; stamp `deliveryCodeVerifiedAt`; proceed exactly as today (minus cash — see below).
  - On mismatch: increment `deliveryCodeAttempts`; `fail(400, 'That delivery code is incorrect.')`. After 5 failed attempts, `fail(429, …)` and do not allow further attempts until an admin intervenes.
  - **Admin override:** an `admin`-role caller may mark `delivered` WITHOUT a code (dispute/edge handling). Record a `DeliveryEvent` (`delivery_code_overridden`) capturing the admin uid so the override is auditable.
- The partner self-delivery `delivered` path (`partner.ts` ~1313) is OUT of SP-2 scope (it is a different operator and the current live model; proof-of-delivery for self-delivery is a later decision). Note it explicitly; do not change it here.
- Cash interaction: leave the existing cash-settle branch in `dispatchUpdateOrderStatus` untouched here — SP-4 removes cash platform-wide. SP-2 must not add any new cash behaviour.

### Client
- **Customer app (live):** on the order tracking screen (`apps/customer/app/(customer)/orders/[id].tsx`), show the delivery code prominently once the order is out for delivery (status `picked_up`/`on_the_way`), with a short "Give this code to your rider at handoff" label. Read it from the customer order detail the screen already fetches. Hide it once `delivered`.
- **Dispatch app (built, gated off until SP-6):** on the delivery detail screen (`apps/dispatch/app/(dispatch)/delivery/[id].tsx`), replace the bare "Mark delivered" button with a code-entry step (4-digit input) that sends `deliveryCode` in the `delivered` action; surface the incorrect-code and locked states. This is reachable only after SP-6 flips `DISPATCH_ENABLED`, but is built and tested now.

## Out of scope
- Partner self-delivery OTP; photo proof; SOS (SP-5); availability (SP-3); payouts/cash removal (SP-4); flipping any gate.

## Global constraints
- SP-2 adds ONE migration — committed, applied by the owner. Never `supabase db push`.
- Backend changes are client-safe-error only (`ClientSafeError`/`fail`). Constant-time compare for the code (`_shared/crypto.ts`), secure RNG for generation.
- The code is customer-only: no rider-facing payload may carry it. This is a hard security invariant, tested.
- `deno check` from `supabase/`: no new errors over the baseline. New deno tests for generation, scoping (code absent from dispatch snapshot), and the delivered-gate (match / mismatch / lockout / admin override). App code: typecheck + lint green for customer and dispatch.
- Do not weaken any SP-1 control. Do not regress the normal offer→accept→pickup→deliver flow when `platform_dispatch` is on.
- No new RPC action is added (the `delivered` action gains a parameter); if a parameter addition touches the action contract/tests, update all required copies ([[feasty-rpc-action-count-guards]]).

## Testing / verification bar
- Deno: code generation is 4-digit + uses crypto RNG; `deliveryCode` is absent from `dispatchGetDeliveryQueue`/`dispatchGetOrderDetail`/offer snapshots (scoping test); `delivered` with no/incorrect code is rejected, correct code succeeds and stamps `verifiedAt`, 6th wrong attempt is 429, admin override succeeds + writes the audit event.
- Customer app: the code renders on the order screen when out-for-delivery and is hidden otherwise (render check per [[feasty-ui-defects-need-rendering]] if feasible; at minimum typecheck/lint + a unit test on the display predicate).
- Migration file present and parseable; a note in the PR body that the owner applies it before deploy.
