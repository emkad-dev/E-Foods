# FEASTy Platform

FEASTy is a multi-app food delivery workspace. Customer, partner, dispatch, and admin all live in one repo, run as separate Expo apps, and share a Supabase and Postgres backend.

## App Layout

```text
apps/
  admin/      Internal admin web console
  customer/   Customer ordering app
  partner/    Restaurant partner shell
  dispatch/   Rider and dispatch shell
packages/
  domain/     Shared role, order, and entity types
```

## Local Development

Use Node 22 for this repo. The Expo and React Native tooling is most stable there.

Run each app from the repo root on its own Metro port:

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
- Admin web console: `8085`

The admin console is web-only. `npm run dev:admin` opens the browser console, and there is no supported native admin build.

The Expo start scripts load `.env.apps` automatically for all four app commands.

## Current Product Surface

- `apps/customer` covers discovery, cart, delivery location, card and bank-transfer checkout, and order tracking.
- `apps/partner` covers store setup, menu management, restaurant linking, and partner order actions.
- `apps/dispatch` covers rider management, assignment, delivery-state actions, and live queue views.
- `apps/admin` covers access oversight, restaurant approvals, browser-only first-admin bootstrap, and staff provisioning.
- `functions/` contains trusted backend logic, claim-based auth checks, and SQL sync and read paths.
- `packages/domain` centralizes shared role, entity, and order types used across the apps.

## Notification Matrix

Push delivery uses Expo tokens stored in `UserAccount.expoPushToken`, with Supabase Edge Functions as the event source.

- Customer:
  - Order paid
  - Partner status updates
  - Rider assigned
  - Rider pickup, on-the-way, and delivered
- Partner:
  - New cash order
  - Paid order confirmed
  - Customer cancellation
  - Delivery progress updates
- Dispatch:
  - Dispatch application decision
  - Rider delivery assignment
  - Delivery cancellation
  - Pickup-ready order handoff
- Admin:
  - New partner applications
  - New dispatch applications
  - Manual notification testing through the `notifications` Edge Function

Notification tap routes are path-driven, so each app can deep-link into the correct order, approvals, access, or profile surface.

## Backend Model

The current stack is:

- `Supabase Auth` for sign-in and token issuance
- `Supabase JWT claims` for privileged app access
- `Supabase Edge Functions` for trusted mutations and protected read APIs
- `Postgres via Prisma` for authority records, approvals, operational orders, riders, and audit history

Paystack phase 1 is implemented in code for `card` and `bank transfer` checkout:

- Customer checkout initializes a Paystack transaction from Functions
- The order stays out of partner and dispatch operations until payment is verified
- A Paystack webhook or manual refresh confirms payment and marks the order trusted
- `wallet` remains blocked for now
- The Paystack dashboard webhook should point to:
  `https://rgfbheorvtolixdcpjhy.supabase.co/functions/v1/paystack-webhook`

This still needs environment setup and live Edge Function deployment before it becomes usable.

## First Admin Bootstrap

The backend includes a one-time bootstrap callable for the first admin account, and the admin web console exposes it at `/(auth)/bootstrap`.

Set:

```bash
BOOTSTRAP_ADMIN_EMAILS=admin@example.com
PAYSTACK_SECRET_KEY=sk_test_your_secret_key_here
PAYSTACK_PUBLIC_KEY=pk_test_your_public_key_here
PAYSTACK_CALLBACK_URL=https://feasty.com/payment/callback
```

Then sign in with the allowed Supabase Auth account and call `bootstrapFirstAdmin` once. After the first admin exists, use normal admin-managed role assignment.

## End-to-End Sandbox Runbook

Use this order to exercise the whole platform in a realistic sandbox:

1. Start the apps:

```bash
npm run dev:customer
npm run dev:partner
npm run dev:dispatch
npm run dev:admin
```

2. Bootstrap the first admin in the admin web console:
   - Open the admin web console in a browser
   - Go to the bootstrap route from the auth flow
   - Sign in with an email allowed by `BOOTSTRAP_ADMIN_EMAILS`

3. Provision staff accounts from the admin Access tab:
   - Create a `restaurant` account for partner
   - Create a `dispatch` account for dispatch
   - Create extra `admin` accounts if needed

4. Use the partner app:
   - Sign in with the provisioned partner account
   - Create or link a restaurant
   - Add menu categories and meals

5. Use the admin web console again:
   - Approve and publish the partner restaurant

