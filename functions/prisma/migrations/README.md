# Frozen Prisma migration history (historical record — do not extend)

These SQL files are the **historical** DDL that created the original core tables
(`UserAccount`, `UserRole`, `RestaurantRecord`, `CustomerOrder`, `PaymentTransaction`,
`OrderItem`, `DeliveryAssignment`, `DispatchRiderRecord`, `AdminAuditLog`, and friends).
They are kept only so the provenance of those tables stays readable, and because the
directory names here are exactly the values recorded in the production `_prisma_migrations`
table.

**Prisma itself was retired on 2026-07-30.** `schema.prisma`, `prisma.config.ts`, the
generated-client wrapper (`functions/sql.js`), and the `prisma:*` / `db:*` npm scripts and
CI steps are all gone. Nothing in this repo runs `prisma generate` or `prisma migrate deploy`
any more, and no runtime code imports `@prisma/client` — the edge functions talk to Postgres
through `supabase-js` with the service-role key.

## Where schema changes go now

`supabase/migrations/*.sql` is the single source of truth for database schema. Add a new
timestamped `.sql` file there and apply it with the Supabase CLI (or the Supabase MCP
`apply_migration`). Do not add anything to this directory.

## Why Prisma was retired rather than reconciled

The schema had drifted far enough that it was actively misleading:

- It declared four job/queue models — `QueueJob`, `OrderPlacementJob`,
  `PaymentVerificationJob`, `NotificationJob` — **none of which exist in the database**.
  The real queues are the `queue_order_placement`, `queue_payment_verification`, and
  `queue_notifications` tables created in `supabase/migrations/` and consumed by
  `supabase/functions/_shared/queue.ts`.
- It was missing eleven tables that do exist: `Promo`, `PromoEvent`, `PlatformSettings`,
  `user_profiles`, `phone_otps`, `auth_audit_log`, `auth_rate_limits`, `notes`, and the
  three `queue_*` tables.
- The repo's own plans had already stopped treating it as authoritative — see
  `docs/superpowers/plans/2026-07-17-pricing-v2-embedded-markup.md`, which says outright:
  "Do NOT touch `functions/prisma/schema.prisma` — it is not maintained for new tables".

## Known unapplied migration

`20260709_useraccount_updatedat_default` was never recorded in production's
`_prisma_migrations`, and its DDL (`ALTER TABLE "UserAccount" ALTER COLUMN "updatedAt"
SET DEFAULT CURRENT_TIMESTAMP`) is **not** present in the live database. This is cosmetic:
every writer of that column (`updateUserAccount` / `upsertUserAccount` in
`supabase/functions/app-rpc/index.ts`) sets `updatedAt` explicitly, so no code depends on
the database-side default. If you want the default anyway, add it as a new
`supabase/migrations/` file.

Three further migrations are also unrecorded in `_prisma_migrations`:

- `20260703_paymenttransaction_id_default` and `20260703_remaining_cuid_id_defaults` — their
  effects **are** live; all five `id` columns have the `(gen_random_uuid())::text` default.
- `20260701_enable_rls_exposed_tables` — only **partially** live. RLS is enabled on all
  twelve tables it names, but none of the `CREATE POLICY` statements are present (the live
  policy count on every one of those tables is zero). RLS-enabled-with-no-policies denies
  all `authenticated` access, which is the intended posture for service-role-only tables,
  but it means the customer self-read and admin-read policies this migration intended were
  never created. No `supabase/migrations/` file recreates them. Nothing appears to depend on
  them today because live updates use Realtime Broadcast rather than `postgres_changes`;
  revisit before pointing any client at these tables directly.
