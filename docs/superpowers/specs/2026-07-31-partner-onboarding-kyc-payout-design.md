# Partner Onboarding — KYC, Payout, and Reviewed Approval

**Date:** 2026-07-31
**Status:** Approved design, pending implementation plan

## Summary

Replace the current instant self-onboarding for restaurants with a Glovo-style
two-phase flow gated by a real admin review:

- **Phase 1 (Apply)** — contact, legal identity (NIN front/back images + number +
  legal name), payout bank details, a map-pinned address, and one or more cuisines.
  Submitting produces a **pending** application. No `restaurant` role, no dashboard,
  no customer visibility.
- **Admin review** — an admin inspects the NIN images, the Paystack-resolved bank
  account name, the address pin, and the chosen cuisines, then approves or rejects
  with a reason.
- **Phase 2 (Set up)** — approval grants the `restaurant` role and unlocks the
  dashboard, but the restaurant stays unpublished. It completes its menu and
  per-day trading hours, then taps **Go live**, which publishes only if a
  readiness check passes.

Two structural corrections come with this:

- **Approval and publication become separate concerns.** Today
  `submitPartnerApplication` writes `status: approved` and `isPublished: true` in
  the same call and grants the role itself.
- **Restaurants without coordinates are invisible to customers.** Coordinates
  become required to publish, and `public-catalog` filters them out regardless.

Money and PII each get their own table (`RestaurantPayout`, `RestaurantKyc`)
rather than being denormalized onto the application record.

**Existing partners are not grandfathered.** Any restaurant already signed in that
lacks the new data is force-signed-out and must supply it on next sign-in (§11).
It keeps selling during a 14-day grace window, then goes unpublished if it has
still not submitted.

## Current state being replaced

- `submitPartnerApplication` (`supabase/functions/app-rpc/index.ts`) hard-codes
  `status: PARTNER_APPLICATION_STATUS.APPROVED`, upserts `RestaurantRecord` with
  `isPublished: true`, upserts `RestaurantApproval` with `status: 'approved'`, and
  calls `syncUserRoleState(..., 'restaurant', ...)` with
  `restaurantLinkSource: 'partner_application_self_publish'`. Anyone who verifies
  an email becomes a live restaurant.
- `adminReviewPartnerApplication` already implements approve/reject with role
  grant, restaurant creation, and admin notification — it is simply unreachable,
  because applications never sit in `pending`.
- `apps/partner/app/(partner)/complete-restaurant-details.tsx` collects a single
  cuisine, a free-text address, and **optional manually typed latitude/longitude**.
- `RestaurantRecord.cuisine` is a single `String?`; `openingTime`/`closingTime` are
  one pair for the whole week.
- `paystackSubaccountCode` exists on `RestaurantRecord` and `splitSubaccountCode`
  on the payment transaction type, but `initializePaystackTransaction` never sends
  `subaccount` or `split` — every naira lands in the FEASTY balance and nothing
  settles to restaurants.
- `restaurantAssetUpload.ts` uploads to the **public** `restaurant-assets` bucket
  and returns `getPublicUrl(...)`.

## Design

### 1. Application lifecycle

```
Phase 1: APPLY            [admin gate]        Phase 2: SET UP        [readiness gate]
─────────────────         ──────────          ────────────────       ───────────────
account + contact    →    reviews NIN,   →    dashboard unlocks  →   "Go live"
legal (NIN + name)        bank name,          menu (>=1 item)        visible to
payout (bank)             address pin,        per-day hours          customers
address (map pin)         cuisines            confirm details
cuisines                  approve/reject
```

States on `PartnerApplicationRecord.status` (existing `PARTNER_APPLICATION_STATUS`
constants, all three finally used): `pending` → `approved` | `rejected`.

- **Submit** writes `pending`. It does **not** grant a role, does **not** create a
  `RestaurantRecord` at all, and does **not** write `RestaurantApproval` as
  approved. The partner app shows an "Application under review" screen.
  Submit still **allocates** `PartnerApplicationRecord.restaurantId`
  (`crypto.randomUUID()`, as today) so KYC and payout rows can reference a stable
  id, but the `RestaurantRecord` itself is created at approval. This matches the
  existing `adminReviewPartnerApplication`, which already does
  `application.restaurantId || crypto.randomUUID()`.
- **Approve** (`adminReviewPartnerApplication`, already built) grants the
  `restaurant` role via `syncUserRoleState` with
  `restaurantLinkSource: 'partner_application_approved'`, creates/updates the
  `RestaurantRecord` with **`isPublished: false`**, and activates the payout
  subaccount.
