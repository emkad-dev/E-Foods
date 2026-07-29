# Promo Analytics — Design (Phase 2, sub-project ①)

**Date:** 2026-07-14
**Status:** Approved design, pending implementation plan
**Depends on:** Phase 1 in-app promo notifications (merged to main as `98ad292`)

## Context

Phase 1 shipped in-app promo banners (a `Promo` table, a `promos` Realtime broadcast topic,
an admin Promos page, and a customer `PromoBanner`). It tells us nothing about whether promos
work. This sub-project adds measurement — via a `"PromoEvent"` table for impressions/clicks and order attribution.

Phase 2 overall is a four-part roadmap, each its own spec/build cycle:
**① Measurable → ② Richer → ③ Targeted → ④ Reach-when-closed.** This document covers **①** only.

## Goal & scope

Answer two questions per promo, in the admin panel:

1. **"Which promos work?"** — impressions, clicks, and click-through rate (CTR). Aggregate, anonymous.
2. **"Did they drive orders?"** — attributed order **count** and **revenue**, using a 24-hour,
   last-click-wins attribution window, counting **paid orders only** (unpaid/abandoned orders never
   earn a promo credit).

**Explicitly out of scope (deferred to later cycles):**
- Unique-user reach / de-duplication across sessions (the "B" option). Impressions are deduped
  only per-session, which is enough to keep CTR meaningful.
- Bot / duplicate-event rate limiting and fraud protection.
- Time-series charts. The raw-event table leaves room to add these later without a rewrite.

## Data model (one migration)

### `"PromoEvent"` (new)
| column | type | notes |
|---|---|---|
| `id` | text PK, `gen_random_uuid()` | |
| `promoId` | text, not null | references `Promo.id` logically (no FK, to keep inserts cheap and tolerate deleted promos) |
| `type` | text, not null | `'impression'` or `'click'` |
| `createdAt` | timestamptz, default `now()` | |

- Index: `("promoId", "type")`.
- RLS: **enabled, no policies** → anon/authenticated get zero access. All writes happen
  service-side via the `promoTrack` edge action (below). Follows the existing `Broadcast` table
  convention.

### `CustomerOrder` (additive change)
- Add nullable column **`attributedPromoId text`** + index on it.
- Purely additive: existing order-placement logic is untouched; the column is written only when an
  attribution is present. Revenue attribution is derived by summing the totals of orders carrying
  a given `attributedPromoId` — no separate revenue store needed.

## Capture flow (A — impressions & clicks)

**Client (`PromoBanner`):**
- **Impression:** when a promo becomes visible, check `sessionStorage["promoSeen:<id>"]`. If unset,
  set it and fire an impression event. Result: **one impression per promo per session**, so CTR is
  a real ratio rather than a re-render count.
- **Click:** on "View deal," fire a click event (in addition to the existing navigation + dismissal).

**Backend — new app-rpc action `promoTrack`:**
- Payload: `{ promoId: string, type: 'impression' | 'click' }`.
- Validates `promoId` is non-empty and `type` is one of the two allowed values; inserts one
  `"PromoEvent"` row via the service client.
- **Architectural note:** browsing customers are frequently **not logged in**, so `promoTrack` must
  work for anonymous callers. It is therefore handled in the **pre-auth branch** of
  `handleNativeAction` (the same region as `bootstrapFirstAdmin`), *before*
  `getAuthenticatedRequestContext`. It is the first anon-allowed app-rpc action. It is validated but
  not role-gated.
- Fire-and-forget from the client: any failure is swallowed and never affects the banner.

## Attribution flow (C — orders & revenue)

- **On click**, the device stores `localStorage["promoLastClick"] = { promoId, clickedAt }`.
  localStorage (not sessionStorage) so it survives the anonymous → logged-in transition on the same
  device, which is required because ordering needs auth but browsing does not.
- **At checkout**, the client reads `promoLastClick`; if `now − clickedAt ≤ 24h`, it adds
  `attributedPromoId` to the **existing order-placement payload**.
