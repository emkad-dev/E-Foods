# FEASTY → Glovo parity

Branch: `feature/glovo-parity` (from `origin/main` @ 4eb31b2)
Audit source: stage-by-stage comparison, 2026-08-02. 3 stages at parity, 5 thin, 5 missing.

Two decisions are already made and are not open for re-litigation by any task:

1. **Backend splits into 5 independently deployable Edge Functions** — `feasty-orders`,
   `feasty-dispatch`, `feasty-partner`, `feasty-admin`, `feasty-account` — sharing
   `supabase/functions/_shared/`. Clients keep calling by action name; a map resolves
   action → function.
2. **Scope is full parity**, executed in phase order. Phases A–F remove hard scaling
   ceilings. Phase G is the commercial layer.

---

## Global Constraints

These bind every task. A reviewer checks them on every diff.

- **Never weaken the security posture that already exists.** Specifically: signup must stay
  enumeration-safe (identical 200 for new and existing email); `login-fail` and `otp-verify`
  rate limits must stay `failClosed: true`; the restaurant's own base price must never leave
  the server; the delivery-radius check must stay server-side; Paystack webhook signature
  comparison must stay constant-time and must keep resolving the order id from the stored
  `PaymentTransaction.reference`, never from webhook metadata alone.
- **RLS posture is unchanged.** New tables are RLS-enabled with **no policies** (service-role
  only) unless the task explicitly says otherwise. The only customer-readable tables remain
  `CustomerOrder` and `DeliveryAssignment` plus anything a task names. Document any addition
  in `docs/rls-posture.md`.
- **Error convention holds.** Real errors are logged server-side via `logEdgeEvent`; clients
  get `ClientSafeError` messages or the generic fallback from `clientErrorMessage`. Never
  return a raw Postgrest/driver message to a client.
- **Money math lives in `_shared/pricing.ts`.** No task recomputes prices inline. Pricing v2
  stands: customer price = base × (1 + markupRate) + markupFlat per unit; `partnerServiceRate`
  is 0; minimum order and settlement run on base prices.
- **Idempotency.** Any new write path reachable from a client or a webhook takes an
  idempotency key or is naturally idempotent by status check. Queue handlers must be safe to
  re-run — `claimPendingQueueJobs` reclaims on a 180s visibility timeout.
- **Migrations are additive and idempotent** (`CREATE TABLE IF NOT EXISTS`,
  `ADD COLUMN IF NOT EXISTS`). Never drop or rename a column in this branch. One migration
  file per task, named `supabase/migrations/<YYYYMMDD>_<slug>.sql`.
- **Nothing is deployed or applied by an implementer.** Write the migration and the code; do
  not run `supabase db push`, `supabase functions deploy`, or any deploy script. The operator
  ships. Every task that needs an operator step lists it under "Operator steps".
- **Tests.** Deno tests for `supabase/functions/**` go beside the code as `*.test.ts` (or
  `*_test.ts` where that file already exists) and get registered in the root
  `package.json` `test:deno` list. Node tests go in the `test:node` list. Every task runs
  `npm run test` plus the typecheck and lint for each app it touches, and pastes the output
  into its report.
- **No dead code.** If a task supersedes an old path, delete the old path in the same commit.
  Do not leave a disabled branch behind "for now". The one carve-out: **compatibility shims a
  task names explicitly** — the `app-rpc` passthrough (A2), the deprecated `public-catalog`
  action aliases (B2), and the `legacy` RPC mode (A3). Installed mobile builds call these and
  cannot be updated by a deploy. Each must carry a header comment saying what it is, why it
  exists, and that it is removed after the next mobile release. A reviewer should treat an
  *unnamed* shim as dead code, and these three as required.
- **Commit per task**, message prefix matching the task id (e.g. `feat(backend): A2 …`).

---

## Phase A — Independent deployment

Everything downstream is safer once a dispatch change cannot break checkout. Do this first.

### Task 1 — [A1] Extract app-rpc into domain modules

**Goal:** `supabase/functions/app-rpc/index.ts` (~7,100 lines, 59 `if (action === …)` branches)
becomes a thin router over five domain modules. Behaviour is byte-for-byte identical; this is
a pure refactor. No function is deployed differently yet.

