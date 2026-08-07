# Partner Onboarding - Single Flow KYC, Bank Setup, and Deferred Subaccount Activation

**Date:** 2026-08-07
**Status:** Approved design, pending implementation plan

## Summary

Replace the current "sign up, then complete restaurant details later" partner
path with one onboarding flow that captures everything once:

- account creation
- restaurant identity
- KYC document upload
- payout bank details

The user submits the full onboarding package a single time. The application
stays hidden and non-publishable while verification is pending. After
verification succeeds, the backend creates the Paystack subaccount, activates
the payout profile, marks the restaurant approved, and routes the partner into
the menu builder.

This keeps the user in one onboarding flow, but it avoids creating a live,
payable restaurant before the payout setup is ready.

## Current state being replaced

- `apps/partner/app/(auth)/register.tsx` only creates login credentials and
  still sends the user into a separate restaurant completion path.
- `apps/partner/app/(partner)/complete-restaurant-details.tsx` collects
  restaurant data after sign-in.
- `supabase/functions/app-rpc/index.ts` currently auto-approves
  `submitPartnerApplication`, creates `RestaurantRecord` immediately, and marks
  the restaurant published.
- `RestaurantRecord.paystackSubaccountCode` already exists, but the payment
  flow does not yet use it to activate split settlement.
- Identity documents and payout details do not have a private storage or table
  path yet.

## Design

### 1. One onboarding flow

The partner path becomes a wizard with a single submission boundary:

1. create the account
2. collect restaurant identity and contact details
3. collect KYC document upload and payout bank details
4. submit once

The current separate restaurant-completion screen is folded into this flow. The
partner does not need to complete a second independent setup after sign-up.

Recommended step structure:

- Step 1: login details
  - contact name
  - email
  - password
  - phone number
- Step 2: restaurant details
  - restaurant name
  - cuisine
  - address
  - latitude / longitude
  - delivery radius
  - logo
- Step 3: verification and payout
  - NIN or Tax ID upload
  - legal name
  - bank name
  - account number
  - account holder name, if needed for review

The submit action creates a pending application and shows a pending review
state. The partner shell stays locked until the backend changes the record to
approved.

If email confirmation is enabled, the wizard must persist the in-progress
onboarding state and resume after the user verifies their email and signs back
in. The user still completes one onboarding package; the auth boundary only
splits the session, not the workflow.

### 2. Lifecycle

The application lifecycle becomes:

| State | Meaning |
|---|---|
| `pending_verification` | The partner has submitted identity, payout, and restaurant details. |
| `verification_failed` | The reviewer rejected the application or the payout setup failed. |
| `approved` | Verification succeeded, the subaccount exists, and the restaurant is live. |

The important rule is that approval does not happen at form submit time. It
happens only after the verification step has succeeded and the subaccount has
been created.

### 3. Data model

Keep the existing application record as the workflow anchor, and add separate
private records for KYC and payout.

**`PartnerApplicationRecord`**

- tracks the overall onboarding application
- stores the restaurant identity fields collected during signup
- carries the application status and review timestamps
- stores the pre-allocated `restaurantId` so later steps can link to a stable id

**`RestaurantKyc`**

- `uid`
- `restaurantId`
- `legalName`
- `documentType` (`nin` or `tax_id`)
- `documentNumberHash`
- `documentLast4`
- `documentFrontPath`
- `documentBackPath` when relevant
- `status` (`pending`, `verified`, `rejected`)
- `verifiedByUid`
- `verifiedAt`
- `reviewNotes`

**`RestaurantPayout`**

- `uid`
- `restaurantId`
- `bankCode`
- `bankName`
- `accountNumber`
- `accountLast4`
- `accountName`
- `paystackSubaccountCode`
- `status` (`pending`, `active`, `failed`)
- `lastError`
- `createdAt`
- `updatedAt`

Identity documents must live in a private storage bucket, not the public
restaurant asset bucket.

### 4. Verification and subaccount activation

Verification is a server-side action, triggered by admin review in v1.

The activation sequence is:

1. reviewer confirms the KYC document and payout details
2. backend resolves the bank account name through Paystack
3. backend creates the Paystack subaccount
4. backend stores the returned `paystackSubaccountCode`
5. backend mirrors that code onto `RestaurantRecord`
6. backend marks the payout profile active
7. backend marks the application approved
8. backend grants the restaurant role and unlocks the menu builder

The subaccount creation step must be idempotent. If the admin retries the
review action, the backend must reuse the existing subaccount code when one has
already been created.

If Paystack rejects the bank details or subaccount creation fails, the
application stays in a non-approved state and the reviewer sees the error.

### 5. Publishing and menu access

The restaurant is not publishable until the payout profile is active.

That means:

- no customer visibility before verification
- no menu builder access before approval
- no orders against a restaurant without an active payout profile

Once approval succeeds, the partner app routes directly into the menu builder.
If the user returns to the app later, the auth gate should detect the approved
state and send them to the restaurant shell instead of back to onboarding.

### 6. Payment split

Once `RestaurantPayout.status = 'active'`, the checkout path uses the stored
`paystackSubaccountCode` to enable automatic split payment to the restaurant.

The payment initialization step should:

- read the active restaurant payout state
- attach the subaccount to the Paystack transaction setup
- fail clearly if the restaurant is somehow approved without an active payout
  record

This keeps the payout guarantee tied to the approval boundary instead of being
dependent on a later manual configuration step.

### 7. Security and privacy

The KYC and payout data are sensitive and must stay service-role only.

Rules:

- KYC image uploads go to a private bucket
- account numbers are never shown in full outside the service-role path
- admin lists show only `accountLast4` and resolved account name
- logs must never print full bank details or document content
- the client only receives the minimum metadata needed to render the review
  screen

The application should store a hash or truncated identifier for support
matching, not the raw NIN or tax ID in any user-facing path.

### 8. Routing

The partner auth flow becomes:

- before signup: show the onboarding wizard
- after submit: show a pending verification screen
- after approval: route to the restaurant shell and menu builder
- after rejection: keep the user in the onboarding shell with the rejection
  reason and edit/resubmit affordance

The flow should not force the user through a second "complete restaurant
details" screen after signup. The whole point is to collect the onboarding
package once.

### 9. Error handling

- invalid coordinates, missing payout fields, or missing documents fail at
  submit time
- Paystack resolution failures surface a retryable review error
- upload failures keep the user on the wizard until the missing upload is fixed
- approval and subaccount creation are idempotent so a retry cannot duplicate
  the payout account

### 10. Testing

Unit and integration coverage should include:

- wizard validation for restaurant fields, KYC upload, and bank details
- private document upload path and metadata storage
- submit path creates a pending application and does not publish the restaurant
- verification path creates the Paystack subaccount exactly once
- approval path sets `RestaurantPayout.status = 'active'`
- approval path grants restaurant access and routes to the menu builder
- payment initialization uses the stored subaccount once active
- rejection path preserves the application for correction and resubmission

## Out of scope

- automated OCR or third-party KYC vendor integration
- changing customer-facing restaurant discovery
- redesigning the customer payment screens beyond using the active subaccount
- removing Paystack as the payout provider