- **Reject** stores `rejectionReason`, leaves the user as `customer`, and allows
  edit-and-resubmit (submit accepts a `rejected` application and returns it to
  `pending`).

`submitPartnerApplication` keeps its existing guard that an already-`approved`
application cannot be resubmitted.

**Go-live readiness** — all must hold before `isPublished` may become `true`:

1. application `approved`
2. `RestaurantKyc` row exists
3. `RestaurantPayout.status = 'active'` with a `paystackSubaccountCode`
4. `latitude` and `longitude` are both non-null
5. at least one menu item with a non-empty name and a price > 0
6. at least one `RestaurantHours` day with `isClosed = false` and valid times
7. `minOrder` explicitly set (≥ 0; `0` is a valid deliberate "no minimum")
8. `deliveryRadiusKm` set and > 0 **when `supportsDelivery` is true**

Readiness is evaluated **server-side** in app-rpc. The dashboard shows the
checklist with unmet items linked to the screen that fixes them.

### 1a. Mandatory fields — coordinates, minimum order, delivery radius

These are **required at application submit**, not optional and not silently
defaulted:

| field | rule |
|---|---|
| `latitude` / `longitude` | required, non-null, from the map pin (§4) |
| `minOrder` | required; the partner must make an explicit choice. `0` is allowed but only via a deliberate "No minimum order" control — never a silent default |
| `deliveryRadiusKm` | required and > 0 **when `supportsDelivery` is true**; ignored (and not asked for) when the restaurant is pickup-only |

Two notes on why these are phrased this way:

- **"Required" has to mean *explicitly chosen*, not *non-null*.** The audit (§13)
  shows `deliveryRadiusKm` is never null — `submitPartnerApplication` hard-codes
  `12`, and `minOrder` is hard-coded to `0`. So a null check would pass for every
  existing restaurant while none of them has actually chosen a value. The server
  therefore stops defaulting these: the submit payload must carry them, and
  validation rejects a missing field rather than substituting a default.
- **Delivery radius is conditional on delivery.** Demanding a radius from a
  pickup-only restaurant is meaningless, and 5 of the 6 current restaurants are
  pickup-only. The field is required exactly when it has meaning.

Coordinates being mandatory also fixes a live data defect the audit found: one
restaurant currently has `supportsDelivery = true` with **no coordinates**, so its
delivery radius is computed from no origin at all.

### 2. Customer visibility (geo-gate)

`public-catalog` currently filters `.eq('isPublished', true)`. It gains:

```
.eq('isPublished', true)
.not('latitude', 'is', null)
.not('longitude', 'is', null)
```

Defence in depth: the shared restaurant-update path in app-rpc refuses to set
`isPublished: true` when either coordinate is null, so the catalog filter is a
safety net rather than the only control.

**Migration risk — must be handled before this ships:** existing published
restaurants with null coordinates will disappear from the customer app. The
implementation plan must first run an audit query counting
`RestaurantRecord WHERE isPublished = true AND (latitude IS NULL OR longitude IS
NULL)`, report the list, and backfill those coordinates. The geo-gate is enabled
only after the backfill is confirmed empty.

### 3. Data model

New tables. All are **service-role only** — no Data API/PostgREST exposure, RLS
enabled with no policies, consistent with `docs/rls-posture.md`.

**`RestaurantKyc`** — private identity data.

| column | type | notes |
|---|---|---|
| `id` | String @id @default(cuid()) | |
| `uid` | String @unique | applicant |
| `restaurantId` | String? | set on approval |
| `legalName` | String | registered/business or personal legal name |
| `ninNumber` | String? | 11 digits, validated; **cleared at purge** (see §7) |
| `ninLast4` | String | retained after purge for support/dispute matching |
| `ninHash` | String | salted SHA-256 of the NIN; survives purge, lets a resubmission be matched without storing the identifier |
| `ninFrontPath` | String | **storage path, never a public URL** |
| `ninBackPath` | String | storage path |
| `verification` | String @default("manual") | slot for a future automated vendor |
| `verifiedByUid` | String? | admin who reviewed |
| `verifiedAt` | DateTime? | |
| `reviewNotes` | String? | admin-only |
| `purgedAt` | DateTime? | set when images are purged (see §7) |
| `createdAt` / `updatedAt` | DateTime | |

**`RestaurantPayout`** — money.

| column | type | notes |
|---|---|---|
| `id` | String @id @default(cuid()) | |
| `uid` | String @unique | |
| `restaurantId` | String? | set on approval |
| `bankCode` | String | Paystack bank code |
| `bankName` | String | display |
| `accountNumber` | String | full number, service-role only |
| `accountLast4` | String | safe for admin lists and partner UI |
| `resolvedAccountName` | String | from Paystack `/bank/resolve` |
| `paystackSubaccountCode` | String? | mirrored to `RestaurantRecord` on approval |
| `status` | String @default("pending") | `pending` \| `active` \| `failed` |
| `lastError` | String? | last Paystack failure, server-side only |
| `createdAt` / `updatedAt` | DateTime | |

