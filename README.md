# EBuy Platform

This repository is a multi-app delivery platform workspace. Customer, partner, dispatch, and admin all live in one repo, run as separate Expo apps, and now share a Supabase + Postgres backend direction.

## App layout

```text
apps/
  admin/      Internal company-only admin console
  customer/   Current customer ordering app
  partner/    Restaurant partner shell
  dispatch/   Rider and dispatch shell
packages/
  domain/     Shared role, order, and entity types
```

## Local development

Use `Node 22` for this repo. The Functions workspace explicitly targets Firebase Functions on Node 22, and the Expo/RN tooling in this monorepo is more stable there than on Node 25.

Run each app on a different Metro port from the repo root:

```bash
npm run dev:customer
npm run dev:partner
npm run dev:dispatch
npm run dev:admin
```

Default ports:

- Dispatch: `8081`
- Partner: `8082`
- Customer: `8084`
- Admin: `8085`

These defaults are intentional so the installed dev builds do not fight over the same Metro port.

The Expo start scripts load `.env.apps` automatically for:

- `npm run dev:customer`
- `npm run dev:partner`
- `npm run dev:dispatch`
- `npm run dev:admin`

## Current state

- `apps/customer` has discovery, cart, delivery location, cash checkout, and order tracking.
- `apps/partner` has store setup, validated menu management, restaurant linking, and partner order actions.
- `apps/dispatch` has live queue views, rider management, assignment, delivery-state actions, and event history.
- `apps/admin` has access oversight, restaurant approvals, in-app first-admin bootstrap, and staff-account provisioning.
- `functions/` contains the trusted backend logic, claim-based auth checks, and SQL sync/read paths.
- `packages/domain` centralizes shared role, entity, and order types used across the apps.

## Notification matrix

Push delivery now uses Expo tokens stored in `UserAccount.expoPushToken`, with Supabase Edge functions as the event source.

- Customer:
  - order paid
  - partner status updates
  - rider assigned
  - rider pickup / on-the-way / delivered
- Partner:
  - new cash order
  - paid order confirmed
  - customer cancellation
  - delivery progress updates
- Dispatch:
  - dispatch application decision
  - rider delivery assignment
  - delivery cancellation
  - pickup-ready order handoff
- Admin:
  - new partner applications
  - new dispatch applications
  - manual notification testing through the `notifications` Edge function

Notification tap routes are path-driven, so each app can deep-link directly into its order, approvals, access, or profile surface from the push payload.

## Backend model

Today the stack is:

- `Supabase Auth` for sign-in and token issuance
- `Supabase JWT claims` for privileged app access
- `Supabase Edge Functions` for trusted mutations and protected read APIs
- `Postgres via Prisma` for authority records, approvals, operational orders, riders, and audit/event history

Paystack phase 1 is now implemented in code for `card` and `bank transfer` checkout:

- customer checkout initializes a Paystack transaction from Functions
- the order stays out of partner/dispatch operations until online payment is verified
- a Paystack webhook or manual refresh confirms payment and marks the order trusted
- `wallet` remains intentionally blocked for now
- the Paystack dashboard webhook should point to:
  `https://YOUR_PROJECT_REF.supabase.co/functions/v1/paystack-webhook`

This still needs env setup plus live Edge Function deployment before it becomes usable.

## First admin bootstrap

The backend now includes a one-time bootstrap callable for the very first admin account, and the admin app exposes it at `/(auth)/bootstrap`.

Set:

```bash
BOOTSTRAP_ADMIN_EMAILS=admin@example.com
PAYSTACK_SECRET_KEY=sk_test_your_secret_key_here
PAYSTACK_PUBLIC_KEY=pk_test_xxxxxxxxxxxxxxxxxxxxxxxx
PAYSTACK_CALLBACK_URL=https://your-web-app-or-confirmation-page.example.com/payment-return
```

Then sign in with that Supabase Auth account and call the `bootstrapFirstAdmin` function once. After the first admin exists, normal admin-managed role assignment should be used instead.

## End-to-end sandbox runbook

Use this order to exercise the whole platform as a real sandbox:

1. Start the apps:

```bash
npm run dev:customer
npm run dev:partner
npm run dev:dispatch
npm run dev:admin
```

