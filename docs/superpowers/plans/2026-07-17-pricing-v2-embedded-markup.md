# Pricing v2 — Embedded Markup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat ₦150/unit markup + broken 5% service fee + 15%/10% commission with one embedded-markup model: customer menu price = restaurant price × 1.20 + ₦100/unit, no checkout service-fee line, restaurant settled at 100% of its own prices (partnerServiceRate exists in config but is 0).

**Architecture:** A new pure pricing module in `supabase/functions/_shared/pricing.ts` owns all money math, driven by a `PricingConfig` loaded from a new `PlatformSettings` DB row (cached, defaults-on-failure). `public-catalog` bakes display prices into the menu payload; `app-rpc` re-derives them authoritatively at order creation and stores per-item base+display prices. Clients do zero fee math — they sum server-quoted numbers.

**Tech Stack:** Supabase Edge Functions (Deno), Expo/React Native apps, plain `Deno.test` unit tests (no assert lib — match `validation.test.ts` idiom).

**Spec:** `docs/superpowers/specs/2026-07-17-pricing-v2-embedded-markup-design.md`

## Global Constraints

- Currency is NGN; all money rounded via `roundCurrency` (2 dp).
- Config values: `markupRate: 0.2`, `markupFlat: 100` (₦ per unit), `partnerServiceRate: 0` — the restaurant keeps 100% of its own prices (user decision 2026-07-17); the rate field stays in the math for future flexibility.
- `serviceFee` stays in stored order pricing JSON and types, always `0` on new orders (backward shape-compat).
- Legacy orders are never migrated; partner analytics must fall back gracefully on their stored fields.
- Do NOT touch `functions/prisma/schema.prisma` — it is not maintained for new tables (Promo was never added).
- New tables follow the existing PascalCase quoted-identifier style (see `supabase/migrations/20260714_promo_notifications.sql`); RLS enabled, no policies = service-role only.
- Deno test command (deno is winget-installed, not on the default tool-shell PATH — run in PowerShell):
  `$env:Path = "$env:LOCALAPPDATA\Microsoft\WinGet\Links;$env:Path"; deno test supabase/functions/_shared/pricing.test.ts`
- Base branch: `main` (pricing files are identical between main and feature/auth-gateway-hardening; the auth branch only diverges in phone/auth files).

---

### Task 0: Worktree bootstrap

**Files:** none (git only)

- [ ] **Step 1: Create the worktree off main**

From `C:\Users\emkad\EBuy\E-Foods`:

```bash
git worktree add ../pricing-v2-wt -b feature/pricing-v2 main
```

- [ ] **Step 2: Bring the spec + this plan onto the branch**

The spec/plan were committed on `feature/auth-gateway-hardening`. From the worktree:

```bash
cd ../pricing-v2-wt
git checkout feature/auth-gateway-hardening -- docs/superpowers/specs/2026-07-17-pricing-v2-embedded-markup-design.md docs/superpowers/plans/2026-07-17-pricing-v2-embedded-markup.md
git add docs/superpowers
git commit -m "docs: pricing v2 spec + implementation plan"
```

- [ ] **Step 3: Install deps in the worktree**

```bash
npm install
```

Expected: completes without errors (workspaces install).

All subsequent tasks run inside `C:\Users\emkad\EBuy\pricing-v2-wt`.

---

### Task 1: Pure pricing module (`_shared/pricing.ts`) — TDD

**Files:**
- Create: `supabase/functions/_shared/pricing.ts`
- Test: `supabase/functions/_shared/pricing.test.ts`

**Interfaces:**
- Produces (used by Tasks 2, 3, 4):
  - `interface PricingConfig { markupRate: number; markupFlat: number; partnerServiceRate: number }`
  - `const DEFAULT_PRICING_CONFIG: PricingConfig`
  - `roundCurrency(value: number): number`
  - `parsePricingConfig(raw: unknown): PricingConfig` — returns defaults for anything invalid
  - `toDisplayPrice(basePrice: number, config: PricingConfig): number`
  - `interface PricedOrderItem { basePrice: number; price: number; quantity: number }`
  - `calculateOrderPricing({ config, deliveryFee, items, tip }): OrderPricingResult` (shape in Step 3 code)

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/pricing.test.ts`:

```ts
import {
  DEFAULT_PRICING_CONFIG,
  calculateOrderPricing,
  parsePricingConfig,
  roundCurrency,
  toDisplayPrice,
} from './pricing.ts';

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
};

Deno.test('toDisplayPrice embeds 20% + flat 100 per unit', () => {
  expectEqual(toDisplayPrice(5000, DEFAULT_PRICING_CONFIG), 6100, 'spec worked example');
  expectEqual(toDisplayPrice(500, DEFAULT_PRICING_CONFIG), 700, 'cheap item');
});

