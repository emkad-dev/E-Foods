# Fraud and Abuse Signals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add advisory fraud and abuse signals, persist them in a private ledger, and surface them in a separate admin review page without blocking checkout or payment flows.

**Architecture:** Existing order, refund, and payment-verification flows emit normalized `RiskEvent` rows through a shared backend helper. Admin web reads the queue through a dedicated RPC-backed read model and renders it on a separate route with filters and detail context. Signal capture stays thin and failure-tolerant so the primary transaction path never depends on the risk pipeline.

**Tech Stack:** Supabase Edge Functions, Postgres migration SQL, Deno tests, React 19, React Router, TypeScript, admin-web Vite app.

**Spec:** `docs/superpowers/specs/2026-08-27-fraud-and-abuse-signals-design.md`

## Global Constraints

- This task is intentionally advisory only. It does **not** auto-block checkout, refunds, or payment verification.
- The `RiskEvent` table is service-role only and is read through RPC, not directly by clients.
- Signal capture failures must not block checkout, payment verification, or refund completion.
- The admin queue lives on a separate admin route, not inside the approvals page.
- Thresholds must be explicit, deterministic, and covered by tests.
- Initial thresholds are conservative and encoded once in the backend helper: account velocity `medium=5/high=8` per hour, device velocity `medium=8/high=12` per hour, card velocity `medium=4/high=6` per hour, refund abuse `medium=3/high=5` within the helper's rolling window.

---

### Task 1: Risk ledger and queue API

**Files:**
- Create: `supabase/migrations/20260827_risk_events.sql`
- Create: `supabase/functions/_shared/riskEvents.ts`
- Create: `supabase/functions/_shared/riskSignals.ts`
- Modify: `supabase/functions/_shared/rpc/actions.ts`
- Modify: `supabase/functions/_shared/domains/admin.ts`
- Modify: `supabase/functions/_shared/rpc/registry.test.ts`
- Modify: `supabase/functions/_shared/rpc/registry.real-domains.test.ts`
- Create: `supabase/functions/_shared/riskEvents.test.ts`

**Interfaces:**
- Produces: `RiskEvent` table, `recordRiskEvent`, `loadRiskEvents`, `loadRiskEventDetail`, `adminGetRiskEvents`
- Consumes: `serviceClient`, `nowIso`, `sanitizeText`, `parseInteger`, `JsonObject`

- [ ] **Step 1: Write the failing tests**

```ts
Deno.test('recordRiskEvent upserts a stable dedupe key and keeps the latest payload', async () => {
  const writes: Array<Record<string, unknown>> = [];
  (serviceClient as any).from = (table: string) => {
    if (table !== 'RiskEvent') throw new Error(`unexpected table ${table}`);
    return {
      upsert: async (payload: Record<string, unknown>) => {
        writes.push(payload);
        return { error: null };
      },
    };
  };

  await recordRiskEvent({
    dedupeKey: 'velocity:account:customer-1:2026-08-27T09:00:00.000Z',
    eventType: 'account_velocity',
    severity: 'medium',
    subjectType: 'account',
    subjectId: 'customer-1',
    score: 5,
    reason: 'Placed 5 orders in the last hour',
    metadata: { count: 5 },
    actorUid: 'customer-1',
    orderId: 'order-1',
  });

  assertEquals(writes.length, 1);
  assertEquals(writes[0].dedupeKey, 'velocity:account:customer-1:2026-08-27T09:00:00.000Z');
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `deno test -A --no-lock supabase/functions/_shared/riskEvents.test.ts`
Expected: fail because `riskEvents.ts` and the RPC actions do not exist yet.

- [ ] **Step 3: Implement the ledger helper and RPC read action**

```ts
export const recordRiskEvent = async (input: {
  dedupeKey: string;
  eventType: string;
  severity: 'low' | 'medium' | 'high';
  subjectType: string;
  subjectId: string;
  score: number;
  reason: string;
  metadata?: JsonObject;
  actorUid?: string | null;
  orderId?: string | null;
}) => {
  const now = nowIso();
  const row = {
    actorUid: sanitizeOptionalText(input.actorUid),
    createdAt: now,
    dedupeKey: sanitizeText(input.dedupeKey),
    eventType: sanitizeText(input.eventType),
    metadata: input.metadata ?? {},
    orderId: sanitizeOptionalText(input.orderId),
    reason: sanitizeText(input.reason),
    score: parseInteger(input.score, 0),
    severity: sanitizeText(input.severity, 'low'),
    subjectId: sanitizeText(input.subjectId),
    subjectType: sanitizeText(input.subjectType),
    updatedAt: now,
  };
  await serviceClient.from('RiskEvent').upsert(row, { onConflict: 'dedupeKey' });
  return row;
};
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `deno test -A --no-lock supabase/functions/_shared/riskEvents.test.ts supabase/functions/_shared/rpc/registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260827_risk_events.sql supabase/functions/_shared/riskEvents.ts supabase/functions/_shared/rpc/actions.ts supabase/functions/_shared/domains/admin.ts supabase/functions/_shared/rpc/registry.test.ts supabase/functions/_shared/rpc/registry.real-domains.test.ts supabase/functions/_shared/riskEvents.test.ts
git commit -m "feat: add fraud risk ledger and admin queue api"
```

