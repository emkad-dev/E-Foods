# Partner Onboarding Stages 1–2 (Schema + Reviewed Approval) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the database foundation for partner KYC/payout/hours, then stop
`submitPartnerApplication` from auto-approving restaurants so the already-built
admin review becomes the only path to the `restaurant` role.

**Architecture:** Stage 1 is additive schema plus behaviour-preserving backfills —
nothing user-visible changes. Stage 2 flips the submit RPC to write `pending`,
removes the self-publish of `RestaurantRecord` and the self-grant of the
`restaurant` role, and routes pending applicants to an "under review" screen.
Decision logic is extracted into small pure modules so it can be unit-tested
without a database or a running edge function, matching how
`supabase/functions/_shared/pricing.ts` and
`apps/partner/src/contexts/partnerAuthFlow.ts` are already tested.

**Tech Stack:** Postgres (Supabase, Frankfurt), Supabase SQL migrations
(`supabase/migrations`), Deno edge functions (`supabase/functions/app-rpc`), Expo /
React Native partner app (`apps/partner`), `node --test` and `deno test`.

> **Amended 2026-07-31 (execution):** this plan was written against Prisma, which
> was retired on 2026-07-30 in `a193b1d`. `functions/prisma/schema.prisma`,
> `prisma.config.ts` and the `db:*` npm scripts no longer exist, and
> `functions/prisma/migrations/` is a frozen archive whose README says not to
> extend it. Task 1 is therefore removed, and Tasks 2–3 now write flat
> `supabase/migrations/<YYYYMMDD>_<name>.sql` files applied with the Supabase CLI
> or the Supabase MCP `apply_migration`. Task numbering is unchanged so the
> cross-references in Task 6 and the Self-Review Notes still resolve.

**Spec:** `docs/superpowers/specs/2026-07-31-partner-onboarding-kyc-payout-design.md`

## Global Constraints

- Design source of truth is the spec above. Stages 3–7 are **out of scope** for
  this plan: no address module, no NIN capture, no payout capture, no Paystack
  split, no forced re-verification cutover.
- **Do not enable the geo-gate in this plan.** Per spec §13, 5 of 6 published
  restaurants have null coordinates; filtering them out would cut the customer
  catalog to 1 restaurant. `public-catalog` is not modified here.
- New tables are **service-role only**: `ENABLE ROW LEVEL SECURITY` with **no
  policies**, per `docs/rls-posture.md`.
- All schema changes are **additive**. No column is dropped or renamed, and
  `cuisine`, `openingTime`, `closingTime` are retained for backward compatibility.
- Existing approvals are preserved: a restaurant that is already
  `isPublished = true` with an `approved` `RestaurantApproval` must remain exactly
  so after every migration in this plan.
- Migrations live in `supabase/migrations/<YYYYMMDD>_<name>.sql`, matching the
  existing convention (e.g. `20260717_platform_settings_pricing.sql`). Nothing is
  added to `functions/prisma/migrations/` — it is a frozen archive.
- New test files must be **added to the explicit file lists** in the root
  `package.json` `test:node` / `test:deno` scripts, or they will never run.
- Error messages returned to clients follow the existing `ClientSafeError`
  convention: generic to the client, detail logged server-side.
- Verify `git status` immediately before each commit — multiple Claude sessions
  work in this repo concurrently. Commit only the files listed in the task.

---

## File Structure

**Created:**
- `supabase/migrations/20260731_partner_kyc_payout_hours.sql` —
  DDL for the three new tables, the additive `RestaurantRecord` columns, and RLS.
- `supabase/migrations/20260731_partner_onboarding_backfills.sql` —
  behaviour-preserving backfills for hours, cuisines, formattedAddress.
- `scripts/audit-partner-readiness.sql` — re-runnable readiness audit (spec §13).
- `supabase/functions/_shared/partnerApplicationTransitions.ts` — pure decision
  logic for what a submit does given the current application status.
- `supabase/functions/_shared/partnerApplicationTransitions.test.ts` — its tests.
- `apps/partner/app/(partner)/application-under-review.tsx` — the pending screen.

**Modified:**
- `supabase/functions/app-rpc/index.ts` — `submitPartnerApplication` handler.
- `apps/partner/src/contexts/partnerAuthFlow.ts` — add `resolvePartnerLandingRoute`.
- `apps/partner/src/contexts/partnerAuthFlow.test.ts` — its tests.
- `apps/partner/app/(partner)/_layout.tsx:170-176` — route pending applicants.
- `apps/partner/app/(partner)/complete-restaurant-details.tsx` — post-submit
  behaviour (no dashboard handoff).
- `apps/partner/src/services/partnerApplications.ts` — response type.
- `package.json` — register the two new test files.

---

## Task 1: REMOVED — Prisma was retired before this plan ran

There is no ORM schema to update. `functions/prisma/schema.prisma` was deleted in
`a193b1d` (2026-07-30) because it had drifted from the live database and nothing
consumed the generated client; `supabase/migrations/*.sql` is now the single
source of truth for schema. The models this task described are expressed directly
as the DDL in Task 2, which is the only artifact the database ever saw anyway.

- [x] **Nothing to do. Proceed to Task 2.**

---

## Task 2: DDL migration with RLS

**Files:**
- Create: `supabase/migrations/20260731_partner_kyc_payout_hours.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: tables `RestaurantKyc`, `RestaurantPayout`, `RestaurantHours` and the
  new `RestaurantRecord` columns, live in Postgres. Task 3 backfills them.

- [x] **Step 1: Write the migration**

Create `supabase/migrations/20260731_partner_kyc_payout_hours.sql`:

```sql
-- Partner onboarding stage 1: KYC, payout, and per-day trading hours.
--
-- Access model: these three tables are service-role only. All reads and writes
-- go through Edge Functions using the service_role key, which BYPASSES RLS.
-- RLS is enabled with NO policies so nothing is reachable through the Data API
-- or Realtime. See docs/rls-posture.md.
--
-- RestaurantKyc holds national ID data. It must never be exposed to the Data API
-- and its image columns hold storage PATHS, never public URLs.

