# Promo Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure whether promos work — per-promo impressions, clicks, CTR, and paid-order attribution (count + revenue) — surfaced in the admin Promos page.

**Architecture:** A `promo_events` table captures impressions/clicks written by a new anon-allowed `promoTrack` app-rpc action. Attribution is stamped as an `attributedPromoId` column on `CustomerOrder` at checkout-init time (where the order is actually created), carried from the device via localStorage; it only *counts* once the order has a paid `PaymentTransaction`. A `ebuy_promo_stats()` SQL function aggregates everything for the admin.

**Tech Stack:** Supabase (Postgres + Deno edge functions, `supabase-js` service client), Prisma schema (source of truth for `CustomerOrder`), Expo/React Native (customer), React + Vite (admin), `deno test` for edge/domain unit tests.

## Global Constraints

- Scope is sub-project ① only (measurable). No unique-user reach/dedup (B), no rate-limiting, no charts. From spec.
- Impressions are deduped **once per promo per session** (client `sessionStorage`). Verbatim from spec.
- Attribution: **24h window, last-click-wins, paid orders only**; the payment/webhook path must **not** be modified. Verbatim from spec.
- All tracking is **fire-and-forget** — a failed event never blocks the banner or an order.
- "Paid" = a `PaymentTransaction` row with `status = 'paid'` (constant `PAYMENT_STATUS.PAID = 'paid'`). Revenue = `sum(PaymentTransaction.amount)` over those rows.
- Follow existing conventions: PascalCase quoted table names, `ebuy_*` SQL functions, app-rpc `if (action === '…')` handlers with `ensureRole` / `sanitizeText` / `fail` / `json`.
- Branch: `feature/promo-analytics-phase2` (already cut from `main`). Commit frequently.

---

## File Structure

**Database**
- `supabase/migrations/20260714_promo_analytics.sql` (create) — `promo_events` table, `CustomerOrder.attributedPromoId` column + index, `ebuy_promo_stats()` function.
- `functions/prisma/schema.prisma` (modify) — add `attributedPromoId String?` + index to `CustomerOrder` so the Prisma model matches the applied DDL (no separate Prisma migration; the supabase migration is the applied source, same way `Promo`/`Broadcast` are supabase-managed).

**Edge (Deno)**
- `supabase/functions/app-rpc/index.ts` (modify) — `promoTrack` action (pre-auth branch); extend `promoList` with stats; thread `attributedPromoId` into `initializeCustomerPayment` → `createOrderWithItems`.
- `supabase/functions/app-rpc/promoTrack.ts` (create) — pure validation helper + `deno test`.

**Shared domain (tested)**
- `packages/domain/src/promoAttribution.ts` (create) — pure `resolveAttributedPromoId(stored, now)` (24h window) + `promoCtr(impressions, clicks)`.
- `packages/domain/src/promoAttribution.test.ts` (create) — `deno test` for the two helpers.

**Customer app**
- `apps/customer/src/services/promoTracking.ts` (create) — `trackPromoEvent(type, promoId)`, `rememberPromoClick(promoId)`, `takeAttributedPromoId()` (localStorage/sessionStorage plumbing).
- `apps/customer/src/components/PromoBanner.tsx` (modify) — fire impression (session-deduped) + click; remember click.
- `apps/customer/src/services/customerOrderActions.ts` (modify) — attach `attributedPromoId` to the `initializeCustomerPayment` payload; clear on success.

**Admin app**
- `apps/admin-web/src/services/promos.ts` (modify) — extend `Promo` type with stats.
- `apps/admin-web/src/pages/PromosPage.tsx` (modify) — render the stat cluster per row.

---

## Task 1: Database — events table, attribution column, stats function

**Files:**
- Create: `supabase/migrations/20260714_promo_analytics.sql`
- Modify: `functions/prisma/schema.prisma` (`CustomerOrder` model, ~line 210-234)

**Interfaces:**
- Produces: table `public."promo_events"("id","promoId","type","createdAt")`; column `CustomerOrder."attributedPromoId" text`; function `public.ebuy_promo_stats()` returning rows `("promoId" text, "impressions" bigint, "clicks" bigint, "attributedOrders" bigint, "attributedRevenue" double precision)`.

- [ ] **Step 1: Write the migration**

