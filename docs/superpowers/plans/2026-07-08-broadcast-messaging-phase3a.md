# Broadcast Messaging — Phase 3a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins compose, preview, and send/schedule segmented broadcasts over email (Resend) + push (Expo), with NDPR-compliant unsubscribe/suppression for customer marketing sends.

**Architecture:** Two new RLS-locked Prisma tables (`Broadcast`, `EmailSuppression`) accessed only through the `app-rpc` router (service-role). Admin composes in a new `/broadcasts` page. Send-now/scheduled broadcasts are claimed and sent by a new cron-invoked `broadcast-runner` edge function (mirrors `queue-drainer`) in batches of 100. A public `unsubscribe` edge function handles opt-outs via HMAC-signed links.

**Tech Stack:** Supabase (Postgres + Prisma + Edge Functions/Deno + pg_cron + pg_net + Vault), Resend batch email, Expo push, React 19 + Vite + react-router-dom 7 (admin panel).

## Global Constraints

- **No unit-test harness in this repo.** Do NOT add vitest/jest/Deno test. "Verify" = type-check (`deno check` where Deno is available, `tsc --noEmit` for admin-web), deploy, and exercise. Deno is NOT installed locally; edge TS is validated at `supabase functions deploy` bundling time.
- **All DB access via `app-rpc`/edge functions using `serviceClient`.** New tables get RLS enabled with **no** anon/authenticated policies (service role bypasses RLS).
- **`id` columns MUST have DB default `(gen_random_uuid())::text`** — raw Supabase-client inserts don't run Prisma's `@default(cuid())` (this caused the support-inbox null-id bug).
- **Router handler style:** `if (action === 'x') { ensureRole(context.role, ['admin']); …; return json(200, { data }); }`; `fail(status, msg)` for validation, `throw new Error(msg)` for DB errors. Helpers already in `app-rpc/index.ts`: `sanitizeText`, `fail`, `json`, `ensureRole`, `serviceClient`, `context`.
- **Category semantics:** `marketing` = customers only, unsubscribe + suppression; `transactional` = anyone incl. partners/riders, no unsubscribe/suppression.
- **Send-now = schedule at `now()`**, processed by the cron runner (≤60s). No inline send path.
- **Reuse shared helpers:** `sendExpoPushMessages` / `sendPushNotificationsToUsers` (`_shared/notifications.ts`), Resend key via `RESEND_API_KEY` + `TRANSACTIONAL_EMAIL_FROM` (`_shared/email.ts`), worker-token auth pattern from `queue-drainer` (`QUEUE_WORKER_TOKEN`, header `x-queue-worker-token`).
- **Edge deploys need `--no-verify-jwt`** and are run by the USER (auto-mode classifier blocks the agent). New functions: `broadcast-runner`, `unsubscribe`. Migrations via Supabase MCP `apply_migration` (agent-capable).
- **New secrets:** `BROADCAST_UNSUB_SECRET` (HMAC). Runner reuses `QUEUE_WORKER_TOKEN`.
- **Branch:** `feature/broadcast-messaging-phase3a` (checked out). Commit after each task.

---

## File Structure

**Create**
- `supabase/migrations/20260708_broadcast_messaging.sql` — tables + indexes + RLS + id defaults.
- `supabase/migrations/20260708_broadcast_runner_schedule.sql` — pg_cron schedule for the runner.
- `supabase/functions/_shared/broadcast.ts` — shared types + `resolveBroadcastAudience()` + email/segment helpers, imported by both `app-rpc` and `broadcast-runner`.
- `supabase/functions/broadcast-runner/index.ts` — cron-invoked sender.
- `supabase/functions/unsubscribe/index.ts` — public opt-out endpoint.
- `apps/admin-web/src/pages/BroadcastsPage.tsx` — list + composer.
- `apps/admin-web/src/services/broadcasts.ts` — admin RPC calls + types.

**Modify**
- `functions/prisma/schema.prisma` — add `Broadcast` + `EmailSuppression` models.
- `supabase/functions/app-rpc/index.ts` — add 6 broadcast actions + imports from `_shared/broadcast.ts`.
- `apps/admin-web/src/App.tsx` — add lazy `/broadcasts` route (admin-only).
- `apps/admin-web/src/components/AppLayout.tsx` — add "Broadcasts" to `ADMIN_NAV`.
- `apps/admin-web/src/styles/global.css` — composer/list styles.

---

## Task 1: Database — tables, RLS, id defaults

Delivers: `Broadcast` + `EmailSuppression` exist with RLS and gen_random_uuid id defaults; Prisma schema in sync.

**Files:**
- Modify: `functions/prisma/schema.prisma`
- Create: `supabase/migrations/20260708_broadcast_messaging.sql`

**Interfaces produced:** tables `public."Broadcast"`, `public."EmailSuppression"`.

- [ ] **Step 1: Add Prisma models.** Append to `functions/prisma/schema.prisma`:

```prisma
model Broadcast {
  id             String   @id @default(cuid())
  title          String
  category       String   // marketing | transactional
  channels       Json     // ["email","push"]
  segment        Json
  emailSubject   String?
  emailBody      String?
  pushTitle      String?
  pushBody       String?
  status         String   @default("draft") // draft|scheduled|sending|sent|failed|canceled
  scheduledAt    DateTime?
  recipientCount Int      @default(0)
  sentEmail      Int      @default(0)
  failedEmail    Int      @default(0)
  sentPush       Int      @default(0)
  failedPush     Int      @default(0)
  createdByUid   String
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  sentAt         DateTime?

  @@index([status])
  @@index([scheduledAt])
  @@index([createdAt])
}

model EmailSuppression {
  id        String   @id @default(cuid())
  email     String   @unique
  reason    String   // unsubscribe | bounce | complaint
  createdAt DateTime @default(now())

  @@index([reason])
}
```

- [ ] **Step 2: Validate schema.** Run: `npm run db:validate` — expect "The schema … is valid".

