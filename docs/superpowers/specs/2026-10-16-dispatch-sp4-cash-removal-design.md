# Dispatch SP-4 — Platform-wide cash removal design spec

Date: 2026-10-16. Branch: `main`. All work in `E-Foods/`.

## Context & intent

Standing product decision (user-set): **cash payment/orders strictly removed, platform-wide.** SP-4 enforces this at the server layer. The customer app already has no cash UI. The server still accepts and settles cash orders — this spec closes that gap.

SP-4 is split into two sub-goals:
1. **Cash removal** — server rejects cash at the validation gate; dead code paths removed. No migration, no app change, no RPC contract change.
2. **Paystack automated payouts** — restaurant receives funds automatically after delivery. GATED: requires the unmerged partner KYC/subaccount work (`worktree-partner-onboarding-kyc`, Tasks 4–6 + their migration). Payouts cannot ship until that work is merged and the migration applied. SP-4 ships cash removal alone; payouts are SP-4b, deferred.

## Cash removal — scope

### Why `placeCustomerOrder` exists
The `placeCustomerOrder` RPC action is the cash-only checkout path — `prepareCustomerOrderDraft` is called with `['cash']` as the allowed methods. `initializeCustomerPayment` is the Paystack path (`['card', 'bank_transfer']`). Removing cash makes `placeCustomerOrder` unreachable by any valid client, but the RPC action is kept (old clients receive a clear rejection rather than an unknown-action error).

### Server changes (no migration, no new RPC action)

**`supabase/functions/_shared/domains/orders.ts`**

1. **Validation gate** (`~line 696`): remove `'cash'` from the allowed methods array:
   ```typescript
   // Before:
   if (!['cash', 'card', 'bank_transfer', 'wallet'].includes(paymentMethod)) {
   // After:
   if (!['card', 'bank_transfer', 'wallet'].includes(paymentMethod)) {
   ```

2. **Wallet error message** (`~line 702`): remove "or cash" from the copy:
   ```typescript
   // Before: 'Wallet payments are still coming soon. Use card, bank transfer, or cash for now.'
   // After:  'Wallet payments are still coming soon. Use card or bank transfer.'
   ```

3. **`placeCustomerOrder` handler** (`~line 1653`): replace the body with an immediate rejection:
   ```typescript
   const placeCustomerOrder: Handler = async () => {
     fail(410, 'Cash payments are no longer accepted. Please use card or bank transfer.');
   };
   ```
   This keeps the RPC contract intact for old clients but immediately rejects them with a clear, client-safe message. The `prepareCustomerOrderDraft` call, notification sends, and email are all removed along with the body.

4. **Notification titles** (`~lines 1773, 1785`): Once `placeCustomerOrder` is a stub, these become dead code. They are removed as part of step 3.

**`supabase/functions/_shared/domains/dispatch.ts`**

5. **Cash-collected block** (`~lines 1300–1307`): remove entirely — a cash order can no longer reach this point. The lines that set `payment.lastEvent = 'cash_collected_on_delivery'` etc. are dead once no new cash orders are placed.
   ```typescript
   // Remove:
   if (nextAction === 'delivered' && sanitizeText(payment.method, 'cash') === 'cash') {
     payment.capturedAmount = ...
     payment.lastEvent = 'cash_collected_on_delivery';
     payment.paidAt = ...
     payment.processor = PAYMENT_PROVIDER_CASH;
     payment.reference = ...
     payment.status = PAYMENT_STATUS.PAID;
   }
   ```

**`supabase/functions/_shared/domains/partner.ts`**

6. **Cash-collected block** (`~lines 1313–1322`): same removal — the comment "Restaurant self-provisions delivery: when it completes the order, a cash order is collected on handoff." plus the if-block.

**`supabase/functions/_shared/orders.ts`**

7. **`PAYMENT_PROVIDER_CASH` constant** (`line 172`): remove after steps 5 and 6 eliminate its only usages. Confirm with grep that no other file imports it before removing.

### Existing order rollout safety
Pre-removal cash orders in prod that are already placed/in-flight will have `payment.method = 'cash'`. Their delivery transition will now skip the `cash_collected_on_delivery` block — the payment object stays `pending` instead of being marked `paid`. This is intentional: any in-flight cash order is an exceptional case that needs manual admin settlement. A comment in the commit message documents this. No migration needed.

### Tests to update
- Any test that passes `'cash'` as a valid payment method to `validateOrderData` or `prepareCustomerOrderDraft` must be updated to expect a 400 rejection instead.
- Any test that exercises the `placeCustomerOrder` handler must expect a 410.
- Tests for the `dispatch.ts` and `partner.ts` `delivered` transition with cash payment must be updated — the cash block is gone so those tests no longer assert on `cash_collected_on_delivery`.

### Client — no change needed
The customer app has no cash option in the checkout UI (confirmed in memory: "customer app already cash-free"). The rejection at the server is a belt-and-suspenders defence against old builds and any future code paths.

## Paystack automated payouts (deferred — SP-4b)

Requires:
- Partner KYC onboarding (Tasks 4–6 on `worktree-partner-onboarding-kyc`) merged + migration applied
- `RestaurantPayout.paystackSubaccountCode` populated for each restaurant
- Paystack Transfer API integration in a new `triggerRestaurantPayout` function
- A webhook handler for `transfer.success` / `transfer.failed` events

This sub-goal ships after the KYC work is merged. Owner signals when to start SP-4b.

## Global constraints
- No migration.
- No new RPC action; `placeCustomerOrder` is kept but made an immediate stub.
- `deno check` from `supabase/`: no new errors over baseline (210 pre-existing).
- Tests: no new failures; update tests that exercised cash paths to expect the rejection.
- Never weaken an SP-1/SP-2/SP-3 control.
- Client-safe errors only; rejection message is user-facing copy.
- No `supabase db push`.

## Testing / verification bar
- `placeCustomerOrder` rejects with 410 for any input.
- `validateOrderData` with `paymentMethod: 'cash'` returns a 400.
- Dispatch `delivered` transition on an existing cash-method order no longer sets `cash_collected_on_delivery`.
- Partner `delivered` transition: same.
- `PAYMENT_PROVIDER_CASH` is gone (or zero usages remain).
- Full `npm run test:deno` green; `cd supabase && deno check` no new errors.
