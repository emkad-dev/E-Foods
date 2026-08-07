# Partner Payout Activation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make admin approval of a partner application create the Paystack subaccount and activate the payout profile, so no restaurant can go live without a working payout route.

**Architecture:** The approval decision already exists in `adminReviewPartnerApplication`. This plan adds the payout half: submit writes `RestaurantKyc` + `RestaurantPayout` rows in `pending`, and approval resolves the bank account through Paystack, creates a subaccount exactly once, mirrors the code onto `RestaurantRecord`, and flips the payout row to `active`. The sequencing and idempotency rule is extracted into a pure module so it is unit-testable without a network or database, matching the existing `partnerApplicationTransitions.ts` pattern.

**Tech Stack:** Deno edge functions (`supabase/functions/_shared`), Supabase Postgres + Storage, Paystack REST API, `Deno.test` with hand-rolled assertions (no test framework).

## Scope note — read before starting

The source spec (`docs/superpowers/specs/2026-08-07-partner-onboarding-single-flow-kyc-bank-subaccount-design.md`) covers **three** independent subsystems. This plan is **only the backend payout/KYC activation**. The other two need their own plans and are explicitly out of scope here:

- **Partner wizard UI** (spec §1, §8) — single-flow signup, resume-after-email-confirm, rejection/resubmit routing, folding `complete-restaurant-details.tsx` into the wizard.
- **Payment split at checkout** (spec §6) — attaching the subaccount to Paystack transaction init. Note `_shared/orders.ts:76` declares `splitSubaccountCode` but **nothing reads it** — it is dead today.

**The spec's "Current state being replaced" section is stale.** Verified against `feature/parity` at `396fa7c`, these are already done and must NOT be rebuilt:

- `submitPartnerApplication` already creates `pending` and grants no role/restaurant (`_shared/domains/partner.ts:805`).
- `adminReviewPartnerApplication` already exists with approve/reject, already-reviewed guards, and creates `RestaurantRecord` with `isPublished=false` (`_shared/domains/admin.ts:459`).
- `RestaurantKyc`, `RestaurantPayout`, `RestaurantHours` tables exist with RLS enabled (`supabase/migrations/20260731_partner_kyc_payout_hours.sql`).
- The `application-under-review.tsx` pending screen exists.

## Global Constraints

- KYC and payout data is **service-role only**. No RLS policy may grant client read.
- Identity documents go to a **private** bucket, never the public restaurant asset bucket.
- Account numbers are **never** returned in full outside the service-role path. Admin responses carry `accountLast4` and `resolvedAccountName` only.
- Logs must never print full bank details or document content.
- Subaccount creation is **idempotent** — an existing `paystackSubaccountCode` is reused, never re-created.
- `percentage_charge = 0` on every subaccount. The platform's take is the embedded menu markup (pricing v2: menu price = restaurant × 1.20 + ₦100/unit, `partnerServiceRate = 0`), not a Paystack commission.
- A payout failure leaves the application **non-approved** and surfaces the error to the reviewer. Never approve with a failed payout.
- New `.test.ts` files must be registered in `package.json`'s `test:deno` script or they never run.

---

### Task 1: KYC schema — document type and review status

`RestaurantKyc` is NIN-only and has no review status. The spec requires `documentType` (`nin` | `tax_id`) and `status` (`pending` | `verified` | `rejected`). Column names stay as-is (`ninHash`, `ninLast4`, `ninFrontPath`, `ninBackPath`) to avoid a rewrite of existing rows — only the two new columns are added.

**Files:**
- Create: `supabase/migrations/20260807_kyc_document_type_status.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `RestaurantKyc.documentType TEXT NOT NULL DEFAULT 'nin'`, `RestaurantKyc.status TEXT NOT NULL DEFAULT 'pending'`. Task 4 writes both.

- [ ] **Step 1: Write the migration**

```sql
-- RestaurantKyc gained two columns the 2026-08-07 onboarding spec requires:
-- documentType, so a partner can present a Tax ID instead of a NIN, and
-- status, so review outcome lives on the KYC row rather than being inferred
-- from the application. Existing rows are all manually-reviewed NINs, so the
-- defaults backfill them correctly without a data migration.
ALTER TABLE "public"."RestaurantKyc"
  ADD COLUMN IF NOT EXISTS "documentType" TEXT NOT NULL DEFAULT 'nin',
  ADD COLUMN IF NOT EXISTS "status"       TEXT NOT NULL DEFAULT 'pending';

