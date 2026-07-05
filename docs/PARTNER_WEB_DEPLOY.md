# Partner web deployment (partner.feasty.com.ng)

The FEASTY partner app (`apps/partner`) is an Expo Router app that also ships as a
web back-office dashboard. On web it renders a desktop sidebar shell at
`width >= 1024` and bottom tabs on narrow viewports (see
`apps/partner/app/(partner)/_layout.tsx`).

This doc covers the one-time setup to host it at **`partner.feasty.com.ng`**.
It is deployed on **Vercel**, mirroring `apps/admin-web`, but built with
`expo export --platform web` (a static `dist/`) instead of Vite.

## How the build works

- `apps/partner/package.json` → `build:web` runs
  `expo export --platform web` (through `scripts/run-expo-with-root-env.cjs`,
  which loads `.env.apps` + the app `.env` and the hoisted root `node_modules`).
  Output goes to `apps/partner/dist/`.
- `apps/partner/vercel.json` tells Vercel to run `npm run build:web`, serve
  `dist/`, and rewrite all unmatched paths to `/index.html` (SPA routing).
- CI (`.github/workflows/ci.yml`) typechecks the app (`typecheck:partner`) and
  runs the export (`build:partner`) so a broken web build fails the PR.

> **Why not `working-directory: ./apps/partner` like admin-web?**
> Partner imports shared workspace packages (`packages/auth`, `packages/domain`)
> and uses hoisted root `node_modules`. Deploying only the `apps/partner` folder
> would break resolution, so the Vercel build must run with the **repo root** as
> context and the project's **Root Directory** set to `apps/partner`.

## One-time Vercel project setup

1. Create a **new Vercel project** (separate from admin-web) linked to this repo.
2. Project → Settings → **General**:
   - **Root Directory:** `apps/partner`
   - Enable **"Include source files outside of the Root Directory in the Build
     Step."** (Required — pulls in `packages/*` and the root lockfile/workspace so
     `npm install` runs at the repo root.)
   - **Framework Preset:** Other (the repo `vercel.json` already sets
     `framework: null`, `buildCommand`, and `outputDirectory`).
3. Project → Settings → **Environment Variables** — add the same
   `EXPO_PUBLIC_*` values the app reads (see `apps/partner/src/config/env.ts`):
   - `EXPO_PUBLIC_SUPABASE_URL`
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
   - `EXPO_PUBLIC_SUPABASE_PROJECT_REF`
   - `EXPO_PUBLIC_BACKEND_RPC_URL`
   - (optional) `EXPO_PUBLIC_FUNCTIONS_REGION`, `EXPO_PUBLIC_PROJECT_ID`
4. Copy the project's **Project ID** into a GitHub Actions secret named
   **`VERCEL_PROJECT_ID_PARTNER`**. The existing `VERCEL_TOKEN` and
   `VERCEL_ORG_ID` secrets are reused. The deploy step in
   `.github/workflows/deploy.yml` runs on every push to `main` and is a no-op
   until `VERCEL_PROJECT_ID_PARTNER` is set.

## DNS: map partner.feasty.com.ng (Bunny)

`feasty.com.ng` is registered at DomainKing with nameservers delegated to
**Bunny DNS**, so the record is added in the Bunny DNS zone (not DomainKing).

1. In Vercel: Partner project → Settings → **Domains** → add
   `partner.feasty.com.ng`. Vercel shows the target CNAME
   (`cname.vercel-dns.com`).
2. In the **Bunny DNS** zone for `feasty.com.ng`, add:

   | Type  | Name / Host | Value                  | TTL  |
   |-------|-------------|------------------------|------|
   | CNAME | `partner`   | `cname.vercel-dns.com` | 3600 |

   (If Bunny rejects a CNAME for a subdomain, use the A/ALIAS target Vercel
   shows for apex-style records — a CNAME on a subdomain is normally fine.)
3. Back in Vercel, wait for the domain to verify and issue the TLS cert.

Once verified, production deploys land at **https://partner.feasty.com.ng**.

## Local verification

```bash
# from the repo root
npm run typecheck:partner
npm run lint:partner
npm run build:partner   # produces apps/partner/dist
```
