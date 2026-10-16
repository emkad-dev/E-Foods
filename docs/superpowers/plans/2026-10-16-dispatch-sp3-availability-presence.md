# Dispatch SP-3 — Rider Availability & Presence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let a rider go Available/Offline, and stream a location heartbeat while Available so an idle rider becomes offerable — closing the deadlock SP-1's freshness gate created.

**Architecture:** A new `dispatchSetAvailability` RPC writes `DispatchRiderRecord.status` (Available/Offline); matching already excludes `'Offline'` and SP-1 already requires a fresh ping, so no selection change. The dispatch app gains an availability toggle and changes its location-sync gate from `hasActiveAssignment` to `isAvailable || hasActiveAssignment`. No migration.

**Tech Stack:** Deno/TS Supabase edge functions, PostgREST `serviceClient`, Expo/React Native dispatch app, expo-location.

**Spec:** `docs/superpowers/specs/2026-10-16-dispatch-sp3-availability-presence-design.md`

## Global Constraints

- SP-3 adds exactly ONE RPC action and NO migration. `DispatchRiderRecord.status` already exists; matching already excludes `'Offline'` (`dispatchSelection.ts:223`).
- Adding the action requires updating ALL contract copies + the handlers map ([[feasty-rpc-action-count-guards]]); the real-domains test only fails under the FULL `test:deno`, so run it:
  - `supabase/functions/_shared/rpc/actions.ts` — the action-name list.
  - `packages/domain/src/rpcRoutes.ts` — route map: `"dispatchSetAvailability": 'feasty-dispatch'`.
  - `packages/domain/src/rpcRoutes.test.ts` — node route test (updates the count AND any name list — "two NAMES").
  - `supabase/functions/_shared/rpc/registry.test.ts` — deno registry test.
  - `supabase/functions/_shared/rpc/registry.real-domains.test.ts` — deno real-domains test.
  - `supabase/functions/_shared/domains/dispatch.ts` — the handler + the handlers map (near the `dispatchDeclineOffer` entry ~line 1797).
- Backend: client-safe errors only; a `dispatch`-role caller may set ONLY their own status; `admin` may target any (`courierId`). Never weaken an SP-1/SP-2 control.
- `deno check` from `supabase/`: no new errors over baseline. App: typecheck + lint green (junction `node_modules` to `C:\Users\emkad\EBuy\E-Foods\node_modules`, remove after).
- The idle heartbeat interval is a deliberate, documented, cost-aware choice (~60s, under the 120s freshness window) — never an every-5s idle beat ([[feasty-egress-is-invocation-bound]]).

## Review Focus

- **A `dispatch`-role rider passing another rider's `courierId`** must only ever change their OWN status, never another rider's. (Task 1 test.)
- **An Offline rider** must not be offered an order; an **Available rider with a fresh ping** must be. (Task 1 selection test.)
- **An idle Available rider** (no active assignment) must now stream location so they pass SP-1's freshness gate; an **Offline rider** must stream nothing. (Task 3 — the gate expression.)
- **The toggle failing server-side** must revert the optimistic UI and show the client-safe error, not leave a false "online". (Task 2.)
- **The full `test:deno`** must pass including the real-domains contract test (the one that only fails there). (Task 1.)

---

## File Structure
- `supabase/functions/_shared/domains/dispatch.ts` — new `dispatchSetAvailability` handler + handlers-map entry.
- the five contract touchpoints above.
- `supabase/functions/_shared/dispatchAvailability.test.ts` (NEW) — handler + selection tests.
- `apps/dispatch/src/services/dispatchOrderActions.ts` (or the dispatch rider service) — a `setDispatchAvailability(available: boolean)` service fn.
- `apps/dispatch/app/(dispatch)/profile.tsx` — the toggle.
- `apps/dispatch/app/_layout.tsx` — the location-sync gate change.

---

### Task 1: Backend `dispatchSetAvailability` RPC + contracts + tests

**Files:** `domains/dispatch.ts`; the five contract touchpoints; `dispatchAvailability.test.ts` (NEW).

**Interfaces:** Produces RPC action `dispatchSetAvailability`, input `{ available: boolean, courierId?: string }`, returns `{ courierId: string, status: 'Available' | 'Offline' }`. A `dispatch` caller's target is always `context.uid` (ignore any `courierId` they pass); an `admin` may target `sanitizeText(data.courierId) || context.uid`.

- [ ] **Step 1: Write the failing handler test** (`--no-check` list; env stubs + dynamic import of `domains/dispatch.ts`; fake `serviceClient` from the `adminSetRestaurantPublished.test.ts` pattern): (a) a `dispatch` caller `{available:false}` sets its OWN row's `status='Offline'`; (b) `{available:true}` sets `'Available'`; (c) a `dispatch` caller passing `courierId: 'other'` still updates only `context.uid` (assert the update's `.eq('id', …)` was the caller, not 'other'); (d) an `admin` caller with `courierId:'other'` updates 'other'.
- [ ] **Step 2: Run, confirm fail** (action/handler missing).
- [ ] **Step 3: Implement the handler** in `dispatch.ts`:
```typescript
const dispatchSetAvailability: Handler = async ({ context, data }) => {
  ensureRole(context.role, ['dispatch', 'admin']);
  const requested = sanitizeText(data.courierId);
  const courierId = context.role === 'admin' && requested ? requested : context.uid;
  const status = data.available === true ? 'Available' : 'Offline';
  const { error } = await serviceClient
    .from('DispatchRiderRecord')
    .update({ status, updatedAt: nowIso() })
    .eq('id', courierId);
  if (error) throw new Error(error.message);
  return json(200, { data: { courierId, status } });
};
```
  Add `dispatchSetAvailability` to the handlers map (near `dispatchDeclineOffer`, ~line 1797). Confirm `nowIso`/`sanitizeText`/`json`/`ensureRole`/`serviceClient` are already imported (they are, used throughout the file).
