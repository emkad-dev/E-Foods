# Dispatch SP-4 — Platform-wide cash removal implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Remove cash as a valid payment method platform-wide. The server is the only surface that matters — the customer app already has no cash UI. This is a backend-only surgical change: no migration, no new RPC action, no app build.

**Spec:** `docs/superpowers/specs/2026-10-16-dispatch-sp4-cash-removal-design.md`

**Files:** `supabase/functions/_shared/domains/orders.ts`, `dispatch.ts`, `partner.ts`, `supabase/functions/_shared/orders.ts`

## Global Constraints

- No migration, no new RPC action, no client change.
- `placeCustomerOrder` RPC action KEPT as a stub — old clients get a 410 "Cash payments are no longer accepted." instead of an unknown-action error. Never remove it from the actions list or route map.
- Client-safe errors only (user-facing copy). Never expose raw DB/Supabase strings.
- `deno check` from `supabase/`: no new errors over the 210-error baseline. Run from `supabase/` directory only.
- Tests: update cash-exercising tests to expect rejections; no new failures overall.
- Never weaken an SP-1/SP-2/SP-3 control (dispatch eligibility gate, rate-limit, OTP delivery code, feature flag, offer redaction).
- `npm run test:deno` (full, incl. real-domains) must be green.
- Working directory: `C:\Users\emkad\EBuy\E-Foods`; `node_modules` junction: `C:\Users\emkad\EBuy\E-Foods\node_modules`.

## Task 1: Remove cash from the order-placement validation gate + stub placeCustomerOrder

**Files:** `supabase/functions/_shared/domains/orders.ts`

- [ ] **Step 1: Grep the cash surface** in `domains/orders.ts` to find all exact line numbers for: the allowed-methods array (`['cash', 'card', ...]`), the wallet error message, and the `placeCustomerOrder` handler body (from its declaration to its closing `};`).
- [ ] **Step 2: Remove `'cash'` from the allowed-methods gate** (~line 696). New array: `['card', 'bank_transfer', 'wallet']`.
- [ ] **Step 3: Update the wallet error message** (~line 702): `'Wallet payments are still coming soon. Use card or bank transfer.'` (remove "or cash").
- [ ] **Step 4: Stub `placeCustomerOrder`** — replace the entire handler body with a single `fail(410, 'Cash payments are no longer accepted. Please use card or bank transfer.');`. Remove the `prepareCustomerOrderDraft(['cash'])` call, the idempotency block, the notification sends, and the email — the whole body. Keep the function declaration and the `};` closing line. Confirm `fail` is already imported (it is, used throughout).
- [ ] **Step 5: Write a failing test** (or update existing) in a relevant test file or a new `cashRemoval.test.ts`:
  - `validateOrderData` with `paymentMethod: 'cash'` → expects a 400 error.
  - `placeCustomerOrder` handler called with any input → expects a 410 error.
  - Use the `--no-check` flag list convention if the file imports `domains/orders.ts`.
- [ ] **Step 6: Run tests** — confirm the new assertions pass. `cd supabase && deno check` no new errors.
- [ ] **Step 7: Commit** (`fix(orders): remove cash from allowed payment methods and stub placeCustomerOrder` + `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>` trailer).

## Task 2: Remove cash-collected-on-delivery from dispatch.ts and partner.ts

**Files:** `supabase/functions/_shared/domains/dispatch.ts`, `supabase/functions/_shared/domains/partner.ts`

- [ ] **Step 1: Remove the cash block from `dispatch.ts`** (~lines 1300–1307):
  ```typescript
  // Remove this entire block:
  if (nextAction === 'delivered' && sanitizeText(payment.method, 'cash') === 'cash') {
    payment.capturedAmount = roundCurrency(parseNumber((bundle.order.pricing ?? {}).total, 0));
    payment.lastEvent = 'cash_collected_on_delivery';
    payment.paidAt = nowIso();
    payment.processor = PAYMENT_PROVIDER_CASH;
    payment.reference = sanitizeText(payment.reference, `CASH-${orderId.slice(-6).toUpperCase()}`);
    payment.status = PAYMENT_STATUS.PAID;
  }
  ```
- [ ] **Step 2: Remove the same block from `partner.ts`** (~lines 1313–1322): the comment "Restaurant self-provisions delivery: when it completes the order, a cash order is collected on handoff." plus the if-block. Exact same structure — same removal.
- [ ] **Step 3: Update any dispatch or partner delivered-transition tests** that previously asserted `payment.lastEvent === 'cash_collected_on_delivery'` to instead confirm it is NOT set (the payment object is unchanged from before the delivered transition for cash-method orders).
- [ ] **Step 4: `grep -rn PAYMENT_PROVIDER_CASH supabase/`** — if zero references remain after steps 1 and 2, remove the constant from `supabase/functions/_shared/orders.ts` (line 172: `export const PAYMENT_PROVIDER_CASH = 'cash_on_delivery';`). If any other reference still exists, leave it and note in the report.
- [ ] **Step 5: Run `npm run test:deno`** (full) and `cd supabase && deno check` — green with no new errors.
- [ ] **Step 6: Commit** (`fix(dispatch,partner): remove cash-collected-on-delivery settlement path` + trailer).

---

## Final verification (after both tasks)
- `git grep -n "'cash'" supabase/functions/_shared/domains/` — only acceptable hits are comments, string literals in test rejection assertions, and any `'cash'` inside a string that is NOT a payment method value.
- `placeCustomerOrder` handler body is a single `fail(410, ...)` call.
- `PAYMENT_PROVIDER_CASH` has zero usages (removed) or is documented as retained for a specific reason.
- Full `npm run test:deno` green; `deno check` no new errors over baseline.
- No files outside `supabase/functions/_shared/` were changed (no migration, no app code, no contract copies).
