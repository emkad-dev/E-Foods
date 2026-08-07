# Partner Onboarding Single Flow KYC, Bank Setup, and Deferred Subaccount Activation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current split partner signup flow with one onboarding wizard that captures restaurant identity, KYC, and bank details once, then creates the Paystack subaccount only after verification and routes the partner into the menu builder when approved.

**Architecture:** Keep the existing partner auth shell, but make `register.tsx` only create the login and let `complete-restaurant-details.tsx` become the resumed onboarding wizard after email verification. Move the sensitive KYC/bank payload through service-role RPCs and private storage, not public bucket uploads. Use `app-rpc` as the approval boundary: it owns onboarding state, subaccount activation, restaurant approval, and the final handoff into the partner shell.

**Tech Stack:** Prisma migrations, Supabase Postgres, Supabase Storage, Deno edge functions, Expo Router / React Native, React web admin, Node + Deno tests.

**Spec:** `docs/superpowers/specs/2026-08-07-partner-onboarding-single-flow-kyc-bank-subaccount-design.md`

---

## Global Constraints

- Do not touch customer app flows unless a payment split or shared entity type requires it.
- Keep KYC documents private. Use signed upload URLs or a service-role upload path; do not expose a public bucket.
- Keep the existing partner application and restaurant approval records as the workflow anchors. New tables may be added, but the app should still resolve the partner from the existing `uid`/`restaurantId` relationships.
- The restaurant must not be marked approved until the Paystack subaccount exists and the payout profile is active.
- Add every new test file to the root `package.json` `test:node` / `test:deno` file lists, or it will never run.
- Commit after each task so review stays bounded.

---

## File Structure

**Created:**
- `functions/prisma/migrations/20260807_partner_onboarding_single_flow_kyc_bank_subaccount/migration.sql` - new tables, storage bucket, and policies.
- `supabase/functions/_shared/partnerOnboarding.ts` - pure onboarding helpers for state, validation, upload-path generation, and approval readiness.
- `supabase/functions/_shared/partnerOnboarding.test.ts` - unit tests for the shared helpers.
- `supabase/functions/app-rpc/partnerOnboarding.test.ts` - Deno tests for the onboarding RPC helpers / approval flow.
- `apps/partner/src/services/partnerOnboardingDraft.ts` - AsyncStorage persistence for the in-progress wizard.
- `apps/partner/src/services/partnerVerificationUploads.ts` - client helper for requesting signed KYC upload URLs and submitting document metadata.
- `apps/partner/src/components/PartnerOnboardingWizard.tsx` - shared multi-step onboarding UI for the partner auth shell.
- `apps/admin-web/src/components/PartnerOnboardingReview.tsx` - review block for KYC and payout details.

**Modified:**
- `functions/prisma/schema.prisma` - add `RestaurantKyc` and `RestaurantPayout`, plus any `RestaurantRecord`/`PartnerApplicationRecord` fields needed for the workflow.
- `package.json` - register the new test files in `test:node` / `test:deno`.
- `apps/partner/app/(auth)/register.tsx` - login creation only, no restaurant completion payload.
- `apps/partner/app/(partner)/complete-restaurant-details.tsx` - resume the onboarding wizard after sign-in, collect restaurant + KYC + payout data, and hand off to the menu builder after approval.
- `apps/partner/app/(partner)/_layout.tsx` - route non-restaurants into the onboarding wizard or pending screen instead of a bare completion shell.
- `apps/partner/src/contexts/AuthContext.tsx` - persist/resume onboarding state and route approved partners straight to the restaurant shell.
- `apps/partner/src/contexts/partnerAuthFlow.ts` - add route-state helpers for pending verification and rejection.
- `apps/partner/src/services/partnerApplications.ts` - expand the onboarding submit input.
- `apps/partner/src/services/partnerRestaurantActions.ts` - add any client helpers needed for approval-state refresh.
- `apps/partner/src/services/supabase/profile.ts` - expose new profile fields if the wizard needs to resume from persisted user data.
- `apps/admin-web/src/services/platformReads.ts` - surface the richer approval queue payload.
- `apps/admin-web/src/services/approvalActions.ts` - keep the review action aligned with the new approval contract.
- `apps/admin-web/src/pages/ApprovalsPage.tsx` - show KYC, payout, and approval state.
- `packages/domain/src/entities.ts` - add the new document fields used by partner/admin reads.
- `packages/auth/src/profileApi.ts` - include the new fields in profile hydration.
- `supabase/functions/app-rpc/index.ts` - the submit, review, approval, upload-url, and payment-init logic.