Deno.test('toDisplayPrice rounds at kobo precision', () => {
  expectEqual(toDisplayPrice(333.33, DEFAULT_PRICING_CONFIG), 500, '333.33*1.2+100 = 499.996 → 500');
});

Deno.test('toDisplayPrice returns 0 for free or invalid base prices', () => {
  expectEqual(toDisplayPrice(0, DEFAULT_PRICING_CONFIG), 0, 'zero base');
  expectEqual(toDisplayPrice(-50, DEFAULT_PRICING_CONFIG), 0, 'negative base');
  expectEqual(toDisplayPrice(Number.NaN, DEFAULT_PRICING_CONFIG), 0, 'NaN base');
});

Deno.test('parsePricingConfig accepts a valid record', () => {
  const parsed = parsePricingConfig({ markupRate: 0.25, markupFlat: 50, partnerServiceRate: 0.05 });
  expectEqual(parsed.markupRate, 0.25, 'markupRate');
  expectEqual(parsed.markupFlat, 50, 'markupFlat');
  expectEqual(parsed.partnerServiceRate, 0.05, 'partnerServiceRate');
});

Deno.test('parsePricingConfig falls back to defaults on garbage', () => {
  for (const raw of [null, undefined, 'x', 42, {}, { markupRate: 'a' }, { markupRate: -1, markupFlat: 100, partnerServiceRate: 0.03 }, { markupRate: 0.2, markupFlat: 100, partnerServiceRate: 0.9 }]) {
    const parsed = parsePricingConfig(raw);
    expectEqual(parsed.markupRate, DEFAULT_PRICING_CONFIG.markupRate, `markupRate for ${JSON.stringify(raw)}`);
    expectEqual(parsed.markupFlat, DEFAULT_PRICING_CONFIG.markupFlat, `markupFlat for ${JSON.stringify(raw)}`);
    expectEqual(parsed.partnerServiceRate, DEFAULT_PRICING_CONFIG.partnerServiceRate, `partnerServiceRate for ${JSON.stringify(raw)}`);
  }
});

Deno.test('calculateOrderPricing matches the spec worked example (2 × ₦5,000 item)', () => {
  const pricing = calculateOrderPricing({
    config: DEFAULT_PRICING_CONFIG,
    deliveryFee: 800,
    items: [{ basePrice: 5000, price: 6100, quantity: 2 }],
    tip: 0,
  });
  expectEqual(pricing.subtotal, 12200, 'display subtotal');
  expectEqual(pricing.restaurantBasis, 10000, 'own-price basis');
  expectEqual(pricing.partnerServiceFee, 0, 'no partner service charge');
  expectEqual(pricing.restaurantPayable, 10000, 'restaurant keeps full own price');
  expectEqual(pricing.platformFee, 2200, 'embedded markup only');
  expectEqual(pricing.netSettlement, 10800, 'payable + delivery fee');
  expectEqual(pricing.serviceFee, 0, 'no customer service fee');
  expectEqual(pricing.total, 13000, 'subtotal + delivery + tip');
  expectEqual(pricing.currency, 'NGN', 'currency');
});

Deno.test('calculateOrderPricing honors a nonzero partnerServiceRate (future flexibility)', () => {
  const pricing = calculateOrderPricing({
    config: { markupRate: 0.2, markupFlat: 100, partnerServiceRate: 0.03 },
    deliveryFee: 0,
    items: [{ basePrice: 5000, price: 6100, quantity: 2 }],
    tip: 0,
  });
  expectEqual(pricing.partnerServiceFee, 300, '3% of basis');
  expectEqual(pricing.restaurantPayable, 9700, 'basis minus fee');
  expectEqual(pricing.platformFee, 2500, 'markup 2200 + fee 300');
});

Deno.test('calculateOrderPricing reconciles platformFee + restaurantPayable = subtotal', () => {
  const pricing = calculateOrderPricing({
    config: DEFAULT_PRICING_CONFIG,
    deliveryFee: 0,
    items: [
      { basePrice: 1234.56, price: toDisplayPrice(1234.56, DEFAULT_PRICING_CONFIG), quantity: 3 },
      { basePrice: 789.01, price: toDisplayPrice(789.01, DEFAULT_PRICING_CONFIG), quantity: 1 },
    ],
    tip: 100,
  });
  expectEqual(
    roundCurrency(pricing.platformFee + pricing.restaurantPayable),
    pricing.subtotal,
    'reconciliation'
  );
});

Deno.test('calculateOrderPricing handles an empty cart as zeros', () => {
  const pricing = calculateOrderPricing({ config: DEFAULT_PRICING_CONFIG, deliveryFee: 0, items: [], tip: 0 });
  expectEqual(pricing.total, 0, 'total');
  expectEqual(pricing.restaurantPayable, 0, 'payable');
  expectEqual(pricing.platformFee, 0, 'platformFee');
});

