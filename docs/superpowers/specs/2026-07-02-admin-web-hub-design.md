# EBuy Admin Web Hub — Design

**Date:** 2026-07-02
**Status:** Approved approach (Option A) — user directed autonomous execution ("commence with A, report when done").

## Summary

A desktop-first admin web app (`apps/admin-web`) that replaces the mobile Expo admin app as the primary admin surface. Sidebar navigation, five pages (Overview, Orders, Approvals, Access, Statistics), KPI cards with period-over-period trend deltas, a date-range selector, and charts. Visual direction follows the "Smile Food" dashboard reference: white cards on a soft green-tinted background, green accent, rounded cards.

## Decisions locked with the user

- **Form factor:** desktop browser primarily.
- **Core job:** live ops monitoring, approvals, and business performance all matter equally — Overview balances all three, with dedicated pages for each.
- **Scope:** full hub (all five pages), not just an overview page.
- **Mobile app fate:** desktop replaces it (Expo admin app to be retired; not deleted in this effort).
- **Features in:** trend deltas + date range selector, charts (status/area breakdowns). **Features out:** global search, PDF export, dark mode.
- **Freshness:** polling (~20s), same as today.

## Architecture

- **Stack:** Vite + React 19 + TypeScript SPA, `react-router-dom` for routing, `recharts` for charts. New workspace `apps/admin-web` in the existing npm-workspaces monorepo.
- **Backend:** unchanged. The Supabase Edge Function `app-rpc` already exposes everything needed:
  - Reads: `adminGetDashboardSnapshot` (users, restaurants, full orders with `pricing`/`payment`/`createdAt`, dispatch riders with `zone`), `adminGetApprovalQueue`, `adminGetAccessOverview`.
  - Mutations: `adminUpdateRestaurantApproval`, `adminReviewPartnerApplication`, `adminReviewDispatchApplication`, `assignUserRole`, `revokeUserRole`, `provisionStaffAccount`, `updateUserRestaurantLink`, `disableUserAccess`, `enableUserAccess`.
- **Analytics are computed client-side** from the snapshot (KPIs, deltas, chart series). Acceptable at current data volume because the snapshot already returns all orders; if order volume grows, move aggregation into new `app-rpc` actions (noted as future work).
- **Shared code reuse:**
  - `packages/domain/src` — entity types, used directly (pure TS).
  - `packages/auth/src/backendRpc.ts` and `claims.ts` — deep-imported (pure TS). The package root (`index.ts`) is NOT imported because it re-exports `client.ts`, which depends on React Native AsyncStorage and `react-native-url-polyfill`.
  - The web app creates its own Supabase client (localStorage persistence, web defaults).
- **Env:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_BACKEND_RPC_URL` (optional; falls back to `<supabase-url>/functions/v1/app-rpc`). Values mirrored from `.env.apps` into `apps/admin-web/.env.local` (gitignored).

## App structure

```
apps/admin-web/
  index.html, vite.config.ts, tsconfig.json, package.json, .env.local
  src/
    main.tsx, App.tsx (routes)
    config/env.ts
    lib/supabase.ts        # web supabase client
    lib/rpc.ts             # callAdminRpc wrapper over packages/auth backendRpc
    lib/format.ts          # NGN currency, dates, percent deltas
    contexts/AuthContext.tsx     # session + admin-role gate
    contexts/SnapshotContext.tsx # single 20s poller for adminGetDashboardSnapshot
    services/              # ported thin RPC wrappers (approvals, access)
    components/            # Sidebar, TopBar, KpiCard, StatusBadge, DataTable, Card, RangePicker
    pages/                 # Login, Overview, Orders, Approvals, Access, Statistics
    styles/global.css      # CSS variables matching adminTheme palette
```

## Pages

1. **Login** — email/password via Supabase; only `admin` role (from JWT `app_metadata`) may enter; server re-checks role on every RPC (`ensureRole`).
2. **Overview** — greeting; range picker (7/30/90 days); KPI cards with deltas vs the preceding equal-length period: Orders, Revenue (NGN), New users, and un-delta'd live counts (Live orders, Dispatch online, Pending approvals); recent-orders table (restaurant, status, time, amount); mini status donut; approval-queue summary.
3. **Orders** — full orders table: id, restaurant, fulfillment, status badge, total, created time; filter by status and range; client-side sort.
4. **Approvals** — three queues (restaurant publishing, partner applications, dispatch applications) with approve/reject + rejection reason, ported 1:1 from the mobile screens.
5. **Access** — users table (role badge, email verification, disabled state); actions: assign/revoke role, enable/disable access, link restaurant, provision staff account form.
6. **Statistics** — revenue & orders over time (line/bar), orders by status (donut), top restaurants by revenue, dispatch riders by zone.

## Error handling & states

Every page: loading state, error banner with retry, empty states. Polling continues in background; errors don't clear last-good data (mirrors mobile behavior).

## Testing / verification

- `tsc --noEmit` clean; production `vite build` clean.
- Manual verification via dev server (login screen renders; route guard redirects unauthenticated users to /login).
- Full data verification requires admin credentials against the live Supabase project — left to the user.

## Out of scope

- Deleting/retiring `apps/admin` (user decides timing).
- Backend changes, global search, PDF export, dark mode, true realtime.