**Structure:**

```
supabase/functions/_shared/rpc/
  context.ts      # request parse, auth, role resolution, idempotency, backpressure
  respond.ts      # json(), fail(), the ClientSafeError bridge
  registry.ts     # type RpcHandler, type RpcDomain, buildDispatcher(handlers)
supabase/functions/_shared/domains/
  orders.ts       # customer order lifecycle + payment (see action list)
  dispatch.ts     # dispatch owner, courier, rider, delivery status
  partner.ts      # restaurant profile, menu, partner order actions, applications
  admin.ts        # approvals, access, dashboard, promos, broadcasts, support inbox
  account.ts      # policy, roles, staff provisioning, account lifecycle, promoTrack
```

**Action → domain map** (all 59; this list is the contract):

- **orders:** `customerGetOrders`, `customerGetOrderDetail`, `customerListFavoriteRestaurants`,
  `customerToggleFavoriteRestaurant`, `placeCustomerOrder`, `initializeCustomerPayment`,
  `refreshCustomerPaymentStatus`, `cancelCustomerOrder`, `customerSendSupportMessage`,
  `customerGetSupportThread`
- **dispatch:** `dispatchGetDeliveryQueue`, `dispatchGetRiders`, `dispatchGetWeeklyEarnings`,
  `dispatchGetOrderDetail`, `upsertDispatchRiderProfile`, `syncDispatchRiderLocation`,
  `dispatchAssignOrderCourier`, `dispatchUpdateOrderStatus`, `submitDispatchApplication`
- **partner:** `partnerGetRestaurantContext`, `partnerGetRestaurantOrders`,
  `partnerGetRestaurantOrder`, `upsertPartnerRestaurantProfile`, `claimPartnerRestaurantLink`,
  `upsertPartnerRestaurantMenu`, `partnerUpdateOrderStatus`, `submitPartnerApplication`
- **admin:** `adminGetApprovalQueue`, `adminReviewDispatchApplication`,
  `adminReviewPartnerApplication`, `adminGetDashboardSnapshot`, `adminGetAccessOverview`,
  `supportGetInbox`, `supportGetConversation`, `supportSendAgentReply`,
  `supportSetConversationStatus`, `supportAssignConversation`, `broadcastList`, `broadcastGet`,
  `broadcastPreviewAudience`, `broadcastCreate`, `broadcastSchedule`, `broadcastCancel`,
  `promoList`, `promoCreate`, `promoSetActive`, `bootstrapFirstAdmin`
- **account:** `promoTrack`, `getPolicyAcceptance`, `recordPolicyAcceptance`,
  `provisionStaffAccount`, `assignUserRole`, `updateUserRestaurantLink`, `revokeUserRole`,
  `disableUserAccess`, `enableUserAccess`, `syncUserClaims`, `deleteOwnAccount`,
  `deleteAdminAccess`

Shared helpers used by more than one domain (`loadOrderBundle`, `notifyUsers`,
`updateOrderRecord`, `loadUserAccount`, the Paystack helpers, the dispatch selectors, …) move
to `_shared/` modules grouped by subject, not one dumping-ground file.

**Preserve exactly:** `HOT_WRITE_ACTIONS` and `HOT_WRITE_BACKPRESSURE_LIMITS` behaviour,
`ensureRole` checks per action, `TERMINAL_ORDER_STATUSES`, `ORDER_STATUS`, the 15-minute
`ORDER_PAYMENT_TIMEOUT_MS` expiry, and every 412 message string — clients match on some of them.

**Tests:** a Deno test per domain module asserting the dispatcher routes each action name to a
handler and rejects unknown actions with 404; plus a single test asserting the union of the
five domains' action lists equals the 59-name set above, so a dropped action fails loudly.

**Done when:** `app-rpc/index.ts` is under 200 lines and only wires context → dispatcher;
`npm run test` passes; no behaviour change is visible in any diff to app code.

---

### Task 2 — [A2] Five deployable functions

**Goal:** each domain gets its own Edge Function directory whose `index.ts` is ~30 lines:
build context, dispatch that domain, respond.