### Task 2: Signal capture in backend flows

**Files:**
- Modify: `supabase/functions/_shared/domains/orders.ts`
- Modify: `supabase/functions/payment-verification/handler.ts`
- Modify: `supabase/functions/_shared/domains/orders.test.ts` or add focused tests beside the touched code paths
- Create: `supabase/functions/_shared/riskSignals.test.ts`
- Create: `supabase/functions/_shared/riskSignals.ts`

**Interfaces:**
- Consumes: `recordRiskEvent`, order/payment rows, refund helpers, `validatePaystackVerificationForOrder`
- Produces: `evaluateAccountVelocitySignals`, `evaluateDeviceVelocitySignals`, `evaluateCardVelocitySignals`, `evaluateRefundAbuseSignals`, `captureOrderRiskSignals`, `capturePaymentVerificationRiskSignals`
- Produces: advisory risk signals for velocity, refund abuse, and payment-verification anomalies

- [ ] **Step 1: Write the failing tests**

```ts
import { assertEquals } from 'jsr:@std/assert';

Deno.test('velocity rule flags on the exact threshold and not below it', async () => {
  const result = await evaluateAccountVelocitySignals({
    customerId: 'customer-1',
    hourWindowStart: '2026-08-27T09:00:00.000Z',
    orderCount: 5,
  });

  assertEquals(result.events.length, 1);
  assertEquals(result.events[0].eventType, 'account_velocity');
  assertEquals(result.events[0].severity, 'medium');
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `deno test -A --no-lock supabase/functions/_shared/riskSignals.test.ts`
Expected: fail until the signal helper is wired into order and payment-verification flows.

- [ ] **Step 3: Implement thin signal emission calls**

```ts
await recordRiskEvent({
  dedupeKey: `velocity:account:${customerId}:${windowStart}`,
  eventType: 'account_velocity',
  severity: 'medium',
  subjectType: 'account',
  subjectId: customerId,
  score: count,
  reason: `Placed ${count} orders in the last hour`,
  metadata: { windowStart, windowEnd, count },
  actorUid: customerId,
  orderId,
});
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `deno test -A --no-lock supabase/functions/_shared/riskSignals.test.ts supabase/functions/_shared/riskEvents.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/domains/orders.ts supabase/functions/payment-verification/handler.ts supabase/functions/_shared/riskSignals.test.ts
git commit -m "feat: emit advisory fraud risk events"
```

### Task 3: Separate admin review page

**Files:**
- Create: `apps/admin-web/src/pages/RiskSignalsPage.tsx`
- Modify: `apps/admin-web/src/App.tsx`
- Modify: `apps/admin-web/src/components/AppLayout.tsx`
- Modify: `apps/admin-web/src/services/platformReads.ts`
- Modify: `apps/admin-web/src/lib/format.ts` if shared formatting is needed

**Interfaces:**
- Consumes: `getAdminRiskEvents`
- Produces: a separate admin page at `/risk-signals` with severity filters and a details pane

- [ ] **Step 1: Write the failing page-level test or typecheck expectation**

```ts
expect(screen.getByRole('link', { name: 'Risk Signals' })).toHaveAttribute('href', '/risk-signals');
```

- [ ] **Step 2: Run the page typecheck and verify it fails**

Run: `npm.cmd --prefix apps/admin-web run typecheck`
Expected: fail because the route/page/service do not exist yet.

- [ ] **Step 3: Implement the route, nav item, and page**

```tsx
<Route path="/risk-signals" element={<Suspense fallback={<LoadingBlock label="Loading…" />}><RiskSignalsPage /></Suspense>} />
```

- [ ] **Step 4: Run typecheck and verify it passes**

Run: `npm.cmd --prefix apps/admin-web run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src/pages/RiskSignalsPage.tsx apps/admin-web/src/App.tsx apps/admin-web/src/components/AppLayout.tsx apps/admin-web/src/services/platformReads.ts
git commit -m "feat: add admin fraud risk queue"
```

### Task 4: Final verification

**Files:**
- Verify: `supabase/functions/_shared/riskEvents.test.ts`
- Verify: `supabase/functions/_shared/riskSignals.test.ts`
- Verify: `supabase/functions/_shared/rpc/registry.test.ts`
- Verify: `apps/admin-web/src/pages/RiskSignalsPage.tsx`

**Interfaces:**
- Produces: a complete, typechecked, tested fraud signal pipeline

- [ ] **Step 1: Run backend tests**

Run: `deno test -A --no-lock supabase/functions/_shared/riskEvents.test.ts supabase/functions/_shared/riskSignals.test.ts supabase/functions/_shared/rpc/registry.test.ts`

- [ ] **Step 2: Run admin-web typecheck**

Run: `npm.cmd --prefix apps/admin-web run typecheck`

- [ ] **Step 3: Confirm the queue is advisory only**

Verify the admin page has no approve/reject mutation actions and the backend capture helpers never call order cancellation or payment mutation paths.

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat: finish fraud and abuse signals"
```