ALTER TABLE "public"."RestaurantKyc"
  DROP CONSTRAINT IF EXISTS "RestaurantKyc_documentType_check";
ALTER TABLE "public"."RestaurantKyc"
  ADD CONSTRAINT "RestaurantKyc_documentType_check"
  CHECK ("documentType" IN ('nin', 'tax_id'));

ALTER TABLE "public"."RestaurantKyc"
  DROP CONSTRAINT IF EXISTS "RestaurantKyc_status_check";
ALTER TABLE "public"."RestaurantKyc"
  ADD CONSTRAINT "RestaurantKyc_status_check"
  CHECK ("status" IN ('pending', 'verified', 'rejected'));
```

- [ ] **Step 2: Verify the migration is valid SQL without applying it**

Run: `npx supabase db lint --schema public` (if the CLI rejects offline linting, instead read the file back and confirm both `ADD COLUMN IF NOT EXISTS` lines and both `CHECK` constraints are present).
Expected: no syntax errors reported.

**Do NOT apply this migration.** Applying to production is an operator step — see "Operator steps" at the end of this plan.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260807_kyc_document_type_status.sql
git commit -m "feat(db): add documentType and status to RestaurantKyc"
```

---

### Task 2: Private KYC document bucket

No storage bucket exists for identity documents. Restaurant logos use a public bucket; KYC must not.

**Files:**
- Create: `supabase/migrations/20260807_kyc_private_bucket.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: storage bucket id `restaurant-kyc`, private. Task 4 writes object paths of the form `<restaurantId>/<documentType>-front-<timestamp>.<ext>` into `RestaurantKyc.ninFrontPath` / `ninBackPath`.

- [ ] **Step 1: Write the migration**

```sql
-- Identity documents must never sit in the public restaurant asset bucket.
-- public = false means no anon/authenticated read path exists at all; the only
-- way to read an object is the service-role key or a signed URL minted by a
-- service-role caller. Deliberately NO storage.objects policies are created:
-- absent policies mean absent client access, which is the posture we want.
INSERT INTO storage.buckets (id, name, public)
VALUES ('restaurant-kyc', 'restaurant-kyc', false)
ON CONFLICT (id) DO UPDATE SET public = false;
```

- [ ] **Step 2: Confirm no policy grants client access**

Run: `grep -rn "restaurant-kyc" supabase/migrations/`
Expected: only the bucket insert above. **Zero** `CREATE POLICY` statements naming `restaurant-kyc`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260807_kyc_private_bucket.sql
git commit -m "feat(db): add private restaurant-kyc storage bucket"
```

---

### Task 3: Pure payout activation rule

The idempotency and blocking rules decided without a database or network, mirroring `_shared/partnerApplicationTransitions.ts`.

**Files:**
- Create: `supabase/functions/_shared/partnerPayoutActivation.ts`
- Test: `supabase/functions/_shared/partnerPayoutActivation.test.ts`
- Modify: `package.json` (register the test in `test:deno`)

**Interfaces:**
- Consumes: nothing.
- Produces: `resolvePayoutActivationPlan(payout)` returning `PayoutActivationPlan`. Task 5 calls it.

- [ ] **Step 1: Write the failing test**

```ts
import { resolvePayoutActivationPlan } from './partnerPayoutActivation.ts';

const expectEqual = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
};

Deno.test('a missing payout row blocks approval', () => {
  for (const raw of [null, undefined]) {
    const plan = resolvePayoutActivationPlan(raw);
    expectEqual(plan.action, 'blocked', `action for ${JSON.stringify(raw)}`);
    expectEqual(plan.action === 'blocked' ? plan.httpStatus : null, 412, 'httpStatus');
  }
});

Deno.test('a payout row with no subaccount code creates one', () => {
  const plan = resolvePayoutActivationPlan({ paystackSubaccountCode: null, status: 'pending' });
  expectEqual(plan.action, 'create', 'action');
});

Deno.test('a blank subaccount code is treated as absent, not reused', () => {
  for (const raw of ['', '   ']) {
    const plan = resolvePayoutActivationPlan({ paystackSubaccountCode: raw, status: 'pending' });
    expectEqual(plan.action, 'create', `action for ${JSON.stringify(raw)}`);
  }
});

Deno.test('an existing subaccount code is reused, never re-created', () => {
  const plan = resolvePayoutActivationPlan({ paystackSubaccountCode: 'ACCT_x1y2', status: 'pending' });
  expectEqual(plan.action, 'reuse', 'action');
  expectEqual(plan.action === 'reuse' ? plan.subaccountCode : null, 'ACCT_x1y2', 'subaccountCode');
});

Deno.test('an already-active payout still reuses rather than re-creating', () => {
  const plan = resolvePayoutActivationPlan({ paystackSubaccountCode: 'ACCT_x1y2', status: 'active' });
  expectEqual(plan.action, 'reuse', 'action');
});

Deno.test('a previously failed payout with no code retries creation', () => {
  const plan = resolvePayoutActivationPlan({ paystackSubaccountCode: null, status: 'failed' });
  expectEqual(plan.action, 'create', 'action');
});
```

