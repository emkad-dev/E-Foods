# Observability And Flags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Sentry-backed observability, a cross-app feature-flag client, and persisted operational alerts so risky paths can ship dark and production failures are visible in a reviewable queue.

**Architecture:** Shared telemetry lives in `packages/observability`; the four apps call the same initializer and install the same global error capture. Feature flags are read through a small authenticated RPC client and written by admin RPC, while operational alerts are written to a dedicated service-role table and reviewed in admin web.

**Tech Stack:** React 19, Expo Router, React Router, Supabase Edge Functions, `@sentry/browser`, `@sentry/react-native`, TypeScript, Deno tests, Node tests.

**Spec:** `docs/superpowers/specs/2026-08-27-observability-and-flags-design.md`

## Global Constraints

- Sentry initialization stays idempotent and must not double-install handlers.
- Feature flags remain service-role-only on write; app clients may only read.
- New alert storage is RLS-enabled with no policies and is service-role-only.
- Alert recording is best-effort and must never block the user flow that triggered it.
- No alert auto-blocks users; alerts are informational and review-only.
- All new RPC actions must be added to the action contract and registry tests in the same commit.

---

### Task 1: Shared telemetry runtime

**Files:**
- Modify: `packages/observability/src/sentry.ts`
- Create: `packages/observability/src/sentry.test.ts`
- Modify: `apps/customer/app/_layout.tsx`
- Modify: `apps/partner/app/_layout.tsx`
- Modify: `apps/dispatch/app/_layout.tsx`
- Modify: `apps/admin-web/src/lib/sentry.ts`
- Modify: `apps/admin-web/src/main.tsx`

**Interfaces:**
- Consumes: app name strings, platform env vars, the existing `packages/observability/src/sentry.ts` initializer.
- Produces: a shared initializer that installs app-wide error capture and performance tracing exactly once per process, plus app root wiring that calls it in all four apps.

- [ ] **Step 1: Write the failing test**

Create `packages/observability/src/sentry.test.ts` that verifies repeated initialization is a no-op, missing DSN returns `false`, and the shared initializer exposes a stable way to report a captured app error payload.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --experimental-strip-types packages/observability/src/sentry.test.ts`
Expected: fail because the new shared helper and assertions do not exist yet.

- [ ] **Step 3: Write the minimal implementation**

Update `packages/observability/src/sentry.ts` so browser and native apps use one shared setup path for tracing and global error capture. Thread that helper into the four app roots and keep `apps/admin-web/src/lib/sentry.ts` as a thin wrapper over the shared package.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test --experimental-strip-types packages/observability/src/sentry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/observability/src/sentry.ts packages/observability/src/sentry.test.ts apps/customer/app/_layout.tsx apps/partner/app/_layout.tsx apps/dispatch/app/_layout.tsx apps/admin-web/src/lib/sentry.ts apps/admin-web/src/main.tsx
git commit -m "feat(obs): add shared app telemetry wiring"
```

### Task 2: Feature flag client and admin write API

**Files:**
- Modify: `supabase/functions/_shared/featureFlags.ts`
- Modify: `supabase/functions/_shared/domains/account.ts`
- Modify: `supabase/functions/_shared/domains/admin.ts`
- Modify: `supabase/functions/_shared/rpc/actions.ts`
- Modify: `supabase/functions/_shared/rpc/registry.test.ts`
- Modify: `supabase/functions/_shared/rpc/registry.real-domains.test.ts`
- Create: `packages/domain/src/featureFlags.ts`
- Create: `packages/domain/src/featureFlags.test.ts`
- Create: `apps/customer/src/services/featureFlags.ts`
- Create: `apps/partner/src/services/featureFlags.ts`
- Create: `apps/dispatch/src/services/featureFlags.ts`
- Create: `apps/customer/src/contexts/FeatureFlagsContext.tsx`
- Create: `apps/partner/src/contexts/FeatureFlagsContext.tsx`
- Create: `apps/dispatch/src/contexts/FeatureFlagsContext.tsx`
- Modify: `apps/customer/app/_layout.tsx`
- Modify: `apps/partner/app/_layout.tsx`
- Modify: `apps/dispatch/app/_layout.tsx`
- Modify: `apps/admin-web/src/services/platformReads.ts`
- Modify: `apps/admin-web/src/contexts/SnapshotContext.tsx`

**Interfaces:**
- Consumes: `FeatureFlag` rows from Supabase, authenticated RPC access, and the app root telemetry from Task 1.
- Produces: a shared `FeatureFlagMap` helper, a `getFeatureFlags` RPC for app clients, admin CRUD RPCs for toggling flags, and app-level feature-flag contexts/hooks that default closed.

- [ ] **Step 1: Write the failing test**