**`RestaurantHours`** — 7 rows per restaurant.

| column | type | notes |
|---|---|---|
| `id` | String @id @default(cuid()) | |
| `restaurantId` | String | |
| `dayOfWeek` | Int | 0 = Sunday … 6 = Saturday |
| `isClosed` | Boolean @default(false) | |
| `opensAt` | String? | `"HH:mm"`, required when `isClosed` is false |
| `closesAt` | String? | `"HH:mm"`, required when `isClosed` is false |

`@@unique([restaurantId, dayOfWeek])`.

**`RestaurantRecord` changes** — all additive, all backward compatible:

- `cuisines String[] @default([])` added. **`cuisine String?` is retained** and
  written as `cuisines[0]` on every write, so `public-catalog`,
  `apps/customer/src/utils/restaurantAvailability.ts`, and
  `apps/customer/src/domain/entities.ts` keep working untouched.
- `customCuisine String?` and `customCuisineStatus String? @default("pending")`
  (`pending` | `approved` | `merged` | `rejected`) for the Others flow.
- `formattedAddress String?`, `addressComponents Json?`, `buildingInfo String?`,
  `deliveryNotes String?`.
- `detailsConfirmedAt DateTime?` — stamped when a partner explicitly confirms
  `minOrder` and `deliveryRadiusKm`. This is what distinguishes "the partner chose
  ₦0" from "the server defaulted to 0", which no value check on the column itself
  can tell apart (§1a). `latitude`/`longitude`/`minOrder`/`deliveryRadiusKm` stay
  nullable in the schema — the requirement is enforced in app-rpc validation and
  by the readiness gate, so the migration does not have to backfill fabricated
  values into existing rows.
- `openingTime` / `closingTime` are **retained for backward compatibility only**.
  They are written **once at save time** as the most frequently occurring
  open/close pair across the restaurant's open days (ties broken by the earliest
  day), and are never recomputed per request — deriving them from "today" would
  force a daily rewrite and break catalog caching. They are a legacy fallback,
  **not** the source of truth for "open now" — see the correctness note below.

**Correctness note — "open now" must move to per-day hours.** The customer app
currently derives open/closed from the single pair
(`apps/customer/src/utils/restaurantAvailability.ts:92-93`). Deriving that pair as
"earliest open, latest close across the week" would be **wrong**: a restaurant
closed on Sundays would still read as open on Sunday, and one open Mon 08:00–14:00
but Sat until 23:00 would read as open until 23:00 every day. Therefore:

- `public-catalog` includes a compact `hours` array (7 entries) in the restaurant
  payload.
- `restaurantAvailability.ts` reads **today's** entry — respecting `isClosed` —
  and falls back to `openingTime`/`closingTime` only when `hours` is absent
  (pre-migration records).
- This is the one place the customer app must change; the cuisine work below
  leaves it untouched.

`PartnerApplicationRecord` keeps its current shape. KYC and payout are joined in
for admin review rather than copied onto it.

### 4. Address — hardened OSM, Glovo standard

A new shared module (`packages/`-level, reused by partner onboarding **and** the
existing `profile.tsx` editor, replacing the manual coordinate inputs in both):