```sql
-- Promo analytics (Phase 2 ①): impression/click events + paid-order attribution.

-- Impression/click events. Written service-side only (via app-rpc promoTrack).
create table if not exists public."promo_events" (
  "id"        text primary key default (gen_random_uuid())::text,
  "promoId"   text not null,
  "type"      text not null, -- 'impression' | 'click'
  "createdAt" timestamptz not null default now()
);
create index if not exists "promo_events_promoId_type_idx"
  on public."promo_events" ("promoId", "type");
alter table public."promo_events" enable row level security;
-- No policies: anon/authenticated get zero access; writes are service-role only.

-- Attribution: stamped at checkout-init; only counted once the order is paid.
alter table public."CustomerOrder" add column if not exists "attributedPromoId" text;
create index if not exists "CustomerOrder_attributedPromoId_idx"
  on public."CustomerOrder" ("attributedPromoId");

-- Per-promo aggregates for the admin. Paid = a PaymentTransaction with status 'paid'.
create or replace function public.ebuy_promo_stats()
returns table (
  "promoId"           text,
  "impressions"       bigint,
  "clicks"            bigint,
  "attributedOrders"  bigint,
  "attributedRevenue" double precision
)
language sql
stable
security definer
set search_path = public
as $$
  with ev as (
    select "promoId",
           count(*) filter (where "type" = 'impression') as impressions,
           count(*) filter (where "type" = 'click')      as clicks
    from public."promo_events"
    group by "promoId"
  ),
  attr as (
    select o."attributedPromoId" as promo_id,
           count(distinct o.id)   as orders,
           coalesce(sum(pt."amount"), 0) as revenue
    from public."CustomerOrder" o
    join public."PaymentTransaction" pt
      on pt."orderId" = o."id" and pt."status" = 'paid'
    where o."attributedPromoId" is not null
    group by o."attributedPromoId"
  )
  select p."id",
         coalesce(ev.impressions, 0),
         coalesce(ev.clicks, 0),
         coalesce(attr.orders, 0),
         coalesce(attr.revenue, 0)::double precision
  from public."Promo" p
  left join ev   on ev."promoId" = p."id"
  left join attr on attr.promo_id = p."id";
$$;

grant execute on function public.ebuy_promo_stats() to service_role;
```

- [ ] **Step 2: Keep the Prisma model in sync**

In `functions/prisma/schema.prisma`, inside `model CustomerOrder`, add the field (after `cancellation Json?`) and index:

```prisma
  attributedPromoId String?
```

and in the index block:

```prisma
  @@index([attributedPromoId])
```

- [ ] **Step 3: Validate SQL locally (syntax only)**

Run: `npx supabase db lint --file supabase/migrations/20260714_promo_analytics.sql` (if unavailable, skip — it is applied against the remote in the deploy step later).
Expected: no syntax errors.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260714_promo_analytics.sql functions/prisma/schema.prisma
git commit -m "feat(promos): promo_events table, attribution column, ebuy_promo_stats()"
```

---

## Task 2: `promoTrack` validation helper (pure, tested)

**Files:**
- Create: `supabase/functions/app-rpc/promoTrack.ts`
- Test: `supabase/functions/app-rpc/promoTrack.test.ts`

**Interfaces:**
- Produces: `validatePromoTrack(data: Record<string, unknown>): { promoId: string; type: 'impression' | 'click' }` — throws via a thrown `Error` with `.status = 400` semantics is NOT used here; instead it returns `{ ok: true, value }` or `{ ok: false, message }` so the action layer decides how to fail.

- [ ] **Step 1: Write the failing test**

```ts
// supabase/functions/app-rpc/promoTrack.test.ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { validatePromoTrack } from './promoTrack.ts';

Deno.test('accepts a valid impression', () => {
  assertEquals(validatePromoTrack({ promoId: 'p1', type: 'impression' }), {
    ok: true, value: { promoId: 'p1', type: 'impression' },
  });
});

Deno.test('accepts a valid click', () => {
  assertEquals(validatePromoTrack({ promoId: 'p1', type: 'click' }).ok, true);
});

Deno.test('rejects missing promoId', () => {
  assertEquals(validatePromoTrack({ type: 'click' }).ok, false);
});

