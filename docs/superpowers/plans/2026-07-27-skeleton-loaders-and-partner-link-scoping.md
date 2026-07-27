# Skeleton Loaders + Partner Restaurant-Link Scoping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `partnerGetRestaurantContext` from returning every restaurant on the platform to every partner, and replace route-level spinners with content-shaped skeleton loaders across all four apps.

**Architecture:** Part 1 extracts two pure decision helpers into a new `partnerRestaurantScope.ts` module beside the `app-rpc` edge function so the scoping rules are unit-testable without a Supabase client, then wires them into the existing handler and trims the partner profile UI. Part 2 adds a `Skeleton` primitive plus three layout presets to each React Native app (themed from that app's own `palette.ts`) and a CSS-driven equivalent to admin-web, then swaps 13 route-level loading blocks and 7 admin page loading blocks over to them.

**Tech Stack:** Deno (Supabase edge functions), React Native + Expo Router (customer, partner, dispatch), React + Vite (admin-web), `node --test --experimental-strip-types` for app-side tests, `deno test` for edge-function tests.

**Spec:** `docs/superpowers/specs/2026-07-27-skeleton-loaders-and-partner-link-scoping-design.md`

## Global Constraints

- Part 1 lands before Part 2. It is a live data-exposure fix; the skeleton work is cosmetic.
- Do **not** run the `app-rpc` deploy. Deployment is an operator step. Finish the code and say so.
- Do not add a new workspace package. Skeleton components live per app under that app's `src/components/`.
- React Native skeleton animation must use `useNativeDriver: true`. That means animating **opacity only** — colour interpolation is not supported by the native driver.
- `partnerTheme` and `dispatchTheme` have **no** `surfaceStrong` key (only `customerTheme` does). Skeleton blocks use each app's `surfaceMuted` as the base fill and pulse opacity. Do not reference `surfaceStrong`.
- Admin-web colours come from the CSS custom properties already defined in `apps/admin-web/src/styles/global.css:1-25`. Use `--surface-muted` and `--border-strong`. Do not add new `:root` variables.
- Leave the 8 auth/boot gates and all inline spinners alone. The exact list is in Task 10.
- Edge-function tests import with an explicit `.ts` extension (Deno style), e.g. `from './partnerRestaurantScope.ts'`. App-side tests import with `.js` (Node strip-types style), e.g. `from './restaurantCompletionHandoff.js'`. Follow the convention of the directory you are in.
- Edge-function tests use **no external imports** — no `jsr:@std/assert`, no `deno.land/std`. They define a local assertion helper and throw. Match `supabase/functions/_shared/validation.test.ts:1-6`.
- `deno` may not be on the tool shell's PATH. Run Deno commands from PowerShell, prepending the WinGet Links directory if needed.

---

## Task 1: Pure scoping + claim-guard helpers

**Files:**
- Create: `supabase/functions/app-rpc/partnerRestaurantScope.ts`
- Test: `supabase/functions/app-rpc/partnerRestaurantScope.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `resolvePartnerRestaurantScope({ role, uid, linkedRestaurantId }): { ownerFilterUid: string | null; extraRestaurantId: string | null }`
  - `canClaimRestaurantLink({ role, uid, linkedRestaurantId, restaurantId, restaurantOwnerId }): boolean`
  - `dedupeRestaurantRowsById<T extends { id: string }>(rows: T[]): T[]`

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/app-rpc/partnerRestaurantScope.test.ts`:

Note the assertion style: edge-function tests in this repo import **nothing** external — no `jsr:@std/assert`, no `deno.land/std`. They hand-roll a local helper and throw. Follow that (see `supabase/functions/_shared/validation.test.ts:1-6` for the house pattern).

```ts
import {
  canClaimRestaurantLink,
  dedupeRestaurantRowsById,
  resolvePartnerRestaurantScope,
} from './partnerRestaurantScope.ts';

const equals = (actual: unknown, expected: unknown, label: string) => {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${label}: expected ${expectedJson}, got ${actualJson}`);
  }
};

Deno.test('admins are not owner-filtered', () => {
  equals(
    resolvePartnerRestaurantScope({ role: 'admin', uid: 'admin-1', linkedRestaurantId: 'rest-9' }),
    { ownerFilterUid: null, extraRestaurantId: null },
    'admin scope'
  );
});

Deno.test('partners are filtered to restaurants they own', () => {
  equals(
    resolvePartnerRestaurantScope({ role: 'restaurant', uid: 'user-1', linkedRestaurantId: '' }),
    { ownerFilterUid: 'user-1', extraRestaurantId: null },
    'partner scope'
  );
});

Deno.test('a partner whose linked restaurant may not be owned still gets that row', () => {
  equals(
    resolvePartnerRestaurantScope({ role: 'restaurant', uid: 'user-1', linkedRestaurantId: 'rest-3' }),
    { ownerFilterUid: 'user-1', extraRestaurantId: 'rest-3' },
    'partner scope with drifted link'
  );
});

Deno.test('admins can claim any restaurant', () => {
  equals(
    canClaimRestaurantLink({
      role: 'admin',
      uid: 'admin-1',
      linkedRestaurantId: '',
      restaurantId: 'rest-1',
      restaurantOwnerId: 'user-2',
    }),
    true,
    'admin claim'
  );
});

Deno.test('a partner can claim a restaurant they already own', () => {
  equals(
    canClaimRestaurantLink({
      role: 'restaurant',
      uid: 'user-1',
      linkedRestaurantId: '',
      restaurantId: 'rest-1',
      restaurantOwnerId: 'user-1',
    }),
    true,
    'own restaurant claim'
  );
});

