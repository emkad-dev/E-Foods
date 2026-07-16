# Promo Landing Pages — Design (Phase 2, sub-project ②)

**Date:** 2026-07-16
**Status:** Approved design, pending implementation plan
**Depends on:** Phase 1 in-app promo banner + Phase 2 ① analytics (both merged to main; latest `5d19ecc`)

## Context

Phase 1 shipped a promo `Promo` table (`title`, `body`, `actionUrl`, `active`, `startsAt/endsAt`)
and a `PromoBanner` that deep-links "View deal" to `actionUrl`. Phase 2 ① added
impression/click/attribution analytics. Today the banner's `actionUrl` typically points at
**`/deals`, which is a static hardcoded placeholder** (three fake deals, disconnected from the
`Promo` table) — so a real promo tap lands on fake content.

This sub-project (②) gives promos a real, compelling destination: a live **Deals hub** listing
active promos, each opening its own **detail page**. Phase 2 overall:
**① Measurable → ② Richer (this) → ③ Targeted → ④ Reach-when-closed.**

## Goal & scope

- A live **Deals hub** at `/deals` (replaces the static placeholder) listing active promos as image cards.
- A **per-promo detail page** at `/promo/[id]` with hero image, full description, terms, and a CTA.
- Admin can attach rich content (image, detail description, terms, CTA label) to a promo.

**Out of scope (deferred):** discount-code redemption (a pricing/checkout engine — its own cycle,
near ③); image gallery / category badges (polish); admin image *management* beyond upload.

## Data model (one additive migration)

Add to `public."Promo"` — all **nullable**, so existing promos and the Phase 1 banner are unaffected:

| column | type | purpose |
|---|---|---|
| `imageUrl` | text | hero image; stored as the Supabase Storage public URL |
| `detailBody` | text | long description for the detail page; falls back to `body` |
| `terms` | text | fine print (time window, minimums, participating restaurants) |
| `ctaLabel` | text | detail-page button label; falls back to `"Order now"` |

The Phase 1 public-read RLS policy on `Promo` already covers new columns (no policy change).

## Image upload (admin)

- New public Storage bucket **`promo-assets`**:
  - **Insert policy restricted to admins** (policy checks the caller's `UserRole` is `admin`), so it
    is not an open authenticated-write surface.
  - **Public read** for serving.
- Admin uploads **client-side** from an `<input type="file">` via
  `supabase.storage.from('promo-assets').upload(...)` — the same pattern as
  `apps/partner/src/services/restaurantAssetUpload.ts`, adapted to the React admin. Path
  `promos/<promoId-or-timestamp>.<ext>`. The returned public URL is saved to `imageUrl`.
- **Rejected alternative:** routing image bytes through an app-rpc/service-role action (base64 over
  JSON) — clunkier and inconsistent with the established client-side storage pattern.

## CDN read path

The customer reads `Promo` **directly** via the anon client (Phase 1 pattern), so the server-side
`_shared/media.ts#toCdnImageUrl` never runs on this path. Add a **small client-side CDN-rewrite
helper** (mirroring `toCdnImageUrl`, using `EXPO_PUBLIC_CDN_BASE_URL` + the Supabase storage public
prefix) and apply it when rendering promo hero images, so images still serve through Bunny CDN.
Storage URLs stay canonical in the DB; the rewrite is a render-time concern.

## Screens & routing (customer, Expo Router)

- **`/deals` — live Deals hub.** Replace the static placeholder. Fetch active promos with the same
  anon RLS `.from('Promo')` read + live-window filter Phase 1 uses; render image cards
  (hero + title + short `body`). Empty state when none are live.
- **`/promo/[id]` — new detail page.** Fetch one promo by id (anon RLS). Render hero image, title,
  `detailBody ?? body`, terms, and a **sticky CTA** button labelled `ctaLabel ?? 'Order now'` that
  navigates to `actionUrl` — reusing the Phase 1 in-app-path / open-redirect guard.
- **Smart banner re-route.** `PromoBanner`'s "View deal":
  - if the promo has rich content (`imageUrl` **or** `detailBody` **or** `terms`) → open `/promo/[id]`;
  - otherwise (a lean Phase-1-style promo) → navigate straight to `actionUrl`, exactly as today.

  Simple promos stay simple; rich promos get the landing page.

## Analytics tie-in (reuses ①, no new event types)

- `trackPromoClick(promoId)` still fires when the user expresses interest — on the banner "View
  deal" tap **and** on a Deals-hub card tap (both open the detail page). The detail-page CTA is
  navigation, not a new tracked event.
- Attribution is unchanged: the click already seeds `promoLastClick` / `takeAttributedPromoId()`, so
  detail-CTA → `actionUrl` → a paid order within 24h still attributes.

## Admin (PromosPage)

Extend the create form and the `promoCreate` / `promoList` app-rpc actions to carry the four new
fields. Server sanitizes; `imageUrl` is validated to the storage/CDN host. Existing
`promoSetActive` and the Phase 2 ① stats display are untouched.

## Error handling & edge cases

- **Missing image:** hub card and detail page render a colored placeholder — never a broken image.
- **Expired / inactive / nonexistent promo detail:** RLS returns no row → "This deal has ended"
  empty state (no crash, no leak of inactive promos).
- **Upload failure:** admin sees a generic retry message (same UX as restaurant upload), raw error
  logged only.
- **Backward compat:** promos created before this migration have null rich fields → hub shows them
  with a placeholder image, banner takes the straight-to-`actionUrl` path.

## Testing

- **Unit (pure):** the client-side CDN-rewrite helper — storage URL → CDN base; passthrough for
  non-storage URLs and null/undefined.
- **Manual E2E:** admin creates a promo with image + detail + terms → Deals hub shows the card →
  tap → detail page renders all fields → CTA deep-links to `actionUrl` → a click event is recorded
  (Phase 2 ① analytics). Also verify a lean promo (no rich fields) still routes banner → `actionUrl`.

## Files touched (anticipated)

- `supabase/migrations/<date>_promo_landing.sql` — 4 nullable columns on `Promo`; `promo-assets`
  bucket + admin-insert/public-read policies.
- `functions/prisma/schema.prisma` — mirror the 4 columns on the `Promo` model.
- `supabase/functions/app-rpc/index.ts` — extend `promoCreate` / `promoList` with the new fields.
- `apps/admin-web/src/pages/PromosPage.tsx` + `services/promos.ts` — image upload + new form fields.
- `apps/customer/app/(customer)/deals.tsx` — replace placeholder with live hub.
- `apps/customer/app/(customer)/promo/[id].tsx` — new detail page.
- `apps/customer/src/components/PromoBanner.tsx` — smart re-route.
- `apps/customer/src/services/` (or a small util) — client-side CDN-rewrite helper (+ test).

## Isolation / delivery

Built on branch `feature/promo-landing-pages` (cut from `main`), in a throwaway worktree, kept
separate from the in-flight `feature/auth-gateway-hardening` tree. Merges to `main` on its own,
like Phase 1 and Phase 2 ①.
