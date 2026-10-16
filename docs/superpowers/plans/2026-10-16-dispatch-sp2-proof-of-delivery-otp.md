# Dispatch SP-2 — Proof-of-Delivery OTP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A 4-digit customer-held delivery code that a rider must enter to mark a dispatch-delivered order `delivered`; customer-only visibility, brute-force bounded, admin override for disputes.

**Architecture:** One owner-applied migration adds `deliveryCode`/`deliveryCodeVerifiedAt`/`deliveryCodeAttempts` to `CustomerOrder`. The code is generated at order placement for delivery orders, exposed only through the customer's own order detail, projected out of every rider-facing payload, and verified (constant-time) on the dispatch `delivered` transition. Customer app shows it when out-for-delivery; dispatch app collects it (built behind the still-off gate).

**Tech Stack:** Deno/TS Supabase edge functions, PostgREST `serviceClient`, `_shared/crypto.ts` (`constantTimeEqual`), Expo/React Native apps.

**Spec:** `docs/superpowers/specs/2026-10-16-dispatch-sp2-proof-of-delivery-otp-design.md`

## Global Constraints

- SP-2 adds exactly ONE migration file, committed, **applied by the owner** — never `supabase db push`. Match the placement/convention of recent dispatch migrations (check whether they live in `functions/prisma/migrations` or `supabase/migrations` and follow it).
- The delivery code is **customer-only**. It must never appear in any rider/dispatch-facing payload (`dispatchGetDeliveryQueue`, `dispatchGetOrderDetail`, offer snapshots, `toOrderSnapshotResponse`). This is a hard, tested invariant.
- Backend errors are client-safe (`ClientSafeError`/`fail`). Code comparison uses `constantTimeEqual` from `_shared/crypto.ts`. Generation uses `crypto.getRandomValues` (secure), never `Math.random`.
- `deno check` from `supabase/`: no new errors over the ~210 baseline. Register every new `*.test.ts` in the matching `test:deno` list (type-checked list for clean modules; `--no-check` list for anything importing `dispatch.ts`/`orders.ts` via `client.ts`).
- App code: customer + dispatch typecheck and lint green. Do not weaken any SP-1 control. Do not add or change cash behaviour (SP-4 owns cash removal).
- No new RPC action; the `delivered` action gains a `deliveryCode` parameter. If that touches the action contract tests, update all required copies ([[feasty-rpc-action-count-guards]]).

## Review Focus

- **A rider fetching the delivery queue or order detail for an order assigned to them** must NOT receive `deliveryCode` in any field. (Task 2 test.)
- **A `delivered` action with a missing, wrong, or well-formed-but-incorrect code** must be rejected; the 6th wrong attempt must be locked (429). (Task 3 test.)
- **An order placed for pickup (not delivery)** should not require or generate a code, and its `delivered`/completion path must be unaffected. (Task 1 + Task 3 tests.)
- **A customer viewing someone else's order** must never see its code (ownership gate already exists — confirm the code rides behind it). (Task 2 test.)
- **An admin marking delivered without a code** must succeed and write an audit event. (Task 3 test.)

---

## File Structure
- NEW migration: `…/2026XXXX_delivery_code.sql` — three columns on `CustomerOrder`.
- `supabase/functions/_shared/deliveryCode.ts` (NEW) — pure `generateDeliveryCode(): string` + `isValidDeliveryCodeFormat(s): boolean` + `DELIVERY_CODE_MAX_ATTEMPTS = 5`.
- `supabase/functions/_shared/domains/orders.ts` — set the code in `prepareCustomerOrderDraft` for delivery orders; add the three columns to the order-columns select; expose `deliveryCode` in `customerGetOrderDetail` (customer-only, live-only).
- `supabase/functions/_shared/domains/dispatch.ts` — enforce the code on the `delivered` action in `dispatchUpdateOrderStatus`.
- `apps/customer/app/(customer)/orders/[id].tsx` — show the code when out-for-delivery.
- `apps/dispatch/app/(dispatch)/delivery/[id].tsx` — code-entry on the delivered action.
- Tests: `deliveryCode.test.ts`, `deliveryCodeScoping.test.ts`, `deliveryCodeGate.test.ts`.

Before Task 1, confirm where `CUSTOMER_ORDER_COLUMNS` is defined (grep across `_shared`) and whether `loadOrderBundle` feeds both customer and dispatch reads — it does, which is why Task 2's projection-out matters.

---

### Task 1: Migration + code generation at placement