- [ ] **Step 3: Write the SQL migration.** Create `supabase/migrations/20260708_broadcast_messaging.sql`:

```sql
-- Broadcast messaging (Phase 3a): broadcasts + email suppression
create table if not exists public."Broadcast" (
  "id"             text primary key default (gen_random_uuid())::text,
  "title"          text not null,
  "category"       text not null,
  "channels"       jsonb not null default '[]'::jsonb,
  "segment"        jsonb not null default '{}'::jsonb,
  "emailSubject"   text,
  "emailBody"      text,
  "pushTitle"      text,
  "pushBody"       text,
  "status"         text not null default 'draft',
  "scheduledAt"    timestamptz,
  "recipientCount" integer not null default 0,
  "sentEmail"      integer not null default 0,
  "failedEmail"    integer not null default 0,
  "sentPush"       integer not null default 0,
  "failedPush"     integer not null default 0,
  "createdByUid"   text not null,
  "createdAt"      timestamptz not null default now(),
  "updatedAt"      timestamptz not null default now(),
  "sentAt"         timestamptz
);

create table if not exists public."EmailSuppression" (
  "id"        text primary key default (gen_random_uuid())::text,
  "email"     text not null unique,
  "reason"    text not null,
  "createdAt" timestamptz not null default now()
);

create index if not exists "Broadcast_status_idx" on public."Broadcast" ("status");
create index if not exists "Broadcast_scheduledAt_idx" on public."Broadcast" ("scheduledAt");
create index if not exists "Broadcast_createdAt_idx" on public."Broadcast" ("createdAt");
create index if not exists "EmailSuppression_reason_idx" on public."EmailSuppression" ("reason");

alter table public."Broadcast" enable row level security;
alter table public."EmailSuppression" enable row level security;
```

- [ ] **Step 4: Apply via Supabase MCP** `apply_migration` (name `broadcast_messaging`) with the SQL above. Then confirm with MCP `list_tables` that both tables exist with `rls_enabled: true` and (via `execute_sql`) that `Broadcast.id` / `EmailSuppression.id` `column_default` = `(gen_random_uuid())::text`.

- [ ] **Step 5: Regenerate Prisma client.** Run: `npm run db:generate` — expect "Generated Prisma Client".

- [ ] **Step 6: Commit.**

```
git add functions/prisma/schema.prisma supabase/migrations/20260708_broadcast_messaging.sql
git commit -m "feat(broadcast): add Broadcast + EmailSuppression tables with RLS"
```

---

## Task 2: Shared audience + email helpers (`_shared/broadcast.ts`)

Delivers: the audience resolver, HMAC token helpers, and marketing email HTML builder, reusable by `app-rpc` and `broadcast-runner`.

**Files:**
- Create: `supabase/functions/_shared/broadcast.ts`

**Interfaces produced:**
- `type BroadcastSegment = { roles?: string[]; activity?: { orderedWithinDays?: number; notOrderedForDays?: number } | null; restaurantId?: string | null }`
- `type BroadcastRecipient = { uid: string; email: string | null; expoPushToken: string | null }`
- `resolveBroadcastAudience(segment: BroadcastSegment, category: string): Promise<BroadcastRecipient[]>`
- `signUnsubscribe(email: string): Promise<string>` / `verifyUnsubscribe(email: string, token: string): Promise<boolean>`
- `unsubscribeUrl(email: string): Promise<string>`
- `buildBroadcastEmailHtml(input: { body: string; includeUnsubscribe: boolean; unsubUrl?: string }): string`

- [ ] **Step 1: Write the module.** Create `supabase/functions/_shared/broadcast.ts`:

