# Signup hardening for email-confirmation-ON

**Date:** 2026-07-19
**Status:** Approved design (pending spec review)

## Problem

Customer and partner sign-up both fail with "Error on submit" whenever Supabase
Auth has **"Confirm email" enabled**. Root cause: the signup code assumes
`signUp` returns an authenticated session, but with confirmation ON it returns
`data.session === null`. Two things then break:

1. `createUserWithEmail` immediately calls `signInWithPassword` when there is no
   session ([packages/auth/src/supabaseAuth.ts:28](../../../packages/auth/src/supabaseAuth.ts),
   and the duplicated copy in
   [apps/customer/src/services/supabase/auth.ts:43](../../../apps/customer/src/services/supabase/auth.ts)).
   The email is unconfirmed, so that sign-in throws (`email_not_confirmed`) and
   the whole submit fails — even though the auth user was created and the
   confirmation email went out.
2. Even past that, both apps run session-dependent work right after signup —
   `createUserDocument` (client upserts into `UserAccount` + `UserRole`),
   `recordCustomerPolicyAcceptance`, `startSingleDeviceSession`, and the partner
   application RPC. With no session these are unauthorized.

The buggy `signInWithPassword` block has existed since the May Supabase
migration (`fa75afa`); the trigger is the **setting**, which is why signup
"keeps breaking" each time confirmation gets toggled on.

Evidence: auth logs show `user_confirmation_requested` events (confirmation
emails being sent) immediately followed by `400` on `/token` (the failing
auto-sign-in).

## Goal

Make sign-up work correctly with **email confirmation ON** (the chosen
long-term behavior) for **customer, partner, and dispatch** apps, and remain
correct if the setting is ever OFF. Users must verify their email before their
account is usable.

**Organizing principle:** nothing that requires the user's own session runs at
signup time. Signup produces a valid unconfirmed auth user plus a server-side
base profile row. Everything session-dependent moves to first authenticated
login (after the user verifies their email).

## Design

### 1. Profile row created by a database trigger (server-side, no session)

Add a `handle_new_user()` trigger on `auth.users` (`SECURITY DEFINER`) that
inserts the base profile from `raw_user_meta_data`, mirroring exactly what
`createUserDocument` writes today
([apps/customer/src/services/supabase/profile.ts:47](../../../apps/customer/src/services/supabase/profile.ts)):

- `UserAccount`: `uid`, `email`, `displayName`, `phoneNumber`, `photoURL` (null),
  `emailVerified` (false at creation), `roleDisplay` (from metadata `role`,
  default `customer`), `createdAt`, `updatedAt`.
- `UserRole`: `userId`, `role` (from metadata, default `customer`), `updatedAt`.

The trigger must be idempotent (`ON CONFLICT DO NOTHING` / upsert) so it never
conflicts with the client-side self-heal upsert (below). Metadata is supplied by
the client via `signUp({ options: { data: { display_name, phone, role } } })`.

Delivered as a Supabase migration. Column names/types to be confirmed against
the live `UserAccount`/`UserRole` schema during planning.

### 2. Fix `createUserWithEmail`

In both copies ([packages/auth/src/supabaseAuth.ts](../../../packages/auth/src/supabaseAuth.ts)
and [apps/customer/src/services/supabase/auth.ts](../../../apps/customer/src/services/supabase/auth.ts)):

- Remove the immediate `signInWithPassword` fallback.
- Accept an optional metadata argument and pass it to `signUp` as `options.data`.
- Return `{ user, session }` (session may be `null`). Never throw on a null
  session — that is now the expected confirm-email path.
- Keep the two copies in sync (ideally the customer file re-exports the shared
  `packages/auth` version, matching how partner already imports it, so there is
  one implementation).

### 3. Customer signup

[apps/customer/src/contexts/AuthContext.tsx:403](../../../apps/customer/src/contexts/AuthContext.tsx):

- Call `createUserWithEmail` with metadata (`display_name`, `phone`,
  `role=customer`). The trigger creates the profile; drop the direct
  `createUserDocument` call from the signup path.
- Persist the accepted policy acceptance locally as *pending* (reuse existing
  `storePolicyAccepted`), do **not** call the session-dependent
  `recordCustomerPolicyAcceptance` at signup.
- If `session` is present (confirmation OFF): finalize immediately (auto-login,
  as today). If `session` is null: show "check your inbox" and stop.
- **First-login self-heal** in `onAuthStateChange` (`SIGNED_IN`): idempotently
  ensure the profile row exists (upsert), flush any pending policy acceptance
  via `recordCustomerPolicyAcceptance`, and `startSingleDeviceSession`. This
  path already runs on every sign-in; it gains the "finish what signup deferred"
  responsibility.

### 4. Partner signup — two-phase form (P-b)

Split the single partner registration form
([apps/partner/app/(auth)/register.tsx](../../../apps/partner/app/(auth)/register.tsx))
into two phases:

