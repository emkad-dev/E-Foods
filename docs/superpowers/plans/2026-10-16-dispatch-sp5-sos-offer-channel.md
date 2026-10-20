# Dispatch SP-5 — Rider SOS + offer sound channel + on-trip persistent notification

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Three rider-safety/UX features: (1) dedicated Android `offers` notification channel so new offers are unmissable; (2) SOS button on active delivery screen; (3) persistent on-trip Android notification.

**Spec:** `docs/superpowers/specs/2026-10-16-dispatch-sp5-sos-offer-channel-design.md`

**Working directory:** `C:\Users\emkad\EBuy\E-Foods`

## Global Constraints

- SP-5 adds ONE new RPC action (`dispatchRiderSOS`). Update ALL FOUR contract copies + the handlers map ([[feasty-rpc-action-count-guards]]): `rpc/actions.ts`, `packages/domain/src/rpcRoutes.ts`, `packages/domain/src/rpcRoutes.test.ts` (count + names), `rpc/registry.test.ts`, `rpc/registry.real-domains.test.ts`. Mirror how `dispatchSetAvailability` appears in each.
- `deno check` from `supabase/` — no new errors over the 210-error baseline.
- Full `npm run test:deno` green (incl. real-domains).
- App typecheck + lint green (`npm --prefix apps/dispatch run typecheck`). Junction `node_modules`: `mklink /J apps\dispatch\node_modules C:\Users\emkad\EBuy\E-Foods\node_modules`, remove after.
- Client-safe errors only in the backend.
- Never weaken SP-1/SP-2/SP-3/SP-4 controls.
- No migration, no `supabase db push`, no new tables.
- Tasks 1 and 2+3 and 4 are independent — Task 1 (offer channel) can be done before or after Task 2 (SOS backend). Do them in order as listed.

## Task 1: Offer sound channel

**Files:** `supabase/functions/_shared/dispatchSelection.ts`, `apps/dispatch/src/hooks/usePushNotifications.ts`

- [ ] **Step 1:** In `dispatchSelection.ts`, find the `notifyUsers` call at ~line 763 (`title: 'New delivery offer'`). Add `channelId: 'offers'` to the payload object (alongside `title`, `body`, `data`).
- [ ] **Step 2:** In `usePushNotifications.ts`, inside the `if (Platform.OS === 'android')` block (after the `setNotificationChannelAsync('default', ...)` call), add the `offers` channel registration:
  ```typescript
  await Notifications.setNotificationChannelAsync('offers', {
    name: 'Delivery offers',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 500, 100, 500],
    lightColor: '#F5B342',
    enableLights: true,
    enableVibrate: true,
    sound: 'default',
  });
  ```
- [ ] **Step 3:** `npm --prefix apps/dispatch run typecheck` green (junction node_modules if needed). `deno check` no new errors.
- [ ] **Step 4: Commit** (`feat(dispatch): route new-offer push to a dedicated Android notification channel` + trailer).

## Task 2: SOS backend RPC + contract updates + tests

**Files:** `supabase/functions/_shared/domains/dispatch.ts`; all five contract touchpoints (same pattern as `dispatchSetAvailability`); new test file `supabase/functions/_shared/dispatchSos.test.ts`.

**First: check the `DeliveryEvent` table** — `grep -n "eventType\|DeliveryEvent" supabase/functions/_shared/domains/dispatch.ts | head -30` to confirm the column accepts free-text event types. If the insert pattern exists, mirror it. Do NOT create a new table.

- [ ] **Step 1: Write the failing test** (`dispatchSos.test.ts`, `--no-check` pattern, env stubs + dynamic import of `domains/dispatch.ts`):
  - A `dispatch` caller triggers SOS → inserts a `DeliveryEvent` row with `eventType: 'sos_triggered'` and the caller's uid as `courierId`.
  - A `partner` or `customer` caller → `ensureRole` throws (role guard).
  - An `admin` caller → role guard rejects (dispatch-only).