1. **Autocomplete** — debounced 350 ms, minimum 3 characters, via **Photon**
   (Komoot's OSM geocoder, built for type-ahead). Nominatim's usage policy
   discourages autocomplete, so it is not used for this. Results biased to Nigeria
   and to the device's current position.
2. **Map with a draggable pin** — defaults to device GPS. Dragging triggers a
   reverse geocode.
3. **Reverse geocode** — Nominatim, throttled to ≤1 request/second, descriptive
   `User-Agent`, responses cached in-memory per session.
4. **Explicit confirmation** — "Is this your exact entrance?" The **pin position is
   the source of truth**, not the typed text.
5. **Courier fields** — building/floor, landmark, delivery notes → `buildingInfo`
   and `deliveryNotes`.
6. **Fallback** — if either geocoder is unavailable, manual pin-drop still yields
   valid coordinates. Onboarding never hard-blocks on a third-party outage; the
   formatted address falls back to the user's typed text.

Both geocoders are free and keyless, preserving the zero-cost posture. Both public
endpoints are **fair-use** rather than contractual, so the design must stay a good
citizen: the 350 ms debounce, the 3-character minimum, the ≤1 req/s reverse-geocode
throttle, session caching, and a descriptive `User-Agent` are requirements, not
polish. Address entry happens a handful of times per restaurant (onboarding plus
occasional edits), never on a customer hot path, so volume stays low. If either
endpoint ever rate-limits, the manual pin-drop fallback (item 6) keeps onboarding
working, and self-hosting Photon remains an option without changing this design.

The web
build reuses the `navigator.geolocation` approach already established in
`apps/customer/src/services/deviceLocation.ts` rather than `expo-location`, which
cannot reverse geocode on web.

Manual latitude/longitude text inputs are **removed** from
`complete-restaurant-details.tsx` and `profile.tsx`. Coordinates are **mandatory**
(§1a): the address step cannot be completed without a confirmed pin, and
`submitPartnerApplication` rejects a payload without them instead of accepting
`null` as it does today.

### 5. Payout and settlement

**At apply time:**

1. Bank dropdown populated from Paystack `GET /bank?country=nigeria` (cached
   server-side; the list is stable).
2. Account number + bank code → `GET /bank/resolve` returns the true account
   name. This is the anti-typo and anti-fraud check.
3. The partner confirms the resolved name. It is stored as `resolvedAccountName`
   and shown to the admin at review.
4. A Paystack **subaccount** is created with `percentage_charge: 0`.
   `RestaurantPayout.status` stays `pending` until the application is approved,
   then becomes `active` and the code is mirrored onto
   `RestaurantRecord.paystackSubaccountCode`.

**At charge time** — this activates the dormant scaffolding.
`initializePaystackTransaction` gains three parameters:

```
subaccount:         <restaurant's subaccount code>
transaction_charge: <FEASTY markup, in kobo>
bearer:             'account'
```

- `transaction_charge` = the pricing-v2 embedded markup only:
  `(basePrice × 0.20 + 100) × quantity`, summed across items, converted to kobo.
- Everything else — the restaurant's base prices, the delivery fee (delivery is
  self-provisioned, so it passes through), and any tip — flows to the restaurant's
  subaccount.
- `bearer: 'account'` makes **FEASTY bear the Paystack processing fee** out of its
  markup, so the restaurant receives exactly 100% of its own prices. This matches
  the pricing-v2 rule that `partner_service_rate = 0`.

**Margin invariant.** Because FEASTY bears the fee, the markup must always exceed
the Paystack charge (Nigeria: 1.5% + ₦100, the ₦100 waived below ₦2,500, capped at
₦2,000). The embedded markup is `20% of base + ₦100/unit`, which clears the 1.5%
comfortably at every price point — a ₦500 item yields ₦200 markup against a ₦10.50
fee; a ₦5,000 × 2 order yields ₦2,200 against ~₦283. The invariant is asserted in
tests rather than assumed, so any future change to `markup_rate` / `markup_flat`
that would make a split unprofitable fails loudly.

`splitSubaccountCode` is recorded on the payment transaction for reconciliation.

**Safety properties:**

- An unapproved restaurant can never be published, so it can never receive an
  order — no money moves before KYC review.
- If a restaurant somehow has no `active` subaccount, order placement is
  **rejected** rather than silently collected into the FEASTY balance.
- **Cash orders** carry no Paystack split; they are settled out of band exactly as
  they are today. This design does not change cash handling.
- One order maps to one restaurant (`CustomerOrder.restaurantId` is singular), so
  no multi-merchant split is required.

**Known trade-off (accepted):** split-at-charge settles the restaurant's share on
Paystack's normal cycle, so a dispute or refund raised days later cannot be
clawed back from the subaccount automatically. The admin review gate is the
mitigation. If dispute volume ever justifies it, the alternative — collect, hold
N days past delivery, then batch-transfer — can be adopted without changing the
onboarding surface.

### 6. Cuisines and the Others flow

- The picker becomes multi-select over the existing standard list
  (`Nigerian, Fast Food, Pizza, Grills, Seafood, Healthy, Desserts`), writing
  `cuisines[]`.
- An **Others** button reveals a free-text field → `customCuisine` with
  `customCuisineStatus = 'pending'`.
- A pending custom cuisine is **stored and shown on the restaurant's own profile
  but excluded from customer-facing filter chips** until an admin approves it.
  The admin can **approve** it as a new tag (status `approved`, it becomes a
  customer-facing chip) or **merge** it onto an existing cuisine
  (e.g. "Suya Spot" → `Grills`), which appends the target to `cuisines[]` and sets
  the status to `merged`, with the mapping recorded in the audit log. `rejected` is
  reserved for text that is not a cuisine at all (spam, a duplicate of a tag the
  restaurant already selected).