```ts
/// <reference path="./edge-runtime.d.ts" />
import { serviceClient } from './client.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const UNSUB_SECRET = Deno.env.get('BROADCAST_UNSUB_SECRET') ?? '';

export type BroadcastSegment = {
  roles?: string[];
  activity?: { orderedWithinDays?: number; notOrderedForDays?: number } | null;
  restaurantId?: string | null;
};

export type BroadcastRecipient = { uid: string; email: string | null; expoPushToken: string | null };

const uniq = (values: string[]) => Array.from(new Set(values.filter(Boolean)));

// Customer uids matching the activity/restaurant filters (customers only).
const resolveCustomerUids = async (segment: BroadcastSegment): Promise<string[]> => {
  const activity = segment.activity ?? null;
  const restaurantId = segment.restaurantId ?? null;
  if (!activity && !restaurantId) {
    // All customers by role handled by caller; nothing customer-specific to filter.
    return [];
  }

  let query = serviceClient.from('CustomerOrder').select('customerId,createdAt,restaurantId');
  if (restaurantId) query = query.eq('restaurantId', restaurantId);
  const { data, error } = await query.returns<Array<{ customerId: string; createdAt: string; restaurantId: string }>>();
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const lastOrderByCustomer = new Map<string, number>();
  for (const row of rows) {
    const ts = new Date(row.createdAt).getTime();
    const prev = lastOrderByCustomer.get(row.customerId) ?? 0;
    if (ts > prev) lastOrderByCustomer.set(row.customerId, ts);
  }

  let uids = Array.from(lastOrderByCustomer.keys());
  if (activity?.orderedWithinDays) {
    const cutoff = Date.now() - activity.orderedWithinDays * 86_400_000;
    uids = uids.filter((uid) => (lastOrderByCustomer.get(uid) ?? 0) >= cutoff);
  } else if (activity?.notOrderedForDays) {
    const cutoff = Date.now() - activity.notOrderedForDays * 86_400_000;
    uids = uids.filter((uid) => (lastOrderByCustomer.get(uid) ?? 0) < cutoff);
  }
  return uniq(uids);
};

const uidsByRoles = async (roles: string[]): Promise<string[]> => {
  const wanted = uniq(roles);
  if (wanted.length === 0) return [];
  const { data, error } = await serviceClient.from('UserRole').select('userId,role').in('role', wanted);
  if (error) throw new Error(error.message);
  return uniq(((data ?? []) as Array<{ userId: string }>).map((r) => r.userId));
};

export const resolveBroadcastAudience = async (
  segment: BroadcastSegment,
  category: string
): Promise<BroadcastRecipient[]> => {
  const roles = segment.roles ?? [];
  const hasCustomerFilter = Boolean(segment.activity || segment.restaurantId);
  const wantsCustomers = roles.includes('customer');

  // Collect candidate uids.
  let uids: string[] = [];
  const nonCustomerRoles = roles.filter((r) => r !== 'customer');
  if (nonCustomerRoles.length > 0) uids = uids.concat(await uidsByRoles(nonCustomerRoles));

  if (wantsCustomers) {
    if (hasCustomerFilter) {
      uids = uids.concat(await resolveCustomerUids(segment));
    } else {
      uids = uids.concat(await uidsByRoles(['customer']));
    }
  } else if (hasCustomerFilter && roles.length === 0) {
    // Segment specified only customer filters, no explicit roles -> treat as customers.
    uids = uids.concat(await resolveCustomerUids(segment));
  }

  uids = uniq(uids);
  if (uids.length === 0) return [];

  const { data: accounts, error } = await serviceClient
    .from('UserAccount')
    .select('uid,email,expoPushToken,accountDisabled')
    .in('uid', uids)
    .returns<Array<{ uid: string; email: string | null; expoPushToken: string | null; accountDisabled: boolean | null }>>();
  if (error) throw new Error(error.message);

  let recipients: BroadcastRecipient[] = (accounts ?? [])
    .filter((a) => !a.accountDisabled)
    .map((a) => ({ uid: a.uid, email: a.email, expoPushToken: a.expoPushToken }));

  if (category === 'marketing') {
    const emails = uniq(recipients.map((r) => (r.email ?? '').toLowerCase()));
    if (emails.length > 0) {
      const { data: suppressed, error: supErr } = await serviceClient
        .from('EmailSuppression')
        .select('email')
        .in('email', emails)
        .returns<Array<{ email: string }>>();
      if (supErr) throw new Error(supErr.message);
      const blocked = new Set((suppressed ?? []).map((s) => s.email.toLowerCase()));
      recipients = recipients.filter((r) => !blocked.has((r.email ?? '').toLowerCase()));
    }
  }
  return recipients;
};

const hmacHex = async (message: string, secret: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
};

export const signUnsubscribe = (email: string) => hmacHex(email.toLowerCase(), UNSUB_SECRET);

export const verifyUnsubscribe = async (email: string, token: string): Promise<boolean> => {
  if (!UNSUB_SECRET || !token) return false;
  const expected = await signUnsubscribe(email);
  // constant-time-ish compare
  if (expected.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
};

export const unsubscribeUrl = async (email: string): Promise<string> => {
  const token = await signUnsubscribe(email);
  const base = SUPABASE_URL.replace(/\/$/, '');
  return `${base}/functions/v1/unsubscribe?e=${encodeURIComponent(email)}&t=${token}`;
};

const escapeHtml = (v: string) =>
  v.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export const buildBroadcastEmailHtml = (input: {
  body: string;
  includeUnsubscribe: boolean;
  unsubUrl?: string;
}): string => {
  const footer = input.includeUnsubscribe && input.unsubUrl
    ? `<p style="margin:24px 0 0;color:#94a3b8;font-size:12px;">FEASTY • <a href="${input.unsubUrl}" style="color:#94a3b8;">Unsubscribe</a> from marketing emails.</p>`
    : '<p style="margin:24px 0 0;color:#94a3b8;font-size:12px;">FEASTY</p>';
  return [
    '<div style="max-width:560px;margin:0 auto;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#334155;font-size:15px;line-height:1.6;">',
    input.body, // admin-authored HTML; treated as trusted (admin-only feature)
    footer,
    '</div>',
  ].join('');
};
```

Note on `escapeHtml`: exported for potential reuse; the email body itself is admin-authored and intentionally rendered as HTML (admin-only feature, trusted input).

- [ ] **Step 2: Type-check note.** Deno isn't local; this file is validated when `app-rpc`/`broadcast-runner` are bundled at deploy. Re-read the module and confirm: no imports beyond `client.ts`, all exported names match the Interfaces block.

- [ ] **Step 3: Commit.**

```
git add supabase/functions/_shared/broadcast.ts
git commit -m "feat(broadcast): shared audience resolver, unsubscribe HMAC, email builder"
```

---

## Task 3: `app-rpc` broadcast actions

Delivers: 6 admin actions for the composer/list, type-checked at deploy.

**Files:**
- Modify: `supabase/functions/app-rpc/index.ts`

**Interfaces consumed:** `resolveBroadcastAudience`, `BroadcastSegment` from `_shared/broadcast.ts`.
**Interfaces produced (action → payload → `{ data }`):**
- `broadcastList` `{}` → `{ broadcasts: BroadcastRow[] }`
- `broadcastGet` `{ id }` → `{ broadcast }`
- `broadcastPreviewAudience` `{ segment, category }` → `{ recipientCount }`
- `broadcastCreate` `{ title, category, channels, segment, emailSubject?, emailBody?, pushTitle?, pushBody? }` → `{ broadcast }`
- `broadcastSchedule` `{ id, scheduledAt? }` → `{ broadcast }` (omitted `scheduledAt` = send now)
- `broadcastCancel` `{ id }` → `{ broadcast }`

- [ ] **Step 1: Add import + type.** At the top of `app-rpc/index.ts`, add:

```ts
import { resolveBroadcastAudience, type BroadcastSegment } from '../_shared/broadcast.ts';
```
And near the other `...Row` types:

```ts
type BroadcastRow = {
  id: string; title: string; category: string; channels: string[]; segment: BroadcastSegment;
  emailSubject: string | null; emailBody: string | null; pushTitle: string | null; pushBody: string | null;
  status: string; scheduledAt: string | null; recipientCount: number;
  sentEmail: number; failedEmail: number; sentPush: number; failedPush: number;
  createdByUid: string; createdAt: string; updatedAt: string; sentAt: string | null;
};
const BROADCAST_CATEGORIES = ['marketing', 'transactional'] as const;
const isBroadcastCategory = (v: unknown): v is (typeof BROADCAST_CATEGORIES)[number] =>
  typeof v === 'string' && (BROADCAST_CATEGORIES as readonly string[]).includes(v);
```

