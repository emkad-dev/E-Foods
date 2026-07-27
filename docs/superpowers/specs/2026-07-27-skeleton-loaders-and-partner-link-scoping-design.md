# Skeleton loaders + partner restaurant-link scoping

Date: 2026-07-27

Two independent changes shipped together:

1. Replace route-level spinners with content-shaped skeleton loaders across all four apps.
2. Stop the partner app from exposing every restaurant on the platform to every partner.

They share no code. Part 2 is a data-exposure fix and should land first.

---

## Part 1 — Partner restaurant-link scoping

### Problem

`partnerGetRestaurantContext` (`supabase/functions/app-rpc/index.ts:5406`) selects every row
in `RestaurantRecord` with no owner filter and returns the full set as `restaurants`.
`apps/partner/app/(partner)/profile.tsx:477` renders that array in the "Restaurant linking"
card, so any signed-in partner sees the name, address, restaurant ID and ownership state of
every other restaurant on the platform.

The payload leaks more than the UI renders. `buildRestaurantResponse`
(`supabase/functions/app-rpc/index.ts:750`) includes:

- `menu` — the complete menu and pricing of every restaurant
- `paystackSubaccountCode` — the payout subaccount identifier of every restaurant

Both are already in the JSON reaching every partner client. This is the urgent part; the
visible list is the smaller half of the problem.

`loadManagedRestaurantForUser` (`supabase/functions/app-rpc/index.ts:1648`) already does the
right thing — it applies `.eq('ownerId', uid)` for non-admin roles. The bulk query in
`partnerGetRestaurantContext` simply never got the same treatment.

### Decision

A partner sees only the restaurant they own or are linked to. Not other partners'
restaurants, and not unowned ones. Admins keep the unfiltered list.

Partner onboarding already creates and assigns a restaurant through
`complete-restaurant-details` and the application flow, so no partner needs to browse a
catalogue of restaurants to attach themselves to one.

### Server changes — `supabase/functions/app-rpc/index.ts`

In `partnerGetRestaurantContext`:

- Branch the `RestaurantRecord` query on `context.role`. For `admin`, keep the current
  unfiltered `.order('updatedAt', { ascending: false })` query. For `restaurant`, apply
  `.eq('ownerId', context.uid)`.
- When the caller's `userAccount.restaurantId` names a restaurant not returned by that
  filter, fetch that single row as well and include it. This keeps `requiresVerifiedLink`
  meaningful for an account whose link and ownership have drifted apart.
- `claimableRestaurants` keeps its existing filter, which now operates over the scoped set.
  For a partner it resolves to their own restaurant or an empty array.
- `restaurants` returns the same scoped set.

In `claimPartnerRestaurantLink` (`supabase/functions/app-rpc/index.ts:5632`):

- The existing check rejects claiming a restaurant owned by another partner. Extend it so a
  non-admin caller is also rejected when the target restaurant has **no** owner and is not
  the restaurant already named by their `userAccount.restaurantId`. An unowned row is no
  longer claimable by whichever partner asks first.
- Admin callers are unaffected.

### Client changes — partner app

- `apps/partner/src/services/partnerReadModel.ts`: no type change. `restaurants` and
  `claimableRestaurants` keep their shapes and simply carry fewer rows.
- `apps/partner/app/(partner)/profile.tsx`: the "Restaurant linking" card stops being a
  browsable list. It renders the partner's own restaurant row when one exists, and otherwise
  an empty state directing them to the application flow. The card keeps the "Claim" action
  for the verified-link case (`requiresVerifiedLink`), where the partner owns a restaurant
  their profile is not yet explicitly linked to.
- The save path at `apps/partner/app/(partner)/profile.tsx:176` — `linkRestaurant(savedRestaurant.id)`
  after creating your own restaurant — is unchanged and still works, because the caller owns
  that row by then.
- `sortedRestaurants` (`profile.tsx:56`) is removed along with the list rendering it fed.

### Testing

Unit test the scoped read: given a partner uid owning restaurant A while restaurants B and C
exist with other owners, `partnerGetRestaurantContext` returns only A in both `restaurants`
and `claimableRestaurants`, and the same call as an admin returns all three.