---

### Task 1: Database and storage foundation

**Files:**
- Modify: `functions/prisma/schema.prisma`
- Create: `functions/prisma/migrations/20260807_partner_onboarding_single_flow_kyc_bank_subaccount/migration.sql`

**Interfaces:**
- Consumes: current `RestaurantRecord`, `PartnerApplicationRecord`, and `UserAccount` schema.
- Produces: `RestaurantKyc`, `RestaurantPayout`, private KYC storage bucket, and the approval-ready columns required by the onboarding flow.

- [ ] **Step 1: Write the schema and migration**

Add `RestaurantKyc` and `RestaurantPayout` to Prisma, then create the migration with:

```sql
CREATE TABLE IF NOT EXISTS "public"."RestaurantKyc" (
  "id" TEXT PRIMARY KEY,
  "uid" TEXT NOT NULL UNIQUE,
  "restaurantId" TEXT,
  "legalName" TEXT NOT NULL,
  "documentType" TEXT NOT NULL,
  "documentNumberHash" TEXT NOT NULL,
  "documentLast4" TEXT NOT NULL,
  "documentFrontPath" TEXT NOT NULL,
  "documentBackPath" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "verifiedByUid" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "reviewNotes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "public"."RestaurantPayout" (
  "id" TEXT PRIMARY KEY,
  "uid" TEXT NOT NULL UNIQUE,
  "restaurantId" TEXT,
  "bankCode" TEXT NOT NULL,
  "bankName" TEXT NOT NULL,
  "accountNumber" TEXT NOT NULL,
  "accountLast4" TEXT NOT NULL,
  "accountName" TEXT NOT NULL,
  "paystackSubaccountCode" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "storage"."buckets" ("id", "name", "public", "file_size_limit", "allowed_mime_types")
VALUES (
  'partner-verification-documents',
  'partner-verification-documents',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'application/pdf']
)
ON CONFLICT ("id") DO UPDATE
SET
  "public" = EXCLUDED."public",
  "file_size_limit" = EXCLUDED."file_size_limit",
  "allowed_mime_types" = EXCLUDED."allowed_mime_types";
```

- [ ] **Step 2: Validate the schema**

Run: `npm run db:validate`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add functions/prisma/schema.prisma functions/prisma/migrations/20260807_partner_onboarding_single_flow_kyc_bank_subaccount/migration.sql
git commit -m "feat(db): add partner onboarding kyc and payout tables"
```

---

### Task 2: Shared onboarding helpers and persistence

**Files:**
- Create: `supabase/functions/_shared/partnerOnboarding.ts`
- Create: `supabase/functions/_shared/partnerOnboarding.test.ts`
- Create: `apps/partner/src/services/partnerOnboardingDraft.ts`
- Create: `apps/partner/src/services/partnerVerificationUploads.ts`
- Modify: `apps/partner/src/services/partnerApplications.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: the new KYC/payout schema and the current partner app form inputs.
- Produces: a reusable validation layer, AsyncStorage draft persistence, and signed upload URL requests for private KYC uploads.

- [ ] **Step 1: Write the helper tests first**

Cover the pure helper rules in `supabase/functions/_shared/partnerOnboarding.test.ts`:

```ts
import { assertEquals } from "jsr:@std/assert";
import { buildPartnerVerificationDocPath, normalizePartnerOnboardingState } from "./partnerOnboarding.ts";

Deno.test("builds a stable verification document path", () => {
  assertEquals(
    buildPartnerVerificationDocPath({ uid: "u1", restaurantId: "r1", kind: "nin-front", extension: "png" }),
    "partner-verification-documents/u1/r1/nin-front.png"
  );
});

Deno.test("normalizes pending approval state", () => {
  assertEquals(
    normalizePartnerOnboardingState({ partnerApplicationStatus: "pending_verification", role: "customer" }).kind,
    "pending-verification"
  );
});
```

- [ ] **Step 2: Run the helper tests and confirm they fail**

Run: `deno test -A --no-lock supabase/functions/_shared/partnerOnboarding.test.ts`
Expected: fail until the helper exists.

- [ ] **Step 3: Implement the shared helpers**