- [ ] **Step 2: Add a validation helper** (module scope, near other helpers):

```ts
const validateBroadcastComposition = (input: {
  category: unknown; channels: unknown; segment: unknown;
  emailSubject: unknown; emailBody: unknown; pushTitle: unknown; pushBody: unknown;
}) => {
  if (!isBroadcastCategory(input.category)) fail(400, 'A valid category is required.');
  const channels = Array.isArray(input.channels) ? input.channels.filter((c) => c === 'email' || c === 'push') : [];
  if (channels.length === 0) fail(400, 'At least one channel (email or push) is required.');
  if (channels.includes('email') && (!sanitizeText(input.emailSubject) || !sanitizeText(input.emailBody))) {
    fail(400, 'Email subject and body are required for the email channel.');
  }
  if (channels.includes('push') && (!sanitizeText(input.pushTitle) || !sanitizeText(input.pushBody))) {
    fail(400, 'Push title and body are required for the push channel.');
  }
  const segment = (input.segment && typeof input.segment === 'object' ? input.segment : {}) as BroadcastSegment;
  if (input.category === 'marketing' && !(segment.roles ?? []).includes('customer') && !segment.activity && !segment.restaurantId) {
    fail(400, 'Marketing broadcasts must target customers.');
  }
  return { channels, segment };
};
```

- [ ] **Step 3: Add the 6 handler blocks** before `return null;` in `handleNativeAction`:

```ts
if (action === 'broadcastList') {
  ensureRole(context.role, ['admin']);
  const { data, error } = await serviceClient
    .from('Broadcast').select('*').order('createdAt', { ascending: false }).returns<BroadcastRow[]>();
  if (error) throw new Error(error.message);
  return json(200, { data: { broadcasts: data ?? [] } });
}

if (action === 'broadcastGet') {
  ensureRole(context.role, ['admin']);
  const id = sanitizeText(data.id);
  if (!id) fail(400, 'A broadcast id is required.');
  const { data: broadcast, error } = await serviceClient
    .from('Broadcast').select('*').eq('id', id).maybeSingle<BroadcastRow>();
  if (error) throw new Error(error.message);
  if (!broadcast) fail(404, 'Broadcast not found.');
  return json(200, { data: { broadcast } });
}

if (action === 'broadcastPreviewAudience') {
  ensureRole(context.role, ['admin']);
  const category = sanitizeText(data.category) || 'transactional';
  const segment = (data.segment && typeof data.segment === 'object' ? data.segment : {}) as BroadcastSegment;
  const recipients = await resolveBroadcastAudience(segment, category);
  return json(200, { data: { recipientCount: recipients.length } });
}

if (action === 'broadcastCreate') {
  ensureRole(context.role, ['admin']);
  const title = sanitizeText(data.title);
  if (!title) fail(400, 'A title is required.');
  const { channels, segment } = validateBroadcastComposition({
    category: data.category, channels: data.channels, segment: data.segment,
    emailSubject: data.emailSubject, emailBody: data.emailBody, pushTitle: data.pushTitle, pushBody: data.pushBody,
  });
  const { data: broadcast, error } = await serviceClient.from('Broadcast').insert({
    title, category: data.category, channels, segment,
    emailSubject: sanitizeText(data.emailSubject) || null,
    emailBody: sanitizeText(data.emailBody) || null,
    pushTitle: sanitizeText(data.pushTitle) || null,
    pushBody: sanitizeText(data.pushBody) || null,
    status: 'draft', createdByUid: context.uid,
  }).select('*').single<BroadcastRow>();
  if (error || !broadcast) throw new Error(error?.message ?? 'Failed to create the broadcast.');
  return json(200, { data: { broadcast } });
}

if (action === 'broadcastSchedule') {
  ensureRole(context.role, ['admin']);
  const id = sanitizeText(data.id);
  if (!id) fail(400, 'A broadcast id is required.');
  const scheduledAtRaw = sanitizeText(data.scheduledAt);
  const scheduledAt = scheduledAtRaw ? new Date(scheduledAtRaw).toISOString() : new Date().toISOString();
  const { data: broadcast, error } = await serviceClient
    .from('Broadcast')
    .update({ status: 'scheduled', scheduledAt, updatedAt: new Date().toISOString() })
    .eq('id', id).in('status', ['draft', 'scheduled', 'canceled'])
    .select('*').single<BroadcastRow>();
  if (error || !broadcast) throw new Error(error?.message ?? 'Failed to schedule the broadcast.');
  return json(200, { data: { broadcast } });
}

if (action === 'broadcastCancel') {
  ensureRole(context.role, ['admin']);
  const id = sanitizeText(data.id);
  if (!id) fail(400, 'A broadcast id is required.');
  const { data: broadcast, error } = await serviceClient
    .from('Broadcast')
    .update({ status: 'canceled', updatedAt: new Date().toISOString() })
    .eq('id', id).eq('status', 'scheduled')
    .select('*').single<BroadcastRow>();
  if (error || !broadcast) throw new Error(error?.message ?? 'Only a scheduled broadcast can be canceled.');
  return json(200, { data: { broadcast } });
}
```

- [ ] **Step 4: Deploy note (USER).** After Task 5, the user redeploys `app-rpc`:
`npx supabase functions deploy app-rpc --project-ref rgfbheorvtolixdcpjhy --no-verify-jwt`. This bundles + type-checks `_shared/broadcast.ts` too.

- [ ] **Step 5: Commit.**

```
git add supabase/functions/app-rpc/index.ts
git commit -m "feat(broadcast): app-rpc actions for list/preview/create/schedule/cancel"
```

---