- [ ] **Step 2: Run, confirm fail** (action/handler missing).
- [ ] **Step 3: Implement the handler** in `dispatch.ts`:
  ```typescript
  const dispatchRiderSOS: Handler = async ({ context, data }) => {
    ensureRole(context.role, ['dispatch']);
    const { data: riderRow, error: riderErr } = await serviceClient
      .from('DispatchRiderRecord')
      .select('latitude,longitude')
      .eq('id', context.uid)
      .single();
    if (riderErr || !riderRow) throw new Error('Rider record not found.');
    const orderId = sanitizeOptionalText(data.orderId) ?? null;
    const { data: event, error: eventErr } = await serviceClient
      .from('DeliveryEvent')
      .insert({
        courierId: context.uid,
        eventType: 'sos_triggered',
        latitude: riderRow.latitude,
        longitude: riderRow.longitude,
        orderId,
        occurredAt: nowIso(),
      })
      .select('id')
      .single();
    if (eventErr) throw new Error(eventErr.message);
    await notifySafely(async () => {
      await sendPushNotificationsToRoles(['admin'], {
        body: `Rider ${context.uid.slice(-6).toUpperCase()} triggered SOS. Lat: ${riderRow.latitude ?? 'unknown'}, Lng: ${riderRow.longitude ?? 'unknown'}.`,
        channelId: 'sos',
        data: buildNotificationData({ app: 'admin', orderId: orderId ?? '', routeKey: 'admin_order_detail', type: 'rider_sos' }),
        title: 'Rider SOS',
      });
    });
    return json(200, { data: { sosId: sanitizeText(event?.id, ''), confirmedAt: nowIso() } });
  };
  ```
  Check imports: `sanitizeOptionalText`, `notifySafely`, `sendPushNotificationsToRoles`, `buildNotificationData` — grep for each and add if missing. `notifySafely` is used in orders.ts and wraps a push so a notification failure doesn't fail the RPC.
  Add `dispatchRiderSOS` to the handlers map (near the `dispatchSetAvailability` entry).
- [ ] **Step 4: Update ALL five contract copies** — mirror how `dispatchSetAvailability` appears in each file. Add `'dispatchRiderSOS'` to `rpc/actions.ts`; `"dispatchRiderSOS": 'feasty-dispatch'` to `rpcRoutes.ts`; update `rpcRoutes.test.ts` (count + any name list); update `registry.test.ts` and `registry.real-domains.test.ts`.
- [ ] **Step 5: Run the FULL `npm run test:deno`** (export node PATH) and `cd supabase && deno check **/*.ts` — no new errors. Register `dispatchSos.test.ts` in the matching `--no-check` test list.
- [ ] **Step 6: Commit** (`feat(dispatch): dispatchRiderSOS RPC — rider SOS alert to admin` + trailer).

## Task 3: SOS UI button in delivery screen

**Files:** `apps/dispatch/app/(dispatch)/delivery/[id].tsx`, `apps/dispatch/src/services/dispatchOrderActions.ts`

**Read the delivery screen** before editing — it is 910 lines. Find where the status-action buttons are rendered (the section that shows "Accept", "Mark Collected", "Mark Delivered" etc.). The SOS button goes in the active-delivery state only.