- [ ] **Step 4: Update ALL contract copies** — add `'dispatchSetAvailability'` to `rpc/actions.ts`; `"dispatchSetAvailability": 'feasty-dispatch'` to `packages/domain/src/rpcRoutes.ts`; update `packages/domain/src/rpcRoutes.test.ts` (count + any name list); update `rpc/registry.test.ts` and `rpc/registry.real-domains.test.ts` to expect the new action. Grep each for how `dispatchDeclineOffer` appears and mirror it.
- [ ] **Step 5: Add a selection confirmation test** to `dispatchAvailability.test.ts` OR extend `dispatchSelection.test.ts`: with the `platform_dispatch` flag ON, a rider whose `status='Offline'` is never offered; an `Available` rider with a fresh `rider_live_location` ping is offered. (This proves the status gate + SP-1 freshness compose; it changes no selection code.)
- [ ] **Step 6: Run the FULL `npm run test:deno`** (export node PATH) — both invocations green, including `registry.real-domains.test.ts`. `cd supabase && deno check` no new errors. Register `dispatchAvailability.test.ts` in the matching `test:deno` list (`--no-check` since it imports `dispatch.ts`).
- [ ] **Step 7: Run the node route test** `npm test` for `packages/domain` (or whatever runs `rpcRoutes.test.ts`) to confirm the node-side contract passes.
- [ ] **Step 8: Commit** (`feat(dispatch): dispatchSetAvailability RPC for rider online/offline` + the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer).

### Task 2: Dispatch app availability toggle

**Files:** `apps/dispatch/src/services/dispatchOrderActions.ts` (add `setDispatchAvailability`); `apps/dispatch/app/(dispatch)/profile.tsx` (the toggle).

**Interfaces:** Consumes the RPC. Produces `setDispatchAvailability(available: boolean): Promise<{ courierId: string; status: string }>` calling `callDispatchBackendRpc('dispatchSetAvailability', { available })`.

- [ ] **Step 1:** Add `setDispatchAvailability` to the dispatch service, mirroring the existing `callDispatchBackendRpc('dispatchAcceptOffer', …)` calls.
- [ ] **Step 2:** In `profile.tsx`, replace the read-only status display (~line 261, "Ready to go live" / `currentRider?.status`) with an online/offline control (a `Switch` or a prominent toggle button). On change: optimistically reflect, call `setDispatchAvailability(next)`, and on error revert + show the client-safe message via the screen's existing error/notice pattern. Reflect the rider's current `status` ('Available' = online).
- [ ] **Step 3:** If a `Switch` is used, pass BOTH `thumbColor` and `activeThumbColor` ([[rnw-switch-active-thumb-color]]), using dispatch theme tokens, no raw hex.
- [ ] **Step 4:** Expose the current availability so Task 3 can read it — e.g. the rider's `status` is already loaded in the dispatch context/profile; confirm how `_layout.tsx` can learn `isAvailable` (the rider record / auth context). If a small shared piece of state or a context field is needed, add it minimally.
- [ ] **Step 5:** `npm --prefix apps/dispatch run typecheck` + lint green (junction node_modules, remove after). State the toggle's error-revert behavior in the report.
- [ ] **Step 6: Commit** (`feat(dispatch): rider availability toggle`).

### Task 3: Presence heartbeat — stream location while Available

**Files:** `apps/dispatch/app/_layout.tsx` (the location-sync gate ~line 54); possibly `apps/dispatch/src/hooks/useRealTimeLocation.ts` for the idle interval.

**Interfaces:** Consumes `isAvailable` (rider `status === 'Available'`) from Task 2's exposed state and the existing `hasActiveAssignment`.

- [ ] **Step 1:** Change the sync gate at `_layout.tsx:54` from `!hasActiveAssignment` to the equivalent of `!(isAvailable || hasActiveAssignment)` — i.e. stream & sync location when the rider is Available OR holds an active assignment; stream nothing when Offline and idle. Derive `isAvailable` from the rider's current `status`.
- [ ] **Step 2:** Make the cadence cost-aware: while Available-but-idle use ~**60s** (under the 120s freshness window); while holding an active assignment keep the existing faster interval the live customer tracking needs. Implement by passing a computed `updateInterval` to `useRealTimeLocation` (idle vs active), or a second slow interval. Do NOT ship an every-5s idle beat.
- [ ] **Step 3:** Confirm `useRealTimeLocation`'s `enabled`/interval props support this; adjust minimally if needed. Keep foreground-only (no background location — that's deferred).
- [ ] **Step 4:** `npm --prefix apps/dispatch run typecheck` + lint green. State in the report the EXACT final gate expression and the idle vs active interval values.
- [ ] **Step 5: Commit** (`feat(dispatch): stream a location heartbeat while the rider is Available`).

---

## Final verification (whole-branch, after all tasks)
- Full `npm run test:deno` green (incl. real-domains contract test); `cd supabase && deno check` no new errors; node route test green.
- Dispatch typecheck + lint green.
- `git grep -n dispatchSetAvailability` — present in all contract copies + the handler + the app service.
- No migration added; no `apps/` change outside the dispatch app.
- PR-body note: deploying `feasty-dispatch` ships the action; presence matters once the dispatch gate flips (SP-6); idle heartbeat cost to revisit at go-live.