Add pure functions for:

- onboarding state normalization
- required-field validation for restaurant + KYC + payout data
- verification document storage paths
- KYC hash / last-four derivation
- private upload URL request payloads

Keep these functions framework-free so the Deno tests stay cheap.

- [ ] **Step 4: Implement local draft persistence**

Create `apps/partner/src/services/partnerOnboardingDraft.ts` with AsyncStorage helpers for:

- save draft
- load draft
- clear draft

The draft should hold the in-progress onboarding fields across email verification and sign-in.

- [ ] **Step 5: Wire the client upload helper**

Create `apps/partner/src/services/partnerVerificationUploads.ts` so the partner app can request a signed upload URL from `app-rpc`, PUT the file to storage, and send back only the private storage path.

- [ ] **Step 6: Update the partner application input contract**

Extend `apps/partner/src/services/partnerApplications.ts` with the restaurant and payout metadata the wizard submits.

- [ ] **Step 7: Update the test lists**

Add the new Deno test file to `package.json` `test:deno`.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/_shared/partnerOnboarding.ts supabase/functions/_shared/partnerOnboarding.test.ts apps/partner/src/services/partnerOnboardingDraft.ts apps/partner/src/services/partnerVerificationUploads.ts apps/partner/src/services/partnerApplications.ts package.json
git commit -m "feat(partner): add onboarding helpers and draft persistence"
```

---

### Task 3: Partner wizard and auth routing

**Files:**
- Modify: `apps/partner/app/(auth)/register.tsx`
- Modify: `apps/partner/app/(partner)/complete-restaurant-details.tsx`
- Modify: `apps/partner/app/(partner)/_layout.tsx`
- Modify: `apps/partner/src/contexts/AuthContext.tsx`
- Modify: `apps/partner/src/contexts/partnerAuthFlow.ts`
- Modify: `apps/partner/src/services/supabase/profile.ts`
- Modify: `apps/partner/src/services/partnerRestaurantActions.ts`
- Modify: `apps/partner/src/contexts/partnerAuthFlow.test.ts`

**Interfaces:**
- Consumes: the new helper/service layer from Task 2.
- Produces: a single onboarding flow that resumes after email verification and routes approved partners directly into the restaurant shell and menu builder.

- [ ] **Step 1: Write the routing tests**

Expand `apps/partner/src/contexts/partnerAuthFlow.test.ts` with cases for:

```ts
import { assertEquals } from "node:assert/strict";
import { resolvePartnerAccessState } from "./partnerAuthFlow";

assertEquals(
  resolvePartnerAccessState({
    claimRole: "customer",
    userDocument: {
      role: "customer",
      partnerApplicationStatus: "pending_verification",
      partnerApplicationRejectionReason: null,
    },
  }).kind,
  "blocked"
);