Deno.test('calculateOrderPricing clamps negative delivery fee and tip to 0', () => {
  const pricing = calculateOrderPricing({
    config: DEFAULT_PRICING_CONFIG,
    deliveryFee: -50,
    items: [{ basePrice: 1000, price: 1300, quantity: 1 }],
    tip: -10,
  });
  expectEqual(pricing.deliveryFee, 0, 'deliveryFee clamped');
  expectEqual(pricing.tip, 0, 'tip clamped');
  expectEqual(pricing.total, 1300, 'total');
});
```

- [ ] **Step 2: Run test to verify it fails**

PowerShell:
```powershell
$env:Path = "$env:LOCALAPPDATA\Microsoft\WinGet\Links;$env:Path"; deno test supabase/functions/_shared/pricing.test.ts
```
Expected: FAIL — `Module not found ... pricing.ts`.

- [ ] **Step 3: Write the implementation**

Create `supabase/functions/_shared/pricing.ts`:

```ts
// Pricing v2 (embedded markup): all platform money math lives here.
// Customer-facing menu price = restaurant base price × (1 + markupRate) + markupFlat, per unit.
// The restaurant is settled at (1 − partnerServiceRate) of its own-price basis; the
// embedded markup plus that service charge is the platform's take. There is no
// customer-visible service fee and no restaurant commission.
// Spec: docs/superpowers/specs/2026-07-17-pricing-v2-embedded-markup-design.md

export interface PricingConfig {
  markupRate: number;
  markupFlat: number;
  partnerServiceRate: number;
}

export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  markupRate: 0.2,
  markupFlat: 100,
  // 0 by decision: the restaurant keeps 100% of its own prices. The rate stays
  // in the math so a partner charge can be enabled from the DB row later.
  partnerServiceRate: 0,
};

export const PRICING_CURRENCY = 'NGN';

export const roundCurrency = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

// Bounds keep a mistyped admin value (e.g. markupRate 20 instead of 0.2) from
// silently multiplying every menu price; out-of-range configs fall back whole.
export const parsePricingConfig = (raw: unknown): PricingConfig => {
  if (!raw || typeof raw !== 'object') {
    return DEFAULT_PRICING_CONFIG;
  }

  const record = raw as Record<string, unknown>;
  const markupRate = Number(record.markupRate);
  const markupFlat = Number(record.markupFlat);
  const partnerServiceRate = Number(record.partnerServiceRate);

  const valid =
    Number.isFinite(markupRate) && markupRate >= 0 && markupRate <= 1 &&
    Number.isFinite(markupFlat) && markupFlat >= 0 && markupFlat <= 10000 &&
    Number.isFinite(partnerServiceRate) && partnerServiceRate >= 0 && partnerServiceRate <= 0.5;

  return valid ? { markupRate, markupFlat, partnerServiceRate } : DEFAULT_PRICING_CONFIG;
};

export const toDisplayPrice = (basePrice: number, config: PricingConfig) => {
  if (!Number.isFinite(basePrice) || basePrice <= 0) {
    return 0;
  }

  return roundCurrency(basePrice * (1 + config.markupRate) + config.markupFlat);
};

export interface PricedOrderItem {
  basePrice: number;
  price: number;
  quantity: number;
}

export const calculateOrderPricing = ({
  config,
  deliveryFee,
  items,
  tip,
}: {
  config: PricingConfig;
  deliveryFee: number;
  items: PricedOrderItem[];
  tip: number;
}) => {
  const subtotal = roundCurrency(items.reduce((sum, item) => sum + item.price * item.quantity, 0));
  const restaurantBasis = roundCurrency(items.reduce((sum, item) => sum + item.basePrice * item.quantity, 0));
  const safeDeliveryFee = roundCurrency(Math.max(deliveryFee, 0));
  const safeTip = roundCurrency(Math.max(tip, 0));
  const totalMarkup = roundCurrency(Math.max(subtotal - restaurantBasis, 0));
  const partnerServiceFee = roundCurrency(restaurantBasis * config.partnerServiceRate);
  const restaurantPayable = roundCurrency(Math.max(restaurantBasis - partnerServiceFee, 0));
  const platformFee = roundCurrency(totalMarkup + partnerServiceFee);
  const netSettlement = roundCurrency(restaurantPayable + safeDeliveryFee);
  const total = roundCurrency(subtotal + safeDeliveryFee + safeTip);

  return {
    currency: PRICING_CURRENCY,
    deliveryFee: safeDeliveryFee,
    discount: 0,
    dispatchFee: safeDeliveryFee,
    netSettlement,
    partnerServiceFee,
    platformFee,
    restaurantBasis,
    restaurantPayable,
    serviceFee: 0,
    settlement: {
      basis: 'menu_base_prices',
      dispatchFee: safeDeliveryFee,
      markupFlat: config.markupFlat,
      markupRate: config.markupRate,
      netSettlement,
      partnerServiceFee,
      partnerServiceRate: config.partnerServiceRate,
      platformFee,
      restaurantBasis,
      restaurantPayable,
      totalMarkup,
    },
    subtotal,
    tip: safeTip,
    total,
  };
};
```

- [ ] **Step 4: Run test to verify it passes**

Same PowerShell command as Step 2. Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/pricing.ts supabase/functions/_shared/pricing.test.ts
git commit -m "feat(pricing): shared embedded-markup pricing module"
```