```
supabase/functions/feasty-orders/index.ts
supabase/functions/feasty-dispatch/index.ts
supabase/functions/feasty-partner/index.ts
supabase/functions/feasty-admin/index.ts
supabase/functions/feasty-account/index.ts
```

`app-rpc` stays, routing all 59 actions as before, marked deprecated in a header comment. It
is the compatibility shim for already-installed mobile builds and is removed in a later
release, not this branch.

Each new function gets its own `deno.json` if the repo pattern needs one, and each is added
to `supabase/config.toml` if functions are declared there.

**Tests:** one Deno test per function asserting an unknown action returns 404 and an
unauthenticated privileged action returns 401 — cheap smoke tests that catch a mis-wired
dispatcher.

**Done when:** all five directories exist, each imports only its own domain module plus
`_shared`, and `npm run test` passes.

**Operator steps:** `supabase functions deploy feasty-orders feasty-dispatch feasty-partner
feasty-admin feasty-account` — then verify each responds before switching clients (Task A3).

---

### Task 3 — [A3] Client action→function routing

**Goal:** every app calls the right function without any call site changing.

- Add `packages/domain/src/rpcRoutes.ts` exporting `RPC_ROUTES: Record<string, RpcFunction>`
  (the same 59-name map as A1, generated from one source so it cannot drift) and
  `resolveRpcFunction(action)` which throws on an unknown action.
- Each app's RPC client (`apps/*/src/lib/rpc.ts`, `apps/*/src/services/*`) resolves the
  function name from the action instead of hardcoding `app-rpc`.
- A single env-controlled kill switch, `EXPO_PUBLIC_RPC_MODE` / `VITE_RPC_MODE`, with values
  `split` (default) and `legacy` (everything to `app-rpc`), so a bad deploy is one env flip
  to recover — not a rebuild.

**Tests:** Node test asserting `RPC_ROUTES` covers exactly the 59 actions, that
`resolveRpcFunction` throws on unknown input, and that `legacy` mode maps everything to
`app-rpc`.

**Done when:** `npm run typecheck:customer`, `typecheck:partner`, `typecheck:dispatch`, the
admin build, and `npm run test` all pass.

---

### Task 4 — [A4] Per-function deploy and CI

**Goal:** deploying one function does not redeploy the others.

- `scripts/deploy-function.ps1 <name>` deploying a single named function, refusing any name
  not in the known list.
- Replace the blanket sync in the existing deploy scripts: **secrets are synced only when
  explicitly asked** (`-SyncSecrets`), because the current script re-syncs `functions/.env`
  to secrets on every run and has clobbered live Paystack keys with placeholders before.
- A path-filtered GitHub workflow per function: changes under
  `supabase/functions/<name>/**` or `supabase/functions/_shared/**` deploy that function.
  `_shared` changes deploy all five.

**Done when:** the scripts exist, the workflows are valid YAML, and the secret-sync default is
off. No deploy is executed by the implementer.

---

## Phase B — Cost: stop polling, stop shipping the whole catalog

### Task 5 — [B1] Realtime-first order and queue data

**Goal:** delete the `setInterval` polls that drive live screens and drive them from the
Realtime Broadcast channels that already exist (`orders`, `order-<id>`, `dispatch-riders`,
`restaurants`, `promos`, `support-inbox`, `support-<id>`).

Files with polls to replace:
`apps/customer/src/hooks/useCustomerOrder.ts` (30s),
`apps/customer/app/(customer)/orders/index.tsx` (30s),
`apps/customer/app/(customer)/cart.tsx` (30s),
`apps/customer/src/hooks/useSupportThreadRealtime.ts` (30s),
`apps/partner/src/hooks/usePartnerOrders.ts` (30s), `usePartnerOrder.ts` (30s),
`usePartnerRestaurant.ts` (60s),
`apps/dispatch/src/hooks/useDispatchOrders.ts`, `useDispatchOrder.ts`,
`useDispatchRiders.ts` (30s each),
`apps/admin-web/src/lib/usePolledRpc.ts` (20s),
`apps/admin-web/src/contexts/SnapshotContext.tsx` (20s).

**Design:** one shared hook, `useRealtimeResource({ topic, load, fallbackMs })`:

- subscribes to the topic, refetches on a `changed` event (debounced 400ms, trailing);
- refetches once on mount and once on app foreground / tab focus — keep the existing
  `hasUserRef` tab-refocus guard, it fixed a real white-screen bug;