- This keeps the customer taxonomy free of near-duplicates
  ("Nigerian Food" / "nigerian" / "Naija") while still letting a restaurant
  describe itself.

### 7. NIN upload — privacy and egress

This is the highest-risk data in the feature and the only new image payload, so
both its privacy and its bandwidth cost are designed explicitly. FEASTY's cost is
invocation- and egress-bound (measured 2026-07-29), so NIN images must not become
a recurring transfer cost.

**Privacy:**

- A **new private bucket `restaurant-kyc`**, separate from the public
  `restaurant-assets` bucket. `restaurant-assets` is served via `getPublicUrl` — a
  public URL for a national ID card would be a serious breach.
- The database stores **storage paths only**, never URLs.
- Admins read images through **short-lived signed URLs (60 s TTL)** minted on
  demand by app-rpc after an `ensureRole(context.role, ['admin'])` check.
- **Every NIN image view is audit-logged** via the existing `createAuditEntry`,
  recording which admin viewed which applicant's document and when.

**Egress control:**

- **Client-side compression before upload** using `expo-image-manipulator`:
  longest edge resized to 1280 px, JPEG quality 0.6, targeting ≤200 KB per image.
  A NIN card is legible well below this; the current unoptimized restaurant images
  measured ~972 KB, which is the size class being avoided.
- **Hard cap of 500 KB per image**, enforced client-side before upload and
  re-validated server-side. Oversized uploads are rejected with a client-safe
  message.
- **Direct client → Supabase Storage upload**, following the existing
  `restaurantAssetUpload.ts` pattern. Image bytes never pass through an edge
  function, so they cost **zero app-rpc invocations** and are not double-counted
  against egress.
- **Images are never proxied through an edge function** for viewing either —
  signed URLs let the client fetch from storage directly. Proxying would double
  the egress and add an invocation per view.
- **The admin list view renders no images at all** — only metadata (legal name,
  resolved bank name, submitted date). Images load only when an admin opens a
  single application. This is what prevents N images × M admins × every list
  refresh from becoming the dominant egress line.
- **Retention:** 90 days after an application reaches `approved` or `rejected`, a
  scheduled job purges the two image objects, **clears `ninNumber`**, and stamps
  `purgedAt`. What survives is verification metadata (who reviewed and when),
  `ninLast4`, and the salted `ninHash` — enough to answer a support query or spot a
  repeat applicant, without retaining a national identifier in full indefinitely.
  This bounds stored bytes, and more importantly bounds breach surface: the
  long-lived record can no longer leak a usable NIN or its photographs.

Total steady-state cost: **two images, ≤400 KB, once per restaurant, purged after
90 days.** Negligible against the measured invocation-driven cost, and it does not
touch the per-order hot path at all.

### 8. Admin review surface

The existing `admin_approvals` route gains a per-application detail view showing:

- contact and legal name, NIN number, and the two NIN images (signed URLs, loaded
  on open, audit-logged)
- the Paystack-resolved bank account name, bank, and `accountLast4`
- the address with its map pin and courier fields
- selected cuisines and any pending `customCuisine`

Actions: **approve**, **reject with reason**, **approve/merge custom cuisine**.
Approve and reject route through the already-built
`adminReviewPartnerApplication`, extended to also flip
`RestaurantPayout.status → active` and stamp `RestaurantKyc.verifiedByUid` /
`verifiedAt`.

### 9. Error handling

Following the established `ClientSafeError` convention — clients get generic
messages, real errors are logged server-side only.

| failure | behaviour |
|---|---|
| Geocoder (Photon/Nominatim) unavailable | fall back to manual pin-drop; never blocks submission |
| Paystack `/bank/resolve` fails | clear "check the account number and bank" message; partner can retry |
| Paystack subaccount creation fails | **application still submits as `pending`**; payout stays `pending` with `lastError`; retried at approval. An application is never lost to a payment-provider outage |
| NIN image upload fails | retry without losing form state; the form is not cleared |
| Image over 500 KB | rejected client-side with a "photo is too large" message before any upload |
| Role claim not yet synced after approval | reuse the existing `resolvePartnerRestaurantCompletionState` timeout/handoff logic |
| Forced re-verification sign-out | must raise a distinct message, never `SESSION_CONFLICT_ERROR` — see §11 |
| Partner has a live order at cutover | deferred to the next batch; never signed out mid-service (§11) |

### 10. Migration and compatibility

Existing partners are **not** grandfathered — they are forced through
re-verification (§11). The migration itself is still behaviour-preserving; the
cutover is what changes their state.