assertEquals(
  resolvePartnerAccessState({
    claimRole: "customer",
    userDocument: {
      role: "customer",
      partnerApplicationStatus: "approved",
      partnerApplicationRejectionReason: null,
    },
  }).kind,
  "restaurant"
);
```

- [ ] **Step 2: Run the partner auth flow tests and confirm the new cases fail**

Run: `npm --prefix apps/partner run typecheck && node --test --experimental-strip-types apps/partner/src/contexts/partnerAuthFlow.test.ts`
Expected: the new cases fail before the routing updates.

- [ ] **Step 3: Rework the register screen**

Make `apps/partner/app/(auth)/register.tsx` create only the login profile:

- contact name, email, password, phone
- keep policy acceptance
- save the draft locally
- route the user to verify email

Remove restaurant, bank, and KYC fields from this screen.

- [ ] **Step 4: Turn the restaurant completion screen into the wizard**

Update `apps/partner/app/(partner)/complete-restaurant-details.tsx` so it becomes the resumed onboarding wizard with:

- restaurant identity fields
- coordinates and delivery radius
- logo upload
- NIN / Tax ID upload
- legal name
- bank name and account number

Submitting should call the new app-rpc onboarding action and then wait for approval instead of immediately assuming a finished restaurant shell.

- [ ] **Step 5: Update the partner auth gate**

In `apps/partner/src/contexts/AuthContext.tsx` and `apps/partner/app/(partner)/_layout.tsx`, route:

- `pending_verification` to a pending screen
- `verification_failed` to the wizard with the rejection reason
- `approved` to the restaurant shell / menu builder

Persist the onboarding draft before sign-out or email verification bounce so the user returns to the same step.

- [ ] **Step 6: Sync user profile hydration**

If the wizard needs new profile fields to resume cleanly, update `apps/partner/src/services/supabase/profile.ts` and `packages/auth/src/profileApi.ts` together so the same profile shape is used everywhere.

- [ ] **Step 7: Commit**

```bash
git add apps/partner/app/(auth)/register.tsx apps/partner/app/(partner)/complete-restaurant-details.tsx apps/partner/app/(partner)/_layout.tsx apps/partner/src/contexts/AuthContext.tsx apps/partner/src/contexts/partnerAuthFlow.ts apps/partner/src/services/supabase/profile.ts apps/partner/src/services/partnerRestaurantActions.ts apps/partner/src/contexts/partnerAuthFlow.test.ts
git commit -m "feat(partner): fold onboarding into a single partner wizard"
```

---

### Task 4: Backend onboarding, review, and approval activation

**Files:**
- Modify: `supabase/functions/app-rpc/index.ts`
- Create: `supabase/functions/app-rpc/partnerOnboarding.test.ts`
- Modify: `packages/domain/src/entities.ts`
- Modify: `packages/auth/src/profileApi.ts`
- Modify: `apps/partner/src/services/partnerApplications.ts`

**Interfaces:**
- Consumes: the onboarding payload from Tasks 2-3 and the private upload paths.
- Produces: signed upload URL support, onboarding submission, review activation, Paystack subaccount creation, and payment initialization that only splits against an active payout profile.

- [ ] **Step 1: Write the failing backend tests**

Add Deno tests that exercise the activation helpers exported from `supabase/functions/_shared/partnerOnboarding.ts` and the onboarding RPC boundary:

```ts
import { assertEquals } from "jsr:@std/assert";
import {
  finalizePartnerApproval,
  shouldAttachPartnerSubaccount,
} from "../_shared/partnerOnboarding.ts";

Deno.test("approval activation reuses an existing subaccount code", async () => {
  const result = await finalizePartnerApproval({
    existingSubaccountCode: "SUB_123",
    paystackBankCode: "058",
    paystackBankName: "GTBank",
    accountNumber: "0123456789",
    resolvedAccountName: "Example Restaurant",
  });

  assertEquals(result.paystackSubaccountCode, "SUB_123");
});

Deno.test("payment initialization only attaches an active subaccount", () => {
  assertEquals(
    shouldAttachPartnerSubaccount({ status: "active", paystackSubaccountCode: "SUB_123" }),
    true
  );
});
```

These should be replaced with concrete helper tests once the onboarding helper module from Task 2 exists.

- [ ] **Step 2: Run the backend tests and confirm they fail**

Run: `deno test -A --no-lock supabase/functions/app-rpc/partnerOnboarding.test.ts`
Expected: fail until the new RPC helpers exist.

- [ ] **Step 3: Implement the onboarding RPCs**

In `supabase/functions/app-rpc/index.ts`, add the server-side actions for:

- creating signed upload URLs for private verification docs
- submitting the full onboarding package
- storing KYC and payout rows
- resolving the bank account name
- creating the Paystack subaccount once verification succeeds
- marking the restaurant approved only after the subaccount is active

Keep the subaccount creation idempotent and reuse the stored code on retries.

- [ ] **Step 4: Update the approval queue shape**

Expose KYC and payout state from the admin read path so the review UI can render:

- document status
- bank name and last four digits
- current payout state
- rejection / verification notes

- [ ] **Step 5: Wire payment initialization to the payout state**

When `initializeCustomerPayment` builds the Paystack transaction payload, attach the restaurant subaccount only if the payout row is active and has a stored subaccount code. Fail clearly if a live restaurant somehow has no active payout.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/app-rpc/index.ts supabase/functions/app-rpc/partnerOnboarding.test.ts packages/domain/src/entities.ts packages/auth/src/profileApi.ts apps/partner/src/services/partnerApplications.ts
git commit -m "feat(backend): activate partner onboarding and payout subaccounts"
```

---

### Task 5: Admin review queue and approval UX