2. Bootstrap the first admin in the admin app:
   - Open the admin app
   - Go to the bootstrap route from the auth flow
   - Sign in with an email allowed by `BOOTSTRAP_ADMIN_EMAILS`

3. Provision staff accounts from the admin Access tab:
   - create a `restaurant` account for partner
   - create a `dispatch` account for dispatch
   - create extra `admin` accounts if needed

4. Use the partner app:
   - sign in with the provisioned partner account
   - create or link a restaurant
   - add menu categories and meals

5. Use the admin app again:
   - approve and publish the partner restaurant

6. Use the dispatch app:
   - sign in with the provisioned dispatch account
   - create one or more rider profiles

7. Use the customer app:
   - sign up as a normal customer
   - browse the approved restaurant
   - add items to cart
   - choose delivery or pickup
   - place a cash order

8. Finish the handoff loop:
   - partner accepts and prepares the order
   - dispatch assigns a rider and moves delivery through pickup, on-the-way, and delivered
   - customer order tracking updates as the order progresses

## Supabase and SQL deploy flow

### Environment

Edge Functions need both Supabase project config and a live Postgres connection:

```bash
# Runtime traffic through Supavisor connection pooling:
DATABASE_URL=postgresql://USER.PROJECT_REF:URL_ENCODED_PASSWORD@REGION.pooler.supabase.com:6543/postgres?pgbouncer=true

# Migration traffic:
DIRECT_URL=postgresql://USER.PROJECT_REF:URL_ENCODED_PASSWORD@REGION.pooler.supabase.com:5432/postgres

# Pure direct connection only when your environment supports IPv6 or your Supabase project has the IPv4 Add-On:
# DIRECT_URL=postgresql://USER:URL_ENCODED_PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres?sslmode=require

BOOTSTRAP_ADMIN_EMAILS=admin@example.com
PAYSTACK_SECRET_KEY=sk_test_your_secret_key_here
PAYSTACK_PUBLIC_KEY=pk_test_xxxxxxxxxxxxxxxxxxxxxxxx
PAYSTACK_CALLBACK_URL=https://your-web-app-or-confirmation-page.example.com/payment-return
```

The checked-in example lives in [`functions/.env.example`](/c:/Users/emkad/EBuy/E-Foods/functions/.env.example).

### Prisma

After setting `DATABASE_URL`, generate the Prisma client and apply your migration flow before deploying functions:

```bash
cd functions
npm run db:doctor
npm run prisma:generate
npx prisma migrate deploy
```

Apply the SQL migration with your preferred Prisma migration command in the environment that hosts Postgres.

## Important notes

- Apply Supabase database migrations before relying on newly added SQL-backed records and views in production.
- If `DATABASE_URL` is missing in the environment that runs Prisma migrations, SQL-backed features will fail by design rather than silently falling back to weaker authority paths.

## Exact follow-up

The repo has been cut over on the app side, but two backend items still need to be finished before the migration is complete.

Do these next:

1. Add `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`, and `PAYSTACK_CALLBACK_URL` to `functions/.env` and the live backend environment before resuming payment testing.
2. Get `npm run db:migrate:deploy` through against Supabase so the authored Prisma migrations are actually applied to the live database.
3. Confirm the latest SQL migrations are live, especially:
   - `RestaurantRecord.menu` for customer discovery and restaurant detail
   - `DispatchRiderRecord.region`, `DispatchRiderRecord.lga`, `DispatchRiderRecord.phoneNumber`, and `DispatchRiderRecord.currentAddress` for the native dispatch rider path
4. Apply the latest application-record migration (`20260514_application_records`) on the live Supabase database before using the native approval and offboarding flows in production.
5. Rerun the full sandbox flow end to end:
   - bootstrap first admin
   - provision partner and dispatch
   - create restaurant and menu
   - approve restaurant
   - create rider
   - place customer order
   - move order through partner and dispatch to delivered

### Exact reminder

Before you move on, the tracked backlog is:

1. add `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`, and `PAYSTACK_CALLBACK_URL`
2. deploy `paystack-webhook` and `payment-verification`
3. fix `npm run db:migrate:deploy` on Supabase and apply the live migrations
4. confirm the new `DispatchRiderRecord` SQL fields are applied live
5. apply the latest application-record migration (`20260514_application_records`) on Supabase before using the native approval and offboarding flows live
6. rerun the full sandbox flow end to end