---

### Task 2: PlatformSettings migration + config loader

**Files:**
- Create: `supabase/migrations/20260717_platform_settings_pricing.sql`
- Create: `supabase/functions/_shared/platformSettings.ts`

**Interfaces:**
- Consumes: `parsePricingConfig`, `DEFAULT_PRICING_CONFIG`, `PricingConfig` from `./pricing.ts`; `serviceClient` from `./client.ts`; `logEdgeEvent` from `./observability.ts`.
- Produces (used by Tasks 3, 4): `loadPricingConfig(): Promise<PricingConfig>` — DB-backed, 60 s in-memory cache, never throws (defaults on any failure).

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260717_platform_settings_pricing.sql`:

```sql
-- Pricing v2 (embedded markup): server-owned pricing parameters + per-item base
-- price snapshot on order items. The edge functions read the 'pricing' row and
-- fall back to identical hardcoded defaults if it is missing.
-- Spec: docs/superpowers/specs/2026-07-17-pricing-v2-embedded-markup-design.md

create table if not exists public."PlatformSettings" (
  "id"        text primary key,
  "data"      jsonb not null default '{}'::jsonb,
  "updatedAt" timestamptz not null default now()
);

alter table public."PlatformSettings" enable row level security;
-- No policies: reads/writes are service-role only (edge functions / admin RPC).

insert into public."PlatformSettings" ("id", "data")
values ('pricing', '{"markupRate": 0.2, "markupFlat": 100, "partnerServiceRate": 0}'::jsonb)
on conflict ("id") do nothing;

-- Restaurant's own per-unit price at order time; display price stays in "price".
-- Nullable: rows created before pricing v2 have no base snapshot.
alter table public."OrderItem" add column if not exists "basePrice" double precision;
```

- [ ] **Step 2: Write the loader**

Create `supabase/functions/_shared/platformSettings.ts`:

```ts
/// <reference path="./edge-runtime.d.ts" />

import { serviceClient } from './client.ts';
import { logEdgeEvent } from './observability.ts';
import { DEFAULT_PRICING_CONFIG, parsePricingConfig, type PricingConfig } from './pricing.ts';

const CACHE_TTL_MS = 60_000;

let cached: { config: PricingConfig; expiresAt: number } | null = null;

// Never throws: an order must not fail because the settings row is unreadable.
// The seeded row and DEFAULT_PRICING_CONFIG hold identical values, so the
// fallback cannot silently change prices unless the row was edited.
export const loadPricingConfig = async (): Promise<PricingConfig> => {
  if (cached && cached.expiresAt > Date.now()) {
    return cached.config;
  }

  try {
    const { data, error } = await serviceClient
      .from('PlatformSettings')
      .select('data')
      .eq('id', 'pricing')
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    if (!data) {
      logEdgeEvent('warn', 'PlatformSettings pricing row missing; using defaults', {});
    }

    const config = parsePricingConfig(data?.data);
    cached = { config, expiresAt: Date.now() + CACHE_TTL_MS };
    return config;
  } catch (error) {
    logEdgeEvent('warn', 'Failed to load pricing config; using defaults', {
      error: error instanceof Error ? error.message : String(error),
    });
    return DEFAULT_PRICING_CONFIG;
  }
};
```

Check `logEdgeEvent`'s signature in `supabase/functions/_shared/observability.ts` before committing — if it does not accept `(level, message, fields)`, match its actual signature.

- [ ] **Step 3: Verify tests still pass (loader has no unit test — it is thin I/O; `parsePricingConfig` carries the logic and is covered by Task 1)**

```powershell
$env:Path = "$env:LOCALAPPDATA\Microsoft\WinGet\Links;$env:Path"; deno test supabase/functions/_shared/pricing.test.ts
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260717_platform_settings_pricing.sql supabase/functions/_shared/platformSettings.ts
git commit -m "feat(pricing): PlatformSettings table + cached config loader"
```

---

### Task 3: public-catalog returns display prices

**Files:**
- Modify: `supabase/functions/public-catalog/index.ts`

**Interfaces:**
- Consumes: `toDisplayPrice`, `PricingConfig` from `../_shared/pricing.ts`; `loadPricingConfig` from `../_shared/platformSettings.ts`.
- Produces: catalog payload where every `menu[].items[].price` is the customer-facing display price. No other payload change.

- [ ] **Step 1: Add imports**

After the existing `_shared` imports at the top of `supabase/functions/public-catalog/index.ts`:

```ts
import { toDisplayPrice, type PricingConfig } from '../_shared/pricing.ts';
import { loadPricingConfig } from '../_shared/platformSettings.ts';
```

- [ ] **Step 2: Add the menu transformer and thread the config through**

Add above `toRestaurantResponse`:

```ts
// Customers only ever see final prices; the restaurant's own price never
// leaves the server. Malformed categories/items pass through untouched.
const withDisplayMenuPrices = (menu: unknown[], config: PricingConfig) =>
  menu.map((category) => {
    if (!category || typeof category !== 'object') {
      return category;
    }

    const categoryRecord = category as Record<string, unknown>;
    if (!Array.isArray(categoryRecord.items)) {
      return category;
    }

    return {
      ...categoryRecord,
      items: categoryRecord.items.map((item) => {
        if (!item || typeof item !== 'object') {
          return item;
        }

        const itemRecord = item as Record<string, unknown>;
        if (typeof itemRecord.price !== 'number' || !Number.isFinite(itemRecord.price)) {
          return item;
        }

        return { ...itemRecord, price: toDisplayPrice(itemRecord.price, config) };
      }),
    };
  });
