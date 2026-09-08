# FEASTY Design System Foundation — Design

**Date:** 2026-07-29
**Status:** Proposed — pending user review
**Phase:** 1 of 4 (Foundation → Customer → Partner → Landing)
**Branch:** `feature/design-system-foundation`

## Goal

Raise FEASTY to a "DoorDash standard" UI/UX bar. This spec covers **Phase 1 only**: the
shared foundation that later surface work is built on. Customer, partner, and landing
redesigns each get their own spec and plan.

The brand palette (green `#2e7d32` / orange `#f57c00`) is **locked** and is not being
replaced. This phase systematizes it rather than redrawing it.

## Problem

The three user-facing surfaces do not read as one product, and none of them have a
design system. Measured on the current `main` (`2813b06`):

| Symptom | Measurement |
|---|---|
| No shared styling | **35 separate `StyleSheet.create` blocks**, one per file |
| Type chaos | **22 distinct `fontSize` values** across 255 declarations (9,10,11,12,13,14,15,16,17,18,19,20,21,22,24,26,28,30,34,36,54,62) |
| Shape chaos | **13 distinct `borderRadius` values** (7,8,10,12,14,15,16,18,20,22,24,28,999) |
| Everything shouts | `fontWeight` **800 used 99×**, 700 57×, 900 15×, 600 5× |
| Spacing chaos | `paddingVertical` uses **13 distinct values** including one-offs 5, 7, 9, 13, 17 |
| Duplication | `palette.ts` hand-copied in customer + partner, already drifted; landing re-declares the same hexes as CSS vars |
| Typography split | Landing uses Bricolage Grotesque + Karla; both Expo apps use **no custom font at all** (`expo-font` installed, never called) |
| Bloat from no primitives | `home/index.tsx` is 41KB, `cart.tsx` 31.6KB, `LoadingSkeleton.tsx` 18.6KB |

Because weight (800) is doing the hierarchy work that size, color, and whitespace should
do, the UI reads as loud and templated. That is the single biggest visual gap versus the
target bar.

### Accessibility defects found (measured, WCAG 2.1)

| Pair | Ratio | Verdict |
|---|---|---|
| `#2e7d32` on white | 5.13:1 | AA pass — brand green is safe for text and fills |
| `#1b5e20` on white | 7.87:1 | AA pass |
| **`#f57c00` on white** | **2.70:1** | **FAIL** — below even the 3.0 large-text floor. Used as a text color in **10 places**. |
| `#f57c00` vs ink `#0d1522` | 6.77:1 | Pass — orange is safe as a *fill* behind dark text |
| **`textSoft #6a7d76` on canvas** | **4.04:1** | **FAIL** for normal text. Used as a text color in **10 places**. |
| `textMuted #5b6978` on canvas | 5.20:1 | AA pass — the correct muted role (70 usages) |
| `danger #c54a43` on white | 4.74:1 | AA pass |

These are real defects shipping today, not hypotheticals. The token layer encodes the
fix structurally so they cannot recur.

## Non-goals

- Redesigning customer/partner/landing screens (later phases, separate specs).
- `apps/admin-web` and `apps/dispatch` — out of scope entirely for now.
- Changing brand colors.
- Dark mode. Tokens are structured so it is addable later; it is not built now.

## Architecture

New workspace package `packages/design-system`, following the existing convention
(`private: true`, `type: module`, `main: src/index.ts`).

```
packages/design-system/
  src/
    tokens/          # pure TS — no React, no react-native import
      color.ts  type.ts  space.ts  radius.ts  elevation.ts  motion.ts  index.ts
    primitives/      # React Native — consumed by customer + partner
      Button.tsx  Card.tsx  Chip.tsx  Badge.tsx  Text.tsx
      Input.tsx  Skeleton.tsx  EmptyState.tsx  index.ts
    css/
      build-css-vars.ts   # emits tokens.css for the landing page
    index.ts
```

**Layer rule:** `tokens/` imports nothing. That keeps it consumable by the landing
build step and any future surface without dragging React Native along. `elevation.ts`
is the sole exception — it needs `Platform` — so it is exported from `primitives/`
instead, and `tokens/elevation.ts` exports only the raw shadow values.

**Landing de-duplication:** `build-css-vars.ts` generates `tokens.css` from the same
token source, so `--green` is derived rather than hand-copied. Wiring the landing to
consume it is Phase 4; generating it is Phase 1.

**Scope boundary:** generic UI lives in the package. Anything that knows what a
restaurant or dish *is* (`RestaurantCard`, `DishRow`, `PriceBreakdown`) stays in
`apps/customer`. Customer and partner share vocabulary, not domain.

### Import ergonomics — the primary risk

Existing packages declare `@ebuy/*` names but **every app imports them by deep relative
path** (`'../../../../../packages/observability/src/analytics'`); the alias was never
wired into Metro. That is tolerable for a service used in 6 places and unacceptable for
a design system imported in nearly every file.