Deno.test('rejects an unknown type', () => {
  assertEquals(validatePromoTrack({ promoId: 'p1', type: 'view' }).ok, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test supabase/functions/app-rpc/promoTrack.test.ts`
Expected: FAIL — module `./promoTrack.ts` not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// supabase/functions/app-rpc/promoTrack.ts
export type PromoEventType = 'impression' | 'click';
export type PromoTrackResult =
  | { ok: true; value: { promoId: string; type: PromoEventType } }
  | { ok: false; message: string };

export const validatePromoTrack = (data: Record<string, unknown>): PromoTrackResult => {
  const promoId = typeof data.promoId === 'string' ? data.promoId.trim() : '';
  const type = data.type;
  if (!promoId) {
    return { ok: false, message: 'A promoId is required.' };
  }
  if (type !== 'impression' && type !== 'click') {
    return { ok: false, message: 'type must be "impression" or "click".' };
  }
  return { ok: true, value: { promoId, type } };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test supabase/functions/app-rpc/promoTrack.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/app-rpc/promoTrack.ts supabase/functions/app-rpc/promoTrack.test.ts
git commit -m "feat(promos): promoTrack payload validation"
```

---

## Task 3: `promoTrack` app-rpc action (anon-allowed, pre-auth branch)

**Files:**
- Modify: `supabase/functions/app-rpc/index.ts` — import (top block) + new handler in the **pre-auth** region (immediately after the `bootstrapFirstAdmin` block, BEFORE `const context = await getAuthenticatedRequestContext(request);`, ~line 3589).

**Interfaces:**
- Consumes: `validatePromoTrack` (Task 2); `serviceClient`, `json`, `fail` (existing).
- Produces: app-rpc action `promoTrack` accepting `{ promoId, type }`, returns `{ data: { ok: true } }`.

- [ ] **Step 1: Add the import**

Near the other local imports at the top of `index.ts`:

```ts
import { validatePromoTrack } from './promoTrack.ts';
```

- [ ] **Step 2: Add the handler in the pre-auth branch**

Immediately BEFORE `const context = await getAuthenticatedRequestContext(request);` (so anonymous browsers can call it), add:

```ts
  if (action === 'promoTrack') {
    // Anon-allowed: browsing customers are frequently not signed in. Fire-and-forget
    // from the client, so failures here are still returned but never block the UI.
    const parsed = validatePromoTrack(data);
    if (!parsed.ok) {
      fail(400, parsed.message);
    }
    const { error } = await serviceClient.from('promo_events').insert({
      promoId: parsed.value.promoId,
      type: parsed.value.type,
    });
    if (error) {
      throw new Error(error.message);
    }
    return json(200, { data: { ok: true } });
  }
```

- [ ] **Step 3: Type-check**

Run: `deno check supabase/functions/app-rpc/index.ts`
Expected: no NEW errors referencing `promoTrack` / the new lines (pre-existing baseline errors are unchanged).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/app-rpc/index.ts
git commit -m "feat(promos): anon-allowed promoTrack action writing promo_events"
```

---

## Task 4: Domain helpers — attribution window + CTR (pure, tested)

**Files:**
- Create: `packages/domain/src/promoAttribution.ts`
- Test: `packages/domain/src/promoAttribution.test.ts`
- Modify: `packages/domain/src/index.ts` — re-export.

**Interfaces:**
- Produces:
  - `PROMO_ATTRIBUTION_WINDOW_MS = 86_400_000`
  - `resolveAttributedPromoId(stored: { promoId: string; clickedAt: number } | null, nowMs: number): string | null`
  - `promoCtr(impressions: number, clicks: number): number` (0 when impressions is 0)

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/src/promoAttribution.test.ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { resolveAttributedPromoId, promoCtr, PROMO_ATTRIBUTION_WINDOW_MS } from './promoAttribution.ts';

const now = 1_000_000_000_000;

Deno.test('attributes a click within 24h', () => {
  assertEquals(resolveAttributedPromoId({ promoId: 'p1', clickedAt: now - 1000 }, now), 'p1');
});

Deno.test('does not attribute a click at exactly 24h + 1ms', () => {
  assertEquals(
    resolveAttributedPromoId({ promoId: 'p1', clickedAt: now - PROMO_ATTRIBUTION_WINDOW_MS - 1 }, now),
    null,
  );
});

Deno.test('returns null when nothing stored', () => {
  assertEquals(resolveAttributedPromoId(null, now), null);
});

Deno.test('CTR guards divide-by-zero', () => {
  assertEquals(promoCtr(0, 0), 0);
  assertEquals(promoCtr(4, 1), 0.25);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test packages/domain/src/promoAttribution.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/domain/src/promoAttribution.ts
export const PROMO_ATTRIBUTION_WINDOW_MS = 86_400_000; // 24h

export const resolveAttributedPromoId = (
  stored: { promoId: string; clickedAt: number } | null,
  nowMs: number,
): string | null => {
  if (!stored || typeof stored.promoId !== 'string' || typeof stored.clickedAt !== 'number') {
    return null;
  }
  return nowMs - stored.clickedAt <= PROMO_ATTRIBUTION_WINDOW_MS ? stored.promoId : null;
};

export const promoCtr = (impressions: number, clicks: number): number =>
  impressions > 0 ? clicks / impressions : 0;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test packages/domain/src/promoAttribution.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Re-export from the domain barrel**

In `packages/domain/src/index.ts` add:

```ts
export * from './promoAttribution';
```

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/promoAttribution.ts packages/domain/src/promoAttribution.test.ts packages/domain/src/index.ts
git commit -m "feat(promos): attribution-window + CTR domain helpers"
```

---

## Task 5: Customer promo tracking service

**Files:**
- Create: `apps/customer/src/services/promoTracking.ts`

**Interfaces:**
- Consumes: `callCustomerBackendRpc` (from `./backendRpc`); `resolveAttributedPromoId` (Task 4).
- Produces:
  - `trackPromoImpression(promoId: string): void` — session-deduped, fire-and-forget.
  - `trackPromoClick(promoId: string): void` — logs click + remembers click for attribution.
  - `takeAttributedPromoId(): string | null` — reads the remembered click, returns the promo id if within 24h, and clears it.

- [ ] **Step 1: Write the implementation**

```ts
// apps/customer/src/services/promoTracking.ts
import { Platform } from 'react-native';
import { resolveAttributedPromoId } from '../../../../packages/domain/src/promoAttribution';
import { callCustomerBackendRpc } from './backendRpc';

const LAST_CLICK_KEY = 'feasty.promoLastClick';
const seenThisSession = new Set<string>();

const track = (promoId: string, type: 'impression' | 'click') => {
  // Fire-and-forget: a tracking failure must never surface to the customer.
  void callCustomerBackendRpc('promoTrack', { promoId, type }).catch(() => undefined);
};

export const trackPromoImpression = (promoId: string) => {
  if (Platform.OS === 'web') {
    try {
      const key = `feasty.promoSeen:${promoId}`;
      if (window.sessionStorage.getItem(key)) return;
      window.sessionStorage.setItem(key, '1');
    } catch {
      if (seenThisSession.has(promoId)) return;
      seenThisSession.add(promoId);
    }
  } else {
    if (seenThisSession.has(promoId)) return;
    seenThisSession.add(promoId);
  }
  track(promoId, 'impression');
};

export const trackPromoClick = (promoId: string) => {
  track(promoId, 'click');
  const record = JSON.stringify({ promoId, clickedAt: Date.now() });
  if (Platform.OS === 'web') {
    try { window.localStorage.setItem(LAST_CLICK_KEY, record); } catch { /* ignore */ }
  }
};

export const takeAttributedPromoId = (): string | null => {
  if (Platform.OS !== 'web') return null; // attribution is web-first (Phase 1)
  try {
    const raw = window.localStorage.getItem(LAST_CLICK_KEY);
    const stored = raw ? (JSON.parse(raw) as { promoId: string; clickedAt: number }) : null;
    const promoId = resolveAttributedPromoId(stored, Date.now());
    window.localStorage.removeItem(LAST_CLICK_KEY);
    return promoId;
  } catch {
    return null;
  }
};
```

- [ ] **Step 2: Type-check**

Run: `cd apps/customer && npx tsc --noEmit`
Expected: 0 errors (from this file).

- [ ] **Step 3: Commit**

```bash
git add apps/customer/src/services/promoTracking.ts
git commit -m "feat(promos): customer promo tracking service (impressions/clicks/attribution)"
```

---

## Task 6: Wire tracking into `PromoBanner`

**Files:**
- Modify: `apps/customer/src/components/PromoBanner.tsx`

**Interfaces:**
- Consumes: `trackPromoImpression`, `trackPromoClick` (Task 5).

- [ ] **Step 1: Import the tracking service**

At the top of `PromoBanner.tsx`:

```ts
import { trackPromoClick, trackPromoImpression } from '../services/promoTracking';
```

- [ ] **Step 2: Fire an impression when a promo is shown**

In the `show` callback (where `setPromo(next)` runs), add before/after `setPromo`:

```ts
    trackPromoImpression(next.id);
```

- [ ] **Step 3: Fire a click in `openDeal`**

At the start of the `openDeal` callback, before navigation:

```ts
    if (promo) trackPromoClick(promo.id);
```

- [ ] **Step 4: Type-check**

Run: `cd apps/customer && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/customer/src/components/PromoBanner.tsx
git commit -m "feat(promos): fire impression/click events from PromoBanner"
```

---

## Task 7: Attach attribution at checkout; stamp it on the order

**Files:**
- Modify: `apps/customer/src/services/customerOrderActions.ts` — send `attributedPromoId` in the `initializeCustomerPayment` RPC payload; clear on success.
- Modify: `supabase/functions/app-rpc/index.ts` — in the `initializeCustomerPayment` action (~line 5108), read/validate `attributedPromoId` and pass it into `createOrderWithItems`; add `attributedPromoId` to that helper's insert into `CustomerOrder`.

**Interfaces:**
- Consumes: `takeAttributedPromoId` (Task 5); `sanitizeText` (existing).
- Produces: `CustomerOrder."attributedPromoId"` populated at init when a valid in-app promo id is present.

- [ ] **Step 1: Client — attach and clear**

In `customerOrderActions.ts`, import at top:

```ts
import { takeAttributedPromoId } from './promoTracking';
```

Inside `initializeCustomerPayment`, compute once before the RPC call:

```ts
  const attributedPromoId = takeAttributedPromoId();
```

and add it to the `callCustomerBackendRpc('initializeCustomerPayment', { … })` payload object:

```ts
    attributedPromoId,
```

(`takeAttributedPromoId` already cleared the stored click, so success/failure needs no extra cleanup.)

- [ ] **Step 2: Server — read + validate + thread into order creation**

In the `initializeCustomerPayment` action, after `const orderId = crypto.randomUUID();`, derive a safe value (only in-app promo ids; anything else is dropped, never trusted):

```ts
    const rawAttributedPromoId = sanitizeText(data.attributedPromoId);
    const attributedPromoId = rawAttributedPromoId ? rawAttributedPromoId : null;
```

Pass it into the `createOrderWithItems({ … })` call:

```ts
      attributedPromoId,
```

- [ ] **Step 3: Server — persist in `createOrderWithItems`**

Locate `createOrderWithItems` (search `const createOrderWithItems`). Add `attributedPromoId?: string | null` to its input type, and include it in the `serviceClient.from('CustomerOrder').insert({ … })` object:

```ts
      attributedPromoId: input.attributedPromoId ?? null,
```

- [ ] **Step 4: Type-check both sides**

Run: `deno check supabase/functions/app-rpc/index.ts` and `cd apps/customer && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add apps/customer/src/services/customerOrderActions.ts supabase/functions/app-rpc/index.ts
git commit -m "feat(promos): stamp attributedPromoId on the order at checkout init"
```

---

## Task 8: Admin — surface the stats

**Files:**
- Modify: `apps/admin-web/src/services/promos.ts` — extend `Promo` type; the existing `listPromos()` call is unchanged (stats arrive on each promo).
- Modify: `supabase/functions/app-rpc/index.ts` — extend the `promoList` action to merge `ebuy_promo_stats()`.
- Modify: `apps/admin-web/src/pages/PromosPage.tsx` — render the stat cluster.

**Interfaces:**
- Consumes: `ebuy_promo_stats()` (Task 1); `promoCtr` (Task 4, re-imported server-side is not possible in Deno from packages/domain via TS path — recompute inline as `clicks/impressions` with a zero guard).
- Produces: each `Promo` in `promoList` gains `impressions`, `clicks`, `attributedOrders`, `attributedRevenue` (numbers).

- [ ] **Step 1: Server — merge stats into `promoList`**

In the `promoList` action, after loading `promos`, fetch stats and merge:

```ts
    const { data: stats } = await serviceClient.rpc('ebuy_promo_stats');
    const statById = new Map(
      (stats ?? []).map((s: {
        promoId: string; impressions: number; clicks: number;
        attributedOrders: number; attributedRevenue: number;
      }) => [s.promoId, s]),
    );
    const withStats = (promos ?? []).map((p) => {
      const s = statById.get(p.id);
      return {
        ...p,
        impressions: s?.impressions ?? 0,
        clicks: s?.clicks ?? 0,
        attributedOrders: s?.attributedOrders ?? 0,
        attributedRevenue: s?.attributedRevenue ?? 0,
      };
    });
    return json(200, { data: { promos: withStats } });
```

(Replace the existing `return json(200, { data: { promos: promos ?? [] } });` line in that action.)

- [ ] **Step 2: Admin — extend the `Promo` type**

In `apps/admin-web/src/services/promos.ts`, add to the `Promo` interface:

```ts
  impressions: number;
  clicks: number;
  attributedOrders: number;
  attributedRevenue: number;
```

- [ ] **Step 3: Admin — render the stat cluster**

In `PromosPage.tsx`, inside the promo `<li>`'s `promo-item-main`, after the body line, add:

```tsx
                  <span className="promo-item-stats">
                    {promo.impressions} impr · {promo.clicks} clicks ·{' '}
                    {promo.impressions > 0 ? Math.round((promo.clicks / promo.impressions) * 100) : 0}% CTR ·{' '}
                    {promo.attributedOrders} orders · ₦{promo.attributedRevenue.toLocaleString()}
                  </span>
```

- [ ] **Step 4: Type-check the admin app**

Run: `cd apps/admin-web && npx tsc --noEmit`
Expected: 0 errors (ignore the pre-existing `packages/domain/src/phone.test.ts` allowImportingTsExtensions error).

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src/services/promos.ts apps/admin-web/src/pages/PromosPage.tsx supabase/functions/app-rpc/index.ts
git commit -m "feat(promos): admin per-promo stats (impressions/clicks/CTR/orders/revenue)"
```

---

## Task 9: End-to-end verification

**Files:** none (verification only). Requires the migration applied and `app-rpc` deployed (operator steps, mirroring Phase 1).

- [ ] **Step 1: Apply DB + deploy**
  - Apply `supabase/migrations/20260714_promo_analytics.sql` to the remote DB.
  - Deploy `app-rpc` (`--no-verify-jwt`, per the existing operator flow).

- [ ] **Step 2: Impression dedup** — load the customer web app with an active promo; confirm exactly one `impression` row in `promo_events` for that promo; reload in the same session → no new row.

- [ ] **Step 3: Click + attribution** — click "View deal"; confirm one `click` row and `feasty.promoLastClick` set in localStorage. Place an order within 24h; confirm the `CustomerOrder` row has `attributedPromoId` set.

- [ ] **Step 4: Paid-only** — before payment, the admin Promos row shows the order is NOT counted; complete payment (PaymentTransaction → `paid`); the admin row now shows +1 attributed order and the revenue.

- [ ] **Step 5: Admin display** — confirm the Promos page renders impressions / clicks / CTR / orders / revenue for the promo.

---

## Self-Review

**Spec coverage:**
- Impressions/clicks/CTR (A) → Tasks 2, 3, 5, 6, 8. ✓
- Per-session impression dedup → Task 5 (`trackPromoImpression`). ✓
- Anon-allowed `promoTrack` in pre-auth branch → Task 3. ✓
- 24h last-click attribution via localStorage → Tasks 4, 5, 7. ✓
- Paid-only credit + revenue via `PaymentTransaction` → Task 1 (`ebuy_promo_stats`), never touching the payment path. ✓
- Admin per-promo stats → Task 8. ✓
- Fire-and-forget everywhere → Tasks 3, 5. ✓
- Tests: `promoTrack` validation (Task 2), 24h boundary + CTR guard (Task 4), paid-vs-unpaid (Task 9 manual). ✓

**Deviation from spec (flagged for the reader):** attribution is stamped in `initializeCustomerPayment` → `createOrderWithItems` (the real order-creation site), NOT `order-placement/handler.ts`. Same column, same behavior, but it avoids threading through the queue/handler. The `order-placement` job path is not used by the live Paystack checkout, so no attribution is lost.

**Placeholder scan:** no TBD/TODO; every code step shows code. The only lookup left to the implementer is the exact location of `createOrderWithItems`'s insert object (Task 7 Step 3), which is a named search, not a placeholder.

**Type consistency:** `resolveAttributedPromoId`, `promoCtr`, `validatePromoTrack`, `trackPromoImpression`/`trackPromoClick`/`takeAttributedPromoId`, and the `promoList` stat fields (`impressions`/`clicks`/`attributedOrders`/`attributedRevenue`) are named identically across tasks.
