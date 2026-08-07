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

**The `user_profiles` view must be replaced in the same migration.** It is a `security_invoker` view over `UserAccount` defined in `20260712_phone_otp.sql:28` and is what the server-side gate reads. If it is not extended with `deletionRequestedAt` and `purgeScheduledAt`, the gate is blind and C3 silently does nothing.

### C2 — request and cancel

`deleteOwnAccount` stops destroying data. It now:

1. Runs the existing `validateOffboardingEligibility` checks for restaurant and dispatch roles (unchanged — a partner with open orders still cannot leave).
2. Writes an audit entry.
3. Sets `deletionRequestedAt = now()`, `purgeScheduledAt = now() + interval '30 days'`.
4. Mints a random cancel token, stores only its SHA-256, and emails the user the purge date and a cancel link — reusing the existing `_shared/email.ts` helpers (`loadUserEmailRecipient`, `buildTransactionalEmailHtml`, `sendTransactionalEmail`). No new mail infrastructure.

**The session is left intact.** The user is not signed out, and the auth user is not banned. Banning is deferred to purge; access is denied by the server-side gate in C3, not by destroying the session. This is the pivotal decision in this design — rationale in [Why not ban at request time](#why-not-ban-at-request-time).

Two cancel paths, both restoring by clearing `deletionRequestedAt`, `purgeScheduledAt`, and `deletionCancelTokenHash`:

- `cancelAccountDeletion` — authenticated RPC, called by the **Restore my account** button on the pending-deletion screen. Works because the session was never torn down.
- `cancelAccountDeletionByToken` — unauthenticated, takes the emailed token, compares against the stored hash in constant time. Safe without a session because the token is itself the secret; it is not keyed by anything guessable. This is the path for someone who has lost device access.

### C3 — server-side gate (authoritative)

**Access denial is enforced on the backend, not by the client.** A client-side sign-out would leave a live session window and make the protection depend on app behaviour — a stale client, an in-flight background request, or any non-app caller holding a valid JWT could keep operating.

There are **two** paths into the backend, and both must be gated. Gating only the edge functions is insufficient: the apps also talk to the Supabase Data API directly (`apps/customer/src/services/supabase/profile.ts:38,63,114`), so a pending-deletion user holding a valid JWT could bypass the edge functions entirely.

#### C3a — edge-function gate

The gate lives in `getAuthenticatedRequestContext` (`supabase/functions/_shared/request-context.ts:22`), immediately after the existing `accountDisabled` check at line 46. It is the single chokepoint for every authenticated backend request: `app-rpc` (`index.ts:3533`) and `notifications` (`index.ts:32`) both resolve their context through it, so one change covers both, and any future function using it inherits the gate.

Signature becomes:

```ts
getAuthenticatedRequestContext(request, options?: { allowPendingDeletion?: boolean })
```

Default is `false` — a request from an account with `deletionRequestedAt != null` is rejected. `action` is already known before the context is resolved at `index.ts:3533` (anon actions like `promoTrack` are handled above it), so `app-rpc` passes `allowPendingDeletion: true` for exactly one action: `cancelAccountDeletion`. Everything else, including all of `notifications`, is refused.

The rejection is a **structured 403**, not a bare `Error`. It carries `code: 'ACCOUNT_PENDING_DELETION'` and `purgeScheduledAt` in the body. The client therefore renders the pending-deletion screen from the rejection itself and needs no separate profile read — which is why the exemption list stays at exactly one action rather than growing to cover profile hydration.

Note this differs from the existing `accountDisabled` throw, which is a bare `Error` with no `.status` (see the comment at `index.ts:7142`). The new rejection needs `.status = 403` so it is not surfaced as a 500.

#### The error envelope must carry the code

The structured rejection does **not** work with the current response plumbing. Both `app-rpc` (`index.ts:7137`) and `notifications` (`index.ts:122`) serialize exactly `{ error: { message } }` and drop everything else, so `code` and `purgeScheduledAt` would never reach the client and the "no separate profile read" path would silently fail.

`_shared/observability.ts` already has the right primitive: `ClientSafeError`, carrying `.status` plus an `expose` marker, with `getErrorStatus` reading `.status` and a convention that only 4xx client-safe errors are surfaced. Extend it with optional `code` and `details`, and update both catch blocks to include them when present, subject to the existing exposure rule.

This also removes a live wart: `app-rpc` currently forces the disabled-account 403 by **string-comparing** `error.message === 'This account is disabled.'`. Once that throw becomes a `ClientSafeError(403, …)`, the string match goes away.

#### C3b — Data API gate

Verified against production: `UserAccount` has RLS enabled with three policies, all `uid = auth.uid()` self-access, and the UPDATE policy carries **no column restriction**. A pending-deletion user could therefore `UPDATE` their own row over the Data API and clear `deletionRequestedAt` themselves — cancelling their own deletion without ever calling the RPC. The deletion state would be client-writable.

Production already has the right mechanism for this: the `ebuy_guard_useraccount_sensitive_update` trigger, which raises on direct updates to sensitive `UserAccount` columns (`accountDisabled`, `disabledAt`, `roleDisplay`, the application-status fields, …) unless the caller is `service_role` or an admin. Two changes, no new mechanism:

1. **Add the new columns to that trigger's guarded list** — `deletionRequestedAt`, `purgeScheduledAt`, `deletionCancelTokenHash`, `purgeAttemptCount`, `purgeLastAttemptAt`, `purgeLastError`. This alone closes the self-cancel hole. `deleteOwnAccount` and the purge runner both write via `serviceClient`, which the trigger already exempts.
2. **Reject all self-writes during the grace period.** Extend the same trigger so any non-service, non-admin update where `OLD."deletionRequestedAt" IS NOT NULL` raises.

The other three client-writable tables get the same condition. The full set of tables `authenticated` can write, verified in production, is exactly four:

| Table | Client writes | Treatment |
|---|---|---|
| `UserAccount` | INSERT, UPDATE | trigger, as above |
| `UserRole` | INSERT | policy condition |
| `UserPolicyAcceptance` | INSERT | policy condition |
| `CustomerFavoriteRestaurant` | INSERT, UPDATE, DELETE | policy condition |

`CustomerOrder` is **not** client-writable — orders already go through `app-rpc` — so the money path needs no change here.

The policy condition uses a `stable security definer` helper following the existing `ebuy_*` convention:

```sql
public.ebuy_account_pending_deletion() returns boolean
```

returning whether the calling user's own account is pending deletion. `security definer` avoids depending on `UserAccount`'s own RLS from inside another table's policy.

**SELECT stays permitted.** Self-reads are harmless and profile hydration needs them before the app can know its own state.

### C4 — pending-deletion screen

With the session intact and the backend refusing everything else, the client's job is presentation only. On receiving `ACCOUNT_PENDING_DELETION` the app routes to a blocked screen showing the purge date and an explicit **Restore my account** button, which calls the authenticated `cancelAccountDeletion` RPC.

Normal app navigation is blocked while in this state. An accidental sign-in cancels nothing — only a deliberate tap on *Restore* reverses the deletion. Implemented in customer, partner, and dispatch.

Because the gate is server-side, a client that fails to route correctly still cannot do anything: every request it makes is refused.

### C5 — purge runner

A new `account-purge-runner` edge function on a daily `pg_cron` schedule, following the pattern in `supabase/migrations/20260708_broadcast_runner_schedule.sql` (vault `project_url` + `queue_worker_token`, exception-guarded so the migration applies cleanly where the extensions are unavailable).

It does **not** reuse `offboardUserAccount`. That function is correct for an interactive request and wrong for a scheduled job: on partial failure it un-bans the auth user and returns 409, which in a purge context would resurrect an account that is supposed to be being destroyed.

Purge semantics:

- **Bans first, and never reverses it.** The auth-user ban happens here, as the runner's first step, not at request time. Once the runner has banned an account past its `purgeScheduledAt`, no failure path un-bans it — that is the specific behaviour of `offboardUserAccount` that makes it unsafe to reuse.
- **Per-leg idempotency.** Each delete re-runs safely, so a partial purge resumes rather than restarts.
- **Auth user deleted last**, so any crash leaves a re-runnable state rather than an orphaned record with no `UserAccount` row to find it by.
- **Bounded retries.** Increment `purgeAttemptCount`, record `purgeLastError`, back off exponentially on `purgeLastAttemptAt`. After 5 attempts stop retrying and leave the row for an operator rather than grinding daily forever. Retry-exhausted rows surface in the admin view (C6) — deliberately *not* the support inbox, which is customer-facing (`SupportConversation`/`SupportMessage`) and the wrong channel for a system alert.

### C6 — admin visibility

`admin-web` user list shows a pending-deletion state with the purge date, and an admin restore action. Also surfaces accounts that exhausted their purge retries.

### Purge activation

The runner ships **disabled**: the cron job is scheduled, but the function short-circuits on a `PURGE_ENABLED` edge-function secret that is absent on first deploy. Scheduling it dormant rather than omitting the cron means activation is a one-line secret change, not a migration.

Purge is irreversible by construction, so it stays off until all of the following hold:

1. At least one full 30-day grace period has elapsed in production since C2 shipped, so there is real data in the pending state.
2. At least one account has completed request → pending screen → restore, verified in prod.
3. The admin pending-deletion view (C6) is live, so there is a way to see what is queued *before* anything is destroyed.
4. A dry-run has been executed: the runner logs the accounts it would purge, with counts reconciled by hand against the admin view.

**Who flips it:** the operator (repo owner), by setting the `PURGE_ENABLED` secret — not CI, and not as a side effect of any deploy. Note the existing footgun that the deploy script syncs `functions/.env` to secrets on every run, so the flag must be managed deliberately rather than left to that sync.

Until it is flipped, accounts accumulate in the pending state indefinitely. That is the intended failure mode: over-retention is recoverable, premature destruction is not.

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

Deferring the ban to purge time removes the problem instead of solving it. The gate moves to `getAuthenticatedRequestContext`, which already loads the account record and can therefore return the purge date with its rejection — so the client can state the date and offer restore without a second call, and without any new auth contract.

The cost is that a valid session continues to exist through the grace period. That is acceptable **only because both gates are server-side** (C3a for the edge functions, C3b for the Data API): the session is a credential the backend refuses to act on, by either route. It is not a window of access. The one action it can still perform is `cancelAccountDeletion`, which is the point.

If either gate were dropped, this design would become unsafe — that is the dependency to keep in mind if the grace period is ever revisited.

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
- `getAuthenticatedRequestContext`: rejects when `deletionRequestedAt` is set; allows only with `allowPendingDeletion: true`; rejection carries `.status = 403`, `code`, and `purgeScheduledAt`; unaffected accounts pass through unchanged
- the `allowPendingDeletion: true` exemption is passed for `cancelAccountDeletion` and no other action
- `ClientSafeError` round-trip: `code` and `details` survive serialization in both functions; a 5xx never exposes them, per the existing convention

**Integration**
- delete → the same session calls an arbitrary `app-rpc` action → 403 `ACCOUNT_PENDING_DELETION` (**the security assertion: this must hold with no client cooperation at all**)
- delete → `notifications` with the same token → rejected
- delete → the rejection body actually contains `code` and `purgeScheduledAt` (guards against the envelope silently dropping them)
- **delete → the same session `UPDATE`s its own `UserAccount` row over the Data API to clear `deletionRequestedAt` → rejected** (the self-cancel hole; must be tested against real RLS, not mocked)
- delete → direct Data API writes to `UserRole`, `UserPolicyAcceptance`, `CustomerFavoriteRestaurant` → rejected
- delete → direct Data API `SELECT` on `user_profiles` → still permitted
- delete → `cancelAccountDeletion` on that session → succeeds → previously-blocked action now succeeds
- delete → cancel via emailed token without a session → restored
- delete → advance clock past `purgeScheduledAt` → purge → auth user gone
- purge with an injected mid-sequence failure → re-run completes, account never unbanned
- purge with `PURGE_ENABLED` unset → no rows touched

**Regression:** an account with `accountDisabled = true` and no `deletionRequestedAt` still gets the existing disabled behaviour, not the new one.

**Per app:** `typecheck`, `lint`, Metro export.

**Manual:** confirm dialogs actually appear on web (the regression this fixes), and auth emails from each app land back in that app.

---

## Commit plan

| # | Scope | Content |
|---|---|---|
| 1 | A | retire `web-landing`, apex domain, all four hard-coded host sites |
| 2 | B1 | shared `buildAuthActionUrl`; partner + dispatch migrated |
| 3 | B2 | customer web/native split; double-send fix |
| 4 | C1 | migration: deletion + purge columns, partial index, `user_profiles` view replacement |
| 5 | C2 | `deleteOwnAccount` schedules; both cancel RPCs; cancel email |
| 6 | C3a | `ClientSafeError` code/details + envelope change in both functions; gate in `getAuthenticatedRequestContext` |
| 7 | C3b | migration: extend `ebuy_guard_useraccount_sensitive_update`, add `ebuy_account_pending_deletion()`, policy conditions on the other three tables |
| 8 | C4 | pending-deletion screen + restore (customer, partner, dispatch) |
| 9 | C5 | `account-purge-runner` + daily cron, shipped disabled |
| 10 | C6 | admin pending-deletion visibility and restore |
| 11 | E | per-app `ConfirmDialog` and the five call sites |

C3a and C3b must both land before or with C4. The gates are the enforcement; the screen is only presentation. C3a's envelope change must precede the gate itself, or the client cannot read the rejection.

## Risks

- **Deploy ordering.** `app-rpc` must deploy before the Supabase Site URL changes, or auth emails point at a dead host. Per `docs` and prior incidents, deploy only from a `main`-current worktree — a stale worktree once reverted `app-rpc` to pricing v1 in production.
- **`app-rpc` is already undeployed relative to `main`.** Partner onboarding stages 1–2 merged but were never deployed, so this branch's `app-rpc` changes will ship those too. That needs to be a deliberate, verified deploy rather than a side effect.
- **The Data API is a second, easily-forgotten attack surface.** The apps read and write `UserAccount`, `UserRole`, `UserPolicyAcceptance`, and `CustomerFavoriteRestaurant` directly through PostgREST, not only through the edge functions. Any future account-state feature has to consider both paths — an edge-function check alone is not enforcement. The four-table set was verified in production against `pg_policy` and should be re-verified rather than assumed if policies change.
- **Purge is irreversible by construction.** The runner should ship disabled (cron scheduled but the function short-circuiting on a flag) until at least one grace period has been observed end-to-end in production.