- **Existing approvals are preserved.** A restaurant currently `isPublished = true`
  with an `approved` `RestaurantApproval` keeps that approval and its `restaurant`
  role. It is not sent back through the full application; it is asked only for the
  data it is missing.
- Backfill `RestaurantHours` from each restaurant's existing
  `openingTime`/`closingTime` across all 7 days, `isClosed = false`. This is
  behaviour-preserving: a restaurant currently open 08:00–22:00 every day keeps
  exactly those hours, and its "open now" result is unchanged.
- Restaurants whose `openingTime`/`closingTime` are null get all 7 days seeded as
  `isClosed = false` with null times. Because the backfill copies the existing
  values verbatim and the legacy fields are preserved, availability behaviour is
  unchanged by construction, whatever the current logic does with nulls.
- Backfill `cuisines[]` from the existing `cuisine` string
  (`cuisine ? [cuisine] : []`).
- Backfill `formattedAddress` from the existing `address`.
- Coordinate audit and backfill (§2) **precedes** enabling the geo-gate.

### 11. Forced re-verification of existing partners

Every already-signed-in restaurant missing the new data is **signed out**, and on
signing back in is required to supply it before regaining the dashboard.

**Who is affected.** After the §10 backfills run, hours and `cuisines[]` are
always populated, so they can never be the missing piece. The only data an
existing restaurant can actually lack is:

1. a `RestaurantKyc` row (NIN images, number, legal name)
2. a `RestaurantPayout` row with `status = 'active'` and a subaccount
3. non-null `latitude` / `longitude` (where the §2 backfill could not geocode)
4. `detailsConfirmedAt` — an explicit `minOrder`, plus `deliveryRadiusKm` if the
   restaurant offers delivery (§1a)

A restaurant satisfying all four is untouched — no sign-out, no prompt.

Per the §13 audit this is currently **all 6 restaurants**, since none has a payout
subaccount. That is expected — no subaccount flow has ever existed — and at this
scale the cutover is a handful of conversations, not a mass migration.

**New `RestaurantRecord` columns:**

| column | type | notes |
|---|---|---|
| `reverificationStatus` | String @default("not_required") | `not_required` \| `required` \| `submitted` \| `complete` |
| `reverificationDueAt` | DateTime? | end of the grace window |
| `reverificationNotifiedAt` | DateTime? | last reminder sent |

**Forced sign-out mechanism.** Reuse the existing single-device session control
rather than inventing one. `syncSingleDeviceSession`
(`apps/partner/src/contexts/AuthContext.tsx:143-153`) signs a user out when the
locally stored session id differs from `UserAccount.activeSessionId`. The cutover
job rotates `activeSessionId` to a **new non-null sentinel**, `reverify:<timestamp>`,
mirroring the existing `disabled:<timestamp>` pattern used when an account is
disabled (`app-rpc/index.ts:3932`).

Two defects must be avoided here, both of which a naive implementation would hit:

- **Setting `activeSessionId` to `null` does not sign anyone out.** The guard
  requires *both* the local and remote ids to be non-null and different. A null
  remote id is treated as "no active session" and the partner stays signed in.
  The value must be a fresh sentinel.
- **The default message is wrong and alarming.** That code path currently raises
  `SESSION_CONFLICT_ERROR` — *"This account was signed in on another device."*
  Showing that to every affected partner is a false security alert and a support
  flood. The sentinel prefix `reverify:` must be distinguishable so the partner
  app raises a distinct, accurate message: *"We need a few extra details before
  you can keep selling. Sign in to finish."*

**Re-entry flow.** On sign-in, the partner keeps the `restaurant` role, so no role
re-sync is needed. The `(partner)` layout routes to a re-verification screen
whenever `reverificationStatus` is `required`, and the dashboard stays
unreachable until the missing items are supplied. The screen reuses the Phase 1
components and **asks only for what is missing** — a partner who already has
coordinates is not asked to re-pin an address. Submitting sets
`reverificationStatus = 'submitted'` and queues the KYC for admin review.

**Grace window (14 days).**

- The storefront **stays published and orderable** for the whole window. Sign-out
  is immediate; going dark is not.
- Reminders escalate: in-app banner on every dashboard visit, plus email at
  day 0, 7, 12, and 13 via the existing Resend infrastructure.
- At the deadline, a restaurant still in `required` is set to
  `isPublished = false`. It is **not** un-approved and its data is untouched, so
  completing the details republishes it immediately once approved.
- A restaurant in `submitted` at the deadline **stays published**. An admin review
  backlog must never cost a partner revenue; only partner inaction does.
- Once admin-approved, `reverificationStatus` becomes `complete` and the payout
  subaccount goes `active`.