**Files:**
- Modify: `apps/admin-web/src/services/platformReads.ts`
- Modify: `apps/admin-web/src/services/approvalActions.ts`
- Modify: `apps/admin-web/src/pages/ApprovalsPage.tsx`
- Create: `apps/admin-web/src/components/PartnerOnboardingReview.tsx`
- Modify: `packages/domain/src/entities.ts`

**Interfaces:**
- Consumes: the richer admin queue payload from Task 4.
- Produces: an admin review experience that can inspect KYC, payout, and onboarding state before approval.

- [ ] **Step 1: Add the review component**

Build the review component with typed props for:

- restaurant identity
- verification status
- private document path or signed preview URL
- bank name and last four digits
- resolved account name
- payout activation state

- [ ] **Step 2: Update the admin reads**

Extend `getAdminApprovalQueue` so the admin app receives the extra onboarding details needed for review, including private-doc signed URLs or safe path tokens.

- [ ] **Step 3: Render the review details**

Add `apps/admin-web/src/components/PartnerOnboardingReview.tsx` and plug it into `ApprovalsPage.tsx` so each partner application row shows:

- restaurant identity
- verification state
- KYC document links or previews
- bank last four digits and resolved account name
- whether the payout profile is active

- [ ] **Step 4: Keep approval actions aligned**

Make `reviewPartnerApplication` and `updateRestaurantApproval` match the new approval contract from `app-rpc`; approval must only succeed when the payout record is active.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src/services/platformReads.ts apps/admin-web/src/services/approvalActions.ts apps/admin-web/src/pages/ApprovalsPage.tsx apps/admin-web/src/components/PartnerOnboardingReview.tsx packages/domain/src/entities.ts
git commit -m "feat(admin): show partner kyc and payout review details"
```

---

### Task 6: Verification, cleanup, and final handoff

**Files:**
- Modify: `package.json`
- Modify: `apps/partner/src/contexts/partnerAuthFlow.test.ts`
- Modify: `supabase/functions/app-rpc/partnerOnboarding.test.ts`

**Interfaces:**
- Consumes: the completed implementation from Tasks 1-5.
- Produces: a verifiable end-to-end onboarding path and an approval flow that routes directly into the menu builder.

- [ ] **Step 1: Add any remaining test files to the root scripts**

Make sure every new test file is listed in `package.json`:

```json
"test:node": "node --test --experimental-strip-types packages/auth/src/cacheHydration.test.ts packages/auth/src/supabaseAuth.test.ts packages/domain/src/phone.test.ts apps/partner/src/utils/authActionUrls.test.ts apps/partner/src/contexts/partnerAuthFlow.test.ts apps/dispatch/src/contexts/dispatchAuthFlow.test.ts",
"test:deno": "deno test -A --no-lock supabase/functions/_shared/media_test.ts supabase/functions/_shared/pricing.test.ts supabase/functions/_shared/requireRole.test.ts supabase/functions/_shared/validation.test.ts supabase/functions/_shared/partnerOnboarding.test.ts supabase/functions/app-rpc/partnerOnboarding.test.ts supabase/functions/app-rpc/partnerRestaurantScope.test.ts supabase/functions/auth-gateway/errors.test.ts supabase/functions/auth-gateway/hash.test.ts supabase/functions/auth-gateway/router.test.ts supabase/functions/payment-verification/invariants.test.ts supabase/functions/paystack-webhook/invariants.test.ts"
```

- [ ] **Step 2: Run the partner test suite**

Run:

```bash
npm --prefix apps/partner run typecheck
npm --prefix apps/partner run lint
node --test --experimental-strip-types apps/partner/src/contexts/partnerAuthFlow.test.ts
```

Expected: pass.

- [ ] **Step 3: Run the Deno helper/backend tests**

Run:

```bash
deno test -A --no-lock supabase/functions/_shared/partnerOnboarding.test.ts supabase/functions/app-rpc/partnerOnboarding.test.ts
```

Expected: pass.

- [ ] **Step 4: Verify the workflow manually**

Check the actual flow on a device or simulator:

1. sign up as partner
2. verify email
3. finish the onboarding wizard
4. approve in admin-web
5. confirm the partner lands in the menu builder
6. confirm customer checkout initializes with the stored subaccount

- [ ] **Step 5: Commit**

```bash
git add package.json apps/partner/src/contexts/partnerAuthFlow.test.ts supabase/functions/app-rpc/partnerOnboarding.test.ts
git commit -m "test: wire partner onboarding plan verification"
```
