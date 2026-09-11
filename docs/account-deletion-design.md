# Account deletion: what ships, and the dormant machinery beside it

Last verified against the production database on 2026-09-11.

There are **two** account-deletion designs in this repository. Only one runs.
Read this before you touch either.

---

## 1. What ships: immediate, irreversible deletion

`deleteOwnAccount` in `supabase/functions/_shared/domains/account.ts`, reached
from all three apps' Profile tab via the RPC action of the same name
(`packages/domain/src/rpcRoutes.ts` routes it to `feasty-account`).

The sequence:

1. **Refuse admins** — 403. Admin offboarding goes through the admin console's
   `deleteAdminAccess`.
2. **Role eligibility** (`validateOffboardingEligibility`):
   - `restaurant` — 412 if a restaurant is linked, so store ownership and order
     history stay traceable.
   - `dispatch` — 412 if `activeLoad > 0` or any `DeliveryAssignment` points at
     a non-terminal order, so no delivery is stranded.
   - `customer` — no gate.
3. **Audit first**, then ban the auth user (`876000h`) so the session dies
   immediately.
4. **Cleanup** under `Promise.allSettled`: `DispatchApplicationRecord`,
   `PartnerApplicationRecord`, `DispatchRiderRecord` (+ rider broadcast), role
   links, and the `UserAccount` row.
5. **Roll back on any failure** — lift the ban and return 409. A half-deleted
   account that can no longer sign in is worse than one that was never deleted.
6. Delete the Supabase auth user.

### The database does most of the erasing

`UserAccount` has 11 inbound foreign keys. The delete fans out through them:

| On delete | Tables |
|---|---|
| **CASCADE** | `UserRole`, `UserPolicyAcceptance`, `CustomerFavoriteRestaurant`, `CourierPayout`, `CourierShiftSlot` |
| **SET NULL** | `AdminAuditLog.actorUid`, `RestaurantRecord.ownerId`, `RestaurantApproval.approvedByUid`, `PartnerApplicationRecord.approvedByUid`, `DispatchApplicationRecord.approvedByUid`, `UserRole.assignedByUid` |

`CustomerOrder` has **no** FK to `UserAccount` — `customerId` is a plain text
column — so order history survives by being unreferenced. That is what makes
the user-facing promise ("past order records are kept, no longer linked to a
sign-in account") literally true, and it is why the audit trail survives an
actor's deletion with `actorUid` nulled rather than the row vanishing.

This path is proven in production: five `self_account_deleted` audit rows from
July 2026, all `role: customer`, each with `actorUid` nulled by the SET NULL.

### Why immediate, and why it stays

Apple Guideline 5.1.1(v) and Google Play both require in-app account deletion
and both accept immediate deletion. Immediate deletion has no scheduler, no
queue, no partially-deleted window, and no way for an account to get stuck.
**Do not replace it with the grace period below without a specific reason.**

The public-facing description lives in three places that must stay in sync:
`apps/web-landing/public/account-deletion.html` (the Play Console "Data
deletion" URL), `docs/legal/privacy-policy.md` + `privacy.html`, and the in-app
copy in `packages/domain/src/accountDeletion.ts` and `policies.ts`.

---

## 2. What does not ship: the 30-day grace period

Plan: `docs/superpowers/plans/2026-08-07-pending-deletion-gates.md` (tasks
C3a/C3b).

**Its enforcement is fully live in production. Its writers do not exist.**

Live today:

- `UserAccount` carries all six columns: `deletionRequestedAt`,
  `purgeScheduledAt`, `deletionCancelTokenHash`, `purgeAttemptCount`,
  `purgeLastAttemptAt`, `purgeLastError`, plus the partial index
  `UserAccount_purge_due_idx`.
- The `user_profiles` view exposes `deletionRequestedAt` and
  `purgeScheduledAt`, and `_shared/request-context.ts` selects both on **every
  authenticated request**.
- `assertAccountAccessible` (`_shared/accountAccess.ts`) throws
  `403 ACCOUNT_PENDING_DELETION` — carrying `purgeScheduledAt` — the instant
  `deletionRequestedAt` is non-null.
- `ebuy_account_pending_deletion()` exists; the
  `ebuy_guard_useraccount_sensitive_update` trigger freezes the whole row to
  its owner while a deletion is pending; **five RLS policies** are gated on it
  (`UserRole` insert, `UserPolicyAcceptance` insert, and the three
  `CustomerFavoriteRestaurant` policies).

Missing entirely: any writer of `deletionRequestedAt`, a
`cancelAccountDeletion` handler, a purge runner, its cron, and the
cancellation email. Production holds **0** pending rows out of 30 accounts.

### The hazard this creates

> Setting `deletionRequestedAt` on a real account today **permanently locks
> that account out of every authenticated action**, and the RLS freeze stops
> the user clearing it themselves.

There is no way back out in the product. Only a `service_role` or `admin`
write — both exempt from the trigger — can clear the flag.

This was worse until 2026-09-11. `rpc/context.ts` read:

```ts
allowPendingDeletion: action === 'cancelAccountDeletion',
```

`cancelAccountDeletion` is in no action list and has no handler; calling it
501s. The single documented escape hatch pointed at nothing, while the comment
above it promised a restore path. Nothing failed, because nothing checked.

It now routes through `PENDING_DELETION_EXEMPT_ACTIONS` in `rpc/actions.ts` —
**currently empty, which is correct** — and
`supabase/functions/_shared/rpc/actionReferences.test.ts` asserts that every
name in that list exists in `ALL_RPC_ACTIONS`, and that `context.ts` keeps
deriving the exemption from the list rather than from a bare string literal.

### If you activate the grace period

All of the following, or none of it:

1. **A writer** — a `requestAccountDeletion` action that sets
   `deletionRequestedAt` and `purgeScheduledAt`, registered in `ACCOUNT_ACTIONS`
   and routed in `packages/domain/src/rpcRoutes.ts`.
2. **A way back** — a `cancelAccountDeletion` handler, registered the same way
   **and added to `PENDING_DELETION_EXEMPT_ACTIONS`**. Without the list entry it
   is refused by its own gate; without the handler the list entry fails the test
   above. Both, or neither.
3. **A purge runner** — reads the `purgeScheduledAt` index, calls the same
   offboarding path as `deleteOwnAccount`, and records
   `purgeAttemptCount` / `purgeLastAttemptAt` / `purgeLastError`. It must be
   idempotent and must not leave an account banned-but-not-deleted.
4. **Its cron**, following the pattern and Vault prerequisites of the existing
   `queue-drainer` / `broadcast-runner` schedules — both of which were silent
   no-ops for a while because those prerequisites were missing.
5. **The cancellation email**, and a `deletionCancelTokenHash` flow to back it.
6. **Store-facing copy changes.** Every surface listed above currently says
   deletion is immediate and irreversible. Apple rejects "deletion" that is
   only deactivation, so if a grace period lands, the copy must describe it
   accurately — what the window is, how to cancel, and what happens at the end.

Until then, treat those six columns as reserved. Do not write to them.

---

## Admin offboarding

`deleteAdminAccess` (same domain file) deletes an admin account: 412 on self,
412 unless the target's resolved primary role is `admin`, then the same
`offboardUserAccount` path with an `admin_account_deleted` audit action. It is
wired into `apps/admin-web` `AccessPage`, gated by
`apps/admin-web/src/lib/adminOffboarding.ts`, which mirrors both 412 conditions
client-side so the button is never offered when the server would refuse it.

Related: [pending-deletion gates plan](superpowers/plans/2026-08-07-pending-deletion-gates.md),
[RLS posture](rls-posture.md).
