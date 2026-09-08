# Pending-Deletion Gates (C3a / C3b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "account pending deletion" unforgeable — enforced by the backend on both the edge-function path and the Data API path, so no client cooperation is required for it to hold.

**Architecture:** Two independent enforcement layers over one piece of state (`UserAccount."deletionRequestedAt"`). C3a rejects edge-function requests at the single shared context chokepoint and returns a structured 403 the client can act on. C3b blocks the Data API path with a database trigger and RLS policy conditions, so a valid JWT cannot clear the deletion state directly. Neither layer trusts the client, and neither depends on the other.

**Tech Stack:** Deno edge functions (`supabase/functions/`), Postgres 15 + RLS + pl/pgSQL triggers, Supabase CLI migrations, `deno test` and `node --test`.

## Global Constraints

- **Schema changes go in `supabase/migrations/*.sql` only.** `functions/prisma/migrations/` is a frozen historical record — its README says "do not extend". Prisma was retired 2026-07-30.
- **`CREATE OR REPLACE` is wholesale.** The trigger function and the `user_profiles` view must be reproduced in full, not patched. Bodies to copy are given verbatim in Tasks 1 and 5.
- **Migrations must be exception-guarded** where they touch optional extensions, following `supabase/migrations/20260708_broadcast_runner_schedule.sql`.
- **New Deno test files must be added to the `test:deno` script in `package.json`.** That script names each file explicitly; a test file not listed there never runs.
- **Column names are quoted camelCase** in this database (`"deletionRequestedAt"`, not `deletion_requested_at`).
- **`service_role` and `admin` must remain exempt** from every guard added here — `deleteOwnAccount` and the purge runner both write via `serviceClient`.
- Error code string, used verbatim: `ACCOUNT_PENDING_DELETION`.
- Grace period: **30 days**.

**Scope note:** This plan covers C3a and C3b from the design, plus the *column* half of C1. The columns are included because the gates cannot be built or tested without the state they read. The `user_profiles` view replacement (also C1) is included for the same reason. Everything else in C1 (cancel-token column usage), C2, C4, C5, C6 is out of scope here.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20260807a_account_deletion_columns.sql` | new `UserAccount` columns, partial index, `user_profiles` view replacement |
| `supabase/migrations/20260807b_account_deletion_data_api_gate.sql` | trigger replacement, `ebuy_account_pending_deletion()`, policy conditions |
| `supabase/functions/_shared/observability.ts` | `ClientSafeError` gains `code`/`details`; new `clientErrorExtras()` |
| `supabase/functions/_shared/observability.test.ts` | unit tests for the above |
| `supabase/functions/_shared/request-context.ts` | `assertAccountAccessible()` + gate wiring |
| `supabase/functions/_shared/request-context.test.ts` | unit tests for the pure decision function |
| `supabase/functions/app-rpc/index.ts` | envelope extras; per-action exemption; retire string-compare 403 |
| `supabase/functions/notifications/index.ts` | envelope extras |
| `scripts/verify-deletion-rls.sql` | integration check against real RLS, run in a rolled-back transaction |
| `package.json` | register new Deno test files |

---

## Task 1: Deletion state columns and view

**Files:**
- Create: `supabase/migrations/20260807a_account_deletion_columns.sql`

**Interfaces:**
- Produces: `UserAccount."deletionRequestedAt"`, `"purgeScheduledAt"`, `"deletionCancelTokenHash"`, `"purgeAttemptCount"`, `"purgeLastAttemptAt"`, `"purgeLastError"`; `user_profiles.deletionRequestedAt`, `user_profiles.purgeScheduledAt`. Tasks 4, 5 and 6 read these.

- [ ] **Step 1: Write the migration**

The `user_profiles` body below is the **live** definition read from production with `pg_get_viewdef`. It includes `phoneVerifiedAt`, which the original `20260712_phone_otp.sql` file does not — copy from here, not from that file.

```sql
-- Deletion lifecycle state for the 30-day grace period.
-- Columns only; the enforcement that makes them meaningful is in 20260807b.

alter table public."UserAccount"
  add column if not exists "deletionRequestedAt" timestamptz,
  add column if not exists "purgeScheduledAt" timestamptz,
  add column if not exists "deletionCancelTokenHash" text,
  add column if not exists "purgeAttemptCount" integer not null default 0,
  add column if not exists "purgeLastAttemptAt" timestamptz,
  add column if not exists "purgeLastError" text;

-- The purge runner scans by due date over a tiny subset of rows.
create index if not exists "UserAccount_purge_due_idx"
  on public."UserAccount" ("purgeScheduledAt")
  where "deletionRequestedAt" is not null;

