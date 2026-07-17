# Pricing v2 — Embedded Markup Model

**Date:** 2026-07-17
**Status:** Approved design, pending implementation plan

## Summary

Replace the current three-part monetization (flat ₦150/unit menu markup + broken 5%
customer service fee + 15%/10% restaurant commission) with a single embedded-markup
model, the way Chowdeck-style marketplaces price:

- **Customer-facing menu price** = restaurant's own price × 1.20 + ₦100, per unit.
- **No separate "Service fee" line** at checkout.
- **Restaurant is settled on 97% of its own menu prices** (a 3% partner service
  charge); the 15%/10% commission is removed.
- **Pricing parameters live in one server-owned config**; clients only ever receive
  final display prices — no client-side fee math.

### Worked example (restaurant prices an item at ₦5,000)

| | Amount |
|---|---|
| Customer sees on menu | ₦6,100 (= 5,000 × 1.20 + 100) |
| Checkout total | items ₦6,100 × qty + delivery fee + tip |
| Partner dashboard, 2 units sold | gross ₦10,000 → service charge −₦300 (3%) → net ₦9,700 |
| Partner payout | ₦9,700 + delivery fee (self-provisioned delivery passes through) |
| Platform margin | ₦1,100/unit embedded markup + 3% of the restaurant basis |

## Current state being replaced

- `CUSTOMER_ITEM_MARKUP = 150` duplicated in `packages/domain/src/orders.ts` and
  `supabase/functions/app-rpc/index.ts`; client applies it via
  `toCustomerFacingItemPrice`.
- `calculateServiceFee` (5% of subtotal, min ₦0.49, cap ₦12 — dollar-era numbers,
  effectively ₦12/order) duplicated in `apps/customer/src/utils/checkoutPricing.ts`
  and app-rpc.
- `calculateSettlementBreakdown` in app-rpc deducts `PLATFORM_COMMISSION_RATES`
  (delivery 0.15 / pickup 0.10) from the restaurant basis.

## Design

### 1. Server-owned pricing config

A single `platform_settings` row (jsonb payload):

```json
{ "markup_rate": 0.20, "markup_flat": 100, "partner_service_rate": 0.03 }
```

Read by `app-rpc` and `public-catalog` (fetched per invocation; simple in-memory
cache acceptable). Rates become editable from the admin app later without a
redeploy. Migration seeds the row. SQL objects follow the existing `ebuy_*` naming
convention. Delete `CUSTOMER_ITEM_MARKUP` (both copies), `toCustomerFacingItemPrice`
client math, `calculateServiceFee` (both copies), and `PLATFORM_COMMISSION_RATES`.

### 2. Customers only see final prices

`public-catalog` applies the markup server-side and returns **display prices**:
`displayPrice = roundCurrency(base × (1 + markup_rate) + markup_flat)`, per unit.
The markup applies identically to delivery and pickup (it is embedded in the menu
before fulfillment choice). At order creation, `app-rpc` re-derives every item's
display price from the restaurant's authoritative base price + the config — it
never trusts client-submitted prices — and stores **both** `basePrice` and `price`
(display) on each order item: settlement needs the base, receipts need the display.

### 3. Checkout math

`total = markedUpSubtotal + deliveryFee + tip`. The service-fee line is removed
from the cart UI, order-details screen, and pricing payloads (`serviceFee: 0` is
retained in stored order JSON for backward shape-compatibility). The client's
`calculateCheckoutTotal` becomes a plain sum of server-quoted numbers.

**Min-order check:** compare the restaurant's `minOrder` against the *own-price
basis* (Σ basePrice × qty), not the marked-up subtotal. A percentage markup cannot
be reverse-derived from the subtotal, so the basis is computed from per-item base
prices carried through order creation.

### 4. Settlement

```
restaurantBasis   = Σ basePrice × qty
partnerServiceFee = roundCurrency(restaurantBasis × partner_service_rate)   // 3%
restaurantPayable = roundCurrency(restaurantBasis − partnerServiceFee)      // 97%
totalMarkup       = roundCurrency(markedUpSubtotal − restaurantBasis)
platformFee       = roundCurrency(totalMarkup + partnerServiceFee)
netSettlement     = restaurantPayable + dispatchFee
```

Pickup and delivery settle identically. The settlement snapshot stored on each
order records the rates in force at order time, so later config changes never
rewrite history.

### 5. Partner dashboard

Earnings are presented at the restaurant's **own prices** with an explicit
deduction, three lines: gross (own-price total), "FEASTY service charge (3%)",
and net payout. `apps/partner` analytics (`partnerAnalytics.ts`) and the earnings
views switch from commission-net figures to this gross/fee/net presentation.
Rationale: gross-only next to a smaller bank credit generates support tickets.

### 6. Rollout

- Server is authoritative; old app builds hardcode +₦150 and the 5% preview fee,
  so ship the edge functions and client builds together (customer app is
  pre-launch, so exposure is minimal).
- Existing orders keep their stored pricing/settlement snapshots; no data
  migration of historical rows.
- Out of scope: VAT (7.5%) treatment, psychological price rounding (e.g. to
  nearest ₦50), per-restaurant rate overrides, visible pickup discounts.

### 7. Testing

Unit tests on the pure pricing functions:

- Display-price derivation (zero, cheap items, rounding at kobo precision).
- Settlement breakdown, including 3% rounding on odd bases and platformFee
  reconciliation (`platformFee + restaurantPayable = markedUpSubtotal`).
- Min-order enforcement against the base-price basis.
- Consistency test: catalog display price for an item equals the price app-rpc
  charges for the same item and config.