**Do not sign anyone out mid-service.** The cutover runs as a scheduled batch. A
partner with a live order (any non-terminal status) is **deferred to the next
run**, so nobody loses the dashboard while food is being prepared. Deferral does
**not** extend `reverificationDueAt` — the deadline is set once, when the
restaurant first becomes eligible, so a permanently busy restaurant cannot defer
its way past the grace window.

**Rollout safety.** The cutover is driven by a config flag and runs in batches
rather than signing out every partner at once, so a mistake affects a cohort
instead of the whole marketplace. The audit query from §2 runs first and reports
exactly how many restaurants each of the three criteria would catch. If that count
is implausibly high, the backfill is wrong and the cutover does not run.

### 12. Testing

**Unit**

- go-live readiness: each of the eight conditions independently blocks publication
- **mandatory fields (§1a)**: submit is rejected when coordinates, `minOrder`, or
  (for a delivery restaurant) `deliveryRadiusKm` are absent; the server no longer
  substitutes the old `12` / `0` defaults; `minOrder = 0` is accepted **only** with
  `detailsConfirmedAt` set, proving deliberate choice; a pickup-only restaurant is
  neither asked for nor blocked on `deliveryRadiusKm`; enabling `supportsDelivery`
  later makes the radius required from that point on
- split math against pricing-v2 fixtures: a ₦5,000 base item at qty 2 produces a
  ₦12,200 charge and a ₦2,200 `transaction_charge`, leaving the restaurant
  ₦10,000
- `transaction_charge` never exceeds the transaction total
- the margin invariant: for a representative price ladder (₦500 / ₦2,400 / ₦2,600 /
  ₦5,000 × qty 1–3), the computed markup strictly exceeds the Paystack fee,
  including across the ₦2,500 boundary where the ₦100 component starts applying
- **"open now" regression guards** (the defect this design exists to avoid):
  a restaurant closed on Sunday reads as **closed** on Sunday; one open
  Mon 08:00–14:00 and Sat 08:00–23:00 reads as closed at 15:00 on Monday; a
  past-midnight close (22:00–02:00) is handled; a record with no `hours` array
  falls back to `openingTime`/`closingTime` without throwing
- `cuisines[]` → derived `cuisine` compatibility, including the empty case
- custom cuisine: `pending` is excluded from customer filter chips; `merged`
  appends the target tag; `rejected` adds nothing
- NIN validation: exactly 11 digits; image size cap
- purge: clears `ninNumber` and both image objects while preserving `ninLast4`,
  `ninHash`, `verifiedByUid`, and `verifiedAt`

**Integration**

- submit → `pending` → approve → dashboard unlocked but unpublished → complete
  menu and hours → Go live → visible in `public-catalog`
- submit → reject with reason → edit → resubmit → `pending`
- an approved-but-unpublished restaurant is absent from `public-catalog`
- a published restaurant with null coordinates is absent from `public-catalog`
- order placement is rejected when the restaurant has no `active` subaccount
- a non-admin cannot mint a signed URL for a NIN image
- a client that has not yet received the `hours` array (pre-migration payload)
  still renders correct availability via the legacy fields

**Forced re-verification (§11)**

- a restaurant with KYC, active payout, and coordinates is **not** signed out and
  sees no prompt
- a restaurant missing any one of the three is signed out on next session sync
- setting `activeSessionId` to `null` does **not** sign the partner out; the
  `reverify:<ts>` sentinel does — this is the regression guard for the guard
  condition at `AuthContext.tsx:147`
- the re-verification sign-out surfaces its own message, never
  "signed in on another device"
- the re-entry screen asks only for missing items: a partner with valid
  coordinates is not asked to re-pin
- a partner with a live order is skipped by the batch and picked up by the next
  run, with `reverificationDueAt` unchanged across deferrals
- at the deadline: `required` → unpublished; `submitted` → stays published
- unpublishing at the deadline leaves the approval and all restaurant data intact,
  and completing re-verification republishes without a new application

**Manual**

- camera capture on a physical device for NIN front/back, including the
  permission-denied path and the photo-library fallback
- address autocomplete, pin drag, and reverse geocode on both native and web

### 13. Audit findings (run 2026-07-31 against production)

The audit called for in §2 has been run. Results, from `RestaurantRecord`:

| metric | count |
|---|---|
| total restaurants | 6 |
| published | 6 |
| **published with null coordinates** | **5** |
| missing a Paystack subaccount | 6 (100%) |
| `minOrder` of 0 | 4 (the other 2 are ₦1) |
| missing `openingTime`/`closingTime` | 3 |
| missing cuisine | 0 |
| `deliveryRadiusKm` null | 0 (all defaulted, none chosen) |
| `supportsDelivery = true` | 1 — **and it has no coordinates** |

