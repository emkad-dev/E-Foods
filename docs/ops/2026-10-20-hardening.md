# 2026-10-20 database + edge-cache hardening: owner steps

Prod DDL can't be run from an agent session, so these are the steps for the owner. Run them in this order.

## 1. Apply the migration (SQL editor, one run)

Supabase dashboard -> SQL Editor -> New query. Paste the whole of
`supabase/migrations/20261020c_security_hardening.sql` and click Run.

- It runs in its own `begin; ... commit;`, so if any statement fails, nothing is applied. You can run it again safely.
- What it does: removes anon/authenticated EXECUTE on `auth_rl_hit`, adds `email` + `phoneVerifiedAt` to the UserAccount guard trigger, pins `search_path` on 5 functions, makes the `notes` demo table unreachable from the Data API, caps the `promo-assets` bucket at 5 MB of jpeg/png/webp, and rewrites 13 RLS policies to use `(select auth.uid())`. The header comment lists each change and how to reverse it.
- Do NOT use `supabase db push` (see the split-RPC rollout notes).

Check it worked (same editor):

```sql
select proacl from pg_proc where oid = 'public.auth_rl_hit(text,integer,integer,integer)'::regprocedure;
-- expect only postgres and service_role, no anon/authenticated
select id, file_size_limit, allowed_mime_types from storage.buckets where id = 'promo-assets';
select count(*) from pg_policies where tablename = 'notes';  -- expect 0
```

Then Advisors -> Security Advisor -> Rerun. `function_search_path_mutable` and the `auth_rl_hit` findings should be gone. Then run the Performance Advisor: `auth_rls_initplan` should be gone too.

## 2. Reclaim net._http_response space (SQL editor, separate run)

Run this **by itself in a new query**. `VACUUM` cannot run inside a transaction, so don't paste it next to the migration.

```sql
VACUUM FULL net._http_response;
```

It takes a brief exclusive lock on that table. pg_net responses are written there, so expect a few seconds of blocked webhook/cron HTTP logging, nothing user-facing. It should give back about 190 MB. Check the size before and after:

```sql
select pg_size_pretty(pg_total_relation_size('net._http_response'));
```

## 3. Turn on Leaked Password Protection (dashboard)

Authentication -> Settings (Auth -> Settings / "Password security") -> turn on **Leaked password protection** (checks against HaveIBeenPwned) -> Save. This clears the `auth_leaked_password_protection` advisor warning.

## 4. Deploy the edge-cache Worker (when convenient)

`cloudflare/edge-cache/src/index.ts` now sends `cache-control: no-store` to clients on HIT, MISS and stale responses, and strips the internal `x-feasty-cached-at` header. The copy stored in the edge cache still has `max-age=86400`, which is what allows the 24h stale-serve fallback. Deploy the Worker the usual way (`wrangler deploy` from `cloudflare/edge-cache`).

## Known follow-up (not done here)

The admin promo image picker (`apps/admin-web`, `accept="image/*"`) still lets an admin pick GIF/HEIC/SVG files. After step 1 the bucket rejects them, and the admin sees a generic "Unable to upload this image" error. Narrow the picker to `image/jpeg,image/png,image/webp`.