**Files:**
- Create: migration `…_delivery_code.sql`
- Create: `supabase/functions/_shared/deliveryCode.ts`
- Modify: `supabase/functions/_shared/domains/orders.ts` (`prepareCustomerOrderDraft` ~675; the order-columns select used by `loadOrderBundle`)
- Test: `supabase/functions/_shared/deliveryCode.test.ts`

**Interfaces:**
- Produces: `generateDeliveryCode(): string` — a 4-char string `'0000'`–`'9999'` from `crypto.getRandomValues`; `isValidDeliveryCodeFormat(s: string): boolean` — exactly 4 ASCII digits; `DELIVERY_CODE_MAX_ATTEMPTS = 5`.

- [ ] **Step 1: Write the failing test** — assert `generateDeliveryCode()` returns `/^\d{4}$/`, that 1000 draws are all 4-digit and include a leading-zero case over enough draws, and `isValidDeliveryCodeFormat` accepts `'0007'`, rejects `'12'`, `'12a4'`, `'12345'`, `''`.
- [ ] **Step 2: Run it, confirm fail** (module missing).
- [ ] **Step 3: Implement `deliveryCode.ts`** using `crypto.getRandomValues(new Uint32Array(1))` → `% 10000` → `String(...).padStart(4,'0')`.
- [ ] **Step 4: Run it, confirm pass.**
- [ ] **Step 5: Migration** — add `deliveryCode text`, `deliveryCodeVerifiedAt timestamptz`, `deliveryCodeAttempts integer not null default 0` to `CustomerOrder`, following the exact DDL style of the newest dispatch migration in the repo.
- [ ] **Step 6: Generate at placement** — in `prepareCustomerOrderDraft`, when the draft is a `delivery` order, set `deliveryCode: generateDeliveryCode()` on the `orderInsert` object (so BOTH the single-order and grouped insert paths carry it). Pickup orders get no code (leave null). Add the three new columns to the order-columns select constant that `loadOrderBundle` uses so later reads see them.
- [ ] **Step 7: deno check + full `npm run test:deno`** — no new errors; register `deliveryCode.test.ts` in the type-checked list.
- [ ] **Step 8: Commit** (`feat(dispatch): generate a delivery code for delivery orders` + the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer).

### Task 2: Customer-only exposure + rider-payload scoping

**Files:**
- Modify: `supabase/functions/_shared/domains/orders.ts` (`customerGetOrderDetail` ~1473)
- Audit: `toOrderSnapshotResponse` (~189) and the dispatch handlers in `domains/dispatch.ts`
- Test: `supabase/functions/_shared/deliveryCodeScoping.test.ts`

**Interfaces:** Consumes `generateDeliveryCode` output on the order row. Produces: `customerGetOrderDetail` response includes `deliveryCode` (string|null) for the owner while the order is live (not terminal); every dispatch/rider payload omits it.

- [ ] **Step 1: Write the failing test** — a handler-level test (fake `serviceClient`, env stubs, `--no-check` list): (a) `customerGetOrderDetail` as the owner of a live delivery order returns `deliveryCode`; (b) as a terminal/delivered order it is null/absent; (c) `dispatchGetDeliveryQueue` and `dispatchGetOrderDetail` for the same order return NO `deliveryCode` anywhere in the payload (assert the serialized JSON does not contain the code string).
- [ ] **Step 2: Run, confirm fail.**
- [ ] **Step 3: Expose for the customer** — in `customerGetOrderDetail`, add `deliveryCode` to the returned order shape, sourced from `bundle.order.deliveryCode`, returned only when the normalized status is non-terminal (hide once `delivered`/cancelled). The existing ownership gate (`customerId !== context.uid` → 403) already protects it.
- [ ] **Step 4: Confirm rider payloads exclude it** — verify `toOrderSnapshotResponse` builds an explicit object that does NOT copy `deliveryCode`; if any dispatch handler spreads the raw order row, project the field out. Add nothing to rider shapes.
- [ ] **Step 5: Run, confirm pass; full suite + deno check.** Register the test in the `--no-check` list.
- [ ] **Step 6: Commit** (`feat(dispatch): expose delivery code to the customer only, never to riders`).

### Task 3: Enforce the code on the delivered transition

**Files:**
- Modify: `supabase/functions/_shared/domains/dispatch.ts` (`dispatchUpdateOrderStatus` ~1152, the `delivered` branch)
- Test: `supabase/functions/_shared/deliveryCodeGate.test.ts`

