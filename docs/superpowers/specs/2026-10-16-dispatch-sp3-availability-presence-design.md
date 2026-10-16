# Dispatch SP-3 — Rider availability & presence design spec

Date: 2026-10-16. Branch: `feature/dispatch-glovo-sp1` (SP-3 stacks on SP-1+SP-2; one accumulating dispatch feature branch, owner merges once). Worktree: `C:\Users\emkad\EBuy\dispatch-glovo-wt`.

## Context & intent

Third sub-project of the dispatch Glovo-standard overhaul (SP-1 security + SP-2 OTP are complete). SP-3 gives riders real **presence**: an online/offline control, and — critically — a location heartbeat while online so the matching engine can actually find an idle-but-available rider.

**The deadlock SP-3 must fix.** SP-1 added an eligibility gate: a rider is only offered an order if their latest `rider_live_location` ping is newer than `DISPATCH_MAX_LOCATION_AGE_SECONDS` (120s). But the dispatch app today streams location **only while the rider holds an active assignment** (`apps/dispatch/app/_layout.tsx:54`, a battery/cost gate: `!hasActiveAssignment` ⇒ no sync). So an idle rider with no current order never pings → never fresh → never offered a *first* order. Presence is the missing half of SP-1's freshness gate, and without it the pilot cannot assign anyone their first job.

Today's status model: `DispatchRiderRecord.status` is a free-text field defaulting to `'Available'`; matching excludes only `status === 'Offline'` (`dispatchSelection.ts:223`). Nothing in the app can set the status — a rider cannot go offline, and the profile's status is read-only (the picker that existed was removed because the server ignored it). There is no RPC to set availability.

Standing decisions: one-city pilot (~30 riders), foreground-only tracking, **cash strictly removed (SP-4)**. On the FREE Supabase plan cost is invocation-bound ([[feasty-egress-is-invocation-bound]]), so the idle heartbeat cadence matters.

Success = a rider can toggle Available/Offline; while Available (and foregrounded) the app sends a location heartbeat frequent enough to stay inside the 120s freshness window, so an idle available rider becomes offerable; while Offline the app stops pinging and matching excludes them. Built behind the still-off dispatch gate (flipped in SP-6), migration-free, tested.

## Scope

### Backend — one new RPC action `dispatchSetAvailability`
- Handler in `supabase/functions/_shared/domains/dispatch.ts`. `ensureRole(['dispatch','admin'])`. Input `{ available: boolean }` (and, for admin only, an optional `courierId` to target another rider — a dispatcher/rider may only set their own).
- Writes `DispatchRiderRecord.status` = `'Available'` when `available` is true, `'Offline'` when false, for the caller's own id (or the admin-targeted id). Use a targeted update; do not touch `activeLoad`, location, or any other field.
- Returns `{ courierId, status }`.
- **No migration** — `status` already exists. Matching already excludes `'Offline'` (`dispatchSelection.ts:223`), so no selection change is needed; this just makes the exclusion reachable.
- Adding an RPC action means updating ALL FOUR contract copies + the handlers map ([[feasty-rpc-action-count-guards]]): the generator lib, the node route test (incl. the two test NAMES), the deno registry test, and the deno real-domains test. The real-domains one only fails in the full `test:deno` — run it.

Ruling — two states only (Available/Offline), not a tri-state with "Busy": `activeLoad` already feeds the scorer for load; a separate "Busy" adds a state with no consumer. Cost if wrong: add a third status value + a matching rule later.

### Dispatch app — the availability toggle + presence heartbeat
`apps/dispatch/app/(dispatch)/profile.tsx` (status display lives here) and/or the dashboard, plus the location gate in `apps/dispatch/app/_layout.tsx`:
1. **Toggle:** an online/offline control (a `Switch` or a prominent button) that calls `dispatchSetAvailability` and reflects the rider's current `status`. On toggle-on → `{available:true}`; toggle-off → `{available:false}`. Surface the server's client-safe error on failure and revert the optimistic UI. (If a `Switch` is used, honour [[rnw-switch-active-thumb-color]] — pass `activeThumbColor` — though dispatch is native-first.)
2. **Presence heartbeat (the deadlock fix):** change the location-sync gate in `_layout.tsx:54` from `hasActiveAssignment` to **`isAvailable || hasActiveAssignment`**, where `isAvailable` is derived from the rider's current `status === 'Available'`. So an Available rider streams location (a heartbeat) even with no active order, and an Offline rider streams nothing.
3. **Heartbeat cadence (cost-aware):** while Available-but-idle, ping on an interval comfortably under the 120s freshness window but as slow as that allows to limit invocations — target ~**60s** idle. While holding an active assignment, keep the faster cadence the live customer-tracking needs (the existing `useRealTimeLocation` interval). Implement as two intervals (idle vs active) or by widening the existing hook's `updateInterval` when no assignment is held. **Record the cost note:** ~30 riders × 60s heartbeats over a long day approaches the FREE-plan invocation budget; the pilot scale is tolerable, but SP-6/go-live should revisit (e.g. a slower idle beat, or a cheaper Data-API write path). Call this out; do not silently ship an every-5s idle beat.
4. **Offline on sign-out / app-background is NOT auto-set here** — the 120s freshness gate already makes a backgrounded/closed app fall out of matching naturally. Explicit Offline is the rider saying "stop offering me work" while the app is still open. (An explicit set-Offline on sign-out is a reasonable nicety; include it only if it is a one-liner through the existing sign-out path.)

### Matching — no change required
`isDispatcherEligible` already returns `false` for `status === 'Offline'` and SP-1 already requires a fresh ping. Once the app actually pings while Available, the two gates compose: Available + fresh ⇒ offerable; Offline ⇒ excluded; Available but app-closed ⇒ falls out after 120s. Confirm with a test; change nothing in selection unless a defect is found.

## Out of scope
- Shift scheduling (the `CourierShiftSlot` table/RPCs already exist but are unused UI — leave for later); background location; "Busy" tri-state; payouts/cash (SP-4); SOS (SP-5); ops console / gate flip (SP-6).

## Global constraints
- SP-3 adds ONE RPC action and NO migration. Update all four action-contract copies + handlers map; run the FULL `test:deno` so the real-domains contract test is exercised.
- Backend: client-safe errors only; a rider may set only their own status; admin may target any. Never weaken an SP-1/SP-2 control.
- `deno check` from `supabase/`: no new errors over baseline. New deno test for the handler (sets own status; admin targets another; rider cannot target another). A selection test proving Offline is excluded and Available+fresh is offered.
- Dispatch app: typecheck + lint green (junction `node_modules` as in SP-2). The dispatch app is gated off, so no render; careful read + typecheck is the bar.
- Honour the invocation-cost constraint: the idle heartbeat interval is a deliberate, documented choice, not an accident.

## Testing / verification bar
- Deno: `dispatchSetAvailability` sets the caller's status to Available/Offline; an admin may set another rider's; a `dispatch`-role caller passing someone else's `courierId` only affects themselves (or is refused). The four contract copies updated (full `test:deno` green, incl. real-domains). A selection test: an Offline rider is never offered; an Available rider with a fresh ping is.
- Dispatch app: typecheck + lint green; the location gate now reads `isAvailable || hasActiveAssignment`; the toggle calls the RPC and reflects/reverts correctly. State the exact gate expression and heartbeat intervals in the report.
- PR-body note: deploying `feasty-dispatch` ships the new action; presence only matters once the dispatch gate is flipped (SP-6).
