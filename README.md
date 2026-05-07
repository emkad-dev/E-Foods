# EBuy Platform

This repository is a multi-app delivery platform workspace. Customer, partner, dispatch, and admin all live in one repo, runs as separate Expo apps, and share a hardened Firebase + SQL hybrid backend direction.

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

## Current state

- `apps/customer` has discovery, cart, delivery location, cash checkout, and order tracking.
- `apps/partner` has store setup, validated menu management, restaurant linking, and partner order actions.
- `apps/dispatch` has live queue views, rider management, assignment, delivery-state actions, and event history.
- `apps/admin` has access oversight, restaurant approvals, in-app first-admin bootstrap, and staff-account provisioning.
- `functions/` contains the trusted backend logic, claim-based auth checks, and SQL sync/read paths.
- `packages/domain` centralizes shared role, entity, and order types used across the apps.

## Backend model

Today the stack is:

- `Firebase Auth` for sign-in and token issuance
- `Firebase custom claims` for privileged app access
- `Firestore` for profile/session metadata and realtime mirrors
- `Cloud Functions` for trusted mutations and protected read APIs
- `Postgres via Prisma` for authority records, approvals, operational orders, riders, and audit/event history

Payment provider integration is intentionally not live yet. Card and wallet remain blocked until that work is completed properly.

## First admin bootstrap

The backend now includes a one-time bootstrap callable for the very first admin account, and the admin app exposes it at `/(auth)/bootstrap`.

Set:

```bash
BOOTSTRAP_ADMIN_EMAILS=admin@example.com
```

Then sign in with that Firebase Auth account and call the `bootstrapFirstAdmin` function once. After the first admin exists, normal admin-managed role assignment should be used instead.

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

## Firebase and SQL deploy flow

### Environment

Functions need both Firebase project config and a live Postgres connection:

```bash
# Runtime traffic through Supavisor connection pooling:
DATABASE_URL=postgresql://USER.PROJECT_REF:URL_ENCODED_PASSWORD@REGION.pooler.supabase.com:6543/postgres?pgbouncer=true

# Migration traffic:
DIRECT_URL=postgresql://USER.PROJECT_REF:URL_ENCODED_PASSWORD@REGION.pooler.supabase.com:5432/postgres

# Pure direct connection only when your environment supports IPv6 or your Supabase project has the IPv4 Add-On:
# DIRECT_URL=postgresql://USER:URL_ENCODED_PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres?sslmode=require

BOOTSTRAP_ADMIN_EMAILS=admin@example.com
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

## Firestore Rules Deploy Flow

The repo already points Firebase CLI at the Firestore rules file in [`firebase.json`](/c:/Users/emkad/EBuy/E-Foods/firebase.json) and the rules live in [`firestore.rules`](/c:/Users/emkad/EBuy/E-Foods/firestore.rules).

### One-time setup

1. Install Firebase CLI if you do not already have it:

```bash
npm install -g firebase-tools
```

2. Sign in:

```bash
firebase login
```

3. Connect this repo to your Firebase project:

Option A: copy [` .firebaserc.example`](/c:/Users/emkad/EBuy/E-Foods/.firebaserc.example) to `.firebaserc` and replace `your-firebase-project-id` with the real project id.

Option B: skip `.firebaserc` and pass the project each time with `FIREBASE_PROJECT_ID`.

### Deploy commands

If `.firebaserc` exists:

```bash
npm run firebase:rules:deploy
```

If you prefer using an environment variable on Windows `cmd`:

```cmd
set FIREBASE_PROJECT_ID=your-firebase-project-id&& npm run firebase:rules:deploy:project
```

If you want extra CLI detail while checking the deploy:

```bash
npm run firebase:rules:dryrun
```

### Recommended exact flow

```bash
firebase login
copy .firebaserc.example .firebaserc
```

Then edit `.firebaserc` and run:

```bash
npm run firebase:rules:deploy
```

## Important notes

- Deploying Firestore rules makes the security rules live. It does not publish the mobile apps.
- Deploying functions is required before the new SQL-backed read models, role bootstrap, rider APIs, and hardened mutation guards are live.
- If `DATABASE_URL` is missing in the deployed Functions environment, SQL-backed callables will fail by design rather than silently falling back to weaker authority paths.

## Exact follow-up if you are skipping billing for now

You can still prepare almost everything locally, but the backend will not fully go live until billing is enabled on the Firebase project.

Do these next:

1. Create the Firebase project and turn on:
   - Authentication
   - Firestore Database
   - Cloud Functions

2. Create a Postgres database and keep the connection strings ready as:

```bash
DATABASE_URL=postgresql://USER.PROJECT_REF:PASSWORD@REGION.pooler.supabase.com:6543/postgres?pgbouncer=true
DIRECT_URL=postgresql://USER.PROJECT_REF:PASSWORD@REGION.pooler.supabase.com:5432/postgres
```

3. Copy the Firebase project id into `.firebaserc` from `.firebaserc.example`.

4. Set Functions environment values before deploy:
   - `DATABASE_URL`
   - `BOOTSTRAP_ADMIN_EMAILS`

5. Apply the Prisma migration flow against the Postgres database from `functions/`.

6. Install Firebase CLI and sign in:

```bash
firebase login
```

7. When you are ready to stop skipping billing, do this exact release order:

```bash
firebase deploy --only functions
firebase deploy --only firestore:rules
```

8. Restart the four apps and run the sandbox loop:
   - bootstrap first admin
   - provision partner and dispatch
   - create restaurant and menu
   - approve restaurant
   - create rider
   - place customer cash order
   - move order through partner and dispatch to delivered

### Exact reminder

If you skip billing now, remember to come back and do these four things in this order:

1. enable Firebase billing / Blaze
2. deploy Functions
3. deploy Firestore rules
4. rerun the full sandbox flow end to end
