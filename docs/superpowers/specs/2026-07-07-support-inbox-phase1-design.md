# Design: Customer Support Inbox — Phase 1

**Date:** 2026-07-07
**Status:** Approved (design), pending implementation plan
**Idea book:** see `docs/idea-book.md` → "Customer service messaging system"

## Summary

A two-way customer support system. Customers send messages from a Support screen
in the FEASTY app; messages arrive in a new **Support Inbox** in the admin panel in
real time. A dedicated **support role** handles replies; each reply fans out to the
customer over three channels — in-app (Realtime), email (Resend), and push (Expo).

This is **Phase 1 of 4**. Phases 2 (inbound email capture), 3 (bulk / broadcast
messaging), and 4 (WhatsApp / social) are captured in the idea book and are out of
scope here, but the data model is shaped so they plug into the same tables.

## Goals

- Customers can message support from inside the app and get replies without leaving it.
- Admin/support can see, manage, and reply to conversations from the admin panel.
- Replies reach the customer via in-app + email + push, and no reply is silently lost.
- A dedicated support role sees **only** the inbox, not the rest of the admin panel.

## Non-goals (Phase 1)

Inbound email replies, WhatsApp/social, bulk/broadcast messaging, attachments/images,
canned responses, CSAT ratings, SLA timers. All deferred to later phases.

## Key decisions

- **One running thread per customer.** A customer has at most one conversation. Their
  first message creates it; later messages append to the same thread. Closing a thread
  and messaging again reopens the same conversation (status → `open`) rather than
  creating a second one.
- **Status set:** `open`, `pending` (waiting on customer), `closed`. No others in P1.
- **Dedicated `support` role**, separate from `admin`.

## Architecture / data flow

```
Customer app (Expo)                Admin panel (Vercel SPA)
  Support screen                     Support Inbox (/inbox)
      | insert message                     ^  live list + thread
      v                                     |  (Realtime)
  ┌─────────────────── Supabase ───────────────────────────┐
  │ support_conversations / support_messages (RLS)          │
  │ Realtime Broadcast  ── pushes new msgs to both sides    │
  │ Edge fn: support_send_agent_reply                       │
  │    ├─ insert agent message                              │
  │    ├─ Resend email  → customer                          │
  │    └─ Expo push     → customer devices                  │
  └─────────────────────────────────────────────────────────┘
```

- **Customer → admin:** customer inserts a message (via RPC or direct insert under RLS);
  Realtime notifies the admin inbox. First-ever message upserts the conversation.
- **Admin → customer:** agent calls Edge Function `support_send_agent_reply`, which
  inserts the agent message and fans out to Resend (email) and Expo (push). Realtime
  delivers the in-app copy. Per-channel result is written back to the message row.

Reuse the existing Realtime + Resend edge-function stack from the 2026-07-03 rollout
(`scripts/deploy-realtime-email-functions.ps1`).

## Data model (Supabase Postgres)

### `support_conversations`
| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `customer_id` | uuid | FK → profiles/auth user; **unique** (one thread per customer) |
| `subject` | text null | optional; derived from first message if absent |
| `status` | text | `open` \| `pending` \| `closed`, default `open` |
| `assigned_to` | uuid null | support/admin user who owns it |
| `channel` | text | default `in_app` (future-proofs P2/P4) |
| `last_message_at` | timestamptz | for inbox sorting |
| `created_at` / `updated_at` | timestamptz | |

### `support_messages`
| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `conversation_id` | uuid | FK → support_conversations |
| `sender_type` | text | `customer` \| `agent` \| `system` |
| `sender_id` | uuid null | agent user id, or customer id |
| `body` | text | text-only in P1 |
| `email_sent` | bool | default false; set by fan-out |
| `push_sent` | bool | default false; set by fan-out |
| `created_at` | timestamptz | |

### RLS
- **Customer:** `select`/`insert` messages only where the conversation's
  `customer_id = auth.uid()`; may create their own conversation.
- **Support + admin:** `select`/`update` all conversations; `insert` agent messages
  (in practice via the edge function, service-role).
- Enforce `customer_id = auth.uid()` on customer inserts; agents cannot impersonate a
  customer `sender_type`.

## Dedicated support role

- Add `'support'` to `APP_ROLES` in `packages/domain/src/roles.ts`:
  `['customer','restaurant','dispatch','admin','support']`.
- New route guard `RequireRole(roles: AppRole[])` in `apps/admin-web`; the inbox route
  uses `['admin','support']`, all existing routes stay `RequireAdmin` (`['admin']`).
- `AppLayout` nav renders only the Inbox item when `role === 'support'`; admins see the
  full nav plus Inbox.
- `LoginPage` currently rejects any non-`admin`; update so `support` is also allowed in,
  landing on `/inbox`.
- Support accounts are provisioned by the super user with
  `app_metadata.user_role = 'support'` (same mechanism as admin provisioning).
- These agents still pass whatever outer perimeter the admin-privacy track selects.

## Customer app (Expo) — Support screen

- New "Help / Support" screen: the customer's single thread (message history), a text
  composer, live agent replies via Realtime.
- Push registration already exists; ensure device tokens are queryable for fan-out.
- Entry points: profile/settings menu, and optionally a "Get help with this order"
  action that prefixes the thread with order context (as a `system` message).

## Admin inbox — new `/inbox` route

- Nav item "Inbox" (unread badge).
- **Left:** conversation list — filter by status (open/pending/closed) and
  assignment (mine / unassigned / all), sorted by `last_message_at`, unread indicators,
  updates live via Realtime.
- **Right:** selected thread — message history, composer, actions: **assign to me /
  reassign, set status (open/pending/closed), close**.
- Reuse existing components: card styles, `StatusBadge`, `EmptyState`, `LoadingBlock`,
  `ErrorBanner`.

## Error handling

- Fan-out is best-effort per channel: the agent reply always persists and shows in-app
  even if email or push fails. Failed channels are recorded (`email_sent=false`) and
  surfaced to the agent ("email failed to send") with a retry.
- Optimistic send in both apps with rollback on insert error.
- Offline customers receive queued messages on reconnect via Realtime + DB read.
- Edge function validates the caller is `admin`/`support` before sending.

## Testing

- **RLS:** customer cannot read/write another customer's conversation; support/admin can.
- **Edge function:** `support_send_agent_reply` unit tests with mocked Resend + Expo,
  including partial-failure (email fails, push ok) writing correct flags.
- **E2E:** customer sends → appears in admin inbox via Realtime → agent replies → customer
  receives it in-app + email + push; status transitions open→pending→closed.

## Open items to resolve during planning

- Exact Realtime mechanism per surface (postgres_changes vs Broadcast) — match the
  existing orders implementation.
- Whether customer message insert goes direct-under-RLS or through an RPC (prefer RPC for
  a consistent conversation-upsert + `last_message_at` bump).
- Email template for support replies (reuse Resend templates from the rollout).