Deno.test('a partner can claim an unowned restaurant their account is already linked to', () => {
  equals(
    canClaimRestaurantLink({
      role: 'restaurant',
      uid: 'user-1',
      linkedRestaurantId: 'rest-1',
      restaurantId: 'rest-1',
      restaurantOwnerId: '',
    }),
    true,
    'assigned unowned claim'
  );
});

Deno.test('a partner cannot claim an unowned restaurant they were never assigned', () => {
  equals(
    canClaimRestaurantLink({
      role: 'restaurant',
      uid: 'user-1',
      linkedRestaurantId: '',
      restaurantId: 'rest-7',
      restaurantOwnerId: '',
    }),
    false,
    'unassigned unowned claim'
  );
});

Deno.test('a partner cannot claim a restaurant owned by another partner', () => {
  equals(
    canClaimRestaurantLink({
      role: 'restaurant',
      uid: 'user-1',
      linkedRestaurantId: 'rest-7',
      restaurantId: 'rest-7',
      restaurantOwnerId: 'user-2',
    }),
    false,
    'foreign restaurant claim'
  );
});

Deno.test('duplicate rows collapse to the first occurrence', () => {
  equals(
    dedupeRestaurantRowsById([{ id: 'a' }, { id: 'b' }, { id: 'a' }]),
    [{ id: 'a' }, { id: 'b' }],
    'dedupe'
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test supabase/functions/app-rpc/partnerRestaurantScope.test.ts`
Expected: FAIL — module `./partnerRestaurantScope.ts` not found.

- [ ] **Step 3: Write the implementation**

Create `supabase/functions/app-rpc/partnerRestaurantScope.ts`:

```ts
export type PartnerRestaurantScopeInput = {
  role: string;
  uid: string;
  linkedRestaurantId: string;
};

export type PartnerRestaurantScope = {
  /** When set, restrict the RestaurantRecord query to this ownerId. Null means no filter. */
  ownerFilterUid: string | null;
  /** A restaurant the caller is linked to but may not own; fetched separately and merged in. */
  extraRestaurantId: string | null;
};

export const resolvePartnerRestaurantScope = ({
  role,
  uid,
  linkedRestaurantId,
}: PartnerRestaurantScopeInput): PartnerRestaurantScope => {
  if (role === 'admin') {
    return { ownerFilterUid: null, extraRestaurantId: null };
  }

  return {
    ownerFilterUid: uid,
    extraRestaurantId: linkedRestaurantId || null,
  };
};

export type ClaimRestaurantLinkInput = {
  role: string;
  uid: string;
  linkedRestaurantId: string;
  restaurantId: string;
  restaurantOwnerId: string;
};

export const canClaimRestaurantLink = ({
  role,
  uid,
  linkedRestaurantId,
  restaurantId,
  restaurantOwnerId,
}: ClaimRestaurantLinkInput): boolean => {
  if (role === 'admin') {
    return true;
  }

  if (restaurantOwnerId) {
    return restaurantOwnerId === uid;
  }

  // Unowned rows are only claimable by the partner the application flow already assigned.
  return Boolean(linkedRestaurantId) && linkedRestaurantId === restaurantId;
};

export const dedupeRestaurantRowsById = <T extends { id: string }>(rows: T[]): T[] => {
  const seen = new Set<string>();
  const deduped: T[] = [];

  for (const row of rows) {
    if (seen.has(row.id)) {
      continue;
    }

    seen.add(row.id);
    deduped.push(row);
  }

  return deduped;
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `deno test supabase/functions/app-rpc/partnerRestaurantScope.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/app-rpc/partnerRestaurantScope.ts supabase/functions/app-rpc/partnerRestaurantScope.test.ts
git commit -m "feat(app-rpc): add partner restaurant scope and claim-guard helpers"
```

---

## Task 2: Scope the `partnerGetRestaurantContext` query

**Files:**
- Modify: `supabase/functions/app-rpc/index.ts:5406-5464`

**Interfaces:**
- Consumes: `resolvePartnerRestaurantScope`, `dedupeRestaurantRowsById` from Task 1.
- Produces: nothing new. The RPC response keeps its existing shape (`claimableRestaurants`, `requiresVerifiedLink`, `restaurant`, `restaurants`) and simply carries fewer rows for the `restaurant` role.

- [ ] **Step 1: Add the import**

Find the existing import block at the top of `supabase/functions/app-rpc/index.ts` and add:

```ts
import {
  dedupeRestaurantRowsById,
  resolvePartnerRestaurantScope,
} from './partnerRestaurantScope.ts';
```

- [ ] **Step 2: Replace the unfiltered query**

The current handler at `supabase/functions/app-rpc/index.ts:5406` starts:

```ts
  if (action === 'partnerGetRestaurantContext') {
    ensureRole(context.role, ['restaurant', 'admin']);
    const [userAccount, allRestaurants] = await Promise.all([
      loadUserAccount(context.uid),
      serviceClient
        .from('RestaurantRecord')
        .select(
          'id,ownerId,name,nameKey,cuisine,address,description,image,logoImage,menu,deliveryFee,deliveryRadiusKm,deliveryTime,openingTime,closingTime,latitude,longitude,minOrder,paystackSubaccountCode,supportsDelivery,supportsPickup,isOpen,isPublished,createdAt,updatedAt'
        )
        .order('updatedAt', { ascending: false }),
    ]);
    const linkedRestaurantId = sanitizeText(userAccount?.restaurantId);

    if (allRestaurants.error) {
      throw new Error(allRestaurants.error.message);
    }

    const restaurantRows = (allRestaurants.data ?? []) as RestaurantRecordRow[];
```

Replace that span — from `const [userAccount, allRestaurants]` through the `const restaurantRows = ...` line — with:

```ts
    const userAccount = await loadUserAccount(context.uid);
    const linkedRestaurantId = sanitizeText(userAccount?.restaurantId);
    const scope = resolvePartnerRestaurantScope({
      role: context.role,
      uid: context.uid,
      linkedRestaurantId,
    });

    const restaurantColumns =
      'id,ownerId,name,nameKey,cuisine,address,description,image,logoImage,menu,deliveryFee,deliveryRadiusKm,deliveryTime,openingTime,closingTime,latitude,longitude,minOrder,paystackSubaccountCode,supportsDelivery,supportsPickup,isOpen,isPublished,createdAt,updatedAt';

    const scopedQuery = serviceClient
      .from('RestaurantRecord')
      .select(restaurantColumns)
      .order('updatedAt', { ascending: false });

    const allRestaurants = await (scope.ownerFilterUid
      ? scopedQuery.eq('ownerId', scope.ownerFilterUid)
      : scopedQuery);

    if (allRestaurants.error) {
      throw new Error(allRestaurants.error.message);
    }

    const ownedRows = (allRestaurants.data ?? []) as RestaurantRecordRow[];
    let restaurantRows = ownedRows;

    if (scope.extraRestaurantId && !ownedRows.some((row) => row.id === scope.extraRestaurantId)) {
      const { data: linkedRow, error: linkedRowError } = await serviceClient
        .from('RestaurantRecord')
        .select(restaurantColumns)
        .eq('id', scope.extraRestaurantId)
        .maybeSingle<RestaurantRecordRow>();

      if (linkedRowError) {
        throw new Error(linkedRowError.message);
      }

      if (linkedRow) {
        restaurantRows = dedupeRestaurantRowsById([...ownedRows, linkedRow]);
      }
    }
```

Everything below that line — `loadManagedRestaurantForUser`, the `RestaurantApproval` lookup, `allResponses`, `claimableRestaurants`, and the `json(200, ...)` return — stays exactly as it is. It already operates over `restaurantRows`.

- [ ] **Step 3: Type-check the edge function**

Run: `deno check supabase/functions/app-rpc/index.ts`
Expected: no errors.

Note: `deno check` on this file also pulls in the rest of the module graph. If it reports pre-existing errors in files you did not touch, confirm they are pre-existing with `git stash && deno check supabase/functions/app-rpc/index.ts && git stash pop` and ignore those specific ones.

- [ ] **Step 4: Re-run the Task 1 tests**

Run: `deno test supabase/functions/app-rpc/partnerRestaurantScope.test.ts`
Expected: PASS — 9 tests, unchanged.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/app-rpc/index.ts
git commit -m "fix(app-rpc): scope partnerGetRestaurantContext to the caller's own restaurant

Partners were receiving every RestaurantRecord row, including each
restaurant's full menu and paystackSubaccountCode."
```

---

## Task 3: Tighten the claim guard

**Files:**
- Modify: `supabase/functions/app-rpc/index.ts:5632-5650`

**Interfaces:**
- Consumes: `canClaimRestaurantLink` from Task 1.
- Produces: nothing new.

- [ ] **Step 1: Add the import**

Extend the import added in Task 2 so it reads:

```ts
import {
  canClaimRestaurantLink,
  dedupeRestaurantRowsById,
  resolvePartnerRestaurantScope,
} from './partnerRestaurantScope.ts';
```

- [ ] **Step 2: Replace the ownership check**

Inside `if (action === 'claimPartnerRestaurantLink')`, the current check is:

```ts
    const existingOwnerId = sanitizeText(existingRestaurant.restaurant.ownerId);
    if (existingOwnerId && existingOwnerId !== context.uid && context.role !== 'admin') {
      fail(403, 'This restaurant is already managed by another partner account.');
    }
```

Replace it with:

```ts
    const existingOwnerId = sanitizeText(existingRestaurant.restaurant.ownerId);
    const claimantAccount = await loadUserAccount(context.uid);
    const claimantLinkedRestaurantId = sanitizeText(claimantAccount?.restaurantId);

    if (
      !canClaimRestaurantLink({
        role: context.role,
        uid: context.uid,
        linkedRestaurantId: claimantLinkedRestaurantId,
        restaurantId,
        restaurantOwnerId: existingOwnerId,
      })
    ) {
      fail(403, 'This restaurant is not available to link to this partner account.');
    }
```

The rest of the handler — the `RestaurantRecord` update, `broadcastRestaurantsChanged`, `updateUserAccount`, `upsertUserRoleLink`, `createAuditEntry`, and the `json(200, ...)` return — is unchanged.

- [ ] **Step 3: Type-check**

Run: `deno check supabase/functions/app-rpc/index.ts`
Expected: no errors.

- [ ] **Step 4: Re-run the helper tests**

Run: `deno test supabase/functions/app-rpc/partnerRestaurantScope.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/app-rpc/index.ts
git commit -m "fix(app-rpc): only allow claiming a restaurant you own or were assigned"
```

---

## Task 4: Trim the partner "Restaurant linking" card

**Files:**
- Modify: `apps/partner/app/(partner)/profile.tsx:56` (remove `sortedRestaurants`)
- Modify: `apps/partner/app/(partner)/profile.tsx:467-513` (the linking card)

**Interfaces:**
- Consumes: the now-scoped `restaurants` / `claimableRestaurants` arrays from `usePartnerRestaurant` (unchanged types).
- Produces: nothing new.

The card stops being a browsable list of the platform. It shows the partner's own restaurant, or an empty state.

- [ ] **Step 1: Remove the sorted-list derivation**

Delete this line at `apps/partner/app/(partner)/profile.tsx:56`:

```tsx
  const sortedRestaurants = [...restaurants].sort((left, right) => left.name.localeCompare(right.name));
```

Replace it with:

```tsx
  const linkedRestaurantId = user?.restaurantId ?? restaurant?.id ?? null;
  const linkableRestaurants = [...restaurants].sort((left, right) => left.name.localeCompare(right.name));
```

- [ ] **Step 2: Replace the card body**

Replace the whole `<View style={styles.card}>` block that begins with `<Text style={styles.cardTitle}>Restaurant linking</Text>` (currently `apps/partner/app/(partner)/profile.tsx:467-513`) with:

```tsx
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Restaurant linking</Text>
        <Text style={styles.helperText}>
          This is the restaurant record tied to your partner account. Create or update your store above and the link is kept in sync.
        </Text>
        {linkableRestaurants.length === 0 ? (
          <Text style={styles.metaLine}>
            No restaurant is attached to this account yet. Complete your restaurant application to have one created for you.
          </Text>
        ) : null}
        {linkableRestaurants.map((candidate) => {
          const isLinked = linkedRestaurantId === candidate.id;

          return (
            <View
              key={candidate.id}
              style={[styles.restaurantRow, isLinked ? styles.restaurantRowActive : null]}
            >
              <View style={styles.restaurantMeta}>
                <Text style={styles.restaurantName}>{candidate.name}</Text>
                <Text style={styles.restaurantInfo}>
                  {candidate.cuisine ?? 'Cuisine not set'} | {candidate.address ?? 'Address not set'}
                </Text>
                <Text style={styles.restaurantId}>ID: {candidate.id}</Text>
              </View>
              <TouchableOpacity
                style={[styles.linkButton, isLinked ? styles.linkButtonActive : null]}
                onPress={() => handleLinkRestaurant(candidate.id, candidate.name)}
                disabled={loading || isLinked}
              >
                <Text style={[styles.linkButtonText, isLinked ? styles.linkButtonTextActive : null]}>
                  {isLinked ? 'Linked' : 'Confirm link'}
                </Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </View>
```

The "Ownership:" line is gone — every row in this list now belongs to the signed-in partner, so the label carried no information. The `claimedByAnotherPartner` and `ownedByThisPartner` locals go with it.

- [ ] **Step 3: Remove the now-unused style**

`styles.restaurantRowDisabled` was only referenced by the removed `claimedByAnotherPartner` branch. Search the file for `restaurantRowDisabled`; if there are no remaining references, delete its entry from the `StyleSheet.create` block.

- [ ] **Step 4: Confirm `claimableRestaurants` is still consumed or drop it**

The destructure at `apps/partner/app/(partner)/profile.tsx:35` still lists `claimableRestaurants`, which the new card no longer reads. Remove it from that destructure. Leave the field on the hook and the RPC response — `usePartnerRestaurant` still exposes it and other callers may be added later.

- [ ] **Step 5: Type-check and lint**

Run: `npm run typecheck:partner`
Expected: no errors.

Run: `npm run lint:partner`
Expected: no new errors. Specifically, no `'claimableRestaurants' is assigned a value but never used`.

- [ ] **Step 6: Commit**

```bash
git add "apps/partner/app/(partner)/profile.tsx"
git commit -m "fix(partner): show only the account's own restaurant in the linking card"
```

---

## Task 5: Customer skeleton primitive + presets

**Files:**
- Create: `apps/customer/src/components/Skeleton.tsx`

**Interfaces:**
- Consumes: `customerTheme` from `apps/customer/src/theme/palette.ts`.
- Produces:
  - `<Skeleton width={number | string} height={number} radius={number} style={StyleProp<ViewStyle>} />`
  - `<SkeletonListRow />` — avatar block plus two text lines
  - `<SkeletonCard />` — image block plus title and meta lines
  - `<SkeletonDetail />` — hero block plus a stack of rows
  - `<SkeletonScreen children />` — full-bleed padded container matching the app background

- [ ] **Step 1: Create the component**

Create `apps/customer/src/components/Skeleton.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { customerTheme } from '../theme/palette';

type SkeletonProps = {
  width?: number | string;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
};

export function Skeleton({ width = '100%', height = 14, radius = 8, style }: SkeletonProps) {
  const pulse = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 650,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.45,
          duration: 650,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );

    animation.start();

    return () => {
      animation.stop();
    };
  }, [pulse]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.block,
        { borderRadius: radius, height, opacity: pulse, width } as StyleProp<ViewStyle>,
        style,
      ]}
    />
  );
}

export function SkeletonScreen({ children }: { children: React.ReactNode }) {
  return <View style={styles.screen}>{children}</View>;
}

export function SkeletonListRow() {
  return (
    <View style={styles.row}>
      <Skeleton width={48} height={48} radius={24} />
      <View style={styles.rowText}>
        <Skeleton width="70%" height={14} />
        <Skeleton width="45%" height={12} style={styles.rowTextGap} />
      </View>
    </View>
  );
}

export function SkeletonCard() {
  return (
    <View style={styles.card}>
      <Skeleton height={140} radius={14} />
      <Skeleton width="60%" height={16} style={styles.cardTitle} />
      <Skeleton width="40%" height={12} style={styles.cardMeta} />
    </View>
  );
}

export function SkeletonDetail() {
  return (
    <View>
      <Skeleton height={180} radius={16} />
      <Skeleton width="55%" height={20} style={styles.detailTitle} />
      <Skeleton width="35%" height={13} style={styles.detailMeta} />
      <SkeletonListRow />
      <SkeletonListRow />
      <SkeletonListRow />
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    backgroundColor: customerTheme.surfaceMuted,
  },
  screen: {
    backgroundColor: customerTheme.background,
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 24,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    marginBottom: 18,
  },
  rowText: {
    flex: 1,
    marginLeft: 12,
  },
  rowTextGap: {
    marginTop: 8,
  },
  card: {
    marginBottom: 22,
  },
  cardTitle: {
    marginTop: 12,
  },
  cardMeta: {
    marginTop: 8,
  },
  detailTitle: {
    marginTop: 18,
  },
  detailMeta: {
    marginBottom: 24,
    marginTop: 10,
  },
});
```

- [ ] **Step 2: Lint**

Run: `npm run lint:customer`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add apps/customer/src/components/Skeleton.tsx
git commit -m "feat(customer): add skeleton primitive and layout presets"
```

---

## Task 6: Convert the six customer screens

**Files:**
- Modify: `apps/customer/app/(customer)/orders/index.tsx:192-197`
- Modify: `apps/customer/app/(customer)/orders/[id].tsx:67-72`
- Modify: `apps/customer/app/(customer)/favorites.tsx:56-61`
- Modify: `apps/customer/app/(customer)/home/index.tsx:352-358`
- Modify: `apps/customer/app/(customer)/home/restaurant/[id].tsx:211-216`
- Modify: `apps/customer/app/(customer)/support.tsx:87-89`

**Interfaces:**
- Consumes: `Skeleton`, `SkeletonScreen`, `SkeletonListRow`, `SkeletonCard`, `SkeletonDetail` from Task 5.
- Produces: nothing new.

Each screen currently returns a centred `<ActivityIndicator size="large" .../>`. Replace the returned JSX only — leave the `if (loading)` condition and everything else untouched.

- [ ] **Step 1: Orders list**

In `apps/customer/app/(customer)/orders/index.tsx`, add the import:

```tsx
import { SkeletonListRow, SkeletonScreen } from '../../../src/components/Skeleton';
```

Replace the loading return with:

```tsx
  if (loading) {
    return (
      <SkeletonScreen>
        <SkeletonListRow />
        <SkeletonListRow />
        <SkeletonListRow />
        <SkeletonListRow />
        <SkeletonListRow />
      </SkeletonScreen>
    );
  }
```

Remove `ActivityIndicator` from the `react-native` import if nothing else in the file uses it.

- [ ] **Step 2: Order detail**

In `apps/customer/app/(customer)/orders/[id].tsx`, add:

```tsx
import { SkeletonDetail, SkeletonScreen } from '../../../src/components/Skeleton';
```

Replace the loading return with:

```tsx
  if (loading) {
    return (
      <SkeletonScreen>
        <SkeletonDetail />
      </SkeletonScreen>
    );
  }
```

Remove `ActivityIndicator` from the `react-native` import if it becomes unused.

- [ ] **Step 3: Favorites**

In `apps/customer/app/(customer)/favorites.tsx`, add:

```tsx
import { SkeletonCard, SkeletonScreen } from '../../src/components/Skeleton';
```

Replace the loading return with:

```tsx
  if (loadingCatalog || favoritesLoading) {
    return (
      <SkeletonScreen>
        <SkeletonCard />
        <SkeletonCard />
      </SkeletonScreen>
    );
  }
```

Remove `ActivityIndicator` from the `react-native` import if it becomes unused.

- [ ] **Step 4: Home**

In `apps/customer/app/(customer)/home/index.tsx`, add:

```tsx
import { Skeleton, SkeletonCard, SkeletonScreen } from '../../../src/components/Skeleton';
```

Replace the loading return at line 352 with:

```tsx
  if (loading) {
    return (
      <SkeletonScreen>
        <Skeleton width="55%" height={22} />
        <Skeleton width="35%" height={13} style={{ marginBottom: 24, marginTop: 10 }} />
        <Skeleton height={44} radius={22} style={{ marginBottom: 24 }} />
        <SkeletonCard />
        <SkeletonCard />
      </SkeletonScreen>
    );
  }
```

**Keep** `ActivityIndicator` in this file's `react-native` import — the catalog-refresh indicator at line 417 still uses it and stays a spinner.

- [ ] **Step 5: Restaurant detail**

In `apps/customer/app/(customer)/home/restaurant/[id].tsx`, add:

```tsx
import { SkeletonDetail, SkeletonScreen } from '../../../../src/components/Skeleton';
```

Replace the loading return with:

```tsx
  if (loading) {
    return (
      <SkeletonScreen>
        <SkeletonDetail />
      </SkeletonScreen>
    );
  }
```

Remove `ActivityIndicator` from the `react-native` import if it becomes unused.

- [ ] **Step 6: Support**

In `apps/customer/app/(customer)/support.tsx`, add:

```tsx
import { SkeletonListRow, SkeletonScreen } from '../../src/components/Skeleton';
```

Replace the centred spinner block with:

```tsx
        <SkeletonScreen>
          <SkeletonListRow />
          <SkeletonListRow />
          <SkeletonListRow />
        </SkeletonScreen>
```

This one sits inside surrounding JSX rather than being a bare early return — replace only the `<View style={styles.centered}>...</View>` wrapper and its `ActivityIndicator`. Remove `ActivityIndicator` from the `react-native` import if it becomes unused.

- [ ] **Step 7: Lint**

Run: `npm run lint:customer`
Expected: no new errors. Watch for `'ActivityIndicator' is defined but never used` in any file where you removed the last usage but left the import.

- [ ] **Step 8: Verify in the running app**

Run: `npm run dev:customer`

Open each of the six screens with a cold cache and confirm the skeleton appears before content and that its shape roughly matches what replaces it. Navigate away mid-load on at least one screen to confirm no "animation on unmounted component" warning appears in the Metro console.

- [ ] **Step 9: Commit**

```bash
git add "apps/customer/app/(customer)"
git commit -m "feat(customer): replace route-level spinners with skeleton loaders"
```

---

## Task 7: Partner skeletons

**Files:**
- Create: `apps/partner/src/components/Skeleton.tsx`
- Modify: `apps/partner/app/(partner)/index.tsx:107-112`
- Modify: `apps/partner/app/(partner)/orders.tsx:55-60`
- Modify: `apps/partner/app/(partner)/order/[id].tsx:76-81`

**Interfaces:**
- Consumes: `partnerTheme` from `apps/partner/src/theme/palette.ts`.
- Produces: the same five exports as Task 5 — `Skeleton`, `SkeletonScreen`, `SkeletonListRow`, `SkeletonCard`, `SkeletonDetail`.

- [ ] **Step 1: Create the component**

Copy `apps/customer/src/components/Skeleton.tsx` to `apps/partner/src/components/Skeleton.tsx` and change exactly two things:

1. The import: `import { partnerTheme } from '../theme/palette';`
2. The two colour references in `StyleSheet.create`: `backgroundColor: partnerTheme.surfaceMuted` in `block`, and `backgroundColor: partnerTheme.background` in `screen`.

Do **not** reference `partnerTheme.surfaceStrong` — that key does not exist.

- [ ] **Step 2: Partner dashboard**

In `apps/partner/app/(partner)/index.tsx`, add:

```tsx
import { Skeleton, SkeletonListRow, SkeletonScreen } from '../../src/components/Skeleton';
```

Replace the loading return with:

```tsx
  if (loading) {
    return (
      <SkeletonScreen>
        <Skeleton width="50%" height={22} />
        <Skeleton width="70%" height={13} style={{ marginBottom: 26, marginTop: 10 }} />
        <Skeleton height={92} radius={14} style={{ marginBottom: 20 }} />
        <SkeletonListRow />
        <SkeletonListRow />
        <SkeletonListRow />
      </SkeletonScreen>
    );
  }
```

Remove `ActivityIndicator` from the `react-native` import if it becomes unused.

- [ ] **Step 3: Partner orders**

In `apps/partner/app/(partner)/orders.tsx`, add:

```tsx
import { SkeletonListRow, SkeletonScreen } from '../../src/components/Skeleton';
```

Replace the loading return with:

```tsx
  if (loading) {
    return (
      <SkeletonScreen>
        <SkeletonListRow />
        <SkeletonListRow />
        <SkeletonListRow />
        <SkeletonListRow />
        <SkeletonListRow />
      </SkeletonScreen>
    );
  }
```

Remove `ActivityIndicator` from the `react-native` import if it becomes unused.

- [ ] **Step 4: Partner order detail**

In `apps/partner/app/(partner)/order/[id].tsx`, add:

```tsx
import { SkeletonDetail, SkeletonScreen } from '../../../src/components/Skeleton';
```

Replace the loading return with:

```tsx
  if (loading) {
    return (
      <SkeletonScreen>
        <SkeletonDetail />
      </SkeletonScreen>
    );
  }
```

Remove `ActivityIndicator` from the `react-native` import if it becomes unused.

- [ ] **Step 5: Type-check and lint**

Run: `npm run typecheck:partner`
Expected: no errors.

Run: `npm run lint:partner`
Expected: no new errors.

- [ ] **Step 6: Verify in the running app**

Run: `npm run dev:partner`

Open the dashboard, the orders list, and one order detail. Confirm each shows a skeleton before content.

- [ ] **Step 7: Commit**

```bash
git add apps/partner/src/components/Skeleton.tsx "apps/partner/app/(partner)"
git commit -m "feat(partner): replace route-level spinners with skeleton loaders"
```

---

## Task 8: Dispatch skeletons

**Files:**
- Create: `apps/dispatch/src/components/Skeleton.tsx`
- Modify: `apps/dispatch/app/(dispatch)/index.tsx:58-63`
- Modify: `apps/dispatch/app/(dispatch)/deliveries.tsx:52-57`
- Modify: `apps/dispatch/app/(dispatch)/fleet.tsx:10-15`
- Modify: `apps/dispatch/app/(dispatch)/delivery/[id].tsx:218-223`

**Interfaces:**
- Consumes: `dispatchTheme` from `apps/dispatch/src/theme/palette.ts`.
- Produces: the same five exports as Task 5.

- [ ] **Step 1: Create the component**

Copy `apps/customer/src/components/Skeleton.tsx` to `apps/dispatch/src/components/Skeleton.tsx` and change exactly two things:

1. The import: `import { dispatchTheme } from '../theme/palette';`
2. The two colour references in `StyleSheet.create`: `backgroundColor: dispatchTheme.surfaceMuted` in `block`, and `backgroundColor: dispatchTheme.background` in `screen`.

Do **not** reference `dispatchTheme.surfaceStrong` — that key does not exist.

- [ ] **Step 2: Dispatch dashboard**

In `apps/dispatch/app/(dispatch)/index.tsx`, add:

```tsx
import { Skeleton, SkeletonListRow, SkeletonScreen } from '../../src/components/Skeleton';
```

Replace the loading return with:

```tsx
  if (loading || ridersLoading) {
    return (
      <SkeletonScreen>
        <Skeleton width="50%" height={22} />
        <Skeleton width="70%" height={13} style={{ marginBottom: 26, marginTop: 10 }} />
        <Skeleton height={92} radius={14} style={{ marginBottom: 20 }} />
        <SkeletonListRow />
        <SkeletonListRow />
        <SkeletonListRow />
      </SkeletonScreen>
    );
  }
```

Remove `ActivityIndicator` from the `react-native` import if it becomes unused.

- [ ] **Step 3: Deliveries**

In `apps/dispatch/app/(dispatch)/deliveries.tsx`, add:

```tsx
import { SkeletonListRow, SkeletonScreen } from '../../src/components/Skeleton';
```

Replace the loading return with:

```tsx
  if (loading) {
    return (
      <SkeletonScreen>
        <SkeletonListRow />
        <SkeletonListRow />
        <SkeletonListRow />
        <SkeletonListRow />
        <SkeletonListRow />
      </SkeletonScreen>
    );
  }
```

Remove `ActivityIndicator` from the `react-native` import if it becomes unused.

- [ ] **Step 4: Fleet**

In `apps/dispatch/app/(dispatch)/fleet.tsx`, add:

```tsx
import { SkeletonListRow, SkeletonScreen } from '../../src/components/Skeleton';
```

Replace the loading return with:

```tsx
  if (loading) {
    return (
      <SkeletonScreen>
        <SkeletonListRow />
        <SkeletonListRow />
        <SkeletonListRow />
        <SkeletonListRow />
      </SkeletonScreen>
    );
  }
```

Remove `ActivityIndicator` from the `react-native` import if it becomes unused.

- [ ] **Step 5: Delivery detail**

In `apps/dispatch/app/(dispatch)/delivery/[id].tsx`, add:

```tsx
import { SkeletonDetail, SkeletonScreen } from '../../../src/components/Skeleton';
```

Replace the loading return with:

```tsx
  if (loading) {
    return (
      <SkeletonScreen>
        <SkeletonDetail />
      </SkeletonScreen>
    );
  }
```

Remove `ActivityIndicator` from the `react-native` import if it becomes unused.

- [ ] **Step 6: Lint**

Run: `npm run lint:dispatch`
Expected: no new errors.

- [ ] **Step 7: Verify in the running app**

Run: `npm run dev:dispatch`

Open the dashboard, deliveries, fleet, and one delivery detail. Note that `apps/dispatch/app/(dispatch)/profile.tsx:329` keeps its inline spinner — do not change it.

- [ ] **Step 8: Commit**

```bash
git add apps/dispatch/src/components/Skeleton.tsx "apps/dispatch/app/(dispatch)"
git commit -m "feat(dispatch): replace route-level spinners with skeleton loaders"
```

---

## Task 9: Admin-web skeletons

**Files:**
- Create: `apps/admin-web/src/components/Skeleton.tsx`
- Modify: `apps/admin-web/src/styles/global.css` (append after the `@keyframes spin` block near line 511)
- Modify: `apps/admin-web/src/pages/OverviewPage.tsx:57`
- Modify: `apps/admin-web/src/pages/OrdersPage.tsx:83`
- Modify: `apps/admin-web/src/pages/AccessPage.tsx:160`
- Modify: `apps/admin-web/src/pages/ApprovalsPage.tsx:68`
- Modify: `apps/admin-web/src/pages/BroadcastsPage.tsx:300`
- Modify: `apps/admin-web/src/pages/InboxPage.tsx:122`
- Modify: `apps/admin-web/src/pages/StatisticsPage.tsx:62`

**Interfaces:**
- Consumes: the CSS custom properties already declared at `apps/admin-web/src/styles/global.css:1-25`.
- Produces:
  - `<SkeletonBlock width={string} height={number} radius={number} />`
  - `<SkeletonRows count={number} />` — repeated full-width bars sized for a table row

- [ ] **Step 1: Add the CSS**

Append to `apps/admin-web/src/styles/global.css`:

```css
.skeleton-block {
  background: var(--surface-muted);
  border-radius: 8px;
  animation: skeleton-pulse 1.3s ease-in-out infinite;
}

.skeleton-rows {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 24px;
}

@keyframes skeleton-pulse {
  0%,
  100% {
    background: var(--surface-muted);
  }
  50% {
    background: var(--border-strong);
  }
}

@media (prefers-reduced-motion: reduce) {
  .skeleton-block {
    animation: none;
  }
}
```

- [ ] **Step 2: Create the component**

Create `apps/admin-web/src/components/Skeleton.tsx`:

```tsx
export function SkeletonBlock({
  width = '100%',
  height = 14,
  radius = 8,
}: {
  width?: string;
  height?: number;
  radius?: number;
}) {
  return (
    <div
      className="skeleton-block"
      style={{ width, height, borderRadius: radius }}
      aria-hidden="true"
    />
  );
}

export function SkeletonRows({ count = 6 }: { count?: number }) {
  return (
    <div className="skeleton-rows" role="status" aria-label="Loading">
      <SkeletonBlock width="100%" height={18} />
      {Array.from({ length: count }, (_, index) => (
        <SkeletonBlock key={index} width="100%" height={40} />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Swap the seven pages**

In each of the seven pages, replace the `LoadingBlock` line with `SkeletonRows` and update the import.

Change the import from:

```tsx
import LoadingBlock from '../components/LoadingBlock';
```

to:

```tsx
import { SkeletonRows } from '../components/Skeleton';
```

Then replace each line as follows:

| File | Line | Replace | With |
|---|---|---|---|
| `OverviewPage.tsx` | 57 | `{loading ? <LoadingBlock label="Loading the admin overview…" /> : null}` | `{loading ? <SkeletonRows count={4} /> : null}` |
| `OrdersPage.tsx` | 83 | `{loading ? <LoadingBlock label="Loading orders…" /> : null}` | `{loading ? <SkeletonRows count={8} /> : null}` |
| `AccessPage.tsx` | 160 | `{loading ? <LoadingBlock label="Loading users…" /> : null}` | `{loading ? <SkeletonRows count={6} /> : null}` |
| `ApprovalsPage.tsx` | 68 | `{loading ? <LoadingBlock label="Loading approval queues…" /> : null}` | `{loading ? <SkeletonRows count={5} /> : null}` |
| `BroadcastsPage.tsx` | 300 | `{loading ? <LoadingBlock label="Loading…" /> : null}` | `{loading ? <SkeletonRows count={5} /> : null}` |
| `InboxPage.tsx` | 122 | `{loading ? <LoadingBlock label="Loading inbox…" /> : null}` | `{loading ? <SkeletonRows count={6} /> : null}` |
| `StatisticsPage.tsx` | 62 | `{loading ? <LoadingBlock label="Loading statistics…" /> : null}` | `{loading ? <SkeletonRows count={4} /> : null}` |

- [ ] **Step 4: Leave `LoadingBlock` in place**

Do not delete `apps/admin-web/src/components/LoadingBlock.tsx`. `RequireRole.tsx:12` still uses it for the session gate and that stays a spinner.

- [ ] **Step 5: Build**

Run: `npm run build:admin`
Expected: build succeeds with no unused-import errors.

- [ ] **Step 6: Verify in the running app**

Run: `npm run dev:admin`

Visit each of the seven pages and confirm a skeleton table appears while data loads, and that a hard refresh on the app root still shows the spinner (not a skeleton) while the session is checked.

- [ ] **Step 7: Commit**

```bash
git add apps/admin-web/src/components/Skeleton.tsx apps/admin-web/src/styles/global.css apps/admin-web/src/pages
git commit -m "feat(admin): replace page loading blocks with skeleton rows"
```

---

## Task 10: Final sweep

**Files:** none created or modified unless the audit finds a miss.

- [ ] **Step 1: Confirm the gates were left alone**

Run: `git diff main --stat`

Confirm **none** of these files appear in the diff:

- `apps/customer/app/index.tsx`
- `apps/customer/app/_layout.tsx`
- `apps/customer/app/(auth)/_layout.tsx`
- `apps/customer/app/(customer)/_layout.tsx`
- `apps/partner/app/(auth)/_layout.tsx`
- `apps/partner/app/(partner)/_layout.tsx`
- `apps/dispatch/app/_layout.tsx`
- `apps/admin-web/src/components/RequireRole.tsx`

- [ ] **Step 2: Confirm the inline spinners survive**

Run: `git diff main -- "apps/customer/app/payment" "apps/customer/app/(customer)/delivery-location.tsx" "apps/dispatch/app/(dispatch)/profile.tsx"`

Expected: empty. These four inline spinners (`payment/index.tsx:133`, `payment/callback.tsx:162`, `delivery-location.tsx:209`, `dispatch/profile.tsx:329`) stay as spinners, and so does the customer home catalog-refresh indicator at `home/index.tsx:417`.

- [ ] **Step 3: Confirm no remaining route-level spinner**

Run: `git grep -n "ActivityIndicator size=\"large\"" -- apps/customer apps/partner apps/dispatch`

Expected: only the seven React Native gate files from Step 1, plus `payment/index.tsx:133`. Anything else is a screen this plan missed — convert it using the matching preset from its app's `Skeleton.tsx`.

- [ ] **Step 4: Report deployment status**

The `app-rpc` changes from Tasks 2 and 3 are **not deployed**. State this explicitly in the completion report and name the function that needs redeploying. Do not run the deploy.

---

## Self-Review Notes

**Spec coverage:** Part 1 of the spec maps to Tasks 1–4 (helpers, scoped query, claim guard, UI). Part 2 maps to Tasks 5–9 (one primitive task plus one conversion task per app, admin folded together since its primitive is three lines of CSS). Task 10 covers the spec's "deliberately unchanged" list. The spec's open question about admin-seeded restaurants is not a code task — it is carried in the spec for the operator to answer.

**Correction against the spec:** the spec said skeleton blocks pulse between `surfaceMuted` and `surfaceStrong`. That is wrong for two of the three RN apps — `partnerTheme` and `dispatchTheme` have no `surfaceStrong` key — and colour interpolation is incompatible with `useNativeDriver: true` regardless. This plan pulses **opacity** over a `surfaceMuted` fill instead. The admin-web CSS path has no native-driver constraint, so it keeps the two-colour `surface-muted` → `border-strong` pulse.