- The **`initializeCustomerPayment` app-rpc action** stamps `attributedPromoId` onto the
  `CustomerOrder` row at creation time via `createOrderWithItems` (that action is where the order is
  actually created — the `order-placement` queue/handler path is not used by the live Paystack
  checkout). Additive, best-effort; ignored/omitted otherwise.
- **Credit is realized on payment, not placement.** The id is *carried* on the order at placement,
  but reporting counts it only once the order reaches a **paid** state. The payment/webhook path is
  **not** modified — the paid-only rule is purely a filter in the reporting query, keyed on the
  `Order`'s existing payment/status field (exact column + "paid" value to be confirmed against the
  schema during planning).
- **After the order is placed**, the client clears `promoLastClick`, so one click credits at most one
  order (last-click-wins, single-use). Trade-off: if that order is abandoned at payment and the
  customer places a *fresh* order, the second order carries no attribution — a deliberate slight
  **under**-credit, preferred over over-crediting ROI.

## Admin reporting (A + C)

- Extend the existing `promoList` app-rpc action to return, per promo, aggregate stats:
  `impressions`, `clicks`, `ctr` (clicks / impressions, guarded for divide-by-zero),
  `attributedOrders`, `attributedRevenue`.
  - Computed with subqueries / group-by over `"PromoEvent"` (counts by type) and `CustomerOrder`
    (count + sum of totals grouped by `attributedPromoId`, **filtered to paid orders only**).
- **`PromosPage`** renders a small stat cluster on each promo row next to the existing Live/Off
  badge: Impr · Clicks · CTR · Orders · Revenue.

## Error handling & edge cases

- **Tracking is fire-and-forget.** A failed `promoTrack` or attribution never blocks the banner or
  the order placement.
- **Impression dedup is per session.** A new session recounts an impression — accepted as fine for
  CTR sanity without persistent identity.
- **Deleted promos:** `"PromoEvent"` rows and attributions are retained historically (no FK); the reporting join
  tolerates promos that no longer exist.
- **Attribution races / multiple clicks:** last click wins by construction (localStorage holds only
  the most recent click); single-use via clear-on-order.
- **Inflation / bots:** acknowledged and **out of scope for launch**; rate limiting is a later add.

## Testing

- **Unit:**
  - `promoTrack` validation: rejects missing `promoId` and invalid `type`; accepts the two valid types.
  - Attribution window: order at 23h59m attributes; at 24h01m does not.
  - Paid-only: an attributed but unpaid order contributes 0 to attributed count/revenue; the same
    order counts once it reaches paid.
  - CTR computation: divide-by-zero guard (0 impressions → CTR 0, not NaN).
- **Manual E2E:**
  1. Create a promo (admin).
  2. Load the customer app → exactly one impression logged for that session; reloading within the
     session logs no additional impression.
  3. Click "View deal" → one click logged; `promoLastClick` set in localStorage.
  4. Place an order within 24h → order carries `attributedPromoId`; while unpaid it is **not**
     counted in the admin's attributed orders/revenue.
  5. Complete payment → the order now counts toward attributed orders + revenue.
  6. Admin Promos row shows impressions / clicks / CTR / attributed (paid) orders / revenue.

## Files touched (anticipated)

- `supabase/migrations/<date>_promo_analytics.sql` — `"PromoEvent"` table + `CustomerOrder.attributedPromoId`.
- `supabase/functions/app-rpc/index.ts` — `promoTrack` action (pre-auth branch) + `promoList` stats; `initializeCustomerPayment` + `createOrderWithItems` — stamp `attributedPromoId` on the order at creation.
- `apps/customer/src/components/PromoBanner.tsx` — impression/click tracking + `promoLastClick`.
- `apps/customer/src/services/customerOrderActions.ts` — attach `attributedPromoId` to the checkout payload.
- `apps/admin-web/src/pages/PromosPage.tsx` + `services/promos.ts` — render stats.

**Not touched:** the payment-verification / paystack-webhook path. Paid-only attribution is enforced
by filtering on the `CustomerOrder`'s existing payment status inside the `promoList` reporting query.

## Isolation / delivery

Built on branch `feature/promo-analytics-phase2` (cut from `main`), kept separate from the
in-flight `feature/auth-gateway-hardening` working tree. Merges to `main` on its own, like Phase 1.