Expo SDK 54 enables `tsconfig` path aliases by default (`experiments.tsconfigPaths`), so
a `paths` entry should let `@feasty/design-system` resolve for both Metro and TypeScript.

**This is proven first, before anything is built on it.** Implementation step 1 is a
throwaway spike: create the package exporting a single constant, import it by alias in
both customer and partner, and confirm the Metro dev bundle *and* `npm run typecheck`
resolve it on both apps.

**Fallback if the alias fails:** each app gets one local `src/design.ts` that re-exports
via relative path, so exactly one file per app carries the ugly path. Either way this is
settled on day one, not after 30 components exist.

**Naming:** new package uses the `@feasty/*` scope (the rename is complete); the three
existing `@ebuy/*` packages are left alone.

## Token layer

### Color — roles, not names

Screens reference roles, never raw hex. Values are the existing locked brand colors
reorganized.

```
brand.primary       #2e7d32   brand.primaryStrong #1b5e20
brand.primarySoft   #c8e6c9   brand.primaryTint   #e8f5e9
brand.accent        #f57c00   — FILL ONLY, never text on light surfaces
brand.accentSoft    #ffe0b2
brand.accentText    #8a4500   — 7.16:1, the safe token for orange-flavored text

surface.canvas  #f3f7f6   surface.default #fbfcfc   surface.muted #edf3f1
surface.strong  #d8e3df   surface.inverse #0d1522

text.primary   #0d1522 (16.95:1)   text.secondary #5b6978 (5.20:1)
text.onBrand   #ffffff  (5.13:1)   text.onAccent  #0d1522 (6.77:1)
text.onInverse #f3f7f6

border.subtle #dde7e3   border.default #c2d0ca   border.strong #a9bcb4

status.success #2e7d32 / successSoft #c8e6c9
status.warning #f57c00 (fill) / warningSoft #ffe0b2 / warningText #8a4500
status.danger  #c54a43 (4.74:1) / dangerSoft #f8dfdc
```

Two roles are deliberately **retired**:

- `textSoft #6a7d76` — fails AA. All 10 usages migrate to `text.secondary`.
- `brandOrange`-as-text — fails AA. The 10 text usages migrate to `brand.accentText`;
  fill usages migrate to `brand.accent` paired with `text.onAccent`.

There is no `text.onAccent` variant for white-on-orange, because that combination cannot
pass. The type system enforces this: `onAccent` is the only text role accepted by
accent-filled components.

### Typography

Adopt the landing's existing pairing so all three surfaces match. Weights are restricted
to exactly what the landing already loads, so no additional font payload:
**Bricolage Grotesque 500/700/800**, **Karla 400/500/700**.

Eight roles replace 22 sizes:

| Role | Size/Line | Family / Weight | Use |
|---|---|---|---|
| `display` | 32/38 | Bricolage 800 | Rare hero moments — order success, empty-state headline |
| `title1` | 24/30 | Bricolage 700 | Screen titles |
| `title2` | 20/26 | Bricolage 700 | Section headers |
| `title3` | 17/22 | Bricolage 500 | Card titles, restaurant names |
| `body` | 15/22 | Karla 400 | Default body text |
| `bodyStrong` | 15/22 | Karla 700 | Emphasis, prices |
| `callout` | 13/18 | Karla 500 | Metadata — delivery time, rating, distance |
| `caption` | 11/14 | Karla 500 | Badges, labels |

**Weight ceiling:** 800 is permitted **only** on `display`. Body text never exceeds 700.
This directly reverses the "99× weight-800" problem — hierarchy comes from size, color,
and whitespace instead.

Fonts load via `expo-font` in each app's root layout using
`@expo-google-fonts/bricolage-grotesque` and `@expo-google-fonts/karla`, gated behind the
existing splash-screen hold so there is no flash of unstyled text.

### Spacing — 4pt base

```
space = { hair: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20,
          '2xl': 24, '3xl': 32, '4xl': 40, '5xl': 48 }
```

Migration mapping for the existing one-offs: 5,6,7 → `sm`(8); 9,10 → `md`(12);
13,14,15 → `lg`(16); 17,18 → `xl`(20); 22 → `2xl`(24); 28,30 → `3xl`(32).

### Radius

```
radius = { sm: 8, md: 12, lg: 16, xl: 20, '2xl': 24, pill: 999 }
```

Mapping: 7,8 → `sm`; 10,12 → `md`; 14,15,16 → `lg`; 18,20 → `xl`; 22,24,28 → `2xl`;
999 → `pill`.

### Elevation

RN shadows are platform-split (iOS `shadowColor/Offset/Radius/Opacity`, Android
`elevation`, web `boxShadow`). The package exports ready-made `Platform.select` style
objects — `elevation.none | sm | md | lg` — so screens never hand-roll shadow props
again. Shadow color derives from `surface.inverse` at low opacity, not pure black, so
cards sit correctly on the sage canvas.