Create `packages/domain/src/featureFlags.test.ts` that verifies unknown flags default to `false`, a missing map resolves closed, and the server/client helper keeps the same key set.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --experimental-strip-types packages/domain/src/featureFlags.test.ts`
Expected: fail because the shared helper is not implemented yet.

- [ ] **Step 3: Write the minimal implementation**

Add the shared feature-flag helper in `packages/domain`, expose authenticated read and admin write actions in the backend, and thread a small feature-flag context into customer, partner, and dispatch so risky paths can check one map instead of reaching into app-specific state.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test --experimental-strip-types packages/domain/src/featureFlags.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/featureFlags.ts packages/domain/src/featureFlags.test.ts supabase/functions/_shared/featureFlags.ts supabase/functions/_shared/domains/account.ts supabase/functions/_shared/domains/admin.ts supabase/functions/_shared/rpc/actions.ts supabase/functions/_shared/rpc/registry.test.ts supabase/functions/_shared/rpc/registry.real-domains.test.ts apps/customer/src/services/featureFlags.ts apps/partner/src/services/featureFlags.ts apps/dispatch/src/services/featureFlags.ts apps/customer/src/contexts/FeatureFlagsContext.tsx apps/partner/src/contexts/FeatureFlagsContext.tsx apps/dispatch/src/contexts/FeatureFlagsContext.tsx apps/customer/app/_layout.tsx apps/partner/app/_layout.tsx apps/dispatch/app/_layout.tsx apps/admin-web/src/services/platformReads.ts apps/admin-web/src/contexts/SnapshotContext.tsx
git commit -m "feat(flags): add shared feature-flag client and admin writes"
```

### Task 3: Operational alerts and observability page

**Files:**
- Create: `supabase/migrations/20260827_operational_alerts.sql`
- Create: `supabase/functions/_shared/operationalAlerts.ts`
- Create: `supabase/functions/_shared/operationalAlerts.test.ts`
- Modify: `supabase/functions/_shared/acceptanceDeadlineSweep.ts`
- Modify: `supabase/functions/_shared/dispatchOfferSweep.ts`
- Modify: `supabase/functions/payment-verification/handler.ts`
- Modify: `supabase/functions/queue-drainer/index.ts`
- Modify: `supabase/functions/_shared/domains/admin.ts`
- Modify: `supabase/functions/_shared/rpc/actions.ts`
- Modify: `supabase/functions/_shared/rpc/registry.test.ts`
- Modify: `supabase/functions/_shared/rpc/registry.real-domains.test.ts`
- Create: `apps/admin-web/src/pages/ObservabilityPage.tsx`
- Modify: `apps/admin-web/src/App.tsx`
- Modify: `apps/admin-web/src/components/AppLayout.tsx`
- Modify: `apps/admin-web/src/services/platformReads.ts`
- Modify: `apps/admin-web/src/styles/global.css`

**Interfaces:**
- Consumes: the new operational-alert table, the feature-flag read/write APIs from Task 2, and the existing sweep/queue/payment handlers.
- Produces: persisted alert rows, backend helpers that emit alerts on threshold crossings, and a single admin page that shows alerts plus the current flag state.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/operationalAlerts.test.ts` that asserts each alert rule fires at its threshold, stays silent below it, and dedupes repeated writes for the same subject/window.

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test -A --no-lock supabase/functions/_shared/operationalAlerts.test.ts`
Expected: fail because the table helper and alert emitters do not exist yet.

- [ ] **Step 3: Write the minimal implementation**

Add the `OperationalAlert` table, build the shared alert helper, wire the alert emitters into the acceptance-deadline sweep, dispatch-offer sweep, and payment-verification/queue-drainer paths, then add a combined admin observability page that reads alert rows and manages the feature flags from Task 2.

- [ ] **Step 4: Run the test to verify it passes**

Run: `deno test -A --no-lock supabase/functions/_shared/operationalAlerts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260827_operational_alerts.sql supabase/functions/_shared/operationalAlerts.ts supabase/functions/_shared/operationalAlerts.test.ts supabase/functions/_shared/acceptanceDeadlineSweep.ts supabase/functions/_shared/dispatchOfferSweep.ts supabase/functions/payment-verification/handler.ts supabase/functions/queue-drainer/index.ts supabase/functions/_shared/domains/admin.ts supabase/functions/_shared/rpc/actions.ts supabase/functions/_shared/rpc/registry.test.ts supabase/functions/_shared/rpc/registry.real-domains.test.ts apps/admin-web/src/pages/ObservabilityPage.tsx apps/admin-web/src/App.tsx apps/admin-web/src/components/AppLayout.tsx apps/admin-web/src/services/platformReads.ts apps/admin-web/src/styles/global.css
git commit -m "feat(observability): add operational alerts and admin queue"
```

### Task 4: Verification

**Files:**
- Modify: `package.json`
- Modify: `apps/admin-web/package.json` if any new app-specific test script is needed

**Interfaces:**
- Consumes: every new test file and every touched app/package typecheck target.
- Produces: a verified branch with updated root test scripts and passing typechecks.

- [ ] **Step 1: Register the new tests**

Add the new Node and Deno tests to the root test scripts so they run with the rest of the repository.

- [ ] **Step 2: Run the full relevant test set**

Run: `npm run test`

- [ ] **Step 3: Run the touched app checks**

Run:
`npm run typecheck:customer`
`npm run typecheck:partner`
`npm run typecheck:dispatch`
`npm run build:admin`

- [ ] **Step 4: Commit**

```bash
git add package.json apps/admin-web/package.json
git commit -m "test: register observability and flag coverage"
```