6. Use the dispatch app:
   - Sign in with the provisioned dispatch account
   - Create one or more rider profiles

7. Use the customer app:
   - Sign up as a normal customer
   - Browse the approved restaurant
   - Add items to cart
   - Choose delivery or pickup
   - Place a customer order

8. Finish the handoff loop:
   - Partner accepts and prepares the order
   - Dispatch assigns a rider and moves delivery through pickup, on-the-way, and delivered
   - Customer tracking updates as the order progresses

## Supabase and SQL Deploy Flow

Edge Functions need both Supabase project config and a live Postgres connection:

```bash
# Runtime traffic through Supavisor connection pooling:
DATABASE_URL=postgresql://USER.PROJECT_REF:URL_ENCODED_PASSWORD@REGION.pooler.supabase.com:6543/postgres?pgbouncer=true

# Migration traffic:
DIRECT_URL=postgresql://USER.PROJECT_REF:URL_ENCODED_PASSWORD@REGION.pooler.supabase.com:5432/postgres

# Direct connection only when your environment supports IPv6 or the Supabase project has the IPv4 add-on:
# DIRECT_URL=postgresql://USER:URL_ENCODED_PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres?sslmode=require

BOOTSTRAP_ADMIN_EMAILS=admin@example.com
PAYSTACK_SECRET_KEY=sk_test_your_secret_key_here
PAYSTACK_PUBLIC_KEY=pk_test_your_public_key_here
PAYSTACK_CALLBACK_URL=https://feasty.com/payment/callback
```

The checked-in example lives in [`functions/.env.example`](functions/.env.example).

After setting `DATABASE_URL`, generate the Prisma client and deploy the migrations before releasing backend changes:

```bash
cd functions
npm run db:doctor
npm run prisma:generate
npx prisma migrate deploy
```

## Important Notes

- Apply Supabase database migrations before relying on SQL-backed records and views in production.
- If `DATABASE_URL` is missing in the environment that runs Prisma migrations, SQL-backed features will fail instead of falling back to a weaker authority path.

## Launch Docs

See the launch planning docs in [`docs/launch/`](docs/launch/README.md) for the MVP scope, marketing plan, legal plan, and publishing follow-up checklist.

The backend still needs a final pass before launch:

1. Add `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`, and `PAYSTACK_CALLBACK_URL` to `functions/.env` and the live backend environment.
2. Deploy `paystack-webhook` and `payment-verification`.
3. Fix `npm run db:migrate:deploy` on Supabase and apply the live migrations.
4. Confirm the new `DispatchRiderRecord` SQL fields are applied live.
5. Apply the latest application-record migration (`20260514_application_records`) on Supabase before using the native approval and offboarding flows live.
6. Rerun the full sandbox flow end to end.
## Realtime updates

Order, rider, and restaurant screens refresh over Supabase Realtime Broadcast instead of tight polling. Edge functions publish best-effort "changed" signals after every relevant mutation (see `supabase/functions/_shared/realtime.ts`), and the apps subscribe through `packages/auth/src/realtime.ts`:

- `order-{orderId}` — order detail screens (customer, partner, dispatch)
- `orders` — partner kitchen queue and dispatch delivery queue
- `dispatch-riders` — dispatch fleet views
- `restaurants` — partner restaurant context (approvals, profile, menu)

Payloads are contentless refresh pokes (`{ orderId, restaurantId? }`); clients refetch through the existing RPC read models, so no data access rules change. Every hook keeps a slow 30–60s polling fallback in case the websocket drops silently. Broadcast is enabled by default on Supabase projects — no database or dashboard configuration is required, but the updated functions must be deployed:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\deploy-realtime-email-functions.ps1
```

## Transactional email

Order confirmation (cash checkout) and payment receipt (Paystack) emails are sent from Edge functions via Resend (`supabase/functions/_shared/email.ts`). Email is best-effort: when `RESEND_API_KEY` is missing the send is skipped with a warning and order flows are unaffected.

Set the secrets on the project:

```bash
supabase secrets set RESEND_API_KEY=re_xxx --project-ref YOUR_PROJECT_REF
supabase secrets set "TRANSACTIONAL_EMAIL_FROM=FEASTy <orders@yourdomain.com>" --project-ref YOUR_PROJECT_REF
```

`TRANSACTIONAL_EMAIL_FROM` defaults to Resend's onboarding sender, which only delivers to the Resend account owner's inbox — verify a domain in Resend and set a real sender before launch.

