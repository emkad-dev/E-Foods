# Supabase Auth Cutover

This repo now includes the first foundation pieces for a full Firebase Auth and claims exit:

- shared app-side Supabase client helpers in [`packages/auth`](./packages/auth)
- shared Expo env placeholders in [`.env.apps.example`](./.env.apps.example)
- backend/runtime env placeholders in [`functions/.env.example`](./functions/.env.example)
- SQL migration for auth profile fields, RLS, the `user_profiles` view, and the custom access token hook in [`functions/prisma/migrations/20260511_supabase_auth_foundation/migration.sql`](./functions/prisma/migrations/20260511_supabase_auth_foundation/migration.sql)

## Required Supabase setup

1. Put the app runtime values in [`.env.apps`](./.env.apps):
   - `EXPO_PUBLIC_SUPABASE_URL`
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
   - `EXPO_PUBLIC_SUPABASE_PROJECT_REF`

2. Put the backend/runtime values in [`functions/.env`](./functions/.env):
   - `SUPABASE_URL`
   - `SUPABASE_PROJECT_REF`
   - `SUPABASE_JWT_SECRET`
   - `SUPABASE_SERVICE_ROLE_KEY`

3. Apply the Prisma migration so the auth profile fields, RLS policies, `user_profiles` view, and JWT hook function exist in Postgres.

4. In Supabase dashboard, set the Custom Access Token Hook to:
   - `public.ebuy_custom_access_token_hook`

5. Keep using a single app role model:
   - `customer`
   - `restaurant`
   - `dispatch`
   - `admin`

## What still remains after this foundation

- swap the four Expo apps from Firebase Auth client flows to Supabase Auth client flows
- replace Firebase-auth-dependent Firestore profile reads with SQL / Supabase reads
- migrate backend request verification away from Firebase callable auth context
- phase out Firebase custom claims and Firestore rules as security boundaries

## Existing reminder that still matters

- add `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`, and `PAYSTACK_CALLBACK_URL` when you return to payments
