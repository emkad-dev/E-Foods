# Dispatch SP-5 — Rider SOS + offer sound channel + on-trip persistent notification

Date: 2026-10-16. Branch: `main`. All work in `E-Foods/`.

## Context & intent

Three rider-safety/UX features that complete the on-device experience before the pilot gate flips in SP-6.

1. **Offer sound channel** — riders miss offers on a noisy street because the default notification channel blends in. A dedicated `offers` Android channel with max importance and a distinct vibration pattern makes new offers unmissable.
2. **Rider SOS** — a one-tap distress signal on the active delivery screen. When triggered it notifies admin immediately with the rider's last known location, logs an immutable audit event, and gives the rider a confirmation. It does NOT call emergency services (that's the rider's own device call); it is a platform alert to ops.
3. **On-trip persistent notification** — an ongoing Android notification while the rider holds an active assignment. The rider can't accidentally lose track of an active order by closing the app, and Android's recents-task killer is less aggressive toward foreground-service-style stickies.

## Feature 1: Offer sound channel

### Backend
`supabase/functions/_shared/dispatchSelection.ts:763` — the `notifyUsers` call already accepts `channelId`. Add `channelId: 'offers'` to the payload:
```typescript
await notifyUsers([winner.id], {
  body: `Order ${order.id.slice(-6).toUpperCase()} is available - you have ${DISPATCH_OFFER_TTL_SECONDS} seconds to accept.`,
  channelId: 'offers',
  data: buildNotificationData({ ... }),
  title: 'New delivery offer',
});
```
No new RPC action, no contract change, no migration.

### App (`apps/dispatch/src/hooks/usePushNotifications.ts`)
Add an `offers` channel registration alongside the existing `default` channel (Android only). Same importance (MAX), but a distinct vibration pattern and optional sound:
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

## Feature 2: Rider SOS

### Backend — one new RPC `dispatchRiderSOS`
**Handler** in `supabase/functions/_shared/domains/dispatch.ts`.

Input: `{ orderId: string }`. Role: `dispatch` only (admin can use dispatchGetRiders or ops console for their own alerts).

Steps:
1. `ensureRole(context.role, ['dispatch'])`.
2. Load the rider's `DispatchRiderRecord` — confirm the caller IS a rider (`serviceClient.from('DispatchRiderRecord').select('latitude,longitude').eq('id', context.uid).single()`). If no row, fail 404.
3. Insert an SOS event into `DeliveryEvent` (or a new `DispatchSosEvent` if that table exists; use `DeliveryEvent` with `eventType: 'sos_triggered'`): `{ orderId: sanitizeText(data.orderId), courierId: context.uid, latitude, longitude, triggeredAt: nowIso() }`. If orderId is empty/invalid, still fire the SOS — the rider may not have an active order (use `null`).
4. Notify admin: `sendPushNotificationsToRoles(['admin'], { title: '🚨 Rider SOS', body: `Rider ${context.uid.slice(-6).toUpperCase()} triggered SOS near lat ${latitude}, lng ${longitude}`, channelId: 'sos', data: { type: 'rider_sos', courierId: context.uid, orderId: ... } })`.
5. Return `json(200, { data: { sosId: <event id>, confirmedAt: nowIso() } })`.

**No migration needed** if `DeliveryEvent` can accommodate the new event type (it is a free-text `eventType` column). Confirm this by reading the existing eventType values. If the table can't hold it, use a generic `audit_event` table that already exists — do NOT create a new table (that requires migration).

**Contract updates** (same as SP-3 — adding one RPC action updates all four copies + handlers map):
- `supabase/functions/_shared/rpc/actions.ts` — add `'dispatchRiderSOS'`
- `packages/domain/src/rpcRoutes.ts` — `"dispatchRiderSOS": 'feasty-dispatch'`
- `packages/domain/src/rpcRoutes.test.ts` — update count + name list
- `supabase/functions/_shared/rpc/registry.test.ts` — update
- `supabase/functions/_shared/rpc/registry.real-domains.test.ts` — update
- Handlers map in `dispatch.ts` — add `dispatchRiderSOS` entry

### App — SOS button in `apps/dispatch/app/(dispatch)/delivery/[id].tsx`
- Show a red SOS button only when the delivery is in an active state (not `delivered`, not `cancelled`).
- Tapping opens a confirmation modal ("Send emergency alert to FEASTY ops? This is not a call to emergency services.") — two buttons: **Send SOS** and **Cancel**. Prevents accidental fires.
- On confirm: call `callDispatchBackendRpc('dispatchRiderSOS', { orderId })` via the existing service layer.
- Show a brief "SOS sent — ops have been notified" confirmation, then auto-dismiss after 3 s.
- On error: show the client-safe error and allow retry.

## Feature 3: On-trip persistent notification

**App only** — `apps/dispatch/app/(dispatch)/_layout.tsx` (or a new hook `useActiveDeliveryNotification.ts` called from `_layout.tsx`).

When the rider has `activeDeliveryOrders.length > 0`:
- Schedule a local notification with `identifier: 'active-delivery-persistent'`:
  ```typescript
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Delivery in progress',
      body: `Order #${order.id.slice(-6).toUpperCase()} — tap to view`,
      android: {
        channelId: 'default',
        sticky: true,
        priority: Notifications.AndroidNotificationPriority.HIGH,
      },
      data: buildNotificationData({
        app: 'dispatch',
        orderId: order.id,
        routeKey: 'dispatch_delivery_detail',
        type: 'active_delivery',
      }),
    },
    trigger: null,
    identifier: 'active-delivery-persistent',
  });
  ```
- When `activeDeliveryOrders.length === 0` (order complete/cancelled), dismiss: `Notifications.dismissNotificationAsync('active-delivery-persistent')`.
- Android-only guard: `if (Platform.OS !== 'android') return;`.
- The notification is local-only — no server involvement.
- Tapping it deep-links to the delivery detail screen via the existing `resolveNotificationHref` path (the `dispatch_delivery_detail` routeKey must exist in the notifications domain, or use a working routeKey — check `packages/domain/src/notifications.ts`).

## Global constraints
- SP-5 adds exactly ONE RPC action (`dispatchRiderSOS`). Update all four contract copies + handlers map; run the FULL `test:deno` (incl. real-domains).
- Feature 1 (offer channel): only `dispatchSelection.ts` + `usePushNotifications.ts` change. No new action, no contract change.
- Feature 3 (persistent notification): app-only. No backend change. Android-only guard required.
- `deno check` from `supabase/`: no new errors over the 210-error baseline.
- App: typecheck + lint green. Junction `node_modules` to `C:\Users\emkad\EBuy\E-Foods\node_modules` if needed.
- Never weaken SP-1/SP-2/SP-3/SP-4 controls.
- Client-safe errors; never expose raw Supabase strings.
- No migration. No `supabase db push`.

## Testing / verification bar
- `dispatchRiderSOS` inserts a `DeliveryEvent` with `eventType: 'sos_triggered'` for the caller's uid; role guard rejects non-dispatch.
- Full `test:deno` green including real-domains contract test.
- Offer channel: `offers` channel registered; backend sends `channelId: 'offers'` on new offers.
- Persistent notification: shown when `activeDeliveryOrders.length > 0`, dismissed on completion; Android-only.
- Typecheck + lint green on dispatch app.