-- =====================================================================
-- RestaurantKyc
-- =====================================================================
CREATE TABLE IF NOT EXISTS "public"."RestaurantKyc" (
  "id"            TEXT PRIMARY KEY,
  "uid"           TEXT NOT NULL UNIQUE,
  "restaurantId"  TEXT,
  "legalName"     TEXT NOT NULL,
  "ninNumber"     TEXT,
  "ninLast4"      TEXT NOT NULL,
  "ninHash"       TEXT NOT NULL,
  "ninFrontPath"  TEXT NOT NULL,
  "ninBackPath"   TEXT NOT NULL,
  "verification"  TEXT NOT NULL DEFAULT 'manual',
  "verifiedByUid" TEXT,
  "verifiedAt"    TIMESTAMP(3),
  "reviewNotes"   TEXT,
  "purgedAt"      TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "RestaurantKyc_restaurantId_idx"
  ON "public"."RestaurantKyc" ("restaurantId");

ALTER TABLE "public"."RestaurantKyc" ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- RestaurantPayout
-- =====================================================================
CREATE TABLE IF NOT EXISTS "public"."RestaurantPayout" (
  "id"                     TEXT PRIMARY KEY,
  "uid"                    TEXT NOT NULL UNIQUE,
  "restaurantId"           TEXT,
  "bankCode"               TEXT NOT NULL,
  "bankName"               TEXT NOT NULL,
  "accountNumber"          TEXT NOT NULL,
  "accountLast4"           TEXT NOT NULL,
  "resolvedAccountName"    TEXT NOT NULL,
  "paystackSubaccountCode" TEXT,
  "status"                 TEXT NOT NULL DEFAULT 'pending',
  "lastError"              TEXT,
  "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "RestaurantPayout_restaurantId_idx"
  ON "public"."RestaurantPayout" ("restaurantId");
CREATE INDEX IF NOT EXISTS "RestaurantPayout_status_idx"
  ON "public"."RestaurantPayout" ("status");

ALTER TABLE "public"."RestaurantPayout" ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- RestaurantHours  (7 rows per restaurant; 0 = Sunday .. 6 = Saturday)
-- =====================================================================
CREATE TABLE IF NOT EXISTS "public"."RestaurantHours" (
  "id"           TEXT PRIMARY KEY,
  "restaurantId" TEXT NOT NULL,
  "dayOfWeek"    INTEGER NOT NULL,
  "isClosed"     BOOLEAN NOT NULL DEFAULT false,
  "opensAt"      TEXT,
  "closesAt"     TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RestaurantHours_restaurantId_fkey"
    FOREIGN KEY ("restaurantId") REFERENCES "public"."RestaurantRecord" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RestaurantHours_dayOfWeek_check"
    CHECK ("dayOfWeek" >= 0 AND "dayOfWeek" <= 6)
);

CREATE UNIQUE INDEX IF NOT EXISTS "RestaurantHours_restaurantId_dayOfWeek_key"
  ON "public"."RestaurantHours" ("restaurantId", "dayOfWeek");

ALTER TABLE "public"."RestaurantHours" ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- RestaurantRecord additive columns
-- =====================================================================
ALTER TABLE "public"."RestaurantRecord"
  ADD COLUMN IF NOT EXISTS "cuisines"                 TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "customCuisine"            TEXT,
  ADD COLUMN IF NOT EXISTS "customCuisineStatus"      TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "formattedAddress"         TEXT,
  ADD COLUMN IF NOT EXISTS "addressComponents"        JSONB,
  ADD COLUMN IF NOT EXISTS "buildingInfo"             TEXT,
  ADD COLUMN IF NOT EXISTS "deliveryNotes"            TEXT,
  ADD COLUMN IF NOT EXISTS "detailsConfirmedAt"       TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reverificationStatus"     TEXT NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS "reverificationDueAt"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reverificationNotifiedAt" TIMESTAMP(3);
```

- [x] **Step 2: Confirm the target database state before applying**

Run against the project (Supabase MCP `execute_sql`):

```sql
SELECT COUNT(*) AS total,
       COUNT(*) FILTER (WHERE "isPublished") AS published
FROM "RestaurantRecord";
```

Record the numbers. Step 5 asserts they are unchanged.

- [ ] **Step 3: Apply the migration**

Apply the file with the Supabase MCP `apply_migration` (name
`20260731_partner_kyc_payout_hours`), or `npx supabase db push` if working from
the CLI. Expected: applied with no error. The DDL is idempotent
(`IF NOT EXISTS` throughout), so a re-run is safe.

- [ ] **Step 4: Verify the tables exist, are RLS-enabled, and have no policies**

Run this against the project (Supabase SQL editor or MCP `execute_sql`):

```sql
SELECT c.relname AS table_name,
       c.relrowsecurity AS rls_enabled,
       COUNT(p.polname) AS policy_count
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_policy p ON p.polrelid = c.oid
WHERE n.nspname = 'public'
  AND c.relname IN ('RestaurantKyc', 'RestaurantPayout', 'RestaurantHours')
GROUP BY c.relname, c.relrowsecurity
ORDER BY c.relname;
```

Expected: three rows, `rls_enabled = true`, `policy_count = 0` for each.

- [ ] **Step 5: Verify existing restaurants are untouched**

```sql
SELECT COUNT(*) AS total,
       COUNT(*) FILTER (WHERE "isPublished") AS published
FROM "RestaurantRecord";
```

Expected: `total = 6`, `published = 6` — unchanged from the spec §13 audit. If
either number moved, stop and investigate before continuing.

- [x] **Step 6: Commit**

```bash
git add supabase/migrations/20260731_partner_kyc_payout_hours.sql
git commit -m "feat(db): create KYC, payout, and hours tables with RLS enabled"
```

---

## Task 3: Behaviour-preserving backfills

**Files:**
- Create: `supabase/migrations/20260731_partner_onboarding_backfills.sql`

**Interfaces:**
- Consumes: the tables and columns from Task 2.
- Produces: every existing restaurant has 7 `RestaurantHours` rows, a populated
  `cuisines` array, and a `formattedAddress`. No behaviour changes.

- [x] **Step 1: Write the backfill migration**

Create `supabase/migrations/20260731_partner_onboarding_backfills.sql`:

```sql
-- Partner onboarding stage 1 backfills. All are behaviour-preserving:
-- existing values are copied forward, never invented.
--
-- Coordinates are deliberately NOT backfilled here. Per the spec audit,
-- 5 of 6 published restaurants have null coordinates; they are geocoded or
-- re-pinned in a later stage. The geo-gate stays off until that is done.

-- Hours: seed 7 days per restaurant from the existing single open/close pair.
-- isClosed = false everywhere, so a restaurant open 08:00-22:00 today keeps
-- exactly those hours on every day, and its "open now" result is unchanged.
INSERT INTO "public"."RestaurantHours" ("id", "restaurantId", "dayOfWeek", "isClosed", "opensAt", "closesAt")
SELECT
  gen_random_uuid()::text,
  r."id",
  d."dayOfWeek",
  false,
  r."openingTime",
  r."closingTime"
FROM "public"."RestaurantRecord" r
CROSS JOIN generate_series(0, 6) AS d("dayOfWeek")
ON CONFLICT ("restaurantId", "dayOfWeek") DO NOTHING;

-- Cuisines: single string -> array. Empty string and NULL both become '{}'.
UPDATE "public"."RestaurantRecord"
SET "cuisines" = ARRAY["cuisine"]
WHERE "cuisine" IS NOT NULL
  AND "cuisine" <> ''
  AND COALESCE(array_length("cuisines", 1), 0) = 0;

-- Formatted address: seed from the existing free-text address.
UPDATE "public"."RestaurantRecord"
SET "formattedAddress" = "address"
WHERE "formattedAddress" IS NULL
  AND "address" IS NOT NULL
  AND "address" <> '';
```

- [ ] **Step 2: Apply the migration**

Apply the file with the Supabase MCP `apply_migration` (name
`20260731_partner_onboarding_backfills`), or `npx supabase db push`.
Expected: applied with no error. The inserts are `ON CONFLICT DO NOTHING` and the
updates are guarded, so a re-run is a no-op.

- [ ] **Step 3: Verify the backfill is correct and complete**

```sql
SELECT
  (SELECT COUNT(*) FROM "RestaurantHours") AS hours_rows,
  (SELECT COUNT(*) FROM "RestaurantRecord") * 7 AS expected_hours_rows,
  (SELECT COUNT(*) FROM "RestaurantRecord"
     WHERE COALESCE(array_length("cuisines", 1), 0) = 0) AS restaurants_without_cuisines,
  (SELECT COUNT(*) FROM "RestaurantRecord"
     WHERE "formattedAddress" IS NULL) AS restaurants_without_formatted_address;
```

Expected: `hours_rows = expected_hours_rows` (42 at 6 restaurants),
`restaurants_without_cuisines = 0` (spec §13 shows 0 restaurants missing a
cuisine), `restaurants_without_formatted_address = 0`.

- [ ] **Step 4: Verify hours round-trip to the original values**

```sql
SELECT r."name", r."openingTime", r."closingTime",
       h."opensAt", h."closesAt", COUNT(*) OVER (PARTITION BY r."id") AS day_count
FROM "RestaurantRecord" r
JOIN "RestaurantHours" h ON h."restaurantId" = r."id"
ORDER BY r."name", h."dayOfWeek"
LIMIT 14;
```

Expected: each restaurant has `day_count = 7`, and `opensAt` / `closesAt` equal
that restaurant's `openingTime` / `closingTime` (both NULL where the restaurant
never set hours — spec §13 shows 3 such restaurants).

- [x] **Step 5: Commit**

```bash
git add supabase/migrations/20260731_partner_onboarding_backfills.sql
git commit -m "feat(db): backfill hours, cuisines, and formatted address"
```

---

## Task 4: Committed readiness audit script

**Files:**
- Create: `scripts/audit-partner-readiness.sql`

**Interfaces:**
- Consumes: columns from Task 2.
- Produces: a re-runnable audit. Stage 4 runs it before enabling the geo-gate;
  stage 7 runs it before the re-verification cutover.

- [x] **Step 1: Write the script**

Create `scripts/audit-partner-readiness.sql`:

```sql
-- Partner readiness audit. Re-run this before enabling the geo-gate (spec §2)
-- and again before the re-verification cutover (spec §11).
--
-- Baseline recorded 2026-07-31 in spec §13:
--   total 6, published 6, published_missing_coords 5, missing_subaccount 6,
--   zero_or_null_min_order 4, missing_hours 3, delivery_without_coords 1.
--
-- The single most important number is published_missing_coords: enabling the
-- geo-gate while it is non-zero removes those restaurants from the customer app.

SELECT
  COUNT(*)                                                                   AS total_restaurants,
  COUNT(*) FILTER (WHERE "isPublished")                                      AS published,
  COUNT(*) FILTER (WHERE "isPublished"
                     AND ("latitude" IS NULL OR "longitude" IS NULL))         AS published_missing_coords,
  COUNT(*) FILTER (WHERE "paystackSubaccountCode" IS NULL
                     OR "paystackSubaccountCode" = '')                        AS missing_subaccount,
  COUNT(*) FILTER (WHERE "minOrder" IS NULL OR "minOrder" = 0)               AS zero_or_null_min_order,
  COUNT(*) FILTER (WHERE "detailsConfirmedAt" IS NULL)                       AS details_never_confirmed,
  COUNT(*) FILTER (WHERE "openingTime" IS NULL OR "closingTime" IS NULL)     AS missing_hours,
  COUNT(*) FILTER (WHERE "supportsDelivery"
                     AND ("latitude" IS NULL OR "longitude" IS NULL))         AS delivery_without_coords
FROM "RestaurantRecord";
```

- [x] **Step 2: Run it and confirm it executes**

Run the file's contents against the project (Supabase SQL editor or MCP
`execute_sql`).
Expected: one row. `published_missing_coords` should still be `5` and
`details_never_confirmed` should equal the restaurant count, since nothing has
confirmed details yet.

- [x] **Step 3: Commit**

```bash
git add scripts/audit-partner-readiness.sql
git commit -m "chore(db): add re-runnable partner readiness audit"
```

---

## Task 5: Pure submit-transition module (TDD)

**Files:**
- Create: `supabase/functions/_shared/partnerApplicationTransitions.ts`
- Test: `supabase/functions/_shared/partnerApplicationTransitions.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type PartnerApplicationStatus = 'pending' | 'approved' | 'rejected'`
  - `type SubmitOutcome = { allowed: true; nextStatus: 'pending' } | { allowed: false; httpStatus: 412; message: string }`
  - `resolvePartnerSubmitOutcome(currentStatus: string | null | undefined): SubmitOutcome`

  Task 6 imports `resolvePartnerSubmitOutcome`.

- [x] **Step 1: Write the failing test**

Create `supabase/functions/_shared/partnerApplicationTransitions.test.ts`:

```ts
import { resolvePartnerSubmitOutcome } from './partnerApplicationTransitions.ts';

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
};

Deno.test('a first-time applicant lands in pending', () => {
  const outcome = resolvePartnerSubmitOutcome(null);
  expectEqual(outcome.allowed, true, 'allowed');
  expectEqual(outcome.allowed ? outcome.nextStatus : null, 'pending', 'nextStatus');
});

Deno.test('an undefined or empty status is treated as first-time', () => {
  for (const raw of [undefined, '', '   ']) {
    const outcome = resolvePartnerSubmitOutcome(raw);
    expectEqual(outcome.allowed, true, `allowed for ${JSON.stringify(raw)}`);
  }
});

Deno.test('a pending applicant may resubmit and stays pending', () => {
  const outcome = resolvePartnerSubmitOutcome('pending');
  expectEqual(outcome.allowed, true, 'allowed');
  expectEqual(outcome.allowed ? outcome.nextStatus : null, 'pending', 'nextStatus');
});

Deno.test('a rejected applicant may fix and resubmit, returning to pending', () => {
  const outcome = resolvePartnerSubmitOutcome('rejected');
  expectEqual(outcome.allowed, true, 'allowed');
  expectEqual(outcome.allowed ? outcome.nextStatus : null, 'pending', 'nextStatus');
});

Deno.test('an approved applicant cannot resubmit', () => {
  const outcome = resolvePartnerSubmitOutcome('approved');
  expectEqual(outcome.allowed, false, 'allowed');
  expectEqual(outcome.allowed ? null : outcome.httpStatus, 412, 'httpStatus');
});

Deno.test('an unrecognised status is treated as pending rather than failing open', () => {
  const outcome = resolvePartnerSubmitOutcome('something-else');
  expectEqual(outcome.allowed, true, 'allowed');
  expectEqual(outcome.allowed ? outcome.nextStatus : null, 'pending', 'nextStatus');
});

Deno.test('status matching ignores case and surrounding whitespace', () => {
  expectEqual(resolvePartnerSubmitOutcome('  APPROVED ').allowed, false, 'approved is still blocked');
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `deno test -A --no-lock supabase/functions/_shared/partnerApplicationTransitions.test.ts`
Expected: FAIL — module `./partnerApplicationTransitions.ts` not found.

- [x] **Step 3: Write the implementation**

Create `supabase/functions/_shared/partnerApplicationTransitions.ts`:

```ts
// Decides what a partner application submit does, given the application's
// current status. Extracted from the app-rpc handler so the rule is unit
// testable without a database.
//
// The rule: submitting always lands in `pending` — approval is an admin
// decision, never a side effect of submitting. The single exception is an
// already-approved application, which must not be reopened by a resubmit.

export type PartnerApplicationStatus = 'pending' | 'approved' | 'rejected';

export type SubmitOutcome =
  | { allowed: true; nextStatus: 'pending' }
  | { allowed: false; httpStatus: 412; message: string };

const ALREADY_APPROVED_MESSAGE =
  'This partner application has already been approved. Sign in from the partner login screen.';

export const resolvePartnerSubmitOutcome = (
  currentStatus: string | null | undefined
): SubmitOutcome => {
  const normalized = (currentStatus ?? '').trim().toLowerCase();

  if (normalized === 'approved') {
    return { allowed: false, httpStatus: 412, message: ALREADY_APPROVED_MESSAGE };
  }

  // Everything else -- no application yet, pending, rejected, or an
  // unrecognised value -- results in a pending application. Defaulting an
  // unknown status to `pending` fails closed: the worst case is that an admin
  // reviews it again, never that an unvetted restaurant goes live.
  return { allowed: true, nextStatus: 'pending' };
};
```

- [x] **Step 4: Run the test to verify it passes**

Run: `deno test -A --no-lock supabase/functions/_shared/partnerApplicationTransitions.test.ts`
Expected: PASS — 7 tests.

- [x] **Step 5: Commit**

```bash
git add supabase/functions/_shared/partnerApplicationTransitions.ts supabase/functions/_shared/partnerApplicationTransitions.test.ts
git commit -m "feat(app-rpc): add pure partner submit-transition rule"
```

---

## Task 6: Stop auto-approving in `submitPartnerApplication`

**Files:**
- Modify: `supabase/functions/app-rpc/index.ts` (the `submitPartnerApplication`
  handler, currently around lines 4254–4440)

**Interfaces:**
- Consumes: `resolvePartnerSubmitOutcome` from Task 5.
- Produces: the RPC now returns `{ status: 'pending', submittedAt, restaurantId,
  targetUid }`. Task 7 consumes that response shape.

- [x] **Step 1: Import the transition module**

At the top of `supabase/functions/app-rpc/index.ts`, alongside the other
`_shared` imports, add:

```ts
import { resolvePartnerSubmitOutcome } from '../_shared/partnerApplicationTransitions.ts';
```

- [x] **Step 2: Replace the approval short-circuit with the pending outcome**

In the `submitPartnerApplication` handler, replace the existing block:

```ts
    const existingApplication = await loadPartnerApplication(context.uid);
    const currentStatus = sanitizeText(existingApplication?.status, PARTNER_APPLICATION_STATUS.PENDING);
    if (existingApplication && currentStatus === PARTNER_APPLICATION_STATUS.APPROVED) {
      fail(
        412,
        'This partner application has already been approved. Sign in from the partner login screen.'
      );
    }
```

with:

```ts
    const existingApplication = await loadPartnerApplication(context.uid);
    const submitOutcome = resolvePartnerSubmitOutcome(existingApplication?.status);
    if (!submitOutcome.allowed) {
      fail(submitOutcome.httpStatus, submitOutcome.message);
    }
```

- [x] **Step 3: Write the application as pending, not approved**

In the same handler, in the `PartnerApplicationRecord` upsert, change these
fields:

```ts
        status: PARTNER_APPLICATION_STATUS.APPROVED,
        restaurantId,
        submittedAt,
        reviewedAt: updatedAt,
        approvedByUid: context.uid,
        rejectionReason: null,
```

to:

```ts
        status: PARTNER_APPLICATION_STATUS.PENDING,
        restaurantId,
        submittedAt,
        // An admin has not looked at this yet. Clearing the review fields also
        // wipes a previous rejection reason when a rejected partner resubmits.
        reviewedAt: null,
        approvedByUid: null,
        rejectionReason: null,
```

- [x] **Step 4: Remove the self-grant of the restaurant role and the self-publish**

Still in the same handler, **delete** the `syncUserRoleState(...)` call that
grants `'restaurant'` with `restaurantLinkSource: 'partner_application_self_publish'`,
**delete** the entire `RestaurantRecord` upsert and its `restaurantError` check,
**delete** the `broadcastRestaurantsChanged({ restaurantId })` call, and
**delete** the `RestaurantApproval` upsert and its `approvalError` check.

The `RestaurantRecord` and `RestaurantApproval` rows are created by
`adminReviewPartnerApplication` on approval — that handler already does
`application.restaurantId || crypto.randomUUID()`, so allocating `restaurantId`
on the application here is still correct and sufficient.

Keep `const currentAccount = await loadUserAccount(context.uid);` — the account
upsert below still uses `currentAccount?.createdAt`.

- [x] **Step 5: Record the account as pending, not approved**

Change the `upsertUserAccount({ ... })` call's role and status fields from:

```ts
      roleDisplay: 'restaurant',
      partnerApplicationStatus: PARTNER_APPLICATION_STATUS.APPROVED,
      partnerApplicationReviewedAt: updatedAt,
      partnerApplicationRejectionReason: null,
      restaurantId,
      restaurantName,
```

to:

```ts
      // Role stays 'customer' until an admin approves. The restaurant link is
      // written by adminReviewPartnerApplication, not here.
      roleDisplay: 'customer',
      partnerApplicationStatus: PARTNER_APPLICATION_STATUS.PENDING,
      partnerApplicationReviewedAt: null,
      partnerApplicationRejectionReason: null,
```

- [x] **Step 6: Fix the admin notification copy**

The notification currently announces a live restaurant. Change its `title` and
`body` from:

```ts
      title: 'New restaurant published',
      body: `${restaurantName} is now live for customer discovery and partner management.`,
```

to:

```ts
      title: 'New restaurant application',
      body: `${restaurantName} has applied and is waiting for review.`,
```

- [x] **Step 7: Fix the approval that admin review writes (REQUIRED — do not skip)**

Deleting the `RestaurantApproval` upsert in Step 4 removes the **only** code path
in the entire function that ever writes `status: 'approved'` (it was at line
~4387). `adminReviewPartnerApplication` writes `status: 'pending'` instead
(line ~4768). Order placement refuses any restaurant whose approval row is not
`'approved'`:

```ts
  if (sanitizeOptionalText(approval?.status) && sanitizeText(approval?.status) !== 'approved') {
    fail(412, 'This restaurant is not accepting orders right now.');
  }
```

Without this step, an admin-approved restaurant can never take an order.

In `adminReviewPartnerApplication`, in the approve branch, change the
`RestaurantApproval` upsert from:

```ts
        {
          restaurantId,
          status: 'pending',
          approvedByUid: null,
          approvedAt: null,
          updatedAt: reviewedAt,
        },
```

to:

```ts
        {
          restaurantId,
          // Approval and publication are separate concerns: the restaurant is
          // approved here but stays isPublished=false until it completes setup
          // and goes live.
          status: 'approved',
          approvedByUid: context.uid,
          approvedAt: reviewedAt,
          updatedAt: reviewedAt,
        },
```

Leave `isPublished: false` on the `RestaurantRecord` upsert exactly as it is.

- [x] **Step 8: Update the returned status**

Find the handler's success response and change the returned `status` from
`'approved'` to `PARTNER_APPLICATION_STATUS.PENDING`, leaving `submittedAt`,
`restaurantId`, and `targetUid` as they are.

- [x] **Step 9: Type-check the edge function**

Run: `deno check supabase/functions/app-rpc/index.ts`
Expected: PASS. If it reports an unused `broadcastRestaurantsChanged` or similar,
that helper is still used by other handlers — leave it defined and only remove
the call site from this handler.

- [x] **Step 10: Confirm no remaining path self-approves**

Run: `rg -n "status: 'approved'" supabase/functions/app-rpc/index.ts`
Expected: exactly one hit — the `RestaurantApproval` upsert inside
`adminReviewPartnerApplication` from Step 7. If a hit remains inside
`submitPartnerApplication`, Step 4 was incomplete.

- [x] **Step 11: Run the full edge-function test suite**

Run: `npm run test:deno`
Expected: PASS, including the new transition tests.

- [x] **Step 12: Commit**

```bash
git add supabase/functions/app-rpc/index.ts
git commit -m "feat(app-rpc): submit partner applications as pending, not approved"
```

---

## Task 7: Route pending applicants to an under-review screen

**Files:**
- Modify: `apps/partner/src/contexts/partnerAuthFlow.ts`
- Test: `apps/partner/src/contexts/partnerAuthFlow.test.ts`
- Create: `apps/partner/app/(partner)/application-under-review.tsx`
- Modify: `apps/partner/app/(partner)/_layout.tsx:170-176`
- Modify: `apps/partner/app/(partner)/complete-restaurant-details.tsx`
- Modify: `apps/partner/src/services/partnerApplications.ts`

**Interfaces:**
- Consumes: the `status: 'pending'` response from Task 6.
- Produces: `resolvePartnerLandingRoute({ role, applicationStatus })` returning
  `'dashboard' | 'under-review' | 'apply'`.

- [x] **Step 1: Write the failing test**

Append to `apps/partner/src/contexts/partnerAuthFlow.test.ts`:

```ts
test('an approved restaurant lands on the dashboard', () => {
  assert.equal(
    resolvePartnerLandingRoute({ role: 'restaurant', applicationStatus: 'approved' }),
    'dashboard'
  );
});

test('a pending applicant waits on the under-review screen', () => {
  assert.equal(
    resolvePartnerLandingRoute({ role: 'customer', applicationStatus: 'pending' }),
    'under-review'
  );
});

test('a rejected applicant is sent back to the form to fix and resubmit', () => {
  assert.equal(
    resolvePartnerLandingRoute({ role: 'customer', applicationStatus: 'rejected' }),
    'apply'
  );
});

test('someone who has never applied is sent to the form', () => {
  assert.equal(
    resolvePartnerLandingRoute({ role: 'customer', applicationStatus: null }),
    'apply'
  );
});

test('the restaurant role wins even if the application status lags behind', () => {
  // The JWT claim can sync before the account row is re-read. Role is
  // authoritative, so an approved partner is never trapped on the waiting screen.
  assert.equal(
    resolvePartnerLandingRoute({ role: 'restaurant', applicationStatus: 'pending' }),
    'dashboard'
  );
});
```

Add `resolvePartnerLandingRoute` to the existing import from
`./partnerAuthFlow.ts` at the top of that test file.

- [x] **Step 2: Run the test to verify it fails**

Run: `node --test --experimental-strip-types apps/partner/src/contexts/partnerAuthFlow.test.ts`
Expected: FAIL — `resolvePartnerLandingRoute is not a function`.

- [x] **Step 3: Implement the helper**

Append to `apps/partner/src/contexts/partnerAuthFlow.ts`:

```ts
export type PartnerLandingRoute = 'dashboard' | 'under-review' | 'apply';

/**
 * Decides where a signed-in partner user belongs.
 *
 * Role is checked first and wins: the `restaurant` claim is granted only by an
 * admin approval, so once it is present the partner must reach the dashboard
 * even if the cached application status still reads `pending`.
 */
export const resolvePartnerLandingRoute = ({
  role,
  applicationStatus,
}: {
  role: string | null | undefined;
  applicationStatus: string | null | undefined;
}): PartnerLandingRoute => {
  if (role === 'restaurant') {
    return 'dashboard';
  }

  return (applicationStatus ?? '').trim().toLowerCase() === 'pending' ? 'under-review' : 'apply';
};
```

- [x] **Step 4: Run the test to verify it passes**

Run: `node --test --experimental-strip-types apps/partner/src/contexts/partnerAuthFlow.test.ts`
Expected: PASS.

- [x] **Step 5: Create the under-review screen**

Create `apps/partner/app/(partner)/application-under-review.tsx`:

```tsx
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/contexts/AuthContext';
import { partnerTheme } from '../../src/theme/palette';

export default function ApplicationUnderReviewScreen() {
  const insets = useSafeAreaInsets();
  const { signOut, user } = useAuth();

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 28 },
      ]}
    >
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>FEASTY Partner</Text>
        <Text style={styles.title}>Your application is under review</Text>
        <Text style={styles.copy}>
          Thanks for applying. Our team is checking your details. We will email
          {user?.email ? ` ${user.email}` : ' you'} as soon as your restaurant is approved.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>What happens next</Text>
        <Text style={styles.cardLine}>1. We verify your identity and restaurant details.</Text>
        <Text style={styles.cardLine}>2. You get an email with the decision.</Text>
        <Text style={styles.cardLine}>3. Once approved, sign in to set up your menu and go live.</Text>

        <TouchableOpacity style={styles.secondaryButton} onPress={() => void signOut()}>
          <Text style={styles.secondaryButtonText}>Sign out</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: partnerTheme.background, flex: 1 },
  content: { paddingHorizontal: 20 },
  hero: {
    backgroundColor: partnerTheme.hero,
    borderRadius: 28,
    padding: 24,
  },
  eyebrow: {
    color: partnerTheme.heroSoft,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  title: { color: '#fffdf8', fontSize: 30, fontWeight: '800' },
  copy: { color: '#e7dbc7', fontSize: 15, lineHeight: 22, marginTop: 10 },
  card: {
    backgroundColor: partnerTheme.surface,
    borderColor: partnerTheme.border,
    borderRadius: 26,
    borderWidth: 1,
    marginTop: 16,
    padding: 20,
  },
  cardTitle: { color: partnerTheme.text, fontSize: 16, fontWeight: '800', marginBottom: 12 },
  cardLine: { color: partnerTheme.textMuted, fontSize: 14, lineHeight: 22 },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: partnerTheme.cream,
    borderColor: partnerTheme.border,
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 20,
    paddingVertical: 14,
  },
  secondaryButtonText: { color: partnerTheme.textMuted, fontSize: 14, fontWeight: '700' },
});
```

- [x] **Step 6: Route non-restaurant users by application status**

In `apps/partner/app/(partner)/_layout.tsx`, replace the block at lines 170–176:

```tsx
  if (user.role !== 'restaurant') {
    if (pathname !== '/complete-restaurant-details') {
      return <Redirect href={'/(partner)/complete-restaurant-details' as never} />;
    }

    return <Slot />;
  }
```

with:

```tsx
  if (user.role !== 'restaurant') {
    const landingRoute = resolvePartnerLandingRoute({
      role: user.role,
      applicationStatus: user.partnerApplicationStatus,
    });
    const targetPath =
      landingRoute === 'under-review' ? '/application-under-review' : '/complete-restaurant-details';

    if (pathname !== targetPath) {
      return <Redirect href={`/(partner)${targetPath}` as never} />;
    }

    return <Slot />;
  }
```

Add the import at the top of the file:

```tsx
import { resolvePartnerLandingRoute } from '../../src/contexts/partnerAuthFlow';
```

- [x] **Step 7: Add the new route to the shell's loading mode**

In the same file, inside `getPartnerShellLoadingMode`, add before the final
`return 'dashboard';`:

```tsx
  if (currentPath.startsWith('/application-under-review')) {
    return 'setup';
  }
```

- [x] **Step 8: Stop the form from waiting for a dashboard handoff**

In `apps/partner/app/(partner)/complete-restaurant-details.tsx`, in `handleSubmit`,
replace:

```tsx
      setHandoffStartedAt(Date.now());
      await supabase.auth.refreshSession().catch(() => undefined);
```

with:

```tsx
      // Submitting no longer grants the restaurant role -- an admin has to
      // approve first. Refresh so the account's pending status is picked up,
      // then let the layout route to the under-review screen.
      await supabase.auth.refreshSession().catch(() => undefined);
      router.replace('/(partner)/application-under-review' as never);
```

Then update the hero copy on the same screen, replacing:

```tsx
          Add the restaurant profile that appears in the partner dashboard. Once you save, we’ll open your restaurant dashboard right away.
```

with:

```tsx
          Add your restaurant profile. Once you submit, our team reviews your application and emails you when it is approved.
```

And change the submit button's idle label from `'Save and open dashboard'` to
`'Submit for review'`, and the note under it from the handoff sentence to
`'We review new restaurants before they go live. This usually takes 1-2 business days.'`

- [x] **Step 9: Update the RPC response type**

In `apps/partner/src/services/partnerApplications.ts`, change:

```ts
    status: 'approved';
```

to:

```ts
    status: 'pending';
```

- [x] **Step 10: Type-check and lint the partner app**

Run: `npm run typecheck:partner`
Expected: PASS.

Run: `npm run lint:partner`
Expected: PASS.

If typecheck reports `handoffStartedAt` or
`PARTNER_RESTAURANT_COMPLETION_TIMEOUT_MS` as now-unused in
`complete-restaurant-details.tsx`, remove only the handoff state and effect from
that screen. **Do not** delete `resolvePartnerRestaurantCompletionState` from
`partnerAuthFlow.ts` — it is still needed on the post-approval sign-in path.

- [x] **Step 11: Commit**

```bash
git add apps/partner/src/contexts/partnerAuthFlow.ts apps/partner/src/contexts/partnerAuthFlow.test.ts apps/partner/app/\(partner\)/application-under-review.tsx apps/partner/app/\(partner\)/_layout.tsx apps/partner/app/\(partner\)/complete-restaurant-details.tsx apps/partner/src/services/partnerApplications.ts
git commit -m "feat(partner): route pending applicants to an under-review screen"
```

---

## Task 8: Register the new tests and verify end to end

**Files:**
- Modify: `package.json`

**Interfaces:**
- Consumes: the test files from Tasks 5 and 7.
- Produces: both run in CI via `npm test`.

- [x] **Step 1: Register the new Deno test file**

In `package.json`, append to the `test:deno` script's file list (the
`partnerAuthFlow.test.ts` node test is already registered, so only the Deno file
is new):

```
supabase/functions/_shared/partnerApplicationTransitions.test.ts
```

The script becomes (note `promoTrack.test.ts` — it is already registered and must
stay; the string originally written here dropped it):

```
"test:deno": "deno test -A --no-lock supabase/functions/_shared/media_test.ts supabase/functions/_shared/pricing.test.ts supabase/functions/_shared/partnerApplicationTransitions.test.ts supabase/functions/_shared/requireRole.test.ts supabase/functions/_shared/validation.test.ts supabase/functions/app-rpc/partnerRestaurantScope.test.ts supabase/functions/app-rpc/promoTrack.test.ts supabase/functions/auth-gateway/errors.test.ts supabase/functions/auth-gateway/hash.test.ts supabase/functions/auth-gateway/router.test.ts supabase/functions/payment-verification/invariants.test.ts supabase/functions/paystack-webhook/invariants.test.ts"
```

- [x] **Step 2: Run the whole suite**

Run: `npm test`
Expected: PASS. Confirm the output includes the new
`partnerApplicationTransitions` tests and the new `resolvePartnerLandingRoute`
tests — if a file is silently absent from the output, it was not registered.

- [x] **Step 3: Verify no restaurant was published by the code change**

```sql
SELECT COUNT(*) AS total,
       COUNT(*) FILTER (WHERE "isPublished") AS published
FROM "RestaurantRecord";
```

Expected: still `total = 6`, `published = 6`. Stage 2 changes only what *new*
submissions do; existing restaurants are untouched until stage 7.

- [ ] **Step 4: Manual end-to-end check**

1. Register a brand-new partner account and complete the restaurant details form.
2. Confirm you land on **"Your application is under review"**, not the dashboard.
3. Confirm in the database that the application is `pending` and that **no**
   `RestaurantRecord` was created for it:

```sql
SELECT p."restaurantName", p."status", r."id" AS restaurant_row
FROM "PartnerApplicationRecord" p
LEFT JOIN "RestaurantRecord" r ON r."id" = p."restaurantId"
ORDER BY p."submittedAt" DESC
LIMIT 3;
```

Expected for the new row: `status = 'pending'` and `restaurant_row` is `NULL`.

4. Approve it from the admin app, then sign in again as the partner and confirm
   the dashboard opens and the restaurant now exists.

5. Confirm the approval wrote the row order placement requires — this is the
   check that catches the Task 6 Step 7 defect:

```sql
SELECT r."name", r."isPublished", a."status" AS approval_status, a."approvedAt"
FROM "RestaurantRecord" r
LEFT JOIN "RestaurantApproval" a ON a."restaurantId" = r."id"
ORDER BY r."createdAt" DESC
LIMIT 3;
```

Expected for the newly approved restaurant: `approval_status = 'approved'` with a
non-null `approvedAt`, and `isPublished = false`. If `approval_status` is
`'pending'`, Task 6 Step 7 was skipped and the restaurant will be rejected at
checkout with "This restaurant is not accepting orders right now."

6. Publish the restaurant from the partner profile screen, then place a real
   customer order against it and confirm checkout succeeds. This is the only
   check that exercises the approval guard end to end.

- [x] **Step 5: Commit**

```bash
git add package.json
git commit -m "test: register partner application transition tests"
```

---

## Self-Review Notes

**Spec coverage for stages 1–2:** §3 data model → Tasks 1–2; §10 backfills →
Task 3; §13 audit → Task 4; §1 lifecycle (submit writes pending, no role grant,
no publish, rejected may resubmit) → Tasks 5–6; the under-review screen → Task 7.

**Deliberately deferred** (later stages, per the spec's implementation order):
the geo-gate and `public-catalog` changes (§2), the address module (§4), payout
and the Paystack split (§5), cuisines UI and the Others flow (§6), NIN capture
(§7), the admin review detail surface (§8), the `hours` catalog payload and the
`restaurantAvailability.ts` open-now fix (§3 correctness note), mandatory-field
validation (§1a), and the re-verification cutover (§11). The columns those stages
need are created here so no later migration has to alter a hot table.

**Defect this plan fixes on the way through:** `adminReviewPartnerApplication`
already creates the `RestaurantRecord` with an explicit `isPublished: false`,
which matches the spec's "approved but unpublished" state. But it writes
`RestaurantApproval` as `'pending'`, and the only code that ever wrote
`'approved'` was inside `submitPartnerApplication` — the self-approval this plan
deletes. Order placement refuses any restaurant whose approval row is not
`'approved'`, so removing the self-approval without Task 6 Step 7 would leave
every admin-approved restaurant permanently unable to take orders. Step 7 moves
the `'approved'` write to where it belongs, and Task 8 Step 4 verifies it with a
real checkout.

**Note on two approval records:** `PartnerApplicationRecord.status` tracks the
*application*; `RestaurantApproval.status` tracks the *restaurant*. After this
plan both are set by the same admin action. Stage 6 adds the readiness gate that
governs `isPublished` separately; until then an approved restaurant is created
unpublished and is published by the existing profile toggle.

---

## Execution status — 2026-07-31

**Done and committed** (branch `worktree-partner-onboarding-kyc`, 7 commits from
`6f10a98` to `f82ab57`): every code artifact. Both migration files, the audit
script, the transition module and its 7 tests, the app-rpc behaviour change, the
partner routing and under-review screen, and the test registration.
`npm test` passes: 35 node, 70 deno, zero failures. `npm run typecheck:partner`
and expo lint are clean.

**Blocked, needs an operator** — the 7 unchecked steps above:

1. Apply `supabase/migrations/20260731_partner_kyc_payout_hours.sql`, then
   `supabase/migrations/20260731_partner_onboarding_backfills.sql`, in that order.
   The MCP `apply_migration` call is refused by the Claude Code auto-mode
   classifier. `npx supabase db push` is **not** a safe substitute in this repo:
   local file names are 8-digit dates (`20260712_auth_gateway.sql`) while the
   remote registry holds 14-digit versions (`20260715072405 auth_gateway`), so
   push would treat several applied migrations as new and re-run them. Use the
   Supabase SQL editor, or approve the MCP call.
2. Run the two verification queries in Task 2 Steps 4-5 and Task 3 Steps 3-4.
3. Deploy `app-rpc`. Until it is deployed, production still self-approves every
   partner applicant. The deploy is independent of the migrations: nothing in
   this stage's code reads the new tables.
4. The manual end-to-end check in Task 8 Step 4.

**Baseline measured against production before any change** (2026-07-31): 6
restaurants, 6 published, 5 published without coordinates, 6 without a Paystack
subaccount, 4 with no minimum order, 3 with no hours, 1 delivery restaurant
without a pin — an exact match for the spec §13 audit. All 4 existing
`PartnerApplicationRecord` rows are `approved`, so no current user lands on the
new under-review screen after deploy.

**Correction to Task 6 Step 9:** `deno check supabase/functions/app-rpc/index.ts`
does not pass and did not pass before this work — it reports 207 errors on the
unmodified file. The error sets before and after the change are identical, which
is the verification that was actually run.