**Interfaces:** Consumes `data.deliveryCode`, the order's `deliveryCode`/`deliveryCodeAttempts`, `constantTimeEqual`, `DELIVERY_CODE_MAX_ATTEMPTS`.

- [ ] **Step 1: Write the failing test** (handler-level, `--no-check`): for `action:'delivered'` on a dispatch-owned delivery order with stored code `'1234'`: (a) missing `deliveryCode` → 400, status unchanged; (b) wrong code → 400 and `deliveryCodeAttempts` incremented; (c) correct `'1234'` → success, `deliveryCodeVerifiedAt` stamped, order transitions; (d) a 6th wrong attempt (attempts already 5) → 429; (e) an `admin`-role caller with no code → success + a `DeliveryEvent` `delivery_code_overridden` written with the admin uid.
- [ ] **Step 2: Run, confirm fail.**
- [ ] **Step 3: Implement the gate** — in the `delivered` branch, before the status write: if `context.role !== 'admin'`, require `isValidDeliveryCodeFormat(data.deliveryCode)` and `constantTimeEqual(data.deliveryCode, order.deliveryCode)`. If `deliveryCodeAttempts >= DELIVERY_CODE_MAX_ATTEMPTS` → `fail(429, 'Too many incorrect delivery codes. Contact support to complete this delivery.')`. On mismatch: increment `deliveryCodeAttempts` (a targeted update) then `fail(400, 'That delivery code is incorrect.')`. On match: include `deliveryCodeVerifiedAt = nowIso()` in the update. For `admin`: skip the code check and `insertDeliveryEvent({ eventType:'delivery_code_overridden', actorUid: context.uid, orderId, details:{} })`. Do not touch the cash branch.
- [ ] **Step 4: Run, confirm pass; full suite + deno check** (no new errors).
- [ ] **Step 5: Commit** (`feat(dispatch): require the customer delivery code to mark an order delivered`).

### Task 4: Customer app — show the code when out for delivery

**Files:**
- Modify: `apps/customer/app/(customer)/orders/[id].tsx`
- Test: a unit test on the display predicate if the screen exposes one; else a typecheck/lint gate + a render check.

- [ ] **Step 1:** Read the order screen; find where the fetched order detail (which now carries `deliveryCode`) is rendered and the status is known.
- [ ] **Step 2:** Add a prominent card/row showing the 4-digit `deliveryCode` with the label "Give this code to your rider at handoff", visible only when the normalized status is `picked_up` or `on_the_way` and a code is present; hidden otherwise (including once delivered).
- [ ] **Step 3:** Match the existing design-system primitives/theme used on that screen (no raw hex; reuse the card/typography components already imported there).
- [ ] **Step 4:** `npm --prefix apps/customer run typecheck` and lint green. If the repo's render-fixture harness ([[feasty-render-fixture-limits]]) can show the customer order screen signed-in, verify the code renders for an out-for-delivery fixture and is absent otherwise; otherwise assert the display predicate in a small unit test.
- [ ] **Step 5: Commit** (`feat(customer): show the delivery code on the order screen when out for delivery`).

### Task 5: Dispatch app — collect the code on delivered

**Files:**
- Modify: `apps/dispatch/app/(dispatch)/delivery/[id].tsx`
- Test: typecheck/lint gate (dispatch app is gated off until SP-6; a render check is not reachable).

- [ ] **Step 1:** Read the delivery detail screen; find the "Mark delivered" action and the service call it makes (it dispatches the `delivered` action via the dispatch backend RPC).
- [ ] **Step 2:** Replace the bare button with a 4-digit code-entry step (a numeric input + confirm) that passes `deliveryCode` in the `delivered` action payload. Surface the incorrect-code (400) and locked (429) states with the server's client-safe message.
- [ ] **Step 3:** Reuse existing dispatch design-system primitives; keep it consistent with the app's other action sheets.
- [ ] **Step 4:** `npm --prefix apps/dispatch run typecheck` and lint green.
- [ ] **Step 5: Commit** (`feat(dispatch): collect the customer delivery code before marking delivered`).

---

## Final verification (whole-branch, after all tasks)
- `npm run test:deno` green; `cd supabase && deno check` no new errors.
- Customer + dispatch typecheck + lint green.
- `git grep -n deliveryCode supabase/functions` — confirm the field is selected only into customer-facing reads and the generation path, never into a rider/dispatch response shape.
- Migration file present and parseable; PR-body note: owner applies the migration before deploy; `delivered` now requires `deliveryCode` for dispatch riders.