Unit test the claim guard: a partner claiming an unowned restaurant that is not their linked
restaurant is rejected with 403.

### Deployment

Requires redeploying the `app-rpc` edge function. That step is run by the operator, not by
the agent.

### Open question

Removing the claim-any-unowned-restaurant path eliminates the only self-serve way to attach
a partner to a pre-seeded restaurant record. If admins do seed restaurants for partners to
pick up, that assignment moves to the admin-web Access page
(`apps/admin-web/src/pages/AccessPage.tsx`), which already supports setting a user's
`restaurantId`.

---

## Part 2 — Skeleton loaders

### Decision

Convert route-level loading states — the `if (loading) return <centered spinner/>` blocks —
to skeletons that mirror the layout of the screen being loaded. Scope is all four apps.
Skeleton components live per app, themed from that app's own palette, matching how the repo
already duplicates theme and components per app. No new workspace package.

### Primitive — React Native apps

`src/components/Skeleton.tsx` in `apps/customer`, `apps/partner`, `apps/dispatch`:

- `<Skeleton>` — a single block taking `width`, `height`, `radius`, `style`. Renders a `View`
  with a looping `Animated` opacity pulse via `Animated.loop(Animated.sequence(...))` and
  `useNativeDriver: true`.
- Colors come from the app's `src/theme/palette.ts`, pulsing between `surfaceMuted` and
  `surfaceStrong`. Each app therefore gets its own tone without any shared theme plumbing.
- The animation is created once in a `useRef` and started in an effect that stops it on
  unmount.

Alongside it, a small set of presets in the same file that compose `<Skeleton>`:

- `SkeletonListRow` — avatar block plus two text lines
- `SkeletonCard` — image block plus title and meta lines
- `SkeletonDetail` — hero block plus a stack of rows

### Primitive — admin-web

`apps/admin-web/src/components/Skeleton.tsx` exporting `SkeletonBlock` and `SkeletonRows`,
styled with a `@keyframes` shimmer added to the existing stylesheet next to the current
`.loading-block` and `.spinner` rules. `LoadingBlock.tsx` stays in the tree for the session
gate described below.

### Screens converted

Thirteen React Native routes and seven admin pages.

| App | Screens |
|---|---|
| customer | `favorites`, `home/index`, `home/restaurant/[id]`, `orders/index`, `orders/[id]`, `support` |
| partner | `(partner)/index`, `(partner)/orders`, `(partner)/order/[id]` |
| dispatch | `(dispatch)/index`, `deliveries`, `fleet`, `delivery/[id]` |
| admin-web | Overview, Orders, Access, Approvals, Broadcasts, Inbox, Statistics |

Each screen's skeleton mirrors that screen's real layout rather than showing a generic grey
box. The restaurant detail screen gets a hero block plus repeated menu rows; the orders list
gets repeated order-card rows; the admin tables get header plus repeated row bars sized to
the real columns.

### Deliberately unchanged

Seven auth and boot gates keep their spinners:

- `apps/customer/app/index.tsx`
- `apps/customer/app/_layout.tsx`
- `apps/customer/app/(auth)/_layout.tsx`
- `apps/customer/app/(customer)/_layout.tsx`
- `apps/partner/app/(auth)/_layout.tsx`
- `apps/partner/app/(partner)/_layout.tsx`
- `apps/dispatch/app/_layout.tsx`
- `apps/admin-web/src/components/RequireRole.tsx`

These decide *which* screen renders. There is no content shape to imitate, and a skeleton
would flash the wrong layout before redirecting.

Inline spinners also stay as spinners: button busy states, the customer home catalog-refresh
indicator (`home/index.tsx:417`), the payment WebView overlay (`payment/index.tsx:133`), the
payment callback row (`payment/callback.tsx:162`), `delivery-location.tsx:209`, and
`dispatch/profile.tsx:329`. A spinner is the right signal for "this action is running"; a
skeleton is the right signal for "this content is arriving".

### Testing

Skeletons are visual. Verification is running each app and observing the loading state of
each converted screen, checking that the skeleton's shape matches the content that replaces
it and that the pulse animation stops cleanly on unmount.