-- user_profiles is what getAuthenticatedRequestContext reads. Without these two
-- columns the C3a gate is blind and silently allows everything.
create or replace view public."user_profiles"
with (security_invoker = true) as
select
  uid,
  email,
  "displayName",
  "phoneNumber",
  "photoURL",
  "emailVerified",
  coalesce(public.ebuy_primary_role(uid), "roleDisplay"::text, 'customer'::text) as role,
  "partnerApplicationStatus",
  "partnerApplicationReviewedAt",
  "partnerApplicationRejectionReason",
  "dispatchApplicationStatus",
  "dispatchApplicationReviewedAt",
  "dispatchApplicationRejectionReason",
  "expoPushToken",
  "pushTokenUpdatedAt",
  "activeSessionId",
  "activeSessionUpdatedAt",
  "accountDisabled",
  "disabledAt",
  "disabledByUid",
  "lastPrivilegedRole"::text as "lastPrivilegedRole",
  "restaurantId",
  "restaurantName",
  "restaurantLinkedAt",
  "restaurantLinkSource",
  "createdAt",
  "updatedAt",
  "phoneVerifiedAt",
  "deletionRequestedAt",
  "purgeScheduledAt"
from public."UserAccount" ua;

grant select on public."user_profiles" to authenticated;
```

- [ ] **Step 2: Apply it**

Run: `npx supabase migration up --local` if a local stack is running, otherwise apply with the Supabase MCP `apply_migration` tool.

- [ ] **Step 3: Verify the columns and view landed**

Run this SQL and confirm it returns 6 rows for the columns and 2 for the view:

```sql
select column_name from information_schema.columns
where table_schema='public' and table_name='UserAccount'
  and column_name in ('deletionRequestedAt','purgeScheduledAt','deletionCancelTokenHash',
                      'purgeAttemptCount','purgeLastAttemptAt','purgeLastError');

select column_name from information_schema.columns
where table_schema='public' and table_name='user_profiles'
  and column_name in ('deletionRequestedAt','purgeScheduledAt');
```

Expected: 6 rows, then 2 rows. If the second query returns 0, the view replacement silently dropped the columns — fix before continuing, because every later task depends on it.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260807a_account_deletion_columns.sql
git commit -m "feat(db): add account deletion lifecycle columns and expose them on user_profiles"
```

---

## Task 2: `ClientSafeError` carries a code

**Files:**
- Modify: `supabase/functions/_shared/observability.ts:82-91`
- Create: `supabase/functions/_shared/observability.test.ts`
- Modify: `package.json` (the `test:deno` script)

**Interfaces:**
- Consumes: nothing.
- Produces: `new ClientSafeError(status, message, { code?, details? })` — third argument optional, so all existing two-argument call sites keep working. `clientErrorExtras(error): { code?: string; details?: Record<string, unknown> }`. Tasks 3 and 4 use both.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/observability.test.ts`:

```ts
import { ClientSafeError, clientErrorExtras } from './observability.ts';

Deno.test('ClientSafeError keeps the two-argument form working', () => {
  const error = new ClientSafeError(401, 'Please sign in.');
  if (error.status !== 401) throw new Error('status should be 401');
  if (error.message !== 'Please sign in.') throw new Error('message should round-trip');
  if (error.code !== undefined) throw new Error('code should be undefined');
});

Deno.test('ClientSafeError carries code and details', () => {
  const error = new ClientSafeError(403, 'Scheduled for deletion.', {
    code: 'ACCOUNT_PENDING_DELETION',
    details: { purgeScheduledAt: '2026-09-06T00:00:00.000Z' },
  });
  if (error.code !== 'ACCOUNT_PENDING_DELETION') throw new Error('code should round-trip');
  if (error.details?.purgeScheduledAt !== '2026-09-06T00:00:00.000Z') {
    throw new Error('details should round-trip');
  }
});

Deno.test('clientErrorExtras surfaces code and details for a 4xx', () => {
  const extras = clientErrorExtras(
    new ClientSafeError(403, 'nope', { code: 'ACCOUNT_PENDING_DELETION', details: { a: 1 } })
  );
  if (extras.code !== 'ACCOUNT_PENDING_DELETION') throw new Error('should expose code');
  if ((extras.details as { a?: number })?.a !== 1) throw new Error('should expose details');
});

Deno.test('clientErrorExtras hides everything for a 5xx', () => {
  const extras = clientErrorExtras(new ClientSafeError(500, 'boom', { code: 'INTERNAL' }));
  if (extras.code !== undefined) throw new Error('5xx must not expose a code');
});