## Task 4: `broadcast-runner` edge function + cron

Delivers: the cron-invoked sender that claims due broadcasts and sends email+push in batches.

**Files:**
- Create: `supabase/functions/broadcast-runner/index.ts`
- Create: `supabase/migrations/20260708_broadcast_runner_schedule.sql`

**Interfaces consumed:** `resolveBroadcastAudience`, `unsubscribeUrl`, `buildBroadcastEmailHtml` from `_shared/broadcast.ts`; `sendExpoPushMessages` from `_shared/notifications.ts`.

- [ ] **Step 1: Write the runner.** Create `supabase/functions/broadcast-runner/index.ts`:

```ts
/// <reference path="../_shared/edge-runtime.d.ts" />
import { corsHeaders } from '../_shared/cors.ts';
import { serviceClient } from '../_shared/client.ts';
import { resolveBroadcastAudience, unsubscribeUrl, buildBroadcastEmailHtml, type BroadcastSegment } from '../_shared/broadcast.ts';
import { sendExpoPushMessages } from '../_shared/notifications.ts';

const WORKER_TOKEN = Deno.env.get('QUEUE_WORKER_TOKEN')?.trim() ?? '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const EMAIL_FROM = Deno.env.get('TRANSACTIONAL_EMAIL_FROM') ?? 'FEASTY <onboarding@resend.dev>';
const RESEND_BATCH = 'https://api.resend.com/emails/batch';
const BATCH = 100;

const chunk = <T>(a: T[], n: number) => {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
};

type BroadcastRow = {
  id: string; category: string; channels: string[]; segment: BroadcastSegment;
  emailSubject: string | null; emailBody: string | null; pushTitle: string | null; pushBody: string | null;
};

const sendEmailBatch = async (
  messages: Array<{ from: string; to: string[]; subject: string; html: string }>
): Promise<number> => {
  if (!RESEND_API_KEY || messages.length === 0) return 0;
  const res = await fetch(RESEND_BATCH, {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(messages),
  });
  if (!res.ok) {
    console.error('Broadcast email batch failed', res.status, await res.text());
    return 0;
  }
  return messages.length;
};

const processBroadcast = async (b: BroadcastRow) => {
  const recipients = await resolveBroadcastAudience(b.segment, b.category);
  let sentEmail = 0, failedEmail = 0, sentPush = 0, failedPush = 0;

  await serviceClient.from('Broadcast').update({ recipientCount: recipients.length }).eq('id', b.id);

  if (b.channels.includes('email') && b.emailSubject && b.emailBody) {
    const withEmail = recipients.filter((r) => r.email);
    for (const group of chunk(withEmail, BATCH)) {
      const messages = await Promise.all(group.map(async (r) => {
        const includeUnsub = b.category === 'marketing';
        const unsubUrl = includeUnsub ? await unsubscribeUrl(r.email as string) : undefined;
        return {
          from: EMAIL_FROM, to: [r.email as string], subject: b.emailSubject as string,
          html: buildBroadcastEmailHtml({ body: b.emailBody as string, includeUnsubscribe: includeUnsub, unsubUrl }),
        };
      }));
      try { sentEmail += await sendEmailBatch(messages); } catch (e) { console.error('email batch', e); failedEmail += group.length; }
    }
  }

  if (b.channels.includes('push') && b.pushTitle && b.pushBody) {
    const tokens = recipients.map((r) => r.expoPushToken).filter((t): t is string => Boolean(t));
    for (const group of chunk(tokens, BATCH)) {
      try {
        const result = await sendExpoPushMessages(group.map((to) => ({
          to, title: b.pushTitle as string, body: b.pushBody as string, sound: 'default' as const,
        })));
        sentPush += result.sent;
      } catch (e) { console.error('push batch', e); failedPush += group.length; }
    }
  }

  const anySuccess = sentEmail > 0 || sentPush > 0 || recipients.length === 0;
  await serviceClient.from('Broadcast').update({
    status: anySuccess ? 'sent' : 'failed',
    sentEmail, failedEmail, sentPush, failedPush,
    sentAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }).eq('id', b.id);
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders, status: 204 });
  const token = request.headers.get('x-queue-worker-token')?.trim() ?? '';
  if (!WORKER_TOKEN || token !== WORKER_TOKEN) {
    return new Response(JSON.stringify({ error: { message: 'Unauthorized' } }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // Atomic claim: scheduled + due -> sending
  const nowIso = new Date().toISOString();
  const { data: claimed, error } = await serviceClient
    .from('Broadcast')
    .update({ status: 'sending', updatedAt: nowIso })
    .eq('status', 'scheduled').lte('scheduledAt', nowIso)
    .select('*').returns<BroadcastRow[]>();
  if (error) {
    return new Response(JSON.stringify({ error: { message: error.message } }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const broadcasts = claimed ?? [];
  for (const b of broadcasts) {
    try { await processBroadcast(b); }
    catch (e) {
      console.error('processBroadcast failed', b.id, e);
      await serviceClient.from('Broadcast').update({ status: 'failed', updatedAt: new Date().toISOString() }).eq('id', b.id);
    }
  }

  return new Response(JSON.stringify({ data: { processed: broadcasts.length } }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
```

- [ ] **Step 2: Write the cron schedule migration** (mirrors `20260624_queue_drainer_schedule.sql`). Create `supabase/migrations/20260708_broadcast_runner_schedule.sql`:

```sql
-- Schedule broadcast-runner every minute via pg_cron + pg_net, reusing the same
-- Vault secrets as queue-drainer (project_url, queue_worker_token). Dormant until
-- both secrets exist.
do $ext$
begin
  create extension if not exists pg_cron;
  create extension if not exists pg_net;
  create extension if not exists supabase_vault;
exception when others then
  raise notice 'broadcast-runner: prerequisite extension unavailable (%), skipping', sqlerrm;
end
$ext$;

do $sched$
begin
  perform cron.schedule(
    'broadcast-runner-every-minute',
    '* * * * *',
    $cron$
      with credentials as (
        select
          (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') as project_url,
          (select decrypted_secret from vault.decrypted_secrets where name = 'queue_worker_token') as queue_worker_token
      )
      select net.http_post(
        url := credentials.project_url || '/functions/v1/broadcast-runner',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-queue-worker-token', credentials.queue_worker_token
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 8000
      ) as request_id
      from credentials
      where credentials.project_url is not null
        and credentials.queue_worker_token is not null;
    $cron$
  );
exception when others then
  raise notice 'broadcast-runner: could not schedule cron (%), skipping', sqlerrm;
end
$sched$;
```