Four consequences, all already folded into this design:

1. **The geo-gate must not ship before the coordinate backfill.** Enabling it
   today would cut the customer catalog from 6 restaurants to 1. §2 already
   sequences the backfill first; this audit is the evidence for why that ordering
   is non-negotiable.
2. **The cutover is small.** All 6 restaurants need re-verification, but 6 is a
   hand-held onboarding, not a migration. The 14-day grace window in §11 is
   comfortable and no cohort staging is needed — the open item asking whether the
   window should be longer is resolved: it should not.
3. **"Required" cannot mean "non-null."** `deliveryRadiusKm` is null for nobody
   yet chosen by nobody, because submit hard-codes `12`. This is what motivates
   `detailsConfirmedAt` in §3 and the explicit-choice rule in §1a.
4. **One restaurant offers delivery with no origin point.** Coordinates being
   mandatory (§1a) closes a defect that exists in production right now.

The audit query should be re-run immediately before the cutover flag is enabled,
since these counts will have moved.

## Suggested implementation order

The pieces are interdependent (approval gates payout, payout gates go-live), so
this stays a single spec — but it should land as seven sequenced, independently
verifiable stages rather than one commit:

1. **Schema + migration** — the three new tables, the `RestaurantRecord` additive
   columns, all backfills (§10), and the coordinate audit. Nothing user-visible
   changes. Verifies: existing restaurants still resolve identically.
2. **Reviewed approval** — flip `submitPartnerApplication` to write `pending` and
   stop granting the role/publishing; wire the "under review" screen. Applies to
   **new** applications only; existing partners are untouched until stage 7. This
   is the smallest change with the largest trust payoff and is shippable on its
   own.
3. **Hours + cuisines** — per-day hours editor in `profile.tsx`, multi-select
   cuisines with the Others field, the `hours` array in the `public-catalog`
   payload, and the `restaurantAvailability.ts` switch to today's entry. Ship the
   catalog payload **before** the client switch so old clients keep working.
4. **Address module + mandatory details** — Photon/Nominatim + draggable pin,
   replacing manual coordinates in both onboarding and `profile.tsx`; plus the
   §1a mandatory-field validation (coordinates, `minOrder`, conditional
   `deliveryRadiusKm`, `detailsConfirmedAt`) and removal of the server-side `12`
   and `0` defaults. Enable the geo-gate **only after** the coordinate backfill
   from stage 1 is confirmed empty — per §13 that is 5 of 6 restaurants today.
5. **KYC + payout capture** — private bucket, compressed NIN upload, bank resolve
   and subaccount creation, and the admin review surface.
6. **Split at charge + go-live gate** — send `subaccount`/`transaction_charge`,
   enforce readiness before `isPublished`. Money moves last, after every gate that
   protects it is already in place.
7. **Forced re-verification cutover** (§11) — the batch job, the `reverify:`
   sentinel and its distinct message, the re-entry screen, reminder emails, and
   the deadline sweep. Runs **last**, behind a config flag, because it is the only
   stage that can take existing revenue offline.

Stage 6 is deliberately before stage 7 but after everything else: the split must
not go live until reviewed approval (stage 2) and KYC (stage 5) are both
enforcing, or an unvetted merchant could be payable. Stage 3 is ordered before
stage 4 because the go-live readiness check depends on hours existing, and because
it is the only stage that touches the customer app. Stage 7 is last because
partners cannot complete re-verification until the screens and payout plumbing
from stages 4–6 exist — cutting over sooner would sign partners out into a flow
that cannot yet accept their details.

## Open items for the implementation plan

- Whether the 90-day KYC purge and the §11 cutover/deadline sweeps run on the
  existing cron infrastructure (`broadcast-runner` / `queue-drainer` pattern) or a
  new scheduled function.
- How the 5 restaurants with null coordinates get them: geocoding their stored
  address strings during the backfill, or asking each partner to drop a pin during
  re-verification. At 5 restaurants either is cheap; geocoding first and letting
  re-verification correct the result is the lower-friction default.

*(The two audit-dependent open items are resolved in §13.)*

## Out of scope

- Automated NIN verification against a KYC vendor (Dojah/QoreID/Smile ID). The
  `RestaurantKyc.verification` field defaults to `"manual"` so a vendor can be
  added later without reworking the schema.
- Food-hygiene licences and other market-specific compliance documents.
- Multi-branch or franchise restaurants, and multiple staff accounts per
  restaurant.
- Collect-then-transfer settlement with a hold window (see §5 trade-off).