Deno.test('clientErrorExtras returns nothing for a plain Error', () => {
  const extras = clientErrorExtras(new Error('plain'));
  if (Object.keys(extras).length !== 0) throw new Error('plain errors expose nothing');
});
```

- [ ] **Step 2: Register the test file**

In `package.json`, add `supabase/functions/_shared/observability.test.ts` to the space-separated file list in the `test:deno` script. Without this it will never run.

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test:deno`
Expected: FAIL — `clientErrorExtras` is not exported from `observability.ts`.

- [ ] **Step 4: Implement**

Replace the `ClientSafeError` class at `supabase/functions/_shared/observability.ts:82-91` with:

```ts
export type ClientSafeErrorOptions = {
  code?: string;
  details?: Record<string, unknown>;
};

/**
 * Base class for deliberately user-facing errors raised in shared helpers.
 * Its message is crafted for end users and is safe to return in a response.
 *
 * `code` and `details` let a client branch on a specific condition instead of
 * string-matching the message. They ride the same exposure rule as the message:
 * 4xx and `expose` only.
 */
export class ClientSafeError extends Error {
  readonly status: number;
  readonly expose = true;
  readonly code?: string;
  readonly details?: Record<string, unknown>;

  constructor(status: number, message: string, options: ClientSafeErrorOptions = {}) {
    super(message);
    this.name = 'ClientSafeError';
    this.status = status;
    this.code = options.code;
    this.details = options.details;
  }
}
```

Then append, after the class:

```ts
/**
 * The structured extras to merge into an error envelope. Deliberately separate
 * from `clientErrorMessage`: the existing catch blocks serialize `error.message`
 * raw, and routing that through the exposure rule here would turn every
 * RpcError message into the generic fallback. This only ever ADDS fields.
 */
export const clientErrorExtras = (
  error: unknown
): { code?: string; details?: Record<string, unknown> } => {
  if (!isClientSafeError(error) || !(error instanceof ClientSafeError)) {
    return {};
  }

  return {
    ...(error.code ? { code: error.code } : null),
    ...(error.details ? { details: error.details } : null),
  };
};
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:deno`
Expected: PASS, and every previously passing Deno test still passes.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/observability.ts supabase/functions/_shared/observability.test.ts package.json
git commit -m "feat(edge): let ClientSafeError carry a structured code and details"
```

---

## Task 3: Serialize the extras in both response envelopes

**Files:**
- Modify: `supabase/functions/app-rpc/index.ts:7136-7160`
- Modify: `supabase/functions/notifications/index.ts:122-130`

**Interfaces:**
- Consumes: `clientErrorExtras` from Task 2.
- Produces: both functions emit `{ error: { message, code?, details? } }`. Task 4's gate depends on this to reach the client.

**Why this task exists:** both catch blocks currently serialize only `message`. Without this change the gate in Task 4 would work server-side but the client would receive a bare 403 with no code and no purge date, and the failure would be silent.

- [ ] **Step 1: Update `app-rpc`**

In the catch block at `supabase/functions/app-rpc/index.ts`, replace the status resolution and the `error` object. The existing code special-cases the disabled-account message by string comparison; that becomes unnecessary once Task 4 throws a `ClientSafeError` with a real status.

Replace:

```ts
    const status =
      error instanceof Error && error.message === 'This account is disabled.'
        ? 403
        : getErrorStatus(error);

    response = json(
      status,
      {
        error: {
          message:
            error instanceof Error ? error.message : 'Unexpected Edge RPC failure.',
        },
      },
```

with:

```ts
    // ClientSafeError and RpcError both carry a numeric `.status`, so
    // getErrorStatus resolves them directly. The old string comparison against
    // "This account is disabled." is gone: request-context.ts now throws a
    // ClientSafeError(403), so there is nothing left to special-case.
    const status = getErrorStatus(error);

    response = json(
      status,
      {
        error: {
          message:
            error instanceof Error ? error.message : 'Unexpected Edge RPC failure.',
          ...clientErrorExtras(error),
        },
      },
```

Add `clientErrorExtras` to the existing import from `../_shared/observability.ts`.

- [ ] **Step 2: Update `notifications`**

In the catch block at `supabase/functions/notifications/index.ts`, replace:

```ts
    const response = jsonResponse(status, {
      error: {
        message: error instanceof Error ? error.message : 'Unexpected notification failure.',
      },
```

with:

```ts
    const response = jsonResponse(status, {
      error: {
        message: error instanceof Error ? error.message : 'Unexpected notification failure.',
        ...clientErrorExtras(error),
      },
```

Add `clientErrorExtras` to the existing import from `../_shared/observability.ts`.

- [ ] **Step 3: Typecheck both functions**

Run from the `supabase/` directory, not the repo root — the root `package.json` makes Deno demand a `node_modules` that is not installed in this worktree:

```bash
cd supabase && deno check functions/app-rpc/index.ts functions/notifications/index.ts
```

**Expected: `Found 210 errors.` — and exit code 1.** This repo does not typecheck clean under `deno check`; 210 pre-existing strictness errors (mostly `TS18047 'x' is possibly null`) are the baseline on `main`. The bar for this task is **no NEW errors**, not zero errors.

To verify that, measure the baseline and compare:

```bash
git checkout <base-commit> -- supabase/functions/app-rpc/index.ts supabase/functions/notifications/index.ts
cd supabase && deno check functions/app-rpc/index.ts functions/notifications/index.ts
cd .. && git checkout HEAD -- supabase/functions/app-rpc/index.ts supabase/functions/notifications/index.ts
```

Both runs must report the same count. Confirm `git status` is clean afterwards.

- [ ] **Step 4: Confirm the string-compare is gone from the code path**

Run: `grep -rn "This account is disabled" supabase/functions/`

**Expected: exactly two hits, both harmless** — `app-rpc/index.ts` (inside the explanatory *comment* introduced in Step 1, which quotes the old string) and `_shared/request-context.ts` (the throw site itself, which Task 4 replaces).

What must NOT appear is a hit on a line performing a comparison — i.e. any surviving `error.message === 'This account is disabled.'`. Check the two hits are a comment and a `throw`, not a conditional.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/app-rpc/index.ts supabase/functions/notifications/index.ts
git commit -m "feat(edge): carry error code and details through both response envelopes"
```

---

## Task 4: The edge-function gate (C3a)

**Files:**
- Modify: `supabase/functions/_shared/request-context.ts`
- Create: `supabase/functions/_shared/request-context.test.ts`
- Modify: `supabase/functions/app-rpc/index.ts:3533`
- Modify: `package.json` (the `test:deno` script)

**Interfaces:**
- Consumes: `ClientSafeError` from Task 2; the `deletionRequestedAt` / `purgeScheduledAt` columns from Task 1.
- Produces: `assertAccountAccessible(profile, options)` and `getAuthenticatedRequestContext(request, options?)` where `options` is `{ allowPendingDeletion?: boolean }`.

**Design note:** the access decision is extracted into a pure function so it can be unit-tested without a database or a live JWT. `getAuthenticatedRequestContext` keeps doing the I/O and delegates the decision.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/request-context.test.ts`:

```ts
import { assertAccountAccessible } from './request-context.ts';

const base = { uid: 'u1', email: 'a@b.co', role: 'customer' };

Deno.test('a healthy account passes', () => {
  assertAccountAccessible({ ...base, accountDisabled: false, deletionRequestedAt: null });
});

Deno.test('a disabled account is rejected with 403', () => {
  try {
    assertAccountAccessible({ ...base, accountDisabled: true, deletionRequestedAt: null });
  } catch (error) {
    if ((error as { status?: number }).status !== 403) throw new Error('should be 403');
    return;
  }
  throw new Error('should have thrown');
});

Deno.test('a pending-deletion account is rejected with the code and purge date', () => {
  try {
    assertAccountAccessible({
      ...base,
      accountDisabled: false,
      deletionRequestedAt: '2026-08-07T00:00:00.000Z',
      purgeScheduledAt: '2026-09-06T00:00:00.000Z',
    });
  } catch (error) {
    const typed = error as { status?: number; code?: string; details?: Record<string, unknown> };
    if (typed.status !== 403) throw new Error('should be 403');
    if (typed.code !== 'ACCOUNT_PENDING_DELETION') throw new Error('should carry the code');
    if (typed.details?.purgeScheduledAt !== '2026-09-06T00:00:00.000Z') {
      throw new Error('should carry the purge date');
    }
    return;
  }
  throw new Error('should have thrown');
});

Deno.test('the exemption lets a pending-deletion account through', () => {
  assertAccountAccessible(
    { ...base, accountDisabled: false, deletionRequestedAt: '2026-08-07T00:00:00.000Z' },
    { allowPendingDeletion: true }
  );
});

Deno.test('the exemption does NOT rescue a disabled account', () => {
  try {
    assertAccountAccessible(
      { ...base, accountDisabled: true, deletionRequestedAt: '2026-08-07T00:00:00.000Z' },
      { allowPendingDeletion: true }
    );
  } catch (error) {
    // Disabled is checked first, so this is the disabled rejection, not the
    // deletion one — it must NOT carry the pending-deletion code.
    if ((error as { status?: number }).status !== 403) throw new Error('should be 403');
    if ((error as { code?: string }).code !== undefined) {
      throw new Error('disabled rejection must not carry ACCOUNT_PENDING_DELETION');
    }
    return;
  }
  throw new Error('should have thrown');
});
```

- [ ] **Step 2: Register the test file**

Add `supabase/functions/_shared/request-context.test.ts` to the `test:deno` file list in `package.json`.

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test:deno`
Expected: FAIL — `assertAccountAccessible` is not exported.

- [ ] **Step 4: Implement the gate**

In `supabase/functions/_shared/request-context.ts`:

Add the import:

```ts
import { ClientSafeError } from './observability.ts';
```

Extend the `UserProfile` type:

```ts
type UserProfile = {
  accountDisabled?: boolean | null;
  deletionRequestedAt?: string | null;
  email?: string | null;
  purgeScheduledAt?: string | null;
  role?: string | null;
  uid: string;
};
```

Add the exported types and decision function above `getAuthenticatedRequestContext`:

```ts
export type AccountAccessOptions = {
  /**
   * Only `cancelAccountDeletion` sets this. Everything else must be refused
   * while a deletion is pending, including all of the notifications function.
   */
  allowPendingDeletion?: boolean;
};

export const ACCOUNT_PENDING_DELETION_CODE = 'ACCOUNT_PENDING_DELETION';

/**
 * The access decision, kept pure so it can be tested without a database.
 * Disabled is checked first: a disabled account is refused even when the
 * pending-deletion exemption is in play.
 */
export const assertAccountAccessible = (
  profile: UserProfile,
  options: AccountAccessOptions = {}
): void => {
  if (profile.accountDisabled) {
    throw new ClientSafeError(403, 'This account is disabled.');
  }

  if (profile.deletionRequestedAt && options.allowPendingDeletion !== true) {
    throw new ClientSafeError(403, 'This account is scheduled for deletion.', {
      code: ACCOUNT_PENDING_DELETION_CODE,
      details: { purgeScheduledAt: profile.purgeScheduledAt ?? null },
    });
  }
};
```

Change the select to fetch the new columns, replace the inline disabled check, and thread the options through:

```ts
export const getAuthenticatedRequestContext = async (
  request: Request,
  options: AccountAccessOptions = {}
): Promise<AuthenticatedRequestContext> => {
```

```ts
  const { data: userProfile, error } = await serviceClient
    .from('user_profiles')
    .select('uid, email, role, accountDisabled, deletionRequestedAt, purgeScheduledAt')
    .eq('uid', uid)
    .maybeSingle<UserProfile>();
```

Replace:

```ts
  if (userProfile.accountDisabled) {
    throw new Error('This account is disabled.');
  }
```

with:

```ts
  assertAccountAccessible(userProfile, options);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:deno`
Expected: PASS.

- [ ] **Step 6: Wire the single exemption in `app-rpc`**

At `supabase/functions/app-rpc/index.ts:3533`, replace:

```ts
  const context = await getAuthenticatedRequestContext(request);
```

with:

```ts
  // Restoring an account is the one thing a pending-deletion user may still do.
  // Every other action, and all of the notifications function, is refused.
  const context = await getAuthenticatedRequestContext(request, {
    allowPendingDeletion: action === 'cancelAccountDeletion',
  });
```

- [ ] **Step 7: Verify the exemption appears exactly once**

Run: `grep -rn "allowPendingDeletion: " supabase/functions/`
Expected: exactly one hit, in `app-rpc/index.ts`. If `notifications/index.ts` appears, remove it — that function has no exempt actions.

- [ ] **Step 8: Typecheck**

Run from the `supabase/` directory, not the repo root:

```bash
cd supabase && deno check functions/app-rpc/index.ts functions/notifications/index.ts functions/_shared/request-context.ts
```

**Expected: a non-zero error count and exit code 1.** This repo carries 210 pre-existing `deno check` errors on `main` (mostly `TS18047 'x' is possibly null`); that is the baseline, not a regression. The bar is **no NEW errors** — compare against the same command run on this task's base commit, as described in Task 3 Step 3.

- [ ] **Step 9: Commit**

```bash
git add supabase/functions/_shared/request-context.ts supabase/functions/_shared/request-context.test.ts supabase/functions/app-rpc/index.ts package.json
git commit -m "feat(edge): refuse authenticated requests from accounts pending deletion"
```

---

## Task 5: The Data API gate (C3b)

**Files:**
- Create: `supabase/migrations/20260807b_account_deletion_data_api_gate.sql`

**Interfaces:**
- Consumes: the columns from Task 1.
- Produces: `public.ebuy_account_pending_deletion()` returning `boolean`; a hardened `ebuy_guard_useraccount_sensitive_update` trigger; tightened policies on three tables. Task 6 verifies all of it.

**Why this task exists:** `UserAccount`'s UPDATE policy is `uid = auth.uid()` with no column restriction. Without this task a pending-deletion user could `UPDATE` their own row over PostgREST and clear `deletionRequestedAt`, cancelling their own deletion and bypassing Task 4 entirely.

- [ ] **Step 1: Write the migration**

The trigger body below reproduces the live function in full — `CREATE OR REPLACE` replaces wholesale, so the existing guarded columns must all be carried over. The six deletion columns and the pending-deletion block are the additions.

```sql
-- Data API enforcement for the deletion grace period.
--
-- The edge-function gate (getAuthenticatedRequestContext) does not cover
-- PostgREST. The apps read and write UserAccount directly, and its UPDATE
-- policy is self-access with no column restriction, so without this a
-- pending-deletion user could clear their own deletionRequestedAt.

-- Does the CALLING user's own account have a deletion pending?
-- security definer so a policy on another table can consult UserAccount
-- without depending on UserAccount's own RLS.
create or replace function public.ebuy_account_pending_deletion()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public."UserAccount"
    where uid = (auth.uid())::text
      and "deletionRequestedAt" is not null
  );
$$;

revoke all on function public.ebuy_account_pending_deletion() from public;
grant execute on function public.ebuy_account_pending_deletion() to authenticated;

-- Full replacement of the existing guard. Everything before the deletion
-- columns is carried over verbatim from 20260613_useraccount_sensitive_update_guard.
create or replace function public.ebuy_guard_useraccount_sensitive_update()
returns trigger
language plpgsql
as $$
BEGIN
  IF COALESCE(auth.role(), '') = 'service_role'
     OR COALESCE(auth.jwt()->'app_metadata'->>'user_role', auth.jwt()->>'user_role') = 'admin' THEN
    RETURN NEW;
  END IF;

  -- While a deletion is pending, the row is frozen to its owner entirely.
  -- Checked before the column list so no self-write slips through.
  IF OLD."deletionRequestedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'account is pending deletion; direct updates are not allowed';
  END IF;

  IF NEW."accountDisabled" IS DISTINCT FROM OLD."accountDisabled"
     OR NEW."disabledAt" IS DISTINCT FROM OLD."disabledAt"
     OR NEW."disabledByUid" IS DISTINCT FROM OLD."disabledByUid"
     OR NEW."lastPrivilegedRole" IS DISTINCT FROM OLD."lastPrivilegedRole"
     OR NEW."roleDisplay" IS DISTINCT FROM OLD."roleDisplay"
     OR NEW."partnerApplicationStatus" IS DISTINCT FROM OLD."partnerApplicationStatus"
     OR NEW."partnerApplicationReviewedAt" IS DISTINCT FROM OLD."partnerApplicationReviewedAt"
     OR NEW."partnerApplicationRejectionReason" IS DISTINCT FROM OLD."partnerApplicationRejectionReason"
     OR NEW."dispatchApplicationStatus" IS DISTINCT FROM OLD."dispatchApplicationStatus"
     OR NEW."dispatchApplicationReviewedAt" IS DISTINCT FROM OLD."dispatchApplicationReviewedAt"
     OR NEW."dispatchApplicationRejectionReason" IS DISTINCT FROM OLD."dispatchApplicationRejectionReason"
     OR NEW."restaurantId" IS DISTINCT FROM OLD."restaurantId"
     OR NEW."restaurantName" IS DISTINCT FROM OLD."restaurantName"
     OR NEW."restaurantLinkedAt" IS DISTINCT FROM OLD."restaurantLinkedAt"
     OR NEW."restaurantLinkSource" IS DISTINCT FROM OLD."restaurantLinkSource"
     OR NEW."emailVerified" IS DISTINCT FROM OLD."emailVerified"
     OR NEW."deletionRequestedAt" IS DISTINCT FROM OLD."deletionRequestedAt"
     OR NEW."purgeScheduledAt" IS DISTINCT FROM OLD."purgeScheduledAt"
     OR NEW."deletionCancelTokenHash" IS DISTINCT FROM OLD."deletionCancelTokenHash"
     OR NEW."purgeAttemptCount" IS DISTINCT FROM OLD."purgeAttemptCount"
     OR NEW."purgeLastAttemptAt" IS DISTINCT FROM OLD."purgeLastAttemptAt"
     OR NEW."purgeLastError" IS DISTINCT FROM OLD."purgeLastError" THEN
    RAISE EXCEPTION 'direct updates to sensitive UserAccount fields are not allowed';
  END IF;

  RETURN NEW;
END;
$$;

-- The other three client-writable tables. Admins stay unaffected; only the
-- self-service branch gains the condition.
alter policy "UserRole self insert customer or admin"
  on public."UserRole"
  with check (
    (
      "userId" = (auth.uid())::text
      and role = 'customer'::"AppRole"
      and "assignedByUid" is null
      and not public.ebuy_account_pending_deletion()
    )
    or coalesce(
      (auth.jwt() -> 'app_metadata') ->> 'user_role',
      auth.jwt() ->> 'user_role'
    ) = 'admin'
  );

alter policy "Users can create their own policy acceptances"
  on public."UserPolicyAcceptance"
  with check (
    "userId" = (auth.uid())::text
    and not public.ebuy_account_pending_deletion()
  );

alter policy "Customers can add their own favorites"
  on public."CustomerFavoriteRestaurant"
  with check (
    "customerId" = (auth.uid())::text
    and not public.ebuy_account_pending_deletion()
  );

alter policy "Customers can update their own favorites"
  on public."CustomerFavoriteRestaurant"
  using (
    "customerId" = (auth.uid())::text
    and not public.ebuy_account_pending_deletion()
  )
  with check (
    "customerId" = (auth.uid())::text
    and not public.ebuy_account_pending_deletion()
  );

alter policy "Customers can delete their own favorites"
  on public."CustomerFavoriteRestaurant"
  using (
    "customerId" = (auth.uid())::text
    and not public.ebuy_account_pending_deletion()
  );
```

- [ ] **Step 2: Apply it**

Run: `npx supabase migration up --local`, or apply with the Supabase MCP `apply_migration` tool.

- [ ] **Step 3: Verify the trigger is still attached**

`CREATE OR REPLACE FUNCTION` does not drop triggers, but confirm anyway:

```sql
select tgname, tgenabled from pg_trigger
where tgrelid = 'public."UserAccount"'::regclass and not tgisinternal;
```

Expected: the existing guard trigger, `tgenabled = 'O'`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260807b_account_deletion_data_api_gate.sql
git commit -m "feat(db): block Data API writes from accounts pending deletion"
```

---

## Task 6: Integration check against real RLS

**Files:**
- Create: `scripts/verify-deletion-rls.sql`

**Interfaces:**
- Consumes: everything from Tasks 1 and 5.
- Produces: nothing consumed by later tasks. This is the acceptance gate for C3b.

**Why this task exists:** the unit tests in Task 4 prove the *decision* is right. They cannot prove RLS and the trigger actually stop a real JWT-bearing client. This runs against the real policies by impersonating `authenticated` with a forged claims setting, inside a transaction that always rolls back.

- [ ] **Step 1: Write the verification script**

Create `scripts/verify-deletion-rls.sql`:

```sql
-- Verifies the C3b Data API gate against the real policies and trigger.
-- Runs entirely inside a transaction that is rolled back, so it is safe to
-- execute against any environment including production.
--
-- Every "should fail" block raises if the statement UNEXPECTEDLY SUCCEEDS.

begin;

-- A disposable account already in the pending-deletion state.
insert into public."UserAccount" (uid, email, "displayName", "emailVerified", "roleDisplay",
                                  "createdAt", "updatedAt",
                                  "deletionRequestedAt", "purgeScheduledAt")
values ('rls-probe-uid', 'rls-probe@example.test', 'RLS Probe', true, 'customer',
        now(), now(), now(), now() + interval '30 days');

-- Impersonate that user over the Data API.
set local role authenticated;
set local request.jwt.claims = '{"sub":"rls-probe-uid","role":"authenticated","app_metadata":{}}';

-- 1. Self-cancel must be impossible. This is the hole C3b closes.
do $$
begin
  update public."UserAccount" set "deletionRequestedAt" = null where uid = 'rls-probe-uid';
  raise exception 'FAIL: a pending-deletion user cleared their own deletionRequestedAt';
exception
  when sqlstate 'P0001' then
    if sqlerrm like 'FAIL:%' then raise; end if;  -- our own failure, re-raise
    raise notice 'PASS: self-cancel blocked (%)', sqlerrm;
end $$;

-- 2. Any other self-write to the row must also be refused.
do $$
begin
  update public."UserAccount" set "displayName" = 'Renamed' where uid = 'rls-probe-uid';
  raise exception 'FAIL: a pending-deletion user updated their own profile';
exception
  when sqlstate 'P0001' then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'PASS: profile write blocked (%)', sqlerrm;
end $$;

-- 3. Writes to the other client-writable tables must be refused.
do $$
begin
  insert into public."CustomerFavoriteRestaurant" ("customerId", "restaurantId")
  values ('rls-probe-uid', 'any-restaurant');
  raise exception 'FAIL: a pending-deletion user added a favorite';
exception
  when insufficient_privilege or check_violation then
    raise notice 'PASS: favorite insert blocked';
  when sqlstate 'P0001' then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'PASS: favorite insert blocked (%)', sqlerrm;
  when others then
    raise notice 'PASS: favorite insert blocked (%)', sqlerrm;
end $$;

-- 4. Reads must STILL work — profile hydration depends on them.
do $$
declare
  found_uid text;
begin
  select uid into found_uid from public."user_profiles" where uid = 'rls-probe-uid';
  if found_uid is null then
    raise exception 'FAIL: a pending-deletion user cannot read their own profile';
  end if;
  raise notice 'PASS: self-read still permitted';
end $$;

-- 5. The helper agrees.
do $$
begin
  if not public.ebuy_account_pending_deletion() then
    raise exception 'FAIL: ebuy_account_pending_deletion() returned false for a pending account';
  end if;
  raise notice 'PASS: helper reports pending deletion';
end $$;

reset role;
rollback;
```

- [ ] **Step 2: Run it**

Against a local stack: `psql "$DATABASE_URL" -f scripts/verify-deletion-rls.sql`
Otherwise paste it into the Supabase MCP `execute_sql` tool.

Expected: five `PASS:` notices and no `FAIL:`. The final `ROLLBACK` leaves nothing behind.

- [ ] **Step 3: Prove the test can fail**

Temporarily comment out the `OLD."deletionRequestedAt" IS NOT NULL` block in the trigger, re-apply, and re-run the script.
Expected: check 1 reports `FAIL: a pending-deletion user cleared their own deletionRequestedAt`.

Restore the trigger and re-run. Expected: all five PASS again.

A verification script that cannot fail proves nothing — do not skip this step.

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-deletion-rls.sql
git commit -m "test(db): verify the pending-deletion Data API gate against real RLS"
```

---

## Task 7: Full suite and handoff state

**Files:**
- Modify: none expected.

- [ ] **Step 1: Run everything**

Run: `npm test`
Expected: `test:node` and `test:deno` both pass, including the two new Deno test files.

- [ ] **Step 2: Typecheck the edge functions**

Run from the `supabase/` directory:

```bash
cd supabase && deno check functions/app-rpc/index.ts functions/notifications/index.ts functions/_shared/request-context.ts functions/_shared/observability.ts
```

**Expected: a non-zero error count and exit code 1** — 210 pre-existing errors is the `main` baseline for this repo. The bar is no NEW errors versus `origin/main`, not zero errors. Do not attempt to fix the pre-existing ones; they are out of scope for this branch.

- [ ] **Step 3: Confirm the branch state**

Run: `git log --oneline origin/main..HEAD`
Expected: the design commits plus six implementation commits from this plan.

- [ ] **Step 4: Record what is deliberately NOT done**

C3a and C3b are complete, but nothing yet *sets* `deletionRequestedAt` — that is C2, and `cancelAccountDeletion` does not exist yet either, so the exemption in Task 4 currently names an action that no handler serves. This is expected and safe: the gate is inert until C2 ships, and the exemption is a no-op until then. Do not "fix" it by removing the exemption.

**Deployment note:** `app-rpc` in production is already behind `main` (partner onboarding stages 1–2 merged but were never deployed). Deploying this work will carry those changes too. Deploy only from a `main`-current worktree, and verify the deployed source afterwards — a stale worktree previously reverted `app-rpc` to pricing v1 in production.

---

## Self-Review

**Spec coverage (C3a / C3b sections of the design):**

| Spec requirement | Task |
|---|---|
| Columns + partial index | 1 |
| `user_profiles` view carries the new columns | 1 |
| `ClientSafeError` gains `code` / `details` | 2 |
| Both envelopes serialize them | 3 |
| Retire the `'This account is disabled.'` string compare | 3 |
| Gate in `getAuthenticatedRequestContext` | 4 |
| `allowPendingDeletion` for `cancelAccountDeletion` only | 4 |
| Structured 403 with code + purge date | 2, 4 |
| Trigger covers the deletion columns | 5 |
| No self-writes at all during grace | 5 |
| `ebuy_account_pending_deletion()` helper | 5 |
| Policy conditions on the other three tables | 5 |
| SELECT stays permitted | 5 (unchanged), verified in 6 |
| Integration test against real RLS, not the RPC | 6 |

No gaps.

**Naming consistency:** `assertAccountAccessible`, `AccountAccessOptions`, `allowPendingDeletion`, `ACCOUNT_PENDING_DELETION_CODE`, `clientErrorExtras`, `ClientSafeErrorOptions`, `ebuy_account_pending_deletion` — each defined once and used with the same spelling in every later task.

**Out of scope, tracked in the design:** C2 (request/cancel), C4 (screen), C5 (purge runner), C6 (admin view), and A, B, E.