- [ ] **Step 3: Apply the cron migration** via Supabase MCP `apply_migration` (name `broadcast_runner_schedule`).

- [ ] **Step 4: Deploy note (USER).** New function needs deploy with worker-token auth (no JWT):
`npx supabase functions deploy broadcast-runner --project-ref rgfbheorvtolixdcpjhy --no-verify-jwt`.
Prereq secrets already set for queue-drainer (`QUEUE_WORKER_TOKEN`, Vault `project_url`/`queue_worker_token`); reused as-is.

- [ ] **Step 5: Commit.**

```
git add supabase/functions/broadcast-runner/index.ts supabase/migrations/20260708_broadcast_runner_schedule.sql
git commit -m "feat(broadcast): cron-invoked broadcast-runner with batched email/push send"
```

---

## Task 5: `unsubscribe` public edge function

Delivers: a public opt-out endpoint that suppresses an email via a signed link.

**Files:**
- Create: `supabase/functions/unsubscribe/index.ts`

**Interfaces consumed:** `verifyUnsubscribe` from `_shared/broadcast.ts`.

- [ ] **Step 1: Write the function.** Create `supabase/functions/unsubscribe/index.ts`:

```ts
/// <reference path="../_shared/edge-runtime.d.ts" />
import { serviceClient } from '../_shared/client.ts';
import { verifyUnsubscribe } from '../_shared/broadcast.ts';

const page = (title: string, message: string) =>
  new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:64px auto;padding:0 24px;color:#0f172a;text-align:center;"><h2>${title}</h2><p style="color:#475569;font-size:15px;line-height:1.6;">${message}</p></body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );

Deno.serve(async (request) => {
  const url = new URL(request.url);
  const email = (url.searchParams.get('e') ?? '').trim().toLowerCase();
  const token = url.searchParams.get('t') ?? '';

  if (!email || !(await verifyUnsubscribe(email, token))) {
    return page('Link invalid', 'This unsubscribe link is invalid or has expired.');
  }

  const { error } = await serviceClient
    .from('EmailSuppression')
    .upsert({ email, reason: 'unsubscribe' }, { onConflict: 'email' });
  if (error) {
    console.error('unsubscribe upsert failed', error.message);
    return page('Something went wrong', 'We could not process your request. Please try again later.');
  }

  return page('Unsubscribed', `${email} has been removed from FEASTY marketing emails. You will still receive important account and order updates.`);
});
```

- [ ] **Step 2: Deploy note (USER).** Public endpoint (no JWT):
`npx supabase functions deploy unsubscribe --project-ref rgfbheorvtolixdcpjhy --no-verify-jwt`.
Also set the HMAC secret once: `npx supabase secrets set BROADCAST_UNSUB_SECRET=<random-64-hex> --project-ref rgfbheorvtolixdcpjhy` (and it is read by `app-rpc`/`broadcast-runner` too, so redeploy those after setting it — or set before deploying).

- [ ] **Step 3: Commit.**

```
git add supabase/functions/unsubscribe/index.ts
git commit -m "feat(broadcast): public unsubscribe endpoint with HMAC-verified links"
```

---

## Task 6: Admin UI — service + Broadcasts page + route/nav

Delivers: a working admin `/broadcasts` page (list + composer + preview + send/schedule/cancel).

**Files:**
- Create: `apps/admin-web/src/services/broadcasts.ts`
- Create: `apps/admin-web/src/pages/BroadcastsPage.tsx`
- Modify: `apps/admin-web/src/App.tsx`
- Modify: `apps/admin-web/src/components/AppLayout.tsx`
- Modify: `apps/admin-web/src/styles/global.css`

**Interfaces consumed:** `callAdminRpc` (`src/lib/rpc.ts`), existing components (`StatusBadge`, `EmptyState`, `ErrorBanner`, `LoadingBlock`), tone helper pattern.

- [ ] **Step 1: Service layer.** Create `apps/admin-web/src/services/broadcasts.ts`:

```ts
import { callAdminRpc } from '../lib/rpc';
import type { AdminTone } from '../theme/tones';

export type BroadcastStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed' | 'canceled';
export interface BroadcastSegment {
  roles?: string[];
  activity?: { orderedWithinDays?: number; notOrderedForDays?: number } | null;
  restaurantId?: string | null;
}
export interface Broadcast {
  id: string; title: string; category: 'marketing' | 'transactional'; channels: string[];
  segment: BroadcastSegment; emailSubject: string | null; emailBody: string | null;
  pushTitle: string | null; pushBody: string | null; status: BroadcastStatus;
  scheduledAt: string | null; recipientCount: number;
  sentEmail: number; failedEmail: number; sentPush: number; failedPush: number;
  createdAt: string; sentAt: string | null;
}

export const broadcastTone = (s: BroadcastStatus): AdminTone =>
  s === 'sent' ? 'success' : s === 'failed' ? 'danger' : s === 'sending' ? 'info'
  : s === 'scheduled' ? 'primary' : s === 'canceled' ? 'neutral' : 'warning';

export const listBroadcasts = () => callAdminRpc<{ broadcasts: Broadcast[] }>('broadcastList');
export const previewAudience = (segment: BroadcastSegment, category: string) =>
  callAdminRpc<{ recipientCount: number }>('broadcastPreviewAudience', { segment, category });
export const createBroadcast = (input: Record<string, unknown>) =>
  callAdminRpc<{ broadcast: Broadcast }>('broadcastCreate', input);
export const scheduleBroadcast = (id: string, scheduledAt?: string) =>
  callAdminRpc<{ broadcast: Broadcast }>('broadcastSchedule', { id, scheduledAt });
export const cancelBroadcast = (id: string) =>
  callAdminRpc<{ broadcast: Broadcast }>('broadcastCancel', { id });
```

