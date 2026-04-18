# EBuy Platform

This repository now uses a multi-app Expo layout so the customer, partner, and dispatch products can live in one repo while running as separate apps.

## App layout

```text
apps/
  customer/   Current customer ordering app
  partner/    Restaurant partner shell
  dispatch/   Rider and dispatch shell
packages/
  ...         Shared packages can be added here later
```

## Local development

Run each app on a different Metro port from the repo root:

```bash
npm run dev:customer
npm run dev:partner
npm run dev:dispatch
```

Default ports:

- Dispatch: `8081`
- Partner: `8082`
- Customer: `8084`

These defaults are intentional so the installed dev builds do not fight over the same Metro port.

## Current state

- `apps/customer` contains the migrated customer app.
- `apps/partner` is a minimal shell ready for partner dashboard work.
- `apps/dispatch` is a minimal shell ready for dispatch and rider flow work.
- The old top-level app folders are still present as a safety fallback while the migration settles.

## Next step after this migration

Refresh the workspace install when you're ready:

```bash
npm install
```

That will regenerate the lockfile for the new monorepo shape and make the workspace metadata fully up to date.

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

### Important note

Deploying these rules makes the Firestore security rules live. It does not publish the mobile apps to the Play Store or App Store.