### Motion

```
duration = { fast: 120, base: 200, slow: 320 }
easing   = { standard, decelerate, accelerate }
```

Respects `useReducedMotion` from Reanimated (already a dependency).

## Primitives

Each is a thin, focused component built strictly from tokens. API sketches:

- **`Text`** — `variant` (the 8 type roles) × `color` (text roles) × `align`.
  The single most important primitive; it is what retires ad-hoc `fontSize`/`fontWeight`.
- **`Button`** — `variant`: `primary | secondary | ghost | destructive`;
  `size`: `sm | md | lg`; `loading`, `disabled`, `fullWidth`, `icon`.
  Enforces a **minimum 44×44pt tap target** at every size.
- **`Card`** — `elevation`, `radius`, `padding`, `onPress` (adds press feedback).
- **`Chip`** — selectable filter pill (category chips for the customer home feed);
  `selected` state, `onPress`.
- **`Badge`** — small status pill; `tone`: `neutral | success | warning | danger`.
  Warning tone uses accent fill + ink text, never orange text.
- **`Input`** — label, placeholder, error text, optional leading/trailing icon,
  focus ring from `brand.primary`.
- **`Skeleton`** — consolidates the existing `Skeleton.tsx` (3.2KB) and
  `LoadingSkeleton.tsx` (18.6KB) into one primitive plus composable shapes.
  The 18.6KB file is bespoke per-screen skeletons that should be composition, not code.
- **`EmptyState`** — icon + title + body + optional action. The app currently
  hand-rolls these per screen.

## Migration strategy

Phase 1 does **not** rewrite screens. It lands the foundation and proves it on a narrow
slice, so that Phase 2 (the customer redesign) is applying a known-good system rather
than inventing one.

1. **Alias spike** — prove `@feasty/design-system` resolves in Metro + typecheck for both
   apps. Choose alias or fallback. Nothing else starts until this is green.
2. **Token layer** — all six token modules, with unit tests.
3. **Font loading** — wire Bricolage + Karla into both apps' root layouts.
4. **Primitives** — the eight components above.
5. **Compatibility shim** — rewrite each app's existing `palette.ts` to re-export from
   the token package, mapping legacy keys (`accent`, `textMuted`, …) onto the new roles.
   The 35 existing `StyleSheet.create` blocks keep working untouched; nothing breaks, and
   the drift source is gone. `textSoft` and `brandOrange`-as-text are fixed here, since
   the shim redirects them to accessible roles — **the 20 contrast defects are resolved
   in Phase 1 without touching 35 files.**
6. **Pilot migration** — convert exactly two screens end-to-end to primitives:
   `(auth)/login.tsx` (small, low-risk, 4.1KB) and `(customer)/orders/index.tsx`
   (list + empty + loading states, 10.5KB). These validate the primitive API against real
   screens and set the pattern Phase 2 follows at scale.

Deliberately **not** in Phase 1: `home/index.tsx` (41KB) and `cart.tsx` (31.6KB). Those
are Phase 2, where they get restructured rather than merely re-styled.

## Testing

- **Token unit tests** (`node --test`, matching the repo's existing runner): scale values
  are the expected sets; no duplicate values within a scale.
- **Contrast test** — an automated WCAG check asserting every `text.*` role clears 4.5:1
  against every `surface.*` role it is permitted on, and that `brand.accent` is absent
  from all text roles. This is what prevents the shipped defects from returning.
- **Primitive render tests** — each primitive renders across its variant matrix.
- **Tap-target test** — `Button` meets 44×44 at every size.
- **Typecheck + lint** on customer and partner (existing `npm run typecheck:*` scripts).
- **Manual smoke** — dev bundle for customer and partner, fonts confirmed loading, the
  two pilot screens verified on web and Android.

## Risks

| Risk | Mitigation |
|---|---|
| Metro alias resolution fails | Spike is step 1; relative re-export fallback ready |
| Font loading adds startup latency | Only weights the landing already loads; gated behind existing splash hold; fallback to system font on timeout |
| Compat shim hides drift indefinitely | Shim is explicitly temporary; Phase 2 deletes `palette.ts` per app as screens migrate |
| Concurrent sessions on this repo | Work is isolated in `design-system-wt`; re-verify `main` before merge |
| Scope creep into screen redesign | Phase 1 migrates exactly two pilot screens; home and cart are Phase 2 |

## Phasing

- **Phase 1 (this spec)** — foundation + shim + 2 pilot screens.
- **Phase 2** — customer redesign: home feed, restaurant page, cart/checkout, order
  tracking. The bulk of the "DoorDash standard" visible work.
- **Phase 3** — partner app on the same system.
- **Phase 4** — landing consumes generated `tokens.css`; visual refresh.
