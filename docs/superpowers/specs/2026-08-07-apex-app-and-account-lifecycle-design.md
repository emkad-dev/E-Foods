# Apex customer app, per-app auth redirects, and account lifecycle

**Date:** 2026-08-07
**Branch:** `feature/apex-app-and-account-lifecycle` (worktree `apex-lifecycle-wt`, cut from `origin/main` @ `4eb31b2`)
**Status:** design approved, ready for implementation plan

## Summary

Four changes, one branch:

- **A.** `feasty.com.ng` serves the customer app. The marketing landing page is retired.
- **B.** Auth emails link back to the app that sent them instead of bouncing through the landing page.
- **C.** Account deletion marks the account inactive for 30 days, then a scheduled job purges it.
- **E.** Destructive confirmations use an in-app dialog instead of `Alert.alert`, which is a no-op on web.

Two things were considered and deliberately excluded — see [Out of scope](#out-of-scope).

## Context

Today `feasty.com.ng` serves a static marketing page (`apps/web-landing/public/index.html`, Cloudflare Pages project `feasty-web`) and the customer app lives at `app.feasty.com.ng` (project `feasty-customer`). Supabase's Site URL points at the landing page, so every auth email — signup confirmation, password reset — lands on marketing copy and the user has to find their way back into the app.

Account deletion is a genuine hard delete. `offboardUserAccount` (`supabase/functions/app-rpc/index.ts:3322`) bans the auth user, destroys the `UserAccount` row, role links, and application/rider records, then deletes the Supabase Auth user outright. There is no recovery path and no grace period.

Destructive confirmations use `Alert.alert` with cancel/destructive buttons. React Native Web implements `Alert` as a no-op, so on `app.feasty.com.ng` today the "Delete my account" and "Sign out" confirmations do nothing at all. This is a live bug, not a styling preference.

---

## A. Customer app at the apex

### Code

- Delete `apps/web-landing/` and `.github/workflows/deploy-web-landing.yml`.
- `.github/workflows/deploy-customer.yml`: `EXPO_PUBLIC_APP_DOMAIN` → `feasty.com.ng`.
- Replace all four hard-coded occurrences of `app.feasty.com.ng` in the customer app:
  - `apps/customer/app.json` — iOS `associatedDomains`
  - `apps/customer/app.json` — Android `intentFilters` host
  - `apps/customer/app.json` — `extra.EXPO_PUBLIC_APP_DOMAIN`
  - `apps/customer/src/config/env.ts` — the `?? 'app.feasty.com.ng'` default

  The `env.ts` default matters most: any build that does not receive the CI environment variable silently keeps emitting the old origin.

`app.feasty.com.ng` is kept as a live custom domain on the same Pages project rather than 301'd to the apex. A redirect would break the deep-link host for already-installed apps. The apex becomes canonical; `app.` is a working alias. Both hosts stay listed in `associatedDomains` and `intentFilters`.

### Operator steps

These require dashboard access and cannot be done from the repo:

1. Cloudflare → Pages → `feasty-customer` → add custom domains `feasty.com.ng` and `www.feasty.com.ng`.
2. Cloudflare → Pages → delete the `feasty-web` project.
3. Supabase → Auth → URL Configuration → Site URL: `https://feasty.com.ng`.

Step 3 must happen **after** B ships, or in-flight auth emails will point at a host that no longer serves the landing page.

---

## B. Per-app auth redirect links

Branch `fix/auth-email-redirect` (`ed798ab`) already implements most of this and is cherry-picked as the starting point.

### B1 — shared helper

`apps/partner/src/utils/authActionUrls.ts` and the dispatch equivalent on that branch are near-identical. Promote one implementation into `packages/auth` as:

```ts
buildAuthActionUrl(path: string, options: { appScheme: string; isWeb?: boolean; webOrigin?: string }): string
```

Behaviour: on web, resolve `path` against `webOrigin` (falling back to `window.location.origin`); on native, emit `${appScheme}://${path}`. Delete the two app-local copies.

Native uses the registered custom scheme, **not** an https URL. This is why universal-link association files are not required for this work — see [Out of scope](#out-of-scope).

### B2 — customer's missing native branch

The real defect. Customer's `getActionCodeSettings` (`apps/customer/src/contexts/AuthContext.tsx:119`) is unconditionally `https://${appEnv.appDomain}${path}` — partner and dispatch got the web/native split and customer never did. Migrate it onto the shared helper.

Also on this branch: the signup path currently calls `createUserWithEmail` and then `sendVerificationEmailWithFallback`, but the sign-up call itself already sends a confirmation email. The second send trips Supabase's 60-second cooldown, so the email the user actually receives is the first one — addressed to the Site URL. Passing the action-code settings into `createUserWithEmail` and dropping the resend fixes it.

### Per-app destinations

| App | Web origin | Native scheme |
|---|---|---|
| customer | `feasty.com.ng` | `feasty-customer://` |
| partner | `partner.feasty.com.ng` | `feasty-partner://` |
| dispatch | *(native only)* | `feasty-dispatch://` |
| admin | `admin.feasty.com.ng` | — |

Confirmation links land on the requesting app's own `/verify-email`, which routes into the app when a session exists and to that app's login otherwise.

---

## C. Soft delete with a 30-day grace period

### C1 — migration

New columns on `UserAccount`:

| Column | Type | Purpose |
|---|---|---|
| `deletionRequestedAt` | `timestamptz` | set when the user requests deletion; the grace-period marker |
| `purgeScheduledAt` | `timestamptz` | `deletionRequestedAt + 30 days` |
| `deletionCancelTokenHash` | `text` | SHA-256 of the emailed cancel token; never stores the token itself |
| `purgeAttemptCount` | `int` default `0` | retry accounting for the purge runner |
| `purgeLastAttemptAt` | `timestamptz` | backoff base |
| `purgeLastError` | `text` | last failure, for support triage |

Partial index on `purgeScheduledAt` where `deletionRequestedAt is not null`, so the daily purge scan stays cheap.

### C2 — request and cancel

`deleteOwnAccount` stops destroying data. It now:

1. Runs the existing `validateOffboardingEligibility` checks for restaurant and dispatch roles (unchanged — a partner with open orders still cannot leave).
2. Writes an audit entry.
3. Sets `deletionRequestedAt = now()`, `purgeScheduledAt = now() + interval '30 days'`.
4. Mints a random cancel token, stores only its SHA-256, and emails the user the purge date and a cancel link — reusing the existing `_shared/email.ts` helpers (`loadUserEmailRecipient`, `buildTransactionalEmailHtml`, `sendTransactionalEmail`). No new mail infrastructure.
5. Signs the user out.

**The auth user is not banned at request time.** Banning is deferred to purge. This is the pivotal decision in this design; the rationale is in [Why not ban at request time](#why-not-ban-at-request-time).

Two cancel paths, both restoring by clearing `deletionRequestedAt`, `purgeScheduledAt`, and `deletionCancelTokenHash`:

- `cancelAccountDeletion` — authenticated RPC, called from the in-app restore screen.
- `cancelAccountDeletionByToken` — unauthenticated, takes the emailed token, compares against the stored hash in constant time. Safe without a session because the token is itself the secret; it is not keyed by anything guessable.

### C3 — the pending-deletion gate

Sign-in succeeds at the Supabase level. The app already loads the user account immediately afterwards; when `deletionRequestedAt` is set it tears the session down and renders a blocked screen showing the purge date and an explicit **Restore my account** action.

An accidental sign-in does not cancel anything. Only a deliberate tap on *Restore* reverses the deletion. Implemented in customer, partner, and dispatch.

### C4 — purge runner

A new `account-purge-runner` edge function on a daily `pg_cron` schedule, following the pattern in `supabase/migrations/20260708_broadcast_runner_schedule.sql` (vault `project_url` + `queue_worker_token`, exception-guarded so the migration applies cleanly where the extensions are unavailable).

It does **not** reuse `offboardUserAccount`. That function is correct for an interactive request and wrong for a scheduled job: on partial failure it un-bans the auth user and returns 409, which in a purge context would resurrect an account that is supposed to be being destroyed.

Purge semantics:

- **Never unbans.** Once past `purgeScheduledAt`, the ban is terminal.
- **Per-leg idempotency.** Each delete re-runs safely, so a partial purge resumes rather than restarts.
- **Auth user deleted last**, so any crash leaves a re-runnable state rather than an orphaned record with no `UserAccount` row to find it by.
- **Bounded retries.** Increment `purgeAttemptCount`, record `purgeLastError`, back off exponentially on `purgeLastAttemptAt`. After 5 attempts stop retrying and leave the row for an operator rather than grinding daily forever. Retry-exhausted rows surface in the admin view (C5) — deliberately *not* the support inbox, which is customer-facing (`SupportConversation`/`SupportMessage`) and the wrong channel for a system alert.

### C5 — admin visibility

`admin-web` user list shows a pending-deletion state with the purge date, and an admin restore action. Also surfaces accounts that exhausted their purge retries.

---

## E. ConfirmDialog

A theme-aware `ConfirmDialog` component per app (~80 lines, RN primitives, built on that app's own palette). Not a shared package: each app styles from its own theme, and a new shared UI package would collide head-on with the unmerged `feature/design-system-foundation` branch.

Replaces every cancel/destructive `Alert.alert` in the five files that have them:

- `apps/customer/app/(customer)/profile/index.tsx` (delete account, sign out)
- `apps/customer/app/(customer)/orders/[id].tsx`
- `apps/customer/app/(customer)/home/restaurant/[id].tsx`
- `apps/partner/app/(partner)/profile.tsx`
- `apps/dispatch/app/(dispatch)/profile.tsx`

Single-button informational `Alert.alert` calls are left alone; they are also silent on web, but that is a separate, larger cleanup.

---

## Why not ban at request time

The obvious implementation bans the auth user when deletion is requested, so Supabase itself refuses the sign-in. Rejected, because the app then cannot tell *why* sign-in failed — a deletion ban and an admin-disable ban surface as the same generic error — so the user gets "login failed" with no purge date and no way to recover.

Making that distinction visible would require routing password sign-in through `auth-gateway`. That is substantially more than a backend tweak:

- `packages/auth/src/gatewayAuth.ts:33` flattens every gateway response into `new Error(message)`. Any structured error code is discarded before a caller sees it, so the helper needs a `GatewayAuthError` with a `.code` field, and every consumer needs updating.
- `createGatewayAuth` already exposes `signIn`, `signUp`, `refresh`, and `signOut`, and **nothing calls any of them.** Only the phone-OTP routes are wired. This would be activating a dormant path, not adjusting a live one.
- Session establishment would move to `setSession` on gateway-returned tokens, touching refresh handling, the `hasUserRef` tab-refocus guard, and every auth listener.
- It is not one shared path. Customer, partner, and dispatch use `signInWithEmail` (`packages/auth/src/supabaseAuth.ts:62`); `admin-web` has its own direct `signInWithPassword` (`apps/admin-web/src/contexts/AuthContext.tsx:50`).

That is a four-app change to the highest-blast-radius code in the product, bought for one error message.

Deferring the ban to purge time removes the problem instead of solving it: the gate moves into the app, which already has the account record and can therefore state the purge date and offer restore directly.

The cost is that a session exists for a few hundred milliseconds before the app tears it down. RLS already restricts customers to self-read on `CustomerOrder` and `DeliveryAssignment`, so the exposure is the user's own data. (Those policies are applied in production, but the accompanying `docs/rls-posture.md` lives on the unmerged `fix/customer-order-rls-policies` branch and is not in `main` — verify the live policies directly rather than relying on that doc.)

An unauthenticated *account-status-by-email* lookup was also considered and rejected outright: it is an email-enumeration oracle, and this project already carries a wildcard-permissive redirect allowlist.

---

## Out of scope

**Theme / dark mode.** Originally part of this work; split out after counting the real surface. On `origin/main`: 36 `StyleSheet.create` blocks in customer, 20 in partner, 18 in dispatch — **74 `createStyles(theme)` conversions**, plus `admin-web` CSS. That is larger than A, B, C, and E combined and would bury the review signal on everything else. It gets its own spec and branch, and `admin-web` is cheap there (22 `:root` CSS variables plus 9 stray hex values).

**Universal links (AASA / assetlinks.json).** No `apple-app-site-association` or `assetlinks.json` exists anywhere in the repo, so universal links have never resolved. This does not block B, because native auth links use the custom scheme rather than an https host. Separate ticket.

---

## Testing

**Unit**
- `buildAuthActionUrl` — web vs native, origin override, path normalisation, empty-path rejection
- cancel-token hashing and constant-time comparison
- purge-eligibility selection: respects `purgeScheduledAt`, skips retry-exhausted rows, honours backoff
- pending-deletion gate: sets blocked state, does not auto-cancel

**Integration**
- delete → sign in → blocked screen → restore → sign in succeeds
- delete → advance clock past `purgeScheduledAt` → purge → auth user gone
- purge with an injected mid-sequence failure → re-run completes, account never unbanned

**Per app:** `typecheck`, `lint`, Metro export.

**Manual:** confirm dialogs actually appear on web (the regression this fixes), and auth emails from each app land back in that app.

---

## Commit plan

| # | Scope | Content |
|---|---|---|
| 1 | A | retire `web-landing`, apex domain, all four hard-coded host sites |
| 2 | B1 | shared `buildAuthActionUrl`; partner + dispatch migrated |
| 3 | B2 | customer web/native split; double-send fix |
| 4 | C1 | migration: deletion + purge columns, partial index |
| 5 | C2 | `deleteOwnAccount` schedules; both cancel RPCs; cancel email |
| 6 | C3 | pending-deletion gate + restore screen (customer, partner, dispatch) |
| 7 | C4 | `account-purge-runner` + daily cron |
| 8 | C5 | admin pending-deletion visibility and restore |
| 9 | E | per-app `ConfirmDialog` and the five call sites |

## Risks

- **Deploy ordering.** `app-rpc` must deploy before the Supabase Site URL changes, or auth emails point at a dead host. Per `docs` and prior incidents, deploy only from a `main`-current worktree — a stale worktree once reverted `app-rpc` to pricing v1 in production.
- **`app-rpc` is already undeployed relative to `main`.** Partner onboarding stages 1–2 merged but were never deployed, so this branch's `app-rpc` changes will ship those too. That needs to be a deliberate, verified deploy rather than a side effect.
- **Purge is irreversible by construction.** The runner should ship disabled (cron scheduled but the function short-circuiting on a flag) until at least one grace period has been observed end-to-end in production.
