# Promo Analytics — Design (Phase 2, sub-project ①)

**Date:** 2026-07-14
**Status:** Approved design, pending implementation plan
**Depends on:** Phase 1 in-app promo notifications (merged to main as `98ad292`)

## Context

Phase 1 shipped in-app promo banners (a `Promo` table, a `promos` Realtime broadcast topic,
an admin Promos page, and a customer `PromoBanner`). It tells us nothing about whether promos
work. This sub-project adds measurement.

Phase 2 overall is a four-part roadmap, each its own spec/build cycle:
**① Measurable → ② Richer → ③ Targeted → ④ Reach-when-closed.** This document covers **①** only.

## Goal & scope

Answer two questions per promo, in the admin panel:

1. **"Which promos work?"** — impressions, clicks, and click-through rate (CTR). Aggregate, anonymous.
2. **"Did they drive orders?"** — attributed order **count** and **revenue**, using a 24-hour,
   last-click-wins attribution window.

**Explicitly out of scope (deferred to later cycles):**
- Unique-user reach / de-duplication across sessions (the "B" option). Impressions are deduped
  only per-session, which is enough to keep CTR meaningful.
- Bot / duplicate-event rate limiting and fraud protection.
- Time-series charts. The raw-event table leaves room to add these later without a rewrite.

## Data model (one migration)

### `promo_events` (new)
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

### `Order` (additive change)
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
  `promo_events` row via the service client.
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
- **`order-placement` edge handler** stamps `attributedPromoId` onto the `Order` row when present
  (additive, best-effort; ignored/omitted otherwise).
- **After a successful order**, the client clears `promoLastClick`, so one click credits at most one
  order (last-click-wins, single-use).

## Admin reporting (A + C)

- Extend the existing `promoList` app-rpc action to return, per promo, aggregate stats:
  `impressions`, `clicks`, `ctr` (clicks / impressions, guarded for divide-by-zero),
  `attributedOrders`, `attributedRevenue`.
  - Computed with subqueries / group-by over `promo_events` (counts by type) and `Order`
    (count + sum of totals grouped by `attributedPromoId`).
- **`PromosPage`** renders a small stat cluster on each promo row next to the existing Live/Off
  badge: Impr · Clicks · CTR · Orders · Revenue.

## Error handling & edge cases

- **Tracking is fire-and-forget.** A failed `promoTrack` or attribution never blocks the banner or
  the order placement.
- **Impression dedup is per session.** A new session recounts an impression — accepted as fine for
  CTR sanity without persistent identity.
- **Deleted promos:** events and attributions are retained historically (no FK); the reporting join
  tolerates promos that no longer exist.
- **Attribution races / multiple clicks:** last click wins by construction (localStorage holds only
  the most recent click); single-use via clear-on-order.
- **Inflation / bots:** acknowledged and **out of scope for launch**; rate limiting is a later add.

## Testing

- **Unit:**
  - `promoTrack` validation: rejects missing `promoId` and invalid `type`; accepts the two valid types.
  - Attribution window: order at 23h59m attributes; at 24h01m does not.
  - CTR computation: divide-by-zero guard (0 impressions → CTR 0, not NaN).
- **Manual E2E:**
  1. Create a promo (admin).
  2. Load the customer app → exactly one impression logged for that session; reloading within the
     session logs no additional impression.
  3. Click "View deal" → one click logged; `promoLastClick` set in localStorage.
  4. Place an order within 24h → order carries `attributedPromoId`.
  5. Admin Promos row shows impressions / clicks / CTR / attributed orders / revenue.

## Files touched (anticipated)

- `supabase/migrations/<date>_promo_analytics.sql` — `promo_events` table + `Order.attributedPromoId`.
- `supabase/functions/app-rpc/index.ts` — `promoTrack` action (pre-auth branch) + `promoList` stats.
- `supabase/functions/order-placement/handler.ts` — stamp `attributedPromoId` when present.
- `apps/customer/src/components/PromoBanner.tsx` — impression/click tracking + `promoLastClick`.
- customer checkout / order-placement call site — attach `attributedPromoId`.
- `apps/admin-web/src/pages/PromosPage.tsx` + `services/promos.ts` — render stats.

## Isolation / delivery

Built on branch `feature/promo-analytics-phase2` (cut from `main`), kept separate from the
in-flight `feature/auth-gateway-hardening` working tree. Merges to `main` on its own, like Phase 1.
