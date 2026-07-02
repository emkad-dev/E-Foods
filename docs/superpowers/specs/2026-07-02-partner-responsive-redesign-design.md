# FEASTY Partner App — Responsive Smile-Food Redesign

**Date:** 2026-07-02
**Status:** Approach A approved by user ("do a"); autonomous execution with report on completion.

## Summary

Upgrade `apps/partner` (Expo) in place to the Smile Food dashboard format with the Feasty brand, serving mobile and web from one codebase: native/narrow keeps bottom tabs, wide web (≥1024px) gets a sidebar shell. All four screens (Dashboard, Orders, Menu, Store) adopt the brand; the Dashboard is rebuilt in the mockup format.

## Decisions locked with the user

- **Architecture:** one responsive Expo codebase (no separate web app).
- **Scope:** all screens.
- **Branding:** full Feasty brand — green `#03b833` primary, orange `#ff951f` secondary, FEAST-Y two-tone italic wordmark, admin-hub status conventions.

## Design

### Theme
`src/theme/palette.ts` values updated in place (keys preserved so all screens recolor without edits): accent `#03b833`, accentStrong `#028a26`, accentSoft `#d3f7dc`, warning `#e07c00`/`#fff0dd`, success `#028a26`, brandGreen/brandOrange added, hero switches from blue to dark neutral.

### Status colors
Shared `packages/domain` `getOrderStatusColor` is used by customer/dispatch apps and stays untouched. New partner-local `src/theme/statusColors.ts` maps statuses to brand: placed=orange, accepted/preparing=green, transit=teal, delivered=deep green, cancelled/rejected/failed=red, escalated=amber. Partner screens switch to it.

### Responsive shell
`(partner)/_layout.tsx`: `Platform.OS === 'web' && width >= 1024` → custom sidebar layout (FEAST-Y wordmark, nav links via router + `usePathname` active state, sign-out at bottom, `<Slot/>` content); otherwise the existing `Tabs`. Screens gain a max-width (1100px) centered content container that is inert on phones.

### Dashboard (mockup format)
Keeps `usePartnerOrders` (realtime + 30s fallback poll). Adds: 7/30/90-day range picker; KPI cards with period-over-period deltas — Orders, Earnings (₦, non-cancelled `pricing.total`), Avg order value — plus live counts (Incoming, In kitchen, Completed today); order-status breakdown as a stacked proportion bar + legend (pure Views — no react-native-svg dependency, works identically native/web); recent orders history rows (amount, time, status badge, tap-through to detail). Client-side analytics in `src/utils/partnerAnalytics.ts`.

### Other screens
Orders/Menu/Store/order-detail: recolored via palette, status pills switch to brand map, content max-width applied. Logic untouched.

## Error handling
Existing loading/error/empty states preserved.

## Verification
- `tsc --noEmit` in apps/partner.
- Expo web dev server: sidebar at desktop width, tabs at mobile width (viewport resize), console clean.
- Native: Metro/TypeScript compile only (no device run in this session).

## Out of scope
Auth screens rework (they recolor via palette), backend changes, customer/dispatch apps, SVG charts.