- **only** starts an interval when the channel is not `SUBSCRIBED`, and that fallback is
  **120s**, not 30s;
- clears everything on unmount and on background.

**Constraint:** customer order Realtime works because the RLS self-read policies on
`CustomerOrder` and `DeliveryAssignment` are applied in production. Do not assume Realtime
works for any other table.

**Tests:** Node tests for the hook's state machine — subscribed → no interval; disconnected →
120s interval; reconnect → interval cleared; two `changed` events inside the debounce window →
one refetch.

**Done when:** no `setInterval` with a value under 120000 remains in `apps/**` outside of
animation code, and every touched app typechecks and lints.

---

### Task 6 — [B2] Split the catalog read

**Goal:** stop returning every restaurant's full menu on every call.

`public-catalog` gains two actions and loses the old shape:

- `customerGetRestaurantList` → cards only: `id, name, cuisine, cuisines, image, logoImage,
  deliveryFee, deliveryTime, minOrder, latitude, longitude, deliveryRadiusKm, supportsDelivery,
  supportsPickup, isOpen, updatedAt, ratingAverage, ratingCount`. **No `menu` field at all.**
  Accepts optional `{ latitude, longitude }` and, when given, returns only restaurants whose
  `deliveryRadiusKm` covers the point, sorted nearest-first; without coordinates, current
  behaviour (`updatedAt DESC`). Page size 50 with a `cursor`.
- `customerGetRestaurantDetail` → one restaurant **by id, queried by id** — not a full-catalog
  load followed by `.find()`, which is what it does today.

Keep `customerGetPublishedRestaurants` and `customerGetPublishedRestaurantDetail` as thin
deprecated aliases for one release so old mobile builds keep working.

Cache headers: list `public, max-age=60, stale-while-revalidate=300`; detail
`public, max-age=30, stale-while-revalidate=120`.

`apps/customer/src/services/publicRestaurantReadModel.ts` moves to list-then-detail: the home
feed uses cards, the restaurant screen fetches its own detail, and menus are never held for
restaurants the user has not opened.

**Tests:** Deno tests for radius filtering (inside, outside, missing coords), for cursor
paging, and asserting the list response contains no `menu` key. Node test that the read model
requests detail exactly once per restaurant open.

**Done when:** a list response for N restaurants is O(N) small rows with no menus, and opening
a restaurant issues exactly one detail request.

---

## Phase C — Money: automatic settlement

### Task 7 — [C1] Paystack subaccounts at approval

**Goal:** `RestaurantPayout` stops being an unused table.