- [ ] **Step 1:** Add `triggerRiderSOS(orderId: string)` to `dispatchOrderActions.ts`, calling `callDispatchBackendRpc('dispatchRiderSOS', { orderId })`. Mirror the pattern of `setDispatchAvailability`.
- [ ] **Step 2:** In `delivery/[id].tsx`, add state: `const [sosConfirming, setSosConfirming] = useState(false)` and `const [sosSent, setSosSent] = useState(false)`.
- [ ] **Step 3:** Render the SOS button only when the delivery is in an active state (not terminal: not `delivered`, `cancelled`, `failed`). Use a red button matching dispatch theme tokens (no raw hex). On press: `setSosConfirming(true)`.
- [ ] **Step 4:** Confirmation overlay/modal (not Alert — it's a no-op on web): a small inline banner or bottom sheet reading "Send emergency alert to FEASTY ops? This is NOT a call to 999/112." with **Send SOS** (red) and **Cancel** buttons. On Send SOS: call `triggerRiderSOS(orderId)` → on success: `setSosSent(true); setSosConfirming(false)` — show "SOS sent. Ops have been notified." badge for 3 s then clear. On error: show client-safe error, allow retry.
- [ ] **Step 5:** `npm --prefix apps/dispatch run typecheck` + lint green. Junction node_modules if needed. State the exact active-state condition used in the report.
- [ ] **Step 6: Commit** (`feat(dispatch): SOS button on active delivery screen` + trailer).

## Task 4: On-trip persistent Android notification

**Files:** `apps/dispatch/app/(dispatch)/_layout.tsx` (or a new hook `useActiveDeliveryNotification` called from `_layout.tsx`).

**First: check `packages/domain/src/notifications.ts`** for available `routeKey` values. Use an existing dispatch routeKey that navigates to an active delivery (e.g. `dispatch_delivery_detail`) if it exists; otherwise fall back to the deliveries list key.

- [ ] **Step 1:** Create `apps/dispatch/src/hooks/useActiveDeliveryNotification.ts`:
  ```typescript
  import { useEffect } from 'react';
  import * as Notifications from 'expo-notifications';
  import { Platform } from 'react-native';
  import { buildNotificationData } from '../../../../packages/domain/src/notifications';
  import type { DispatchOrderSummary } from '../domain/entities';

  const NOTIFICATION_ID = 'active-delivery-persistent';

  export const useActiveDeliveryNotification = (activeOrders: DispatchOrderSummary[]) => {
    useEffect(() => {
      if (Platform.OS !== 'android') return;
      const activeOrder = activeOrders[0] ?? null;
      if (activeOrder) {
        void Notifications.scheduleNotificationAsync({
          content: {
            title: 'Delivery in progress',
            body: `Order #${activeOrder.id.slice(-6).toUpperCase()} — tap to view`,
            data: buildNotificationData({
              app: 'dispatch',
              orderId: activeOrder.id,
              routeKey: '<chosen routeKey>',
              type: 'active_delivery',
            }),
            android: {
              channelId: 'default',
              sticky: true,
              priority: Notifications.AndroidNotificationPriority.HIGH,
            } as Record<string, unknown>,
          },
          trigger: null,
          identifier: NOTIFICATION_ID,
        }).catch(() => undefined);
      } else {
        void Notifications.dismissNotificationAsync(NOTIFICATION_ID).catch(() => undefined);
      }
    }, [activeOrders]);
  };
  ```
  Adjust the type of `activeOrders` to match whatever `useDispatchOrders` returns for its `activeDeliveryOrders`.
- [ ] **Step 2:** Call `useActiveDeliveryNotification(activeDeliveryOrders)` in `apps/dispatch/app/(dispatch)/_layout.tsx`. Read the layout file first — `activeDeliveryOrders` is likely available there via `useDispatchOrders`.
- [ ] **Step 3:** `npm --prefix apps/dispatch run typecheck` + lint green. State the routeKey chosen and the type name used in the report.
- [ ] **Step 4: Commit** (`feat(dispatch): persistent Android notification during active delivery` + trailer).

---

## Final verification (whole-branch, after all tasks)
- Full `npm run test:deno` green (incl. real-domains contract test); `deno check` no new errors.
- `git grep -n dispatchRiderSOS` — present in all five contract copies + handler + app service.
- Dispatch typecheck + lint green.
- PR-body note: deploying `feasty-dispatch` ships the SOS action; the offer channel and persistent notification land in the next app build; the `sos` admin push channel requires the admin app to register it (out of scope here — admin uses web).
