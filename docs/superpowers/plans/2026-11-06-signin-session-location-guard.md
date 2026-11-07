# Sign-in speed, unexpected logouts and location guard — implementation plan

Branch: `feature/signin-session-location-guard` (off `main` at `975d769`). Repo root: `C:\Users\emkad\EBuy\E-Foods`.

## Spec (agreed with the user, binding)

### A. Unexpected logouts
1. A network failure while the app reloads the profile must not look like signed out. Partner and dispatch reconcile
   catch blocks only recognise errors containing "offline"; real failures say "Network request failed". Treat every
   transient network failure (`isNetworkRequestError` as well as the offline check) as offline: keep the user from the
   saved profile. With no saved profile for that user, show the no-internet error without destroying the Supabase session.
   Customer: confirm its path holds and fix it if it does not.
2. Every sign-out affects only the current device: `signOutUser` and `clearSupabaseSession` use `scope: 'local'`. This
   includes takeover eviction, session expiry and the user's own sign-out. No "sign out everywhere".
3. Force close during sign-in must not cause self-eviction. Clear the locally stored device id when an interactive sign-in
   starts, and keep the order remote-write-then-local-store. A kill in between leaves local empty, which adopts rather than
   evicts. Applies to customer and dispatch (partner does not enforce single device). Do NOT store locally first: local-new
   + remote-old evicts.

### B. Sign-in speed
4. Do not block entry on saving the device id. Customer and dispatch enter the app once profile data is ready, then claim
   in the background with one retry. `signInInProgressRef` stays set until the claim settles so the passive reconcile cannot
   evict during the window. A failed claim is reported, and must not sign the user out.
5. A combined profile call for dispatch and partner like `customerBootstrap`, so sign-in costs password + one call. Old
   clients keep working; a missing action falls back to the existing chain, as customer does.
6. Keep `feasty-dispatch` and `feasty-partner` warm: migration adding them to `fn-warmer-every-5-min` (the human applies it).
7. Fail faster on stalls: password sign-in requests time out at 7s and retry once on a network failure or timeout. The
   bootstrap read retries once. NEVER retry or shorten refresh-token requests: refresh tokens rotate, so a retry can burn the
   session. All other requests keep the current 15s limit.

### C. Location guard (customer browsing stays open)
8. Publishing requires coordinates. Enforced on the server wherever a restaurant becomes published (admin publish action,
   partner self-service paths, approval if it publishes). Already-published restaurants are not auto-hidden by code.
9. Partner store details gets two buttons above the raw fields: "Find from address" (forward geocode the typed address
   with OpenStreetMap Nominatim, user-triggered only, show the result to confirm before filling) and "Use my current
   location" (GPS, foreground only, with the result confirmed). Raw fields stay as a manual fallback. Adds `expo-location` to
   partner with foreground permissions only, background location explicitly blocked, and an in-app disclosure before the OS prompt.
10. Customer address screen on launch: on every cold launch while no address is saved, including guests, offer "Use my
    location" or "Type your address" with a Skip. Skip lasts until the next cold launch. Must not interrupt deep links (payment
    callback, order, reset password, verify email), so it triggers only on arriving at Home. Reuse the existing
    `delivery-location` screen where it fits.
11. Checkout: no saved address blocks ordering for collection as well as delivery, with a clear way to add one.
    Out-of-range delivery and the existing no-coverage block stay as they are. Client-side rule only: older installed apps must
    keep working, and requiring coordinates on the server is explicitly out of scope.
12. Collection distance warning: when a collection order's restaurant is more than 50 km from the saved address, ask
    "This restaurant is X km away. Are you sure?" before payment. A warning, not a block. Mixed baskets use the farthest
    restaurant. Restaurants without coordinates produce no warning.

## Global Constraints

- Never apply migrations, write to production, deploy or push. The human runs SQL. Any function selecting a new column needs
  its migration first; this plan adds no columns.
- Adding an RPC action needs FOUR count updates plus the handlers map: `supabase/functions/_shared/rpc/actions.ts`,
  `scripts/rpc-routes-lib.mjs` (`EXPECTED_DOMAIN_ACTION_COUNTS`, `EXPECTED_TOTAL_ACTION_COUNT`), then
  `npm run generate:rpc-routes`, `packages/domain/src/rpcRoutes.test.ts` (map, total, literal counts in two test NAMES),
  `supabase/functions/_shared/rpc/registry.test.ts`, `supabase/functions/_shared/rpc/registry.real-domains.test.ts`.
- Node tests are `.ts`, registered by hand in root `package.json` `test:node`; deno tests in `test:deno`. Run `npm run -s test`.
  deno: PowerShell with `$env:Path = "$env:LOCALAPPDATA\Microsoft\WinGet\Links;" + $env:Path`.
- react-native `Alert` is a no-op on web: use design-system `useConfirm` and inline notices. Touchables need a style and a 44pt
  minimum (`scripts/uiContract.test.ts`).
- `android/` is committed, so native changes go in `android/app/src/main/AndroidManifest.xml` as well as `app.json`. Keep the
  manifest's explanatory comments. Do NOT run `eas update:configure`.
- Runtime version stays `1.0.0`: no installed build has updates yet, so the coming build is the first of that runtime.
- Each commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Match surrounding code; comments say WHY.

## Tasks

### Task 1: Logout fixes (Spec A)
- Shared helper in `packages/auth` for "transient network failure", used by all three AuthContext reconcile catch blocks.
- `signOutUser` and `clearSupabaseSession` local scope.
- Clear stored device id at interactive sign-in start in customer and dispatch.
- Pure-logic tests for what you can extract (error classification, the keep-signed-in decision, signOut scope with a fake client).
- Commit: `fix(auth): a network failure no longer looks like being signed out`.

### Task 2: Sign-in speed (Spec B)
- Background device-id claim with one retry (customer, dispatch).
- `dispatchBootstrap` and `partnerBootstrap` actions in the domains that own those apps, modelled on `customerBootstrap`
  (`supabase/functions/_shared/domains/`), used by sign-in with fallback. Real-handler deno tests. Update all RPC counts.
- `supabase/migrations/20261106_fn_warmer_dispatch_partner.sql`: idempotent re-schedule of the warmer with the two added targets.
  Read `20261022_fn_warmer.sql` first and keep its guards.
- Timeout policy in `packages/auth/src/boundedFetch.ts` as a pure, tested function of the URL; password retry in the sign-in helper.
- Commit: `feat(auth): faster sign-in for all three apps`.

### Task 3: Restaurant location required (Spec 8, 9)
- Server rule + deno tests covering each publish path, with a clear 412 message.
- Partner store-details buttons, pure geocode-result parser + tests. Nominatim: user-triggered only, identify the app per its usage
  policy, handle no result and no network. See `apps/customer/src/services/deviceLocation.ts` and `locationResolution.ts` for patterns.
- `expo-location` in partner (package.json via SDK-compatible version, lockfile, `app.json`, manifest). Update
  `docs/play/` partner data-safety answers to declare location. Report anything the human must change in Play Console.
- Commit: `feat(partner): restaurants must set a location before publishing`.

### Task 4: Customer address screen and checkout rules (Spec 10-12)
- Launch prompt, skip-for-this-launch state, deep-link safety. Pure decision helper + tests.
- Checkout address requirement and 50 km collection warning. Pure helpers + tests (threshold boundary, mixed basket, missing
  coordinates). Must work on web and native.
- Commit: `feat(customer): ask for an address on launch and check it at checkout`.