- [ ] **Step 2: Broadcasts page.** Create `apps/admin-web/src/pages/BroadcastsPage.tsx` with: a list (left) of broadcasts (title, `StatusBadge` via `broadcastTone`, channels, `recipientCount`, sent/failed, `scheduledAt`) and a composer (right) with fields: title; category select (`marketing`/`transactional`); channel checkboxes (email/push); segment builder — role checkboxes (`customer`/`restaurant`/`dispatch`), activity select (`none` / `ordered within 30d` → `{orderedWithinDays:30}` / `not ordered 60d` → `{notOrderedForDays:60}`), restaurant id text input; email subject + body textarea; push title + body; a **Preview recipients** button (calls `previewAudience`, shows count); a **Create draft** button (`createBroadcast`); then **Send now** (`scheduleBroadcast(id)`) / **Schedule** (datetime-local → `scheduleBroadcast(id, iso)`) / **Cancel** (`cancelBroadcast(id)`) on a selected draft/scheduled row. Reuse `LoadingBlock`, `ErrorBanner`, `EmptyState`. Full component:

```tsx
import { useCallback, useEffect, useState } from 'react';
import EmptyState from '../components/EmptyState';
import ErrorBanner from '../components/ErrorBanner';
import LoadingBlock from '../components/LoadingBlock';
import StatusBadge from '../components/StatusBadge';
import {
  broadcastTone, cancelBroadcast, createBroadcast, listBroadcasts, previewAudience, scheduleBroadcast,
  type Broadcast, type BroadcastSegment,
} from '../services/broadcasts';

type ActivityChoice = 'none' | 'active30' | 'lapsed60';
const activityToSegment = (a: ActivityChoice): BroadcastSegment['activity'] =>
  a === 'active30' ? { orderedWithinDays: 30 } : a === 'lapsed60' ? { notOrderedForDays: 60 } : null;

export default function BroadcastsPage() {
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<'marketing' | 'transactional'>('marketing');
  const [email, setEmail] = useState(true);
  const [push, setPush] = useState(false);
  const [roles, setRoles] = useState<string[]>(['customer']);
  const [activity, setActivity] = useState<ActivityChoice>('none');
  const [restaurantId, setRestaurantId] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [pushTitle, setPushTitle] = useState('');
  const [pushBody, setPushBody] = useState('');
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [selected, setSelected] = useState<Broadcast | null>(null);
  const [schedAt, setSchedAt] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setBroadcasts((await listBroadcasts()).broadcasts); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to load broadcasts.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const buildSegment = (): BroadcastSegment => ({
    roles,
    activity: activityToSegment(activity),
    restaurantId: restaurantId.trim() || null,
  });

  const channels = [...(email ? ['email'] : []), ...(push ? ['push'] : [])];

  const toggleRole = (r: string) =>
    setRoles((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));

  const onPreview = async () => {
    setBusy(true);
    try { setPreviewCount((await previewAudience(buildSegment(), category)).recipientCount); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : 'Preview failed.'); }
    finally { setBusy(false); }
  };

  const onCreate = async () => {
    setBusy(true);
    try {
      const { broadcast } = await createBroadcast({
        title, category, channels, segment: buildSegment(),
        emailSubject, emailBody, pushTitle, pushBody,
      });
      setSelected(broadcast);
      await load();
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Create failed.'); }
    finally { setBusy(false); }
  };

  const onSendNow = async () => {
    if (!selected) return;
    setBusy(true);
    try { await scheduleBroadcast(selected.id); setSelected(null); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Send failed.'); }
    finally { setBusy(false); }
  };
  const onSchedule = async () => {
    if (!selected || !schedAt) return;
    setBusy(true);
    try { await scheduleBroadcast(selected.id, new Date(schedAt).toISOString()); setSelected(null); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Schedule failed.'); }
    finally { setBusy(false); }
  };
  const onCancel = async (b: Broadcast) => {
    setBusy(true);
    try { await cancelBroadcast(b.id); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Cancel failed.'); }
    finally { setBusy(false); }
  };

  return (
    <section className="page broadcasts-page">
      <div className="broadcast-compose card">
        <h3>New broadcast</h3>
        {error ? <ErrorBanner message={error} /> : null}
        <div className="field"><label>Title</label><input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="field"><label>Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value as 'marketing' | 'transactional')}>
            <option value="marketing">Marketing (customers, unsubscribe)</option>
            <option value="transactional">Transactional/operational (no opt-out)</option>
          </select>
        </div>
        <div className="field"><label>Channels</label>
          <label><input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} /> Email</label>
          <label><input type="checkbox" checked={push} onChange={(e) => setPush(e.target.checked)} /> Push</label>
        </div>
        <div className="field"><label>Roles</label>
          {['customer', 'restaurant', 'dispatch'].map((r) => (
            <label key={r}><input type="checkbox" checked={roles.includes(r)} onChange={() => toggleRole(r)} /> {r}</label>
          ))}
        </div>
        <div className="field"><label>Activity (customers)</label>
          <select value={activity} onChange={(e) => setActivity(e.target.value as ActivityChoice)}>
            <option value="none">Any</option>
            <option value="active30">Ordered within 30 days</option>
            <option value="lapsed60">Not ordered for 60 days</option>
          </select>
        </div>
        <div className="field"><label>Restaurant id (optional)</label><input value={restaurantId} onChange={(e) => setRestaurantId(e.target.value)} /></div>
        {email ? (<>
          <div className="field"><label>Email subject</label><input value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} /></div>
          <div className="field"><label>Email body (HTML)</label><textarea rows={5} value={emailBody} onChange={(e) => setEmailBody(e.target.value)} /></div>
        </>) : null}
        {push ? (<>
          <div className="field"><label>Push title</label><input value={pushTitle} onChange={(e) => setPushTitle(e.target.value)} /></div>
          <div className="field"><label>Push body</label><textarea rows={2} value={pushBody} onChange={(e) => setPushBody(e.target.value)} /></div>
        </>) : null}
        <div className="broadcast-actions">
          <button className="btn btn-ghost" disabled={busy} onClick={() => void onPreview()}>Preview recipients</button>
          {previewCount !== null ? <span className="badge badge-primary">{previewCount} recipients</span> : null}
          <button className="btn btn-primary" disabled={busy || !title.trim()} onClick={() => void onCreate()}>Create draft</button>
        </div>
        {selected ? (
          <div className="broadcast-send">
            <p className="muted">Draft “{selected.title}” created. Send it:</p>
            <button className="btn btn-primary" disabled={busy} onClick={() => void onSendNow()}>Send now</button>
            <input type="datetime-local" value={schedAt} onChange={(e) => setSchedAt(e.target.value)} />
            <button className="btn btn-ghost" disabled={busy || !schedAt} onClick={() => void onSchedule()}>Schedule</button>
          </div>
        ) : null}
      </div>

      <div className="broadcast-list card">
        <h3>Broadcasts</h3>
        {loading ? <LoadingBlock label="Loading…" /> : null}
        {!loading && broadcasts.length === 0 ? <EmptyState title="No broadcasts yet" body="Compose one on the left." /> : (
          <table className="data-table">
            <thead><tr><th>Title</th><th>Status</th><th>Recipients</th><th>Sent</th><th>When</th><th /></tr></thead>
            <tbody>
              {broadcasts.map((b) => (
                <tr key={b.id}>
                  <td className="cell-strong">{b.title}</td>
                  <td><StatusBadge label={b.status} tone={broadcastTone(b.status)} /></td>
                  <td>{b.recipientCount}</td>
                  <td>{b.sentEmail + b.sentPush}{b.failedEmail + b.failedPush > 0 ? ` (${b.failedEmail + b.failedPush} failed)` : ''}</td>
                  <td>{b.scheduledAt ? new Date(b.scheduledAt).toLocaleString() : new Date(b.createdAt).toLocaleString()}</td>
                  <td>{b.status === 'scheduled' ? <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void onCancel(b)}>Cancel</button> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Route + nav.** In `apps/admin-web/src/App.tsx`, add a lazy import `const BroadcastsPage = lazy(() => import('./pages/BroadcastsPage'));` and a route inside the `RequireAdmin` group:

```tsx
<Route
  path="/broadcasts"
  element={<Suspense fallback={<LoadingBlock label="Loading…" />}><BroadcastsPage /></Suspense>}
