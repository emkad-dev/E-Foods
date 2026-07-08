# Design: Broadcast Messaging — Phase 3a

**Date:** 2026-07-08
**Status:** Approved (design), pending implementation plan
**Idea book:** `docs/idea-book.md` → "Customer service messaging system" (Phase 3)
**Builds on:** support inbox Phase 1 (Resend/Expo fan-out helpers, `app-rpc` router, admin panel).

## Summary

Admin-composed **broadcasts** to segmented audiences over **email (Resend)** and
**push (Expo)**. Compose in a new admin `/broadcasts` page, pick a segment, preview the
recipient count, then **send now (≤60s)** or **schedule**. A queue-backed runner (reusing
the existing `pg_cron` + drainer pattern) resolves the audience and sends in batches,
recording success/failure counts. **Marketing** sends (customers only) carry an
unsubscribe link and skip a suppression list; **operational/transactional** sends
(including all partner/rider comms) bypass suppression.

Phase 3a of the broadcast track. Deferred to **Phase 3b**: in-app notice channel,
city/region segmentation, recurring schedules, open/click tracking. The v1 schema is
shaped so 3b bolts on additively (jsonb `channels`/`segment`, a future `cadence` field,
a future per-recipient table).

## Goals

- Admin can compose and send/schedule a broadcast to a chosen segment over email + push.
- Segment by role, activity (order recency), and restaurant; preview the count first.
- Marketing emails (customers) are NDPR-compliant: unsubscribe link + honored suppression.
- Sending is resilient at volume (batched, per-recipient failures don't abort the run).

## Non-goals (Phase 3a)

In-app notice channel, city/region segmentation, recurring schedules, open/click
tracking, A/B testing, per-recipient delivery rows.

## Key decisions

- **Send-now = schedule at `now`**, processed by the cron runner on its next tick
  (≤60s). No separate inline send path.
- **`category`** drives compliance: `marketing` (customers; unsubscribe + suppression)
  vs `transactional` (anyone incl. partners/riders; no unsubscribe, no suppression).
  Partner/rider comms are always `transactional`.
- **Admin-only** feature (`RequireAdmin`); not visible to the `support` role.
- Tables are **RLS-locked** (service-role access via `app-rpc`), matching the support
  tables. `id` columns get a DB default `(gen_random_uuid())::text` (learned from the
  support-inbox null-id bug — raw Supabase-client inserts don't run Prisma's cuid()).

## Data model (Prisma + SQL migration)

### `Broadcast`
| column | type | notes |
|---|---|---|
| `id` | text pk, default `(gen_random_uuid())::text` | |
| `title` | text | internal label |
| `category` | text | `marketing` \| `transactional` |
| `channels` | jsonb | e.g. `["email","push"]` |
| `segment` | jsonb | audience spec (below) |
| `emailSubject` | text null | required if email channel |
| `emailBody` | text null | HTML/markdown body |
| `pushTitle` | text null | required if push channel |
| `pushBody` | text null | |
| `status` | text | `draft` \| `scheduled` \| `sending` \| `sent` \| `failed` \| `canceled`, default `draft` |
| `scheduledAt` | timestamptz null | when the runner should send |
| `recipientCount` | int | resolved at send time |
| `sentEmail` / `failedEmail` | int default 0 | |
| `sentPush` / `failedPush` | int default 0 | |
| `createdByUid` | text | admin who created it |
| `createdAt` / `updatedAt` / `sentAt` | timestamptz | |

### `EmailSuppression`
| column | type | notes |
|---|---|---|
| `id` | text pk, default `(gen_random_uuid())::text` | |
| `email` | text unique | lowercased |
| `reason` | text | `unsubscribe` \| `bounce` \| `complaint` |
| `createdAt` | timestamptz default now() | |

## Segment model

`segment` jsonb, resolved by `resolveBroadcastAudience(segment)` →
`Array<{ uid, email, expoPushToken }>`:

```jsonc
{
  "roles": ["customer"],            // union across listed roles (UserRole)
  "activity": { "orderedWithinDays": 30 } | { "notOrderedForDays": 60 } | null,
  "restaurantId": "abc" | null      // distinct customers who ordered from it
}
```

- Resolution semantics: **AND** across the provided dimensions; **union** across roles.
- `activity` and `restaurantId` apply to customers (derived from `CustomerOrder`); if the
  segment also includes non-customer roles, those roles are unioned in without the
  customer-only filters.
- Dedupe by `uid`. For `category = 'marketing'`, drop rows whose lowercased email is in
  `EmailSuppression`.
- **Preview** = run the resolver, return `recipientCount` only (no send).

## Sending pipeline

1. Admin creates/updates a `Broadcast` (draft) via `app-rpc`.
2. **Send now** sets `status='scheduled'`, `scheduledAt=now()`. **Schedule** sets a future
   `scheduledAt`. **Cancel** (only while `scheduled`) sets `status='canceled'`.
3. A new **`broadcast-runner`** edge function, invoked by `pg_cron` every minute (mirrors
   `queue-drainer` + `20260624_queue_drainer_schedule.sql`):
   - Claims due broadcasts: `update Broadcast set status='sending' where status='scheduled'
     and scheduledAt <= now() returning *` (atomic claim → no double-send).
   - Resolves the audience; writes `recipientCount`.
   - Sends in **batches of 100**: email via Resend batch endpoint
     (`POST /emails/batch`), push via existing `sendExpoPushMessages`.
   - Marketing email: append an unsubscribe footer with a signed link; already-suppressed
     recipients were removed during resolution.
   - Accumulates `sentEmail`/`failedEmail`/`sentPush`/`failedPush`; per-recipient/batch
     failures are caught and counted, never abort the run.
   - Sets `status='sent'`, `sentAt=now()` (or `failed` on wholesale failure).

## Unsubscribe

- New public edge function **`unsubscribe`** (`verify_jwt:false`, like `public-catalog`).
- Marketing emails include `…/unsubscribe?e=<email>&t=<hmac>` where `t = HMAC_SHA256(email,
  BROADCAST_UNSUB_SECRET)` (new secret). The function verifies the HMAC, upserts
  `EmailSuppression(email, reason='unsubscribe')`, and returns a small HTML confirmation.
- Suppression is checked only for `category='marketing'` sends.

## Admin UI — new `/broadcasts` route (admin-only)

- Nav item "Broadcasts" (added to `ADMIN_NAV`, not `SUPPORT_NAV`).
- **List:** broadcasts with status badge, channels, `recipientCount`, sent/failed counts,
  `scheduledAt`; newest first (live via realtime broadcast or on-demand refresh).
- **Composer:** title; category (marketing/transactional); channel toggles (email/push);
  segment builder (role checkboxes, activity dropdown, restaurant picker); email
  subject+body; push title+body; **Preview recipients** (count); **Send now** / **Schedule**
  (datetime); **Cancel** for a scheduled one.
- Reuses existing card/badge/form styles and `StatusBadge`, `EmptyState`, `ErrorBanner`,
  `LoadingBlock`.

## `app-rpc` actions (admin-only, `ensureRole(context.role, ['admin'])`)

- `broadcastList` → `{ broadcasts }`.
- `broadcastPreviewAudience` `{ segment, category }` → `{ recipientCount }`.
- `broadcastCreate` `{ ...fields }` → `{ broadcast }` (status `draft`).
- `broadcastSchedule` `{ id, scheduledAt? }` → `{ broadcast }` (send-now if `scheduledAt`
  omitted; sets `scheduled`).
- `broadcastCancel` `{ id }` → `{ broadcast }` (only while `scheduled`).
- `broadcastGet` `{ id }` → `{ broadcast }`.

Shared helper `resolveBroadcastAudience(segment, category)` used by preview and runner.

## Error handling

- Validation via `fail(400, …)`: email channel requires subject+body; push requires
  title+body; at least one channel; marketing requires customer roles.
- Runner: batch try/catch → counts; wholesale failure → `status='failed'` (re-runnable by
  resetting to `scheduled`).
- Empty audience → broadcast completes `sent` with `recipientCount=0` (no-op, logged).
- Unsubscribe: invalid/tampered token → generic "link invalid" page, no suppression write.

## Testing

- **Audience resolver:** role union, activity filters, restaurant filter, AND-semantics,
  dedupe, suppression removal for marketing.
- **Unsubscribe:** valid token suppresses; tampered token rejected.
- **Runner:** atomic claim prevents double-send; partial-failure counting.
- **E2E:** create a small marketing broadcast to a test segment → email+push delivered →
  click unsubscribe → confirm suppressed on the next marketing send. A transactional send
  to partners/riders ignores suppression.

## Deploy notes (carried from support inbox)

- Migrations via Supabase MCP `apply_migration` (agent-capable).
- Edge deploys (`app-rpc`, new `broadcast-runner`, `unsubscribe`) need
  `supabase functions deploy … --no-verify-jwt` — the auto-mode classifier blocks the
  agent from running this; **the user runs the edge deploys**. `broadcast-runner` and
  `unsubscribe` are new functions (runner is cron-invoked/service-role; unsubscribe is
  public) — deploy both with `--no-verify-jwt`.
- New secret `BROADCAST_UNSUB_SECRET` must be set on the project (`supabase secrets set`).
- `pg_cron` schedule for `broadcast-runner` added as a SQL migration.