**Phase 1 — create login.** Collect only email, password, contact name, and
policy acceptance. Call `createUserWithEmail` with metadata
(`display_name=contactName`, `role=customer`). No session → show "Verify your
email, then sign in to finish setting up your restaurant." Restaurant-specific
fields are removed from this screen. No logo upload here.

**Phase 2 — complete restaurant application.** After the partner verifies their
email and signs into the partner app, they land on a "Complete your restaurant
details" screen containing the restaurant fields that used to be on register
(restaurant name, cuisine, address, description, delivery time, logo,
coordinates, phone). Submitting calls the existing session-authenticated flow —
`uploadRestaurantAsset` then `submitPartnerApplication`
([apps/partner/src/services/partnerApplications.ts:18](../../../apps/partner/src/services/partnerApplications.ts)) —
which auto-approves and grants the `restaurant` role + `restaurantId`.

**Routing.** A partner who has not completed phase 2 is a `role=customer` user
with no linked restaurant. In the partner app's auth gating
([apps/partner/src/contexts/AuthContext.tsx](../../../apps/partner/src/contexts/AuthContext.tsx)
`buildNextUser`), replace the current `PARTNER_ACCESS_ERROR` for
non-`restaurant` users with: if the user has no restaurant/application, route to
the Phase 2 completion screen; keep the existing `pending`/`rejected` messages
for their respective states; keep a sign-out/back affordance. Once phase 2
succeeds and the role becomes `restaurant`, normal partner access resumes.

`AuthContext.signUp` for partner no longer submits the application or uploads
the logo (that work moves to Phase 2); it only creates the login and reports
whether the verification email was sent.

### 5. Dispatch signup - two-phase form

Split the dispatch registration flow in the same way:

**Phase 1 - create login.** Collect only email, password, rider name, phone
number, and policy acceptance. Call `createUserWithEmail` with metadata
(`display_name=riderName`, `phone=phoneNumber`, `role=customer`). No dispatch
application submission happens here. If `session` is null, show the verify-email
message and stop.

**Phase 2 - complete rider details.** After the rider verifies their email and
signs into the dispatch app, route `role=customer` users without a pending or
rejected application to a completion screen that collects region, LGA, vehicle
type, and current address. Submitting calls `submitDispatchApplication` with
the session-backed rider identity plus
`buildDispatchPolicyAcceptance('dispatch_signup')`, then routes back into the
dispatch shell once the account is live.

**Routing.** In dispatch auth gating
([apps/dispatch/src/contexts/AuthContext.tsx](../../../apps/dispatch/src/contexts/AuthContext.tsx)
`buildNextUser`), replace the current access failure for non-`dispatch` users
with the same phase-2 bridge used by partner: customer-role riders who have not
yet completed their details go to the completion screen; `pending` and
`rejected` states keep their existing messages; a sign-out/back affordance stays
visible on the completion screen.

## Error handling

- Signup surfaces only genuine server faults. "Email already registered" must
  stay indistinguishable from a fresh signup (no account enumeration), matching
  what the `auth-gateway` signup route already does.
- First-login self-heal is idempotent (upserts + pending-flag checks), so
  re-firing `SIGNED_IN` (e.g. web tab refocus) is safe and does no duplicate
  work.
- Phase 2 partner submission keeps its existing error/rollback semantics; it now
  simply runs with a guaranteed live session.

## Testing (TDD)

- **`createUserWithEmail`** (unit): returns `{ user, session }`; does not call
  `signInWithPassword`; passes metadata to `signUp`; does not throw when session
  is null.
- **`handle_new_user` trigger** (SQL/integration): inserting an `auth.users` row
  with metadata creates matching `UserAccount` + `UserRole` rows; re-running is
  idempotent; default role is `customer`.
- **Customer first-login self-heal** (unit/integration): a signed-in user with
  no profile gets one created; a pending policy acceptance is recorded exactly
  once; single-device session starts.
- **Partner phase 1** (unit): creates login with metadata, defers application,
  shows verify-email message.
- **Partner phase 2 routing** (unit): a verified `role=customer` partner-app user
  with no restaurant is routed to the completion screen; a `restaurant` user is
  not; `pending`/`rejected` states still show their messages.
- **Partner phase 2 submission** (integration): completing the form uploads the
  logo and submits the application with a session, yielding `restaurant` access.
- **Dispatch phase 1** (unit): creates login with metadata, defers application,
  shows verify-email message.
- **Dispatch phase 2 routing** (unit): a verified `role=customer` dispatch-app
  user with no application is routed to the completion screen; a `dispatch`
  user is not; `pending`/`rejected` states still show their messages.
- **Dispatch phase 2 submission** (integration): completing the form submits
  rider details with a session, yielding `dispatch` access.

## Out of scope

- Routing customer signup through the `auth-gateway` edge function (separate,
  un-deployed hardening effort).
- Phone OTP verification (paused pending Termii approval).
- Any change to the admin approval model (partner application already
  auto-approves via `submitPartnerApplication`).