/>
```
In `apps/admin-web/src/components/AppLayout.tsx`, add to `ADMIN_NAV` (NOT `SUPPORT_NAV`): `{ to: '/broadcasts', label: 'Broadcasts' }`.

- [ ] **Step 4: Styles.** Append to `apps/admin-web/src/styles/global.css`:

```css
/* ---------- Broadcasts ---------- */
.broadcasts-page { display: grid; grid-template-columns: minmax(320px, 420px) 1fr; gap: 16px; align-items: start; }
.broadcast-compose { display: flex; flex-direction: column; gap: 10px; }
.broadcast-compose textarea { border: 1px solid var(--border); border-radius: 10px; padding: 8px 10px; font: inherit; }
.broadcast-actions, .broadcast-send { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
@media (max-width: 980px) { .broadcasts-page { grid-template-columns: 1fr; } }
```

- [ ] **Step 5: Verify.** Run: `npm --prefix apps/admin-web run typecheck` then `npm --prefix apps/admin-web run build` — expect both pass; confirm a `BroadcastsPage-*.js` lazy chunk appears in the build output.

- [ ] **Step 6: Commit.**

```
git add apps/admin-web/src
git commit -m "feat(broadcast): admin Broadcasts page, service, route, nav"
```

---

## Task 7: End-to-end verification + docs (after USER deploys)

Delivers: proven round-trip + updated docs.

- [ ] **Step 1: USER deploys** (agent is blocked from `--no-verify-jwt`): set `BROADCAST_UNSUB_SECRET`, then deploy `app-rpc`, `broadcast-runner`, `unsubscribe` (all `--no-verify-jwt`). Merge the branch to `main` for the admin-web Vercel build.

- [ ] **Step 2: Seed check.** Via admin `/broadcasts`: create a small **transactional** email+push broadcast targeting `roles:['dispatch']` (small set), Preview shows a count, Send now. Within ≤60s the runner flips it to `sent` with counts. Verify an email arrived and (if a device token exists) a push.

- [ ] **Step 3: Marketing + unsubscribe.** Create a **marketing** broadcast to `roles:['customer']`; confirm the email has an Unsubscribe link; click it → "Unsubscribed" page → row added to `EmailSuppression` (verify via MCP `execute_sql`). Re-run a marketing send and confirm `recipientCount` dropped by one.

- [ ] **Step 4: Docs.** Update `docs/idea-book.md` Phase 3 line to "3a live" with date; commit.

- [ ] **Step 5: Open PR** from `feature/broadcast-messaging-phase3a` into `main`.

---

## Self-Review notes (spec coverage)

- Tables + RLS + id defaults → Task 1. Audience resolver (role/activity/restaurant AND, suppression) → Task 2. Preview/create/schedule/cancel/list → Task 3. Batched send + atomic claim + cron ≤60s → Task 4. Unsubscribe HMAC + public page → Task 5 (+ Task 2 helpers). Admin UI/nav → Task 6. Marketing=customers/unsubscribe, transactional=partners/riders no opt-out → enforced in Task 2 (suppression only when category='marketing') + Task 3 validation. E2E + deploy notes → Task 7.
- Deferred (in-app notice, city segmentation, recurring, tracking) → not in any task (Phase 3b).