- [ ] **Step 2: Register the test and run it to verify it fails**

In `package.json`, add `supabase/functions/_shared/partnerPayoutActivation.test.ts` to the `test:deno` file list, immediately after `supabase/functions/_shared/partnerApplicationTransitions.test.ts`.

Run: `npm run test:deno`
Expected: FAIL — module `./partnerPayoutActivation.ts` not found.

- [ ] **Step 3: Write the implementation**

```ts
// Decides what approving a partner application must do about its payout
// profile, given only the current RestaurantPayout row. Extracted from the
// admin handler so the idempotency rule is unit testable without Paystack or
// a database, same as partnerApplicationTransitions.ts.
//
// The rule: an existing subaccount code is ALWAYS reused. A retried review
// must never create a second Paystack subaccount for one restaurant, and
// status is not part of that decision — a row can be 'failed' with a code
// already minted if a later step threw, and re-creating then would duplicate
// the payout account.

export type PayoutActivationPlan =
  | { action: 'reuse'; subaccountCode: string }
  | { action: 'create' }
  | { action: 'blocked'; httpStatus: 412; message: string };

const MISSING_PAYOUT_MESSAGE =
  'This partner has no payout details on file. They must resubmit onboarding with a bank account before approval.';

export const resolvePayoutActivationPlan = (
  payout: { paystackSubaccountCode?: string | null; status?: string | null } | null | undefined
): PayoutActivationPlan => {
  if (!payout) {
    return { action: 'blocked', httpStatus: 412, message: MISSING_PAYOUT_MESSAGE };
  }

  const existingCode = (payout.paystackSubaccountCode ?? '').trim();
  if (existingCode) {
    return { action: 'reuse', subaccountCode: existingCode };
  }

  return { action: 'create' };
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:deno`
Expected: PASS, with the six new `partnerPayoutActivation` tests counted in the total.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/partnerPayoutActivation.ts supabase/functions/_shared/partnerPayoutActivation.test.ts package.json
git commit -m "feat(backend): add pure payout activation rule"
```

---

### Task 4: Paystack bank resolve and subaccount create

`_shared/paystack.ts` already has a private `fetchPaystackJson` helper (line 80) that handles auth, timeout, and error shaping. Add two calls on top of it.

**Files:**
- Modify: `supabase/functions/_shared/paystack.ts` (append to end of file)

**Interfaces:**
- Consumes: the existing private `fetchPaystackJson({ method, path, body })` in the same file, and `sanitizeText` already imported there.
- Produces: `resolveBankAccount({ accountNumber, bankCode })` → `Promise<{ accountName: string }>`; `createPaystackSubaccount({ accountNumber, bankCode, businessName })` → `Promise<{ subaccountCode: string }>`. Task 5 calls both.

**Critical — what `fetchPaystackJson` returns.** Verified at `supabase/functions/_shared/paystack.ts:122`, its final statement is:

```ts
return (payload?.data ?? null) as JsonObject | null;
```

It returns Paystack's **`data` object already unwrapped**, not the full envelope. So read fields directly off the return value (`result.account_name`), never `result.data.account_name` — the latter is always `undefined`. Do **not** change this function's return value; `initializePaystackTransaction` and the other existing callers depend on it exactly as-is.

- [ ] **Step 1: Append the two functions**

```ts
// Confirms a bank account exists and returns the name the bank has on file.
// Called before subaccount creation so a typo'd account number fails review
// with a clear message instead of minting a subaccount that can never settle.
export const resolveBankAccount = async ({
  accountNumber,
  bankCode,
}: {
  accountNumber: string;
  bankCode: string;
}): Promise<{ accountName: string }> => {
  // fetchPaystackJson already unwraps `data` — this IS the data object.
  const data = await fetchPaystackJson({
    path: `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
  });

  return { accountName: sanitizeText((data as { account_name?: string } | null)?.account_name) };
};

// percentage_charge is 0 on purpose: the platform's revenue is the embedded
// menu markup (pricing v2), not a Paystack commission. Setting anything else
// here would double-charge the restaurant.
export const createPaystackSubaccount = async ({
  accountNumber,
  bankCode,
  businessName,
}: {
  accountNumber: string;
  bankCode: string;
  businessName: string;
}): Promise<{ subaccountCode: string }> => {
  const data = await fetchPaystackJson({
    method: 'POST',
    path: '/subaccount',
    body: {
      account_number: accountNumber,
      bank_code: bankCode,
      business_name: businessName,
      percentage_charge: 0,
    },
  });

  const subaccountCode = sanitizeText((data as { subaccount_code?: string } | null)?.subaccount_code);
  if (!subaccountCode) {
    fail(500, 'Paystack created the subaccount but returned no subaccount code.');
  }

  return { subaccountCode };
};
```

- [ ] **Step 2: Confirm the existing callers still compile**

Run: `npx deno check supabase/functions/_shared/paystack.ts`
Expected: no new errors beyond the repo's known baseline. `fetchPaystackJson` must be unchanged.

- [ ] **Step 3: Verify the type baseline is unchanged**

Run: `node scripts/check-deno-types.mjs`
Expected: `OK - error set matches the committed baseline exactly.`

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/paystack.ts
git commit -m "feat(backend): add Paystack bank resolve and subaccount create"
```

---

### Task 5: Activate payout during admin approval

Wire Tasks 3 and 4 into `adminReviewPartnerApplication`. The approve branch begins around `_shared/domains/admin.ts:508` (`if (decision === 'approve')`).

**Files:**
- Modify: `supabase/functions/_shared/domains/admin.ts`

**Interfaces:**
- Consumes: `resolvePayoutActivationPlan` (Task 3), `resolveBankAccount` + `createPaystackSubaccount` (Task 4).
- Produces: on success `RestaurantPayout.status = 'active'` with `paystackSubaccountCode` set, the same code mirrored onto `RestaurantRecord.paystackSubaccountCode`, and the application `approved`.

- [ ] **Step 1: Add the imports**

```ts
import { resolvePayoutActivationPlan } from '../partnerPayoutActivation.ts';
import { createPaystackSubaccount, resolveBankAccount } from '../paystack.ts';
```

- [ ] **Step 2: Insert payout activation between `restaurantId` assignment and the role grant**

**Exact insertion point — this matters more than anything else in this task.** The approve branch currently reads:

```
508  if (decision === 'approve') {
509    restaurantId = sanitizeText(application.restaurantId) || crypto.randomUUID();
510    await syncUserRoleState(applicationId, 'restaurant', context.uid, {   <-- grants the restaurant role
520    await updateUserAccount(applicationId, {                              <-- sets status APPROVED
529    const { error: restaurantError } = await serviceClient.from('RestaurantRecord').upsert(
```

Insert the block below **after line 509 and before line 510**.

Not at the top of the branch: `restaurantId` is not assigned until 509, so inserting above it reads `null`. Not after 510/520 either: `syncUserRoleState` grants the restaurant role and `updateUserAccount` writes `partnerApplicationStatus: APPROVED`, and neither is rolled back when a later `throw` unwinds. Activating after them would leave a partner approved and role-bearing with a failed payout — exactly the posture this plan's Global Constraints forbid and the reason parity Task 7 [C1]'s failure bullet was amended. Activation must be the first thing that can fail in this branch.

```ts
  const { data: payoutRow } = await serviceClient
    .from('RestaurantPayout')
    .select('id,restaurantId,bankCode,accountNumber,paystackSubaccountCode,status')
    .eq('restaurantId', restaurantId)
    .maybeSingle();

  const activationPlan = resolvePayoutActivationPlan(payoutRow);
  if (activationPlan.action === 'blocked') {
    fail(activationPlan.httpStatus, activationPlan.message);
  }

  let subaccountCode: string;
  let resolvedAccountName: string | null = null;

  if (activationPlan.action === 'reuse') {
    subaccountCode = activationPlan.subaccountCode;
  } else {
    try {
      // Resolve first: a bad account number must fail before a subaccount exists.
      const resolved = await resolveBankAccount({
        accountNumber: payoutRow!.accountNumber,
        bankCode: payoutRow!.bankCode,
      });
      const created = await createPaystackSubaccount({
        accountNumber: payoutRow!.accountNumber,
        bankCode: payoutRow!.bankCode,
        businessName: sanitizeText(application.restaurantName, 'FEASTY partner'),
      });
      subaccountCode = created.subaccountCode;
      resolvedAccountName = resolved.accountName;
    } catch (error) {
      // Record the failure and let the throw unwind before the role grant.
      // clientErrorMessage keeps the raw Paystack error server-side; never log
      // payoutRow itself, it carries the full account number.
      await serviceClient
        .from('RestaurantPayout')
        .update({ status: 'failed', lastError: clientErrorMessage(error), updatedAt: reviewedAt })
        .eq('id', payoutRow!.id);
      throw error;
    }
  }

  // One activation write serves both paths — a reused code re-asserts 'active'
  // (a prior run may have left the row 'failed' after minting the code), and a
  // freshly created one is persisted here rather than inside the try block.
  await serviceClient
    .from('RestaurantPayout')
    .update({
      paystackSubaccountCode: subaccountCode,
      status: 'active',
      lastError: null,
      updatedAt: reviewedAt,
      ...(resolvedAccountName ? { resolvedAccountName } : {}),
    })
    .eq('id', payoutRow!.id);
```

Then add `paystackSubaccountCode: subaccountCode,` to the existing `RestaurantRecord` upsert object.

- [ ] **Step 3: Confirm `clientErrorMessage` is imported**

Run: `grep -n "clientErrorMessage" supabase/functions/_shared/domains/admin.ts`
Expected: an existing import from `../observability.ts`. If absent, add `import { clientErrorMessage } from '../observability.ts';`.

- [ ] **Step 4: Verify types and the full suite**

Run: `node scripts/check-deno-types.mjs && npm test`
Expected: baseline unchanged, and both suites pass (`test:node` and `test:deno`).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/domains/admin.ts
git commit -m "feat(backend): create Paystack subaccount on partner approval"
```

---

## Deferred to the wizard plan

Spec §3 requires submit to write the `RestaurantKyc` and `RestaurantPayout` rows. That write is driven entirely by wizard step 3 (document upload + bank fields), which does not exist yet, so it belongs with the wizard plan rather than here. **Until that lands, Task 5's `blocked` branch is the live behaviour for every application** — approval fails with a clear 412 until payout details exist. That is the correct fail-closed posture, not a regression.

## Operator steps

The agent cannot run these — its safety classifier blocks `supabase` deploys, and both are live-surface changes:

1. Apply `20260807_kyc_document_type_status.sql` and `20260807_kyc_private_bucket.sql` to the Frankfurt project.
2. Deploy `feasty-admin` (the domain function carrying `adminReviewPartnerApplication`). Note `deploy-feasty-admin.yml` is path-filtered on `supabase/functions/feasty-admin/**`, `_shared/**`, and `supabase/config.toml` — Task 5 edits `_shared/domains/admin.ts`, so a push to `main` triggers it automatically.
3. Confirm `PAYSTACK_SECRET_KEY` is the live key before the first real approval. Per `feasty-paystack-config`, the deploy script syncs `functions/.env` → secrets on every run and has clobbered real keys with placeholders before.

## Self-review

- **Spec coverage:** §2 lifecycle → Task 5. §3 data model → Tasks 1, 2 (KYC columns, private bucket); the row *writes* are deferred above with a reason. §4 activation sequence → Tasks 3, 4, 5. §7 security → Global Constraints + Task 2's no-policy posture + Task 5's `clientErrorMessage`. §9 idempotency → Task 3. §1, §8 (wizard) and §6 (payment split) are out of scope by the scope note. §5 publishing is already enforced — `RestaurantRecord` is created `isPublished=false`.
- **Placeholders:** none — every step carries runnable SQL, TypeScript, or an exact command.
- **Type consistency:** `resolvePayoutActivationPlan` returns the same three-variant `PayoutActivationPlan` in Task 3's test, Task 3's implementation, and Task 5's consumption. `subaccountCode` is spelled identically in Task 4's return type and Task 5's use. Column names (`resolvedAccountName`, `accountLast4`, `ninHash`) match the live schema read from `20260731_partner_kyc_payout_hours.sql`, not the spec's aspirational names.