```

Change `toRestaurantResponse` to accept the config and use the transformer:

```ts
const toRestaurantResponse = (
  restaurant: RestaurantRecordRow,
  approval: RestaurantApprovalRow | null,
  pricingConfig: PricingConfig
) => ({
```

and replace the `menu:` line:

```ts
  menu: Array.isArray(restaurant.menu) ? withDisplayMenuPrices(restaurant.menu, pricingConfig) : [],
```

In `loadPublishedRestaurantCatalog`, load the config and pass it through — replace the final `return`:

```ts
  const pricingConfig = await loadPricingConfig();

  return (restaurants ?? []).map((restaurant) =>
    toRestaurantResponse(restaurant, approvalByRestaurantId.get(restaurant.id) ?? null, pricingConfig)
  );
```

- [ ] **Step 3: Typecheck the function**

```powershell
$env:Path = "$env:LOCALAPPDATA\Microsoft\WinGet\Links;$env:Path"; deno check supabase/functions/public-catalog/index.ts
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/public-catalog/index.ts
git commit -m "feat(pricing): catalog serves customer display prices"
```

---

### Task 4: app-rpc order pricing rewire

**Files:**
- Modify: `supabase/functions/app-rpc/index.ts`

**Interfaces:**
- Consumes: `calculateOrderPricing`, `toDisplayPrice`, `PricingConfig` from `../_shared/pricing.ts`; `loadPricingConfig` from `../_shared/platformSettings.ts`.
- Produces: order `pricing` JSON with `serviceFee: 0` and new top-level `restaurantBasis`, `partnerServiceFee`, `restaurantPayable`, plus the new `settlement` snapshot (Task 1 shape). `OrderItem` rows gain `basePrice`.

- [ ] **Step 1: Add imports**

Add to the existing `_shared` import block:

```ts
import { calculateOrderPricing, toDisplayPrice, type PricingConfig } from '../_shared/pricing.ts';
import { loadPricingConfig } from '../_shared/platformSettings.ts';
```

(The file keeps its own local `roundCurrency` — other call sites use it.)

- [ ] **Step 2: Delete the dead constants and functions**

- Delete `PLATFORM_COMMISSION_RATES` (lines ~292–295).
- Delete the `CUSTOMER_ITEM_MARKUP` constant and its comment block (lines ~296–300).
- Delete `calculateServiceFee` (lines ~1783–1789).
- Delete `calculateSettlementBreakdown` (lines ~1791–1824).
- Delete the local `calculatePricing` (lines ~1826–1865).

(Line numbers are from `main` at the time of writing — locate by name, not number.)

- [ ] **Step 3: Rework `buildOrderItems`**

New signature and item shape (whole function):

```ts
const buildOrderItems = (
  requestedItems: unknown,
  restaurantId: string,
  restaurant: RestaurantRecordRow,
  pricingConfig: PricingConfig
) => {
  if (!Array.isArray(requestedItems) || requestedItems.length === 0) {
    fail(400, 'Add at least one item before placing an order.');
  }

  const menuItems = flattenRestaurantMenu(restaurant);
  const menuLookup = new Map(menuItems.map((item) => [item.id, item]));

  return requestedItems.map((item) => {
    const itemRecord = item as JsonObject;
    const itemId = sanitizeText(itemRecord.id);
    const quantity = Number.parseInt(String(itemRecord.quantity ?? ''), 10);

    if (!itemId || !Number.isInteger(quantity) || quantity <= 0) {
      fail(400, 'Each order item must include a valid id and quantity.');
    }

    const menuItem = menuLookup.get(itemId);
    if (!menuItem || menuItem.isAvailable === false) {
      fail(412, 'One or more selected menu items are unavailable.');
    }

    return {
      // Restaurant's own price — settlement and min-order run on this.
      basePrice: menuItem.price,
      id: menuItem.id,
      name: menuItem.name,
      // Customer-facing price with the platform markup embedded, re-derived
      // server-side from the authoritative menu price (never client input).
      price: toDisplayPrice(menuItem.price, pricingConfig),
      quantity,
      restaurantId,
      restaurantName: sanitizeText(restaurant.name, 'Restaurant'),
    };
  });
};
```

- [ ] **Step 4: Rework the pricing block in `prepareCustomerOrderDraft`**

Replace the block from `const items = buildOrderItems(...)` through `const pricing = calculatePricing({...});` with:

```ts
  const pricingConfig = await loadPricingConfig();
  const items = buildOrderItems(requestData.items, restaurantId, restaurant, pricingConfig);
  // Min-order and settlement both run on the restaurant's own menu prices,
  // never on the marked-up customer prices.
  const restaurantBasis = items.reduce((sum, item) => sum + item.basePrice * item.quantity, 0);
  const deliveryFee = fulfillmentType === 'delivery' ? parseNumber(restaurant.deliveryFee, 0) : 0;
  const minOrder = parseNumber(restaurant.minOrder, 0);

  if (restaurantBasis < minOrder) {
    fail(412, `This restaurant requires a minimum order of ${minOrder.toFixed(2)}.`);
  }

  const deliveryLocation =
    fulfillmentType === 'delivery' ? normalizeDeliveryLocation(requestData.deliveryLocation) : null;
  if (fulfillmentType === 'delivery' && !deliveryLocation) {
    fail(400, 'A valid delivery location is required.');
  }

  const pricing = calculateOrderPricing({
    config: pricingConfig,
    deliveryFee,
    items,
    tip: tipAmount,
  });
```

(Keep the existing `return { deliveryLocation, fulfillmentType, ... }` unchanged.)

- [ ] **Step 5: Persist `basePrice` on order items**

In `createOrderWithItems`: add `basePrice: number;` to the `items` array element type, and add `basePrice: item.basePrice,` to the object inside the `OrderItem` insert `items.map(...)`.

- [ ] **Step 6: Sweep for leftovers**

```bash
grep -n "CUSTOMER_ITEM_MARKUP\|PLATFORM_COMMISSION_RATES\|calculateServiceFee\|calculateSettlementBreakdown\|marketplaceMarkup" supabase/functions/app-rpc/index.ts
```
Expected: no matches. Then:

```powershell
$env:Path = "$env:LOCALAPPDATA\Microsoft\WinGet\Links;$env:Path"; deno check supabase/functions/app-rpc/index.ts
```
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/app-rpc/index.ts
git commit -m "feat(pricing): app-rpc orders on embedded markup, full own-price settlement"
```

---

### Task 5: Domain cleanup + customer menu display

**Files:**
- Modify: `packages/domain/src/orders.ts` (delete markup helpers)
- Modify: `packages/domain/src/entities.ts` (extend `OrderPriceBreakdown`)
- Modify: `apps/customer/app/(customer)/home/restaurant/[id].tsx`
- Check: `apps/customer/src/domain/entities.ts` and `apps/partner/src/domain/entities.ts` — if they are full copies (not re-exports of `packages/domain`), mirror the `OrderPriceBreakdown` change there too.

**Interfaces:**
- Produces: `OrderPriceBreakdown` gains optional `restaurantBasis?: number; partnerServiceFee?: number; restaurantPayable?: number` (used by Task 7).

- [ ] **Step 1: Delete the markup helpers**

In `packages/domain/src/orders.ts`, delete lines 18–26 (the `CUSTOMER_ITEM_MARKUP` comment + constant and `toCustomerFacingItemPrice`).

- [ ] **Step 2: Extend `OrderPriceBreakdown`**

In `packages/domain/src/entities.ts` (interface at ~line 106), add after `total: number;`:

```ts
  /** Restaurant's own-price basis (Σ base price × qty). Absent on legacy orders. */
  restaurantBasis?: number;
  /** Platform service charge deducted from the basis (currently 0). Absent on legacy orders. */
  partnerServiceFee?: number;
  /** Food payout: basis − service charge. Legacy orders carry the commission-era value. */
  restaurantPayable?: number;
```

If `apps/customer/src/domain/entities.ts` / `apps/partner/src/domain/entities.ts` define their own `OrderPriceBreakdown` rather than re-exporting, apply the same addition in each.

- [ ] **Step 3: Use catalog prices directly in the customer menu screen**

In `apps/customer/app/(customer)/home/restaurant/[id].tsx`:
- Remove the import of `toCustomerFacingItemPrice` (line ~22).
- Line ~154: `price: toCustomerFacingItemPrice(item.price),` → `price: item.price,`
- Line ~176: `price: toCustomerFacingItemPrice(item.price),` → `price: item.price,`
- Line ~340: `formatMoney(toCustomerFacingItemPrice(menuItem.price))` → `formatMoney(menuItem.price)`

- [ ] **Step 4: Verify nothing references the deleted helpers**

```bash
grep -rn "toCustomerFacingItemPrice\|CUSTOMER_ITEM_MARKUP" apps packages --include="*.ts" --include="*.tsx"
```
Expected: no matches.

- [ ] **Step 5: Commit**

```bash
git add packages/domain apps/customer
git commit -m "feat(pricing): drop client-side markup math; menu uses catalog display prices"
```

---

### Task 6: Customer checkout — remove the service-fee line

**Files:**
- Modify: `apps/customer/src/utils/checkoutPricing.ts`
- Modify: `apps/customer/app/(customer)/cart.tsx`
- Modify: `apps/customer/app/(customer)/orders/[id].tsx`

**Interfaces:**
- Produces: `calculateCheckoutTotal({ deliveryFee, subtotal, tip })` now returns `{ deliveryFee, subtotal, tip, total }` — **no `serviceFee` key**.

- [ ] **Step 1: Rewrite `checkoutPricing.ts`** (whole file):

```ts
export const roundCurrency = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

// Menu prices arrive from the catalog with the platform markup already
// embedded, so checkout is a plain sum. The server re-derives every amount
// authoritatively at order creation — this preview must add nothing.
export const calculateCheckoutTotal = ({
  deliveryFee,
  subtotal,
  tip,
}: {
  deliveryFee: number;
  subtotal: number;
  tip: number;
}) => {
  const safeSubtotal = roundCurrency(subtotal);
  const safeDeliveryFee = roundCurrency(deliveryFee);
  const safeTip = roundCurrency(tip);

  return {
    deliveryFee: safeDeliveryFee,
    subtotal: safeSubtotal,
    tip: safeTip,
    total: roundCurrency(safeSubtotal + safeDeliveryFee + safeTip),
  };
};
```

- [ ] **Step 2: Remove the cart's service-fee row**

In `apps/customer/app/(customer)/cart.tsx` (~lines 506–509), delete the `summarySplit` view containing `Service fee` / `pricingPreview.serviceFee`. Also remove any `calculateServiceFee` import if present.

- [ ] **Step 3: Make the order-detail line legacy-only**

In `apps/customer/app/(customer)/orders/[id].tsx` (~line 238), replace:

```tsx
<Text style={styles.detailLine}>Service fee: {formatMoney(order.pricing?.serviceFee ?? 0)}</Text>
```

with:

```tsx
{order.pricing?.serviceFee ? (
  <Text style={styles.detailLine}>Service fee: {formatMoney(order.pricing.serviceFee)}</Text>
) : null}
```

- [ ] **Step 4: Lint**

```bash
npm --prefix apps/customer run lint
```
Expected: passes (or only pre-existing warnings).

- [ ] **Step 5: Commit**

```bash
git add apps/customer
git commit -m "feat(pricing): checkout drops the service-fee line"
```

---

### Task 7: Partner earnings at the restaurant's own prices

**Files:**
- Modify: `apps/partner/src/utils/partnerAnalytics.ts`
- Modify: `apps/partner/app/(partner)/index.tsx`

**Interfaces:**
- Consumes: `OrderPriceBreakdown` optional fields from Task 5.
- Produces: `PartnerKpis` = `{ orders, earnings, avgOrder }` (all `PeriodComparison`; `cost` and `costShareOfGross` removed).

- [ ] **Step 1: Rewrite the KPI computation in `partnerAnalytics.ts`**

Replace the `PartnerKpis` interface and `computePartnerKpis` (keep everything else) with:

```ts
export interface PartnerKpis {
  orders: PeriodComparison;
  /** Food earnings at the restaurant's own menu prices — exactly what the kitchen is paid. */
  earnings: PeriodComparison;
  avgOrder: PeriodComparison;
}

type PricingRecord = {
  restaurantBasis?: number;
  restaurantPayable?: number;
  settlement?: { marketplaceMarkup?: number } | null;
  subtotal?: number;
};

// Pricing-v2 orders are settled at the restaurant's full own-price basis
// (restaurantPayable === restaurantBasis). Legacy orders fall back to their
// stored commission-era payable — that is what was actually owed at the time —
// and, failing that, subtotal minus the old flat marketplace markup.
const earningsOf = (order: OrderDocument) => {
  const pricing = (order.pricing ?? null) as PricingRecord | null;
  if (typeof pricing?.restaurantPayable === 'number') {
    return pricing.restaurantPayable;
  }

  if (typeof pricing?.restaurantBasis === 'number') {
    return pricing.restaurantBasis;
  }

  const subtotal = pricing?.subtotal ?? orderTotal(order);
  const legacyMarkup = typeof pricing?.settlement?.marketplaceMarkup === 'number' ? pricing.settlement.marketplaceMarkup : 0;
  return Math.max(subtotal - legacyMarkup, 0);
};

export const computePartnerKpis = (orders: OrderDocument[], rangeDays: RangeDays, now = new Date()): PartnerKpis => {
  const currentStart = new Date(now.getTime() - rangeDays * 24 * 60 * 60 * 1000);
  const previousStart = new Date(now.getTime() - 2 * rangeDays * 24 * 60 * 60 * 1000);

  const currentOrders = ordersBetween(orders, currentStart, now);
  const previousOrders = ordersBetween(orders, previousStart, currentStart);

  const sumOf = (windowOrders: OrderDocument[], pick: (order: OrderDocument) => number) =>
    windowOrders.reduce((total, order) => (isCountedTowardRevenue(order) ? total + pick(order) : total), 0);

  const currentEarnings = sumOf(currentOrders, earningsOf);
  const previousEarnings = sumOf(previousOrders, earningsOf);

  // Averages are per completed order, so they line up with earnings above.
  const currentCompleted = currentOrders.filter(isCountedTowardRevenue).length;
  const previousCompleted = previousOrders.filter(isCountedTowardRevenue).length;

  return {
    orders: { current: currentOrders.length, previous: previousOrders.length },
    earnings: { current: currentEarnings, previous: previousEarnings },
    avgOrder: {
      current: currentCompleted > 0 ? currentEarnings / currentCompleted : 0,
      previous: previousCompleted > 0 ? previousEarnings / previousCompleted : 0,
    },
  };
};
```

- [ ] **Step 2: Update the dashboard cards**

In `apps/partner/app/(partner)/index.tsx` (~lines 174–187): keep the `Earnings` card exactly as-is (it already reads `kpis.earnings`), and delete the whole `Total costs` `KpiCard` (the one using `kpis.cost.current` and `costShareOfGross`). Keep the `Avg order value` card. If `partnerTheme.danger` is now unused in the file, remove that import usage only if the linter flags it.

- [ ] **Step 3: Typecheck**

```bash
npm --prefix apps/partner run typecheck
```
Expected: no errors (fix any other `kpis.earnings`/`kpis.cost`/`costShareOfGross` references the compiler finds).

- [ ] **Step 4: Commit**

```bash
git add apps/partner
git commit -m "feat(pricing): partner earnings at the restaurant's own prices"
```

---

### Task 8: Full verification + deploy checklist

**Files:** none new.

- [ ] **Step 1: Run everything**

```powershell
$env:Path = "$env:LOCALAPPDATA\Microsoft\WinGet\Links;$env:Path"
deno test supabase/functions/_shared/
deno check supabase/functions/app-rpc/index.ts supabase/functions/public-catalog/index.ts
```
```bash
npm --prefix apps/partner run typecheck
npm --prefix apps/customer run lint
```
Expected: all pass.

- [ ] **Step 2: End-to-end sanity in the dev app (optional but recommended)**

Start the customer app against local/staging, open a restaurant, and confirm: menu shows base×1.2+100 prices, cart shows no service-fee row, order total = items + delivery + tip.

- [ ] **Step 3: Operator deploy steps (user runs; agent cannot)**

1. Apply `supabase/migrations/20260717_platform_settings_pricing.sql` to Frankfurt (`npx supabase db push` or MCP `apply_migration`).
2. Deploy `app-rpc` (needs `--no-verify-jwt`) and `public-catalog` via the usual deploy script. ⚠️ The script syncs `functions/.env` → secrets on every run — confirm the Paystack live keys in `functions/.env` are still the real ones first.
3. Ship new customer/partner builds (Expo) and redeploy partner web on Vercel. Old builds will preview slightly different totals until updated; the server charge is authoritative.

- [ ] **Step 4: Merge/PR**

Follow superpowers:finishing-a-development-branch — merge `feature/pricing-v2` into `main` (single source of truth).