- On `adminReviewPartnerApplication` decision `approve`: resolve the bank account against
  Paystack (`/bank/resolve`), create a subaccount (`/subaccount`) with
  `percentage_charge = 0` (the platform's take is the embedded markup, not a commission),
  store `paystackSubaccountCode`, set `RestaurantPayout.status = 'active'`.
- Failure sets `status = 'failed'` with `lastError`, leaves the application approved, and
  raises an admin notification. A restaurant with a non-active payout row **may still trade** —
  it settles on the manual path until fixed. Do not block orders on payout state.
- Idempotent: an existing `paystackSubaccountCode` is reused, never re-created.
- Admin console gets a payout column and a "retry payout setup" action.

**Tests:** Deno tests over a faked Paystack client — happy path, resolve failure, subaccount
failure, and re-approval with an existing code (must not call create).

**Operator steps:** none beyond deploying `feasty-admin`.

---

### Task 8 — [C2] Split the charge

**Goal:** money reaches the restaurant without a human.

- `initializeCustomerPayment` passes `subaccount` and `transaction_charge` so Paystack splits
  at capture: the restaurant's subaccount receives `pricing.settlement.netSettlement`
  (restaurant basis + delivery fee), the platform keeps the rest.
- Record `splitSubaccountCode` on the `PaymentTransaction` row (the column already exists).
- Orders for a restaurant without an active payout initialize **unsplit**, exactly as today,
  and are flagged `settlementMode: 'manual'` on the transaction so reconciliation can find them.
- Admin gets a settlement view: per restaurant, per day — orders, gross, split, manual,
  and the delta.

**Invariant test:** for every order, `settlement.netSettlement + platformFee + tip` equals
`pricing.total` to the kobo. Add it to `payment-verification/invariants.ts` and assert it in
the webhook path.

**Operator steps:** confirm the live Paystack key has subaccount permissions; verify one live
split order end to end before enabling for all restaurants.

---

## Phase D — Dispatch automation

### Task 9 — [D1] Automatic courier selection

**Goal:** stop requiring a human to pick every rider.

**Corrected premise (found during Task 1, 2026-08-03).** An earlier draft of this task said it
would "replace the current weighted-random owner pick". **There is no current pick.**
`assignDispatchOwnerForOrder` is defined in the pre-refactor `app-rpc/index.ts` at line 2332
and has **no caller anywhere in the 59-action surface** — confirmed by grep against the
baseline file and independently by the Task 1 implementer and reviewer. The whole automatic
dispatch path — `assignDispatchOwnerForOrder`, `selectDispatchOwnerForRestaurant`,
`selectDispatchCourierForRestaurant`, both candidate loaders, the eligibility predicate and
both weight functions — is unreachable code, now parked verbatim in
`_shared/dispatchSelection.ts`. Today an order reaches a rider **only** when a human calls
`dispatchAssignOrderCourier`, and nothing assigns a dispatch owner at all.

So this task **introduces** automatic assignment rather than rewiring it. Treat
`dispatchSelection.ts` as a starting sketch to rewrite, not as working code to call — it has
never executed, so none of it is proven.

- **Call site:** when an order reaches `accepted` and `fulfillmentType === 'delivery'`, select
  a dispatch owner, then a courier, and create the `DeliveryAssignment` automatically. This
  call site does not exist yet — add it in `partnerUpdateOrderStatus` where the status
  transition is committed, and make it non-fatal: a selection failure must log and leave the
  order accepted, never roll back the restaurant's accept.
- **Scoring** replaces the sketch's `selectWeightedRandomCandidate` entirely:
  `score = w_load × activeLoad + w_distance × distanceKm`, lowest wins, ties broken by
  `activeLoad` then `id`. Weights live in `PlatformSettings` (`dispatchWeights`) with defaults
  `{ load: 1.0, distance: 0.15 }` so they are tunable without a deploy. No randomness — a
  random assignment is not explainable to a rider. Delete the weighted-random helpers.
- The dispatcher keeps `dispatchAssignOrderCourier` as an **override**, which must log a
  `courier_reassigned` event with `reason: 'manual_override'`.
- No eligible courier → emit the `dispatch_pool_empty` event and admin notification the sketch
  describes (also never yet executed — verify it works), plus a retry on the next status change.
- Delete anything in `dispatchSelection.ts` this task does not adopt. It is dead code that has
  been carried forward once already; do not carry it again.

**Tests:** Deno tests for the scorer — nearest wins at equal load, least-loaded wins at equal
distance, missing coordinates degrade to load-only, empty pool returns null, deterministic
under a fixed candidate list.

---

### Task 10 — [D2] Offer / accept / decline

**Goal:** riders stop being assigned to and start accepting.

- New table `DeliveryOffer` (`id, orderId, courierId, status, offeredAt, respondsBy,
  respondedAt, sequence`), RLS on, no policies. Statuses:
  `pending | accepted | declined | expired | superseded`.
- On auto-selection, create a `pending` offer with `respondsBy = now + 45s` instead of
  assigning outright.
- Rider actions in `feasty-dispatch`: `dispatchAcceptOffer`, `dispatchDeclineOffer`.
  Accepting creates the `DeliveryAssignment` and increments `activeLoad`; declining or
  expiring marks the offer and re-offers to the next-best courier, excluding everyone who has
  already seen this order.
- Expiry is swept by `queue-drainer` on its existing schedule; the sweep is idempotent.
- After 3 exhausted offers, fall back to the dispatch owner's manual queue and notify admin.
- Dispatch app gets an offer screen: order summary, distance, countdown, Accept / Decline.

**Tests:** Deno tests for the offer state machine — accept, decline→re-offer, expire→re-offer,
exhausted→manual, double-accept rejected (only one offer per order can win), accept of a
superseded offer rejected.

---

### Task 11 — [D3] Rider location track

**Goal:** a position history, not one overwritten row.

- `DispatchRiderPing` (`id, riderId, latitude, longitude, accuracy, recordedAt`), RLS on, no
  policies, indexed `(riderId, recordedAt DESC)`. **UNLOGGED is not safe here** — check first
  whether any client subscribes to this table via `postgres_changes` before considering it.
- `syncDispatchRiderLocation` keeps updating the current position on `DispatchRiderRecord`
  **and** appends a ping, at most one every 10 seconds per rider (server-side throttle).
- Retention: pings older than 24 hours are deleted by `queue-drainer`.
- Dispatch app streams location while the rider has an active assignment, not always.

**Tests:** Deno tests for the throttle (second ping inside 10s is dropped, ping at 11s is
kept) and for retention deleting only rows older than the cutoff.

---

## Phase E — The customer-visible layer

### Task 12 — [E1] Ratings

**Goal:** a quality signal on both sides of the marketplace.

- `OrderRating` (`id, orderId UNIQUE, customerId, restaurantId, courierId, restaurantScore
  1-5, courierScore 1-5 nullable, comment, createdAt`). RLS on, no policies; reads go through
  the RPC.
- `RestaurantRecord` gains `ratingAverage NUMERIC`, `ratingCount INTEGER`, maintained
  incrementally on write (no full recompute).
- `DispatchRiderRecord` gains `ratingAverage`, `ratingCount`.
- Actions: `customerSubmitOrderRating` (only on a `delivered` order the customer owns, only
  once — the UNIQUE on `orderId` is the guard, not a read-then-write check),
  `customerGetPendingRatings`.
- Customer app prompts after delivery; the restaurant card and detail show the average and
  count; a restaurant with fewer than 5 ratings shows "New" rather than a misleading average.
- Feed ranking uses rating as a tie-break behind distance — not as the primary sort.

**Tests:** Node/Deno tests — rating a non-delivered order rejected, rating twice rejected,
average maths correct across increments, "New" threshold at 5.

---

### Task 13 — [E2] Customer live tracking

**Goal:** the thing people mean when they say a delivery app feels real.

- Order detail shows a map once the order is `picked_up` or `on_the_way`: restaurant pin,
  delivery pin, rider marker updated from `DispatchRiderPing`.
- Rider position reaches the customer over the existing `order-<id>` broadcast topic, emitted
  on ping (throttled to one broadcast per 10s per order). The customer must **not** be able to
  read `DispatchRiderPing` directly.
- ETA: straight-line distance ÷ a configurable average speed from `PlatformSettings`
  (`dispatchAverageSpeedKmh`, default 18), floored at 1 minute, shown as a range
  (`eta ± 3 min`). Honest and cheap; a routing service comes later.
- Map library must match what `apps/dispatch/src/components/DispatchLiveMap.tsx` already uses —
  do not introduce a second mapping stack.
- Web has no `expo-location` reverse geocoding and RNW `Alert` is a no-op; follow the existing
  `src/services/deviceLocation.ts` pattern for anything location-related on web.

**Tests:** ETA maths, throttle behaviour, and a test asserting the customer payload contains
only the rider's coordinates — never the rider's phone, id, or other assignments.

---

### Task 14 — [E3] Acceptance deadline

**Goal:** close the path where a paid customer waits forever.

- An order in `placed` past `acceptanceDeadlineMinutes` (PlatformSettings, default 8) escalates:
  admin notification, order flagged `needsAttention`.
- At 2× the deadline it auto-cancels with a **full** refund (regardless of the normal
  status-based refund rate — the customer did nothing wrong) and notifies the customer and
  the restaurant.
- Swept by `queue-drainer`; idempotent, and it must never touch an order that has since moved
  out of `placed`.
- Repeated timeouts are counted on the restaurant (`missedOrderCount`) and surfaced in admin.

**Tests:** an order accepted at deadline−1s is untouched; at deadline it escalates once and
only once; at 2× it cancels and refunds in full; an order already `accepted` is never touched.

---

## Phase F — Partner as a real in-store surface

### Task 15 — [F1] Kitchen display mode

**Goal:** the partner app is Android/iOS **and** an in-store tablet. Make the tablet case real.

- Tablet layout for `apps/partner`: at ≥900dp width, orders render as a multi-column board
  (New / Preparing / Ready) instead of a list, with type sized to be read from across a
  kitchen.
- **Alarm until acknowledged:** a new order plays a repeating sound and shows a full-screen
  interstitial that only clears on an explicit Acknowledge. Repeats every 20s until
  acknowledged or the acceptance deadline escalates it. Respect an explicit mute toggle,
  persisted per device — not a silent default.
- Keep-awake while the board is foregrounded.
- Acknowledge is distinct from Accept: acknowledging stops the alarm; the order still needs an
  accept/reject decision.

**Tests:** Node tests for the alarm state machine — new order starts it, acknowledge stops it,
a second order re-arms it, mute suppresses sound but not the interstitial.

---

### Task 16 — [F2] Availability control

**Goal:** a kitchen that has run out of something can say so in two taps.

- Menu item gains `isAvailable` (default true) and `unavailableUntil`; unavailable items are
  filtered out of the customer catalog server-side and rejected at `placeCustomerOrder` with a
  clear 412 naming the item.
- Store pause: `pausedUntil` on `RestaurantRecord`; a paused store is excluded from the list
  feed and rejects new orders, and auto-resumes without anyone remembering to.
- Both changes broadcast on the `restaurants` topic so open customer apps update without a poll.

**Tests:** ordering an unavailable item is rejected by name; a paused store is absent from the
list and rejects placement; auto-resume at expiry.

---

## Phase G — Commercial parity

Phases A–F remove ceilings; Phase G is the revenue and growth surface. Each task here is
independent of the others and can be reordered if something proves harder than expected.

### Task 17 — [G1] Promotions engine
Codes and automatic campaigns validated at checkout: `PromoCode` (code, type
`percent | fixed | free_delivery`, value, min basket, per-user and global usage caps, validity
window, restaurant scope, funding source `platform | restaurant`), `PromoRedemption` for
enforcement. Discount is computed server-side in `_shared/pricing.ts` and lands as
`pricing.discount` — which is currently hardcoded to 0. Settlement splits the discount by
funding source. Customer app gets a code field in the cart and shows eligible automatic offers.
**Tests:** cap enforcement, expiry, restaurant scoping, discount never exceeding subtotal,
settlement correctness for both funding sources.

### Task 18 — [G2] Scheduled orders
`scheduledFor` on the order; placement accepts a slot inside the restaurant's
`RestaurantHours`; a scheduler releases the order into the kitchen queue at
`scheduledFor − prepTimeMinutes`. Payment is captured at placement. Customer sees the slot in
tracking; the kitchen board shows scheduled orders in a separate lane.
**Tests:** slot validation against per-day hours, release timing, cancellation before release.

### Task 19 — [G3] Item modifiers
Menu items gain typed option groups (`single | multi`, required, min/max, per-option price
delta). Order items carry the selected options and the priced delta. Markup applies to the
option-inclusive base price — verify against `_shared/pricing.ts` rather than assuming.
**Tests:** required-group enforcement, min/max, price maths with the v2 markup, and an order
whose options changed between cart and placement being rejected.

### Task 20 — [G4] Multi-store cart
The cart holds per-restaurant sub-carts; placement creates one `CustomerOrder` per restaurant
under a shared `OrderGroup`, each with its own kitchen and dispatch lifecycle; one payment
covers the group. Tracking shows the group. This touches settlement — each order settles to its
own restaurant.
**Tests:** group placement atomicity (all orders created or none), per-order settlement,
partial cancellation.

### Task 21 — [G5] Prep-time and dynamic ETA
Record actual `acceptedAt → readyAt` per restaurant. Predict prep time as a rolling median over
the last 20 orders for that restaurant and hour-of-day bucket, falling back to the restaurant's
static `deliveryTime` until 20 samples exist. Feed the prediction into the courier offer timing
(don't dispatch a rider to wait) and into customer ETA.
**Tests:** median maths, the cold-start fallback, and bucket isolation.

### Task 22 — [G6] Courier supply
Courier onboarding with document capture (same service-role-only, storage-path posture as
`RestaurantKyc` — never public URLs), vehicle and licence fields, and an admin verification
step. Shift slots against forecast demand. A per-delivery earnings ledger (`CourierEarning`)
replacing the derived weekly sum, with a payout record mirroring `RestaurantPayout`.
**Tests:** ledger accrual on delivery, no double-accrual on re-run, payout totals matching the
ledger.

### Task 23 — [G7] Fraud and abuse signals
Velocity checks (orders per account/device/card per hour), refund-abuse scoring, and a
`RiskEvent` table feeding an admin review queue. Nothing auto-blocks in this task — it flags,
and a human decides. Auto-blocking without a human is a separate decision.
**Tests:** each rule fires on its threshold and not below it.

### Task 24 — [G8] Observability and flags
`@sentry/browser` is already a dependency and unused. Wire error and performance capture in all
four apps and structured error capture in the Edge Functions. Add a `FeatureFlag` table plus a
tiny client so a risky path ships dark. Add alerting on: payment webhook failure rate, dispatch
pool empty, acceptance-deadline escalations, and offer-exhaustion.
**Tests:** flag resolution and default-off behaviour; Sentry init is asserted, not its network
calls.

---

### Task 25 — [H1] Admin restaurant publish control

**Why this exists:** Task 3's call-site audit found `adminUpdateRestaurantApproval` wired into
the admin Approvals page (Publish / Unpublish buttons) with **no server-side implementation —
it never existed**, verified by grep against the 7,168-line pre-split `app-rpc`. The buttons
have been hitting a 501 for as long as they have shipped. Task 3 deletes the dead UI; this
task builds the capability properly.

**Goal:** an admin can publish and unpublish an already-approved restaurant without going
through the application flow.

- New action `adminSetRestaurantPublished` in the `admin` domain, registered in
  `_shared/rpc/actions.ts` `ADMIN_ACTIONS` (which raises the action count to 60 — the
  generator's count assertions in `packages/domain/src/rpcRoutes.test.ts` must be updated in
  the same commit or the suite fails, which is the intended safety net working).
- `ensureRole(context.role, ['admin'])`. Takes `{ restaurantId, isPublished }`, writes
  `RestaurantRecord.isPublished`, writes an audit entry, and broadcasts on the `restaurants`
  topic so open customer apps update without a poll.
- Unpublishing must **not** cancel in-flight orders — it only removes the restaurant from
  discovery and blocks new placement. `placeCustomerOrder` already rejects unpublished
  restaurants; verify that path rather than duplicating the check.
- Restore the Publish / Unpublish controls in `apps/admin-web/src/pages/ApprovalsPage.tsx`
  against the real action, with the error surfaced through the existing `ErrorBanner` path.

**Tests:** Deno tests — non-admin rejected 403; unknown restaurant 404; publish and unpublish
both persist and emit an audit row; the broadcast fires. Node test — the regenerated route map
still round-trips and the count assertions match 60.

**Done when:** `npm run test`, `npm run build:admin` pass, and the buttons work against a real
action rather than a 501.

---

## Sequencing

Task 1 [A1] -> 2 [A2] -> 3 [A3] -> 4 [A4] -> 5 [B1] -> 6 [B2] -> 7 [C1] -> 8 [C2] ->
9 [D1] -> 10 [D2] -> 11 [D3] -> 12 [E1] -> 13 [E2] -> 14 [E3] -> 15 [F1] -> 16 [F2] ->
17 [G1] -> 18 [G2] -> 19 [G3] -> 20 [G4] -> 21 [G5] -> 22 [G6] -> 23 [G7] -> 24 [G8] ->
25 [H1]

Task 25 [H1] is appended rather than inserted: it is a latent defect Task 3's gate surfaced,
not a dependency of anything. It may be pulled forward if an admin needs the control sooner.

A is first because every later task lands in a smaller blast radius once it is done. B is
second because it is the live cost problem. C removes the hardest operational ceiling. D is
the largest structural gap. E is what customers see. F makes the partner surface real. G is
growth.

## Out of scope for this branch

Removing the `app-rpc` shim (needs a mobile-release cycle first), multi-country and
multi-currency, POS/aggregator menu ingestion, in-app chat and masked calling, and any
auto-blocking fraud action.
