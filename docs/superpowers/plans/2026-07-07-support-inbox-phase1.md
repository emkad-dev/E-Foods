# Customer Support Inbox — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let customers message support from the FEASTY app into a threaded inbox in the admin panel, where a dedicated `support` role replies and each reply fans out to the customer via in-app (Realtime), email (Resend), and push (Expo).

**Architecture:** Two new Prisma tables (`SupportConversation`, `SupportMessage`) accessed exclusively through the existing `app-rpc` edge-function router (service-role). Both apps call the router via their existing `callBackendRpc` helpers. Live updates use the existing Realtime **Broadcast** helper (topics), not `postgres_changes`, so the tables stay fully RLS-locked. Admin adds a `support` role, a route guard, and an Inbox page; the customer app adds a Support screen.

**Tech Stack:** Supabase (Postgres + Prisma + Edge Functions/Deno + Realtime Broadcast + Auth), Resend (email), Expo (push + customer app / Expo Router), React 19 + Vite + react-router-dom 7 (admin panel).

## Global Constraints

- **No unit-test harness exists in this repo.** Do NOT introduce vitest/jest/Deno test as part of this feature. "Verify" steps mean: type-check (`deno check` / `tsc --noEmit`), lint where configured, deploy, and exercise the real flow. Match the codebase's existing manual-verification style.
- **All DB access goes through `app-rpc`** using `serviceClient`. Apps never query these tables directly. New tables get RLS enabled with **no policies** for `anon`/`authenticated` (service role bypasses RLS).
- **Roles source:** edge context role comes from `user_profiles.role` (`getAuthenticatedRequestContext`); admin-web role comes from `app_metadata.user_role` via `getSupabaseSessionRole`. Both must recognise `support`.
- **Router handler style (copy exactly):** `if (action === 'x') { ensureRole(context.role, [...]); ...; return json(200, { data }); }`. Use `fail(status, msg)` for validation errors, `throw new Error(msg)` for unexpected DB errors.
- **Naming:** tables/models PascalCase (`SupportConversation`), columns camelCase (Prisma convention in `functions/prisma/schema.prisma`). RPC actions camelCase (`supportGetInbox`).
- **Best-effort fan-out:** an agent reply must persist and appear in-app even if email or push fails; record per-channel result on the message row and never throw from a delivery failure (mirror `sendTransactionalEmail`/`broadcastRealtimeMessages`, which log and return).
- **One thread per customer:** `SupportConversation.customerId` is UNIQUE. First customer message upserts the row; later messages append and bump `lastMessageAt`; a `closed` thread reopens to `open` on a new customer message.
- **Branch:** `feature/support-inbox-phase1` (already checked out). Commit after every task.

---

## File Structure

**Create**
- `supabase/migrations/20260707_support_inbox.sql` — tables (mirrors Prisma models), indexes, RLS enable.
- `apps/admin-web/src/pages/InboxPage.tsx` — inbox list + thread + composer + actions.
- `apps/admin-web/src/services/supportInbox.ts` — admin RPC calls + types.
- `apps/admin-web/src/lib/useSupportRealtime.ts` — subscribe to the `support-inbox` broadcast topic.
- `apps/admin-web/src/components/RequireRole.tsx` — generic role guard.
- `apps/customer/app/(customer)/support.tsx` — customer support screen.
- `apps/customer/src/services/customerSupport.ts` — customer RPC calls + types.
- `apps/customer/src/hooks/useSupportThreadRealtime.ts` — subscribe to `support-<conversationId>`.

**Modify**
- `functions/prisma/schema.prisma` — add `AppRole` enum value `support`; add two models.
- `packages/domain/src/roles.ts` — add `'support'` to `APP_ROLES`.
- `supabase/functions/_shared/realtime.ts` — add support broadcast topics + helpers.
- `supabase/functions/app-rpc/index.ts` — add 7 action handlers + shared support types/helpers.
- `apps/admin-web/src/App.tsx` — add `/inbox` route (guarded `['admin','support']`); extract `RequireRole`.
- `apps/admin-web/src/pages/LoginPage.tsx` — allow `support` to sign in (redirect to `/inbox`).
- `apps/admin-web/src/components/AppLayout.tsx` — role-aware nav (support sees only Inbox).
- `apps/customer/app/(customer)/_layout.tsx` + a profile/menu entry — link to Support.
- `docs/idea-book.md` / spec — flip Phase 1 status to "in progress"/"done".

---

## Task 1: Support role plumbing (admin panel + shared domain)

Delivers: a `support`-role account can sign into the admin panel and sees only an Inbox nav item (page stub); admins are unchanged. No DB/RPC yet.

**Files:**
- Modify: `packages/domain/src/roles.ts`
- Modify: `functions/prisma/schema.prisma` (enum only)
- Create: `apps/admin-web/src/components/RequireRole.tsx`
- Modify: `apps/admin-web/src/App.tsx`
- Modify: `apps/admin-web/src/pages/LoginPage.tsx`
- Modify: `apps/admin-web/src/components/AppLayout.tsx`
- Create: `apps/admin-web/src/pages/InboxPage.tsx` (stub in this task)

**Interfaces produced:**
- `APP_ROLES` includes `'support'`; `AppRole` union gains `'support'`.
- `RequireRole({ roles, children })` — renders children only if `session && roles.includes(role)`, else `<Navigate to="/login" />`.

- [ ] **Step 1: Add `support` to shared roles.** Edit `packages/domain/src/roles.ts`:

```ts
export const APP_ROLES = ['customer', 'restaurant', 'dispatch', 'admin', 'support'] as const;

export type AppRole = (typeof APP_ROLES)[number];
```

- [ ] **Step 2: Add `support` to the Prisma `AppRole` enum.** In `functions/prisma/schema.prisma`, find `enum AppRole { ... }` and add `support` as a value (keep existing values). Do not run a migration yet — Task 2 batches all DB changes.

- [ ] **Step 3: Create the generic guard.** `apps/admin-web/src/components/RequireRole.tsx`:

```tsx
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { AppRole } from '../../../../packages/domain/src';
import { useAuth } from '../contexts/AuthContext';
import LoadingBlock from './LoadingBlock';

export default function RequireRole({ roles, children }: { roles: AppRole[]; children: ReactNode }) {
  const { session, role, initializing } = useAuth();
  const location = useLocation();

  if (initializing) {
    return <LoadingBlock label="Checking your session…" />;
  }
  if (!session || !role || !roles.includes(role)) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}
```

- [ ] **Step 4: Add the Inbox route + stub page.** Create `apps/admin-web/src/pages/InboxPage.tsx`:

```tsx
export default function InboxPage() {
  return (
    <section className="page">
      <h2>Support Inbox</h2>
      <p className="muted">Inbox coming online…</p>
    </section>
  );
}
```

In `apps/admin-web/src/App.tsx`: import `RequireRole` and `InboxPage`. Add a route that allows both roles. Because the existing block is wrapped in a single `RequireAdmin`, add the inbox as its own guarded branch so support users are not forced through `RequireAdmin`:

```tsx
<Route
  path="/inbox"
  element={
    <RequireRole roles={['admin', 'support']}>
      <SnapshotProvider>
        <AppLayout />
      </SnapshotProvider>
    </RequireRole>
  }
>
  <Route index element={<InboxPage />} />
</Route>
```

Keep the existing admin-only routes as-is under `RequireAdmin`.

- [ ] **Step 5: Let `support` sign in.** In `apps/admin-web/src/pages/LoginPage.tsx`, replace the admin-only redirect/guard so support is accepted and routed to `/inbox`:

```tsx
const allowedRole = role === 'admin' || role === 'support';
if (!initializing && session && allowedRole) {
  const fallback = role === 'support' ? '/inbox' : '/';
  const from = (location.state as { from?: string } | null)?.from ?? fallback;
  return <Navigate to={from} replace />;
}
// ...
const signedInWithoutAccess = !initializing && session && !(role === 'admin' || role === 'support');
```
Update the `signedInWithoutAdminRole` usages to `signedInWithoutAccess` and keep the "does not have admin access" banner copy generic: "This account does not have panel access."

- [ ] **Step 6: Role-aware nav.** In `apps/admin-web/src/components/AppLayout.tsx`, add an `Inbox` item and hide the rest for support:

```tsx
import { useAuth } from '../contexts/AuthContext';

const ADMIN_NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/orders', label: 'Orders' },
  { to: '/approvals', label: 'Approvals' },
  { to: '/access', label: 'Access' },
  { to: '/dispatch', label: 'Dispatch' },
  { to: '/statistics', label: 'Statistics' },
  { to: '/inbox', label: 'Inbox' },
];
const SUPPORT_NAV = [{ to: '/inbox', label: 'Inbox' }];
// inside component:
const { role } = useAuth();
const navItems = role === 'support' ? SUPPORT_NAV : ADMIN_NAV;
```
Render `navItems` instead of the old `NAV_ITEMS`. Note: `AppLayout` uses `useSnapshot()`; `SnapshotProvider` wraps the inbox route (Step 4) so this keeps working.

- [ ] **Step 7: Verify.** Run:

```
npm --prefix apps/admin-web run typecheck
```
Expected: passes (exit 0). Manually reason: an admin sees all nav incl. Inbox; a support user (once provisioned in Task 2) would see only Inbox.

- [ ] **Step 8: Commit.**

```
git add packages/domain/src/roles.ts functions/prisma/schema.prisma apps/admin-web/src
git commit -m "feat(support): add support role, route guard, and inbox nav stub"
```

---

## Task 2: Database — conversations, messages, RLS, realtime helpers

Delivers: the two tables exist with correct shape, indexes, and RLS enabled; broadcast helpers ready for later tasks. Provision a test `support` user.

**Files:**
- Modify: `functions/prisma/schema.prisma` (models)
- Create: `supabase/migrations/20260707_support_inbox.sql`
- Modify: `supabase/functions/_shared/realtime.ts`

**Interfaces produced:**
- Tables `public."SupportConversation"`, `public."SupportMessage"`.
- `SUPPORT_INBOX_TOPIC = 'support-inbox'`, `supportThreadTopic(conversationId)`, `broadcastSupportInboxChanged(payload)`, `broadcastSupportThreadChanged(conversationId, payload)`.

- [ ] **Step 1: Add Prisma models.** In `functions/prisma/schema.prisma` add (adjust relation back-references on `UserAccount` only if the repo's Prisma validate requires them; otherwise keep relations minimal with `@relation` name-free FKs as other models do):

```prisma
model SupportConversation {
  id            String           @id @default(cuid())
  customerId    String           @unique
  subject       String?
  status        String           @default("open") // open | pending | closed
  assignedTo    String?
  channel       String           @default("in_app")
  lastMessageAt DateTime         @default(now())
  createdAt     DateTime         @default(now())
  updatedAt     DateTime         @updatedAt
  messages      SupportMessage[]

  @@index([status])
  @@index([assignedTo])
  @@index([lastMessageAt])
}

model SupportMessage {
  id             String              @id @default(cuid())
  conversationId String
  senderType     String              // customer | agent | system
  senderId       String?
  body           String
  emailSent      Boolean             @default(false)
  pushSent       Boolean             @default(false)
  createdAt      DateTime            @default(now())
  conversation   SupportConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@index([conversationId])
  @@index([createdAt])
}
```

- [ ] **Step 2: Validate the schema.** Run:

```
npm run db:validate
```
Expected: "The schema at functions/prisma/schema.prisma is valid".

- [ ] **Step 3: Write the SQL migration** (tables + indexes + RLS). Create `supabase/migrations/20260707_support_inbox.sql`. This mirrors the Prisma models so the migration is the source of truth applied to the remote DB (matches how `supabase/migrations/*.sql` are used here). Enable RLS with no policies — all access is service-role via `app-rpc`.

```sql
-- Support inbox: conversations + messages (Phase 1)
create table if not exists public."SupportConversation" (
  "id"            text primary key,
  "customerId"    text not null unique,
  "subject"       text,
  "status"        text not null default 'open',
  "assignedTo"    text,
  "channel"       text not null default 'in_app',
  "lastMessageAt" timestamptz not null default now(),
  "createdAt"     timestamptz not null default now(),
  "updatedAt"     timestamptz not null default now()
);

create table if not exists public."SupportMessage" (
  "id"             text primary key,
  "conversationId" text not null references public."SupportConversation"("id") on delete cascade,
  "senderType"     text not null,
  "senderId"       text,
  "body"           text not null,
  "emailSent"      boolean not null default false,
  "pushSent"       boolean not null default false,
  "createdAt"      timestamptz not null default now()
);

create index if not exists "SupportConversation_status_idx" on public."SupportConversation" ("status");
create index if not exists "SupportConversation_assignedTo_idx" on public."SupportConversation" ("assignedTo");
create index if not exists "SupportConversation_lastMessageAt_idx" on public."SupportConversation" ("lastMessageAt");
create index if not exists "SupportMessage_conversationId_idx" on public."SupportMessage" ("conversationId");
create index if not exists "SupportMessage_createdAt_idx" on public."SupportMessage" ("createdAt");

alter table public."SupportConversation" enable row level security;
alter table public."SupportMessage" enable row level security;
-- No policies: anon/authenticated get zero rows. app-rpc uses the service role, which bypasses RLS.
```

- [ ] **Step 4: Apply the migration** using the repo's workflow. Preferred (matches other SQL migrations here):

```
supabase db push
```
If the project uses Prisma migrate for table creation instead, run `npm run db:migrate:deploy` after generating a migration and apply only the `alter table ... enable row level security` block via `supabase db push`. Confirm afterward with the Supabase MCP `list_tables` (or `supabase migration list`) that both tables exist.

- [ ] **Step 5: Regenerate Prisma client** (keeps `functions` in sync):

```
npm run db:generate
```
Expected: "Generated Prisma Client".

- [ ] **Step 6: Add broadcast helpers.** Append to `supabase/functions/_shared/realtime.ts`:

```ts
export const SUPPORT_INBOX_TOPIC = 'support-inbox';
export const supportThreadTopic = (conversationId: string) => `support-${conversationId}`;

export const broadcastSupportInboxChanged = (payload: Record<string, unknown> = {}) =>
  broadcastRealtimeMessages([{ payload, topic: SUPPORT_INBOX_TOPIC }]);

export const broadcastSupportThreadChanged = (
  conversationId: string,
  payload: Record<string, unknown> = {}
) =>
  broadcastRealtimeMessages([
    { payload: { conversationId, ...payload }, topic: supportThreadTopic(conversationId) },
    { payload: { conversationId, ...payload }, topic: SUPPORT_INBOX_TOPIC },
  ]);
```

- [ ] **Step 7: Provision a test support user.** Using the existing admin `provisionStaffAccount` flow (admin panel → Access) or the Supabase dashboard, create one account with `app_metadata.user_role = 'support'` and a matching `user_profiles.role = 'support'`. Record the credentials for Task 4/6 verification.

- [ ] **Step 8: Verify realtime helper types.** Run:

```
deno check supabase/functions/_shared/realtime.ts
```
Expected: no errors.

- [ ] **Step 9: Commit.**

```
git add functions/prisma/schema.prisma supabase/migrations/20260707_support_inbox.sql supabase/functions/_shared/realtime.ts
git commit -m "feat(support): add support conversation/message tables, RLS, and realtime topics"
```

---

## Task 3: Edge RPC actions (customer + agent)

Delivers: the full backend API, type-checked and deployed. All 7 actions live in `app-rpc/index.ts`.

**Files:**
- Modify: `supabase/functions/app-rpc/index.ts`

**Interfaces produced (action → payload → return `{ data }`):**
- `customerSendSupportMessage` `{ body: string }` → `{ conversation, message }` (role: any authenticated; uses `context.uid` as customerId).
- `customerGetSupportThread` `{}` → `{ conversation: Conversation | null, messages: Message[] }`.
- `supportGetInbox` `{ status?: 'open'|'pending'|'closed', scope?: 'mine'|'unassigned'|'all' }` → `{ conversations: InboxRow[] }` (role: admin|support).
- `supportGetConversation` `{ conversationId: string }` → `{ conversation, messages }` (admin|support).
- `supportSendAgentReply` `{ conversationId: string, body: string }` → `{ message }` (admin|support). Fans out email+push, sets `emailSent`/`pushSent`.
- `supportSetConversationStatus` `{ conversationId: string, status: 'open'|'pending'|'closed' }` → `{ conversation }` (admin|support).
- `supportAssignConversation` `{ conversationId: string, assignTo: string | null }` → `{ conversation }` (admin|support).

Types (add near the other `...Row` types in the file):

```ts
type SupportConversationRow = {
  id: string;
  customerId: string;
  subject: string | null;
  status: string;
  assignedTo: string | null;
  channel: string;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
};
type SupportMessageRow = {
  id: string;
  conversationId: string;
  senderType: string;
  senderId: string | null;
  body: string;
  emailSent: boolean;
  pushSent: boolean;
  createdAt: string;
};
```

Add imports at the top of `app-rpc/index.ts` (extend existing import lines — do not duplicate imports already present such as `sendTransactionalEmail`, `buildTransactionalEmailHtml`, `loadUserEmailRecipient`):

```ts
import {
  broadcastSupportInboxChanged,
  broadcastSupportThreadChanged,
} from '../_shared/realtime.ts';
import { sendPushNotificationsToUsers } from '../_shared/notifications.ts';
// email helpers already imported: sendTransactionalEmail, buildTransactionalEmailHtml, loadUserEmailRecipient
```

- [ ] **Step 1: Shared helper — upsert + append.** Add a helper function (near other module-level helpers) that both customer and agent paths reuse:

```ts
const SUPPORT_STATUSES = ['open', 'pending', 'closed'] as const;
const isSupportStatus = (v: unknown): v is (typeof SUPPORT_STATUSES)[number] =>
  typeof v === 'string' && (SUPPORT_STATUSES as readonly string[]).includes(v);

const appendSupportMessage = async (input: {
  conversationId: string;
  senderType: 'customer' | 'agent' | 'system';
  senderId: string | null;
  body: string;
  emailSent?: boolean;
  pushSent?: boolean;
}) => {
  const { data, error } = await serviceClient
    .from('SupportMessage')
    .insert({
      conversationId: input.conversationId,
      senderType: input.senderType,
      senderId: input.senderId,
      body: input.body,
      emailSent: input.emailSent ?? false,
      pushSent: input.pushSent ?? false,
    })
    .select('*')
    .single<SupportMessageRow>();
  if (error) throw new Error(error.message);
  await serviceClient
    .from('SupportConversation')
    .update({ lastMessageAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    .eq('id', input.conversationId);
  return data;
};
```

- [ ] **Step 2: `customerSendSupportMessage`.** Add the handler block (anywhere alongside the other `if (action === ...)` blocks; group with customer actions):

```ts
if (action === 'customerSendSupportMessage') {
  const body = sanitizeText(data.body);
  if (!body) {
    fail(400, 'A message body is required.');
  }

  // One thread per customer: find or create, reopen if closed.
  const { data: existing, error: findError } = await serviceClient
    .from('SupportConversation')
    .select('*')
    .eq('customerId', context.uid)
    .maybeSingle<SupportConversationRow>();
  if (findError) throw new Error(findError.message);

  let conversation = existing;
  if (!conversation) {
    const { data: created, error: createError } = await serviceClient
      .from('SupportConversation')
      .insert({ customerId: context.uid, status: 'open', subject: body!.slice(0, 80) })
      .select('*')
      .single<SupportConversationRow>();
    if (createError) throw new Error(createError.message);
    conversation = created;
  } else if (conversation.status === 'closed') {
    const { data: reopened, error: reopenError } = await serviceClient
      .from('SupportConversation')
      .update({ status: 'open', updatedAt: new Date().toISOString() })
      .eq('id', conversation.id)
      .select('*')
      .single<SupportConversationRow>();
    if (reopenError) throw new Error(reopenError.message);
    conversation = reopened;
  }

  const message = await appendSupportMessage({
    conversationId: conversation!.id,
    senderType: 'customer',
    senderId: context.uid,
    body: body!,
  });

  await broadcastSupportInboxChanged({ conversationId: conversation!.id });
  await broadcastSupportThreadChanged(conversation!.id, { messageId: message.id });

  return json(200, { data: { conversation, message } });
}
```

- [ ] **Step 3: `customerGetSupportThread`.**

```ts
if (action === 'customerGetSupportThread') {
  const { data: conversation, error: convError } = await serviceClient
    .from('SupportConversation')
    .select('*')
    .eq('customerId', context.uid)
    .maybeSingle<SupportConversationRow>();
  if (convError) throw new Error(convError.message);
  if (!conversation) {
    return json(200, { data: { conversation: null, messages: [] } });
  }
  const { data: messages, error: msgError } = await serviceClient
    .from('SupportMessage')
    .select('*')
    .eq('conversationId', conversation.id)
    .order('createdAt', { ascending: true });
  if (msgError) throw new Error(msgError.message);
  return json(200, { data: { conversation, messages: messages ?? [] } });
}
```

- [ ] **Step 4: `supportGetInbox`.**

```ts
if (action === 'supportGetInbox') {
  ensureRole(context.role, ['admin', 'support']);
  const status = sanitizeText(data.status);
  const scope = sanitizeText(data.scope) ?? 'all';

  let query = serviceClient
    .from('SupportConversation')
    .select('*')
    .order('lastMessageAt', { ascending: false });
  if (status && isSupportStatus(status)) query = query.eq('status', status);
  if (scope === 'mine') query = query.eq('assignedTo', context.uid);
  if (scope === 'unassigned') query = query.is('assignedTo', null);

  const { data: conversations, error } = await query.returns<SupportConversationRow[]>();
  if (error) throw new Error(error.message);

  // Attach customer display info for the list.
  const customerIds = Array.from(new Set((conversations ?? []).map((c) => c.customerId)));
  const { data: accounts } = customerIds.length
    ? await serviceClient.from('UserAccount').select('uid,displayName,email').in('uid', customerIds)
    : { data: [] as Array<{ uid: string; displayName: string | null; email: string }> };
  const byUid = new Map((accounts ?? []).map((a) => [a.uid, a]));

  const rows = (conversations ?? []).map((c) => ({
    ...c,
    customerName: byUid.get(c.customerId)?.displayName ?? byUid.get(c.customerId)?.email ?? c.customerId,
  }));
  return json(200, { data: { conversations: rows } });
}
```

- [ ] **Step 5: `supportGetConversation`.**

```ts
if (action === 'supportGetConversation') {
  ensureRole(context.role, ['admin', 'support']);
  const conversationId = sanitizeText(data.conversationId);
  if (!conversationId) fail(400, 'A conversationId is required.');

  const { data: conversation, error: convError } = await serviceClient
    .from('SupportConversation')
    .select('*')
    .eq('id', conversationId!)
    .maybeSingle<SupportConversationRow>();
  if (convError) throw new Error(convError.message);
  if (!conversation) fail(404, 'Conversation not found.');

  const { data: messages, error: msgError } = await serviceClient
    .from('SupportMessage')
    .select('*')
    .eq('conversationId', conversationId!)
    .order('createdAt', { ascending: true });
  if (msgError) throw new Error(msgError.message);
  return json(200, { data: { conversation, messages: messages ?? [] } });
}
```

- [ ] **Step 6: `supportSendAgentReply`** (with fan-out).

```ts
if (action === 'supportSendAgentReply') {
  ensureRole(context.role, ['admin', 'support']);
  const conversationId = sanitizeText(data.conversationId);
  const body = sanitizeText(data.body);
  if (!conversationId) fail(400, 'A conversationId is required.');
  if (!body) fail(400, 'A reply body is required.');

  const { data: conversation, error: convError } = await serviceClient
    .from('SupportConversation')
    .select('*')
    .eq('id', conversationId!)
    .maybeSingle<SupportConversationRow>();
  if (convError) throw new Error(convError.message);
  if (!conversation) fail(404, 'Conversation not found.');

  // Persist first so the reply is never lost, even if delivery fails.
  const message = await appendSupportMessage({
    conversationId: conversation!.id,
    senderType: 'agent',
    senderId: context.uid,
    body: body!,
  });

  // In-app: broadcast to the customer's thread + inbox.
  await broadcastSupportThreadChanged(conversation!.id, { messageId: message.id });
  await broadcastSupportInboxChanged({ conversationId: conversation!.id });

  // Email (best-effort).
  let emailSent = false;
  const recipient = await loadUserEmailRecipient(conversation!.customerId);
  if (recipient) {
    const html = buildTransactionalEmailHtml({
      heading: 'FEASTY Support replied',
      recipientName: recipient.displayName,
      lines: [body!, 'Reply to this message inside the FEASTY app to continue the conversation.'],
    });
    const res = await sendTransactionalEmail({ to: recipient.email, subject: 'FEASTY Support', html });
    emailSent = res.sent;
  }

  // Push (best-effort).
  let pushSent = false;
  try {
    const pushRes = await sendPushNotificationsToUsers([conversation!.customerId], {
      title: 'FEASTY Support',
      body: body!.length > 120 ? `${body!.slice(0, 117)}…` : body!,
      data: { type: 'support_reply', path: '/support', routeKey: 'customer_profile', app: 'customer' },
    });
    pushSent = pushRes.sent > 0;
  } catch (error) {
    console.error('Support push delivery failed.', error);
  }

  await serviceClient.from('SupportMessage').update({ emailSent, pushSent }).eq('id', message.id);

  return json(200, { data: { message: { ...message, emailSent, pushSent } } });
}
```

- [ ] **Step 7: `supportSetConversationStatus` + `supportAssignConversation`.**

```ts
if (action === 'supportSetConversationStatus') {
  ensureRole(context.role, ['admin', 'support']);
  const conversationId = sanitizeText(data.conversationId);
  const status = sanitizeText(data.status);
  if (!conversationId) fail(400, 'A conversationId is required.');
  if (!status || !isSupportStatus(status)) fail(400, 'A valid status is required.');

  const { data: conversation, error } = await serviceClient
    .from('SupportConversation')
    .update({ status: status!, updatedAt: new Date().toISOString() })
    .eq('id', conversationId!)
    .select('*')
    .single<SupportConversationRow>();
  if (error) throw new Error(error.message);
  await broadcastSupportInboxChanged({ conversationId: conversation.id });
  return json(200, { data: { conversation } });
}

if (action === 'supportAssignConversation') {
  ensureRole(context.role, ['admin', 'support']);
  const conversationId = sanitizeText(data.conversationId);
  if (!conversationId) fail(400, 'A conversationId is required.');
  const assignToRaw = sanitizeText(data.assignTo);
  const assignTo = assignToRaw === 'me' ? context.uid : assignToRaw; // 'me' convenience

  const { data: conversation, error } = await serviceClient
    .from('SupportConversation')
    .update({ assignedTo: assignTo, updatedAt: new Date().toISOString() })
    .eq('id', conversationId!)
    .select('*')
    .single<SupportConversationRow>();
  if (error) throw new Error(error.message);
  await broadcastSupportInboxChanged({ conversationId: conversation.id });
  return json(200, { data: { conversation } });
}
```

- [ ] **Step 8: Type-check.** Run:

```
deno check supabase/functions/app-rpc/index.ts
```
Expected: no errors. Fix any missing-import or type mismatches (confirm `sanitizeText`, `fail`, `json`, `ensureRole`, `serviceClient`, `context` are the in-file names — they are).

- [ ] **Step 9: Deploy the function.**

```
npx supabase functions deploy app-rpc
```
Expected: "Deployed Function app-rpc".

- [ ] **Step 10: Smoke test with a real token.** Sign in as the test customer in the app (or mint a JWT), then:

```
curl -s -X POST "$BACKEND_RPC_URL" -H "Authorization: Bearer $CUSTOMER_JWT" \
  -H "Content-Type: application/json" \
  -d '{"action":"customerSendSupportMessage","data":{"body":"Hi, my order is late"}}'
```
Expected: `{ "data": { "conversation": {...}, "message": {...} } }`. Then call `supportGetInbox` with a support JWT and confirm the conversation appears.

- [ ] **Step 11: Commit.**

```
git add supabase/functions/app-rpc/index.ts
git commit -m "feat(support): add customer + agent support RPC actions with email/push fan-out"
```

---

## Task 4: Admin inbox UI

Delivers: a working `/inbox` — live conversation list with filters, thread view, composer, assign/status/close actions.

**Files:**
- Create: `apps/admin-web/src/services/supportInbox.ts`
- Create: `apps/admin-web/src/lib/useSupportRealtime.ts`
- Replace: `apps/admin-web/src/pages/InboxPage.tsx` (from stub)

**Interfaces consumed:** `callAdminRpc` (`src/lib/rpc.ts`), `supabase` (`src/lib/supabase.ts`), existing components (`StatusBadge`, `EmptyState`, `LoadingBlock`, `ErrorBanner`), RPC actions from Task 3.

- [ ] **Step 1: Service layer + types.** Create `apps/admin-web/src/services/supportInbox.ts`:

```ts
import { callAdminRpc } from '../lib/rpc';

export type SupportStatus = 'open' | 'pending' | 'closed';
export interface InboxConversation {
  id: string; customerId: string; customerName: string;
  subject: string | null; status: SupportStatus;
  assignedTo: string | null; lastMessageAt: string;
}
export interface SupportMessage {
  id: string; conversationId: string;
  senderType: 'customer' | 'agent' | 'system';
  senderId: string | null; body: string;
  emailSent: boolean; pushSent: boolean; createdAt: string;
}

export const getInbox = (params: { status?: SupportStatus; scope?: 'mine' | 'unassigned' | 'all' }) =>
  callAdminRpc<{ conversations: InboxConversation[] }>('supportGetInbox', params);
export const getConversation = (conversationId: string) =>
  callAdminRpc<{ conversation: InboxConversation; messages: SupportMessage[] }>('supportGetConversation', { conversationId });
export const sendAgentReply = (conversationId: string, body: string) =>
  callAdminRpc<{ message: SupportMessage }>('supportSendAgentReply', { conversationId, body });
export const setStatus = (conversationId: string, status: SupportStatus) =>
  callAdminRpc<{ conversation: InboxConversation }>('supportSetConversationStatus', { conversationId, status });
export const assignConversation = (conversationId: string, assignTo: string | null | 'me') =>
  callAdminRpc<{ conversation: InboxConversation }>('supportAssignConversation', { conversationId, assignTo });
```

- [ ] **Step 2: Realtime hook.** Create `apps/admin-web/src/lib/useSupportRealtime.ts` — subscribe to the `support-inbox` broadcast topic and invoke a callback on any event:

```ts
import { useEffect } from 'react';
import { supabase } from './supabase';

export function useSupportRealtime(onChange: () => void) {
  useEffect(() => {
    const channel = supabase
      .channel('support-inbox')
      .on('broadcast', { event: 'changed' }, () => onChange())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [onChange]);
}
```
(If the existing orders realtime uses a different event name than `changed`, match it — see how `OrdersPage`/`SnapshotContext` subscribes.)

- [ ] **Step 3: Inbox page.** Replace `apps/admin-web/src/pages/InboxPage.tsx` with a two-pane layout. Reuse existing components and CSS classes. Full implementation:

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import EmptyState from '../components/EmptyState';
import ErrorBanner from '../components/ErrorBanner';
import LoadingBlock from '../components/LoadingBlock';
import StatusBadge from '../components/StatusBadge';
import { useSupportRealtime } from '../lib/useSupportRealtime';
import {
  assignConversation, getConversation, getInbox, sendAgentReply, setStatus,
  type InboxConversation, type SupportMessage, type SupportStatus,
} from '../services/supportInbox';

const STATUS_FILTERS: Array<SupportStatus | 'all'> = ['open', 'pending', 'closed', 'all'];

export default function InboxPage() {
  const [statusFilter, setStatusFilter] = useState<SupportStatus | 'all'>('open');
  const [conversations, setConversations] = useState<InboxConversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [reply, setReply] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const loadInbox = useCallback(async () => {
    try {
      const res = await getInbox({ status: statusFilter === 'all' ? undefined : statusFilter, scope: 'all' });
      setConversations(res.conversations);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load the inbox.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  const loadThread = useCallback(async (id: string) => {
    const res = await getConversation(id);
    setMessages(res.messages);
  }, []);

  useEffect(() => { void loadInbox(); }, [loadInbox]);
  useEffect(() => { if (selectedId) void loadThread(selectedId); }, [selectedId, loadThread]);
  useSupportRealtime(useCallback(() => {
    void loadInbox();
    if (selectedId) void loadThread(selectedId);
  }, [loadInbox, loadThread, selectedId]));

  const selected = useMemo(
    () => conversations.find((c) => c.id === selectedId) ?? null,
    [conversations, selectedId]
  );

  const onSend = async () => {
    if (!selectedId || !reply.trim()) return;
    setSending(true);
    try {
      await sendAgentReply(selectedId, reply.trim());
      setReply('');
      await loadThread(selectedId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to send the reply.');
    } finally {
      setSending(false);
    }
  };

  const onStatus = async (status: SupportStatus) => {
    if (!selectedId) return;
    await setStatus(selectedId, status);
    await loadInbox();
  };
  const onAssignMe = async () => {
    if (!selectedId) return;
    await assignConversation(selectedId, 'me');
    await loadInbox();
  };

  return (
    <section className="page inbox-page">
      <div className="inbox-list">
        <div className="inbox-filters">
          {STATUS_FILTERS.map((s) => (
            <button key={s} type="button"
              className={`btn btn-ghost ${statusFilter === s ? 'active' : ''}`}
              onClick={() => setStatusFilter(s)}>{s}</button>
          ))}
        </div>
        {loading ? <LoadingBlock label="Loading inbox…" /> : null}
        {error ? <ErrorBanner message={error} /> : null}
        {!loading && conversations.length === 0
          ? <EmptyState title="No conversations" />
          : conversations.map((c) => (
            <button key={c.id} type="button"
              className={`card inbox-item ${selectedId === c.id ? 'selected' : ''}`}
              onClick={() => setSelectedId(c.id)}>
              <div className="inbox-item-head">
                <span>{c.customerName}</span>
                <StatusBadge status={c.status} />
              </div>
              <div className="muted">{new Date(c.lastMessageAt).toLocaleString()}</div>
            </button>
          ))}
      </div>

      <div className="inbox-thread">
        {!selected ? <EmptyState title="Select a conversation" /> : (
          <>
            <header className="inbox-thread-head">
              <h3>{selected.customerName}</h3>
              <div className="inbox-actions">
                <button className="btn btn-ghost" onClick={() => void onAssignMe()}>Assign to me</button>
                <button className="btn btn-ghost" onClick={() => void onStatus('pending')}>Pending</button>
                <button className="btn btn-ghost" onClick={() => void onStatus('closed')}>Close</button>
                <button className="btn btn-ghost" onClick={() => void onStatus('open')}>Reopen</button>
              </div>
            </header>
            <div className="inbox-messages">
              {messages.map((m) => (
                <div key={m.id} className={`bubble bubble-${m.senderType}`}>
                  <p>{m.body}</p>
                  <span className="muted">{new Date(m.createdAt).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
            <div className="inbox-composer">
              <textarea value={reply} onChange={(e) => setReply(e.target.value)}
                placeholder="Type a reply…" rows={3} />
              <button className="btn btn-primary" disabled={sending || !reply.trim()} onClick={() => void onSend()}>
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Styles.** Add the `inbox-*` and `bubble-*` classes to `apps/admin-web/src/styles/global.css` (two-column grid for `.inbox-page`, scrollable `.inbox-messages`, right-align `.bubble-agent`, left-align `.bubble-customer`). Match the existing card/spacing tokens already in that file.

- [ ] **Step 5: Verify.** Run:

```
npm --prefix apps/admin-web run typecheck
npm --prefix apps/admin-web run dev
```
Then use the preview workflow: sign in as the test **support** user, open `/inbox`, confirm the conversation from Task 3 appears, open it, send a reply, and confirm it renders and (via Task 3) the customer row updates. Check the browser console/network for errors.

- [ ] **Step 6: Commit.**

```
git add apps/admin-web/src
git commit -m "feat(support): admin inbox page with live list, thread, replies, and actions"
```

---

## Task 5: Customer support screen (Expo)

Delivers: customers can open a Support screen, send a message, and receive agent replies live (in-app), plus push (from Task 3).

**Files:**
- Create: `apps/customer/src/services/customerSupport.ts`
- Create: `apps/customer/src/hooks/useSupportThreadRealtime.ts`
- Create: `apps/customer/app/(customer)/support.tsx`
- Modify: a profile/menu screen to add a "Help & Support" link; ensure `(customer)/_layout.tsx` registers the route if it uses an explicit `<Stack.Screen>` list.

**Interfaces consumed:** `callCustomerBackendRpc` (`src/services/backendRpc.ts`), `supabase` client (`src/services/supabase/config`), existing theme (`src/theme/palette`), Expo Router.

- [ ] **Step 1: Service layer.** Create `apps/customer/src/services/customerSupport.ts`:

```ts
import { callCustomerBackendRpc } from './backendRpc';

export interface SupportConversation {
  id: string; status: 'open' | 'pending' | 'closed'; lastMessageAt: string;
}
export interface SupportMessage {
  id: string; conversationId: string;
  senderType: 'customer' | 'agent' | 'system'; body: string; createdAt: string;
}

export const getSupportThread = () =>
  callCustomerBackendRpc<{ conversation: SupportConversation | null; messages: SupportMessage[] }>(
    'customerGetSupportThread'
  );
export const sendSupportMessage = (body: string) =>
  callCustomerBackendRpc<{ conversation: SupportConversation; message: SupportMessage }>(
    'customerSendSupportMessage', { body }
  );
```

- [ ] **Step 2: Realtime hook.** Create `apps/customer/src/hooks/useSupportThreadRealtime.ts`:

```ts
import { useEffect } from 'react';
import { supabase } from '../services/supabase/config';

export function useSupportThreadRealtime(conversationId: string | null, onChange: () => void) {
  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase
      .channel(`support-${conversationId}`)
      .on('broadcast', { event: 'changed' }, () => onChange())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [conversationId, onChange]);
}
```
(Match the broadcast `event` name to whatever the customer app already uses for order realtime.)

- [ ] **Step 3: Support screen.** Create `apps/customer/app/(customer)/support.tsx` — a chat view (FlatList of messages + input + send). Follow the styling/patterns of an existing `(customer)` screen (e.g. `cart.tsx`) for header, safe-area, theme colors, and `KeyboardAvoidingView`. Core logic:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { getSupportThread, sendSupportMessage, type SupportMessage } from '../../src/services/customerSupport';
import { useSupportThreadRealtime } from '../../src/hooks/useSupportThreadRealtime';

export default function SupportScreen() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    const res = await getSupportThread();
    setConversationId(res.conversation?.id ?? null);
    setMessages(res.messages);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useSupportThreadRealtime(conversationId, load);

  const onSend = async () => {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    try {
      const res = await sendSupportMessage(body);
      setConversationId(res.conversation.id);
      setDraft('');
      await load();
    } finally {
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <FlatList
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => (
          <View style={{ alignSelf: item.senderType === 'customer' ? 'flex-end' : 'flex-start', margin: 8 }}>
            <Text>{item.body}</Text>
          </View>
        )}
        ListEmptyComponent={<Text style={{ textAlign: 'center', margin: 24 }}>Send us a message and our team will reply.</Text>}
      />
      <View style={{ flexDirection: 'row', padding: 8 }}>
        <TextInput style={{ flex: 1 }} value={draft} onChangeText={setDraft} placeholder="Type a message…" />
        <TouchableOpacity disabled={sending || !draft.trim()} onPress={() => void onSend()}>
          <Text>Send</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}
```
Apply the app's real theme/components rather than these bare styles; the logic (load → realtime → send → reload) is the contract.

- [ ] **Step 4: Entry point.** Add a "Help & Support" row that routes to `/support` on the customer profile/menu screen (locate the profile screen; the app uses Expo Router `router.push('/support')`). If `(customer)/_layout.tsx` enumerates screens explicitly, register `support`.

- [ ] **Step 5: Verify.** Run:

```
npm --prefix apps/customer run typecheck
npm --prefix apps/customer run lint
```
Then run the app (Expo) on web or a device, open Support, send a message; confirm it appears, and that a reply sent from the admin inbox (Task 4) arrives live and as a push.

- [ ] **Step 6: Commit.**

```
git add apps/customer
git commit -m "feat(support): customer support screen with live thread and messaging"
```

---

## Task 6: End-to-end verification + docs

Delivers: a proven round-trip and updated docs.

- [ ] **Step 1: Full round-trip.** With the customer app and admin inbox both open: customer sends → appears in inbox live → support replies → customer receives it in-app (live) + email (check inbox) + push. Then exercise status open→pending→closed and "assign to me". Confirm a closed thread reopens when the customer sends again.

- [ ] **Step 2: RLS spot-check.** As a normal authenticated (non-support) user, attempt a direct REST select on `SupportConversation` (e.g. via the app's anon client) and confirm zero rows / denied — proving access is only via `app-rpc`.

- [ ] **Step 3: Update docs.** In `docs/idea-book.md`, set the Phase 1 line to done and note the deploy date; in `docs/superpowers/specs/2026-07-07-support-inbox-phase1-design.md`, flip Status to "Implemented". 

- [ ] **Step 4: Commit + open PR.**

```
git add docs
git commit -m "docs(support): mark support inbox phase 1 implemented"
```
Then open a PR from `feature/support-inbox-phase1` into `main`.

---

## Self-Review notes (spec coverage)

- One-thread-per-customer, statuses open/pending/closed → Task 2 (UNIQUE) + Task 3 (`customerSendSupportMessage` reopen logic, `isSupportStatus`).
- Dedicated support role, inbox-only nav → Task 1.
- Reply fan-out email+in-app+push with per-channel flags → Task 3 Step 6.
- Admin inbox list/thread/assign/status → Task 4.
- Customer support screen live → Task 5.
- RLS-locked tables, all access via app-rpc → Task 2 + Task 6 Step 2.
- Realtime via existing Broadcast helper → Task 2 Step 6, consumed in Tasks 4–5.
- Deferred (inbound email, WhatsApp, bulk) → explicitly out of scope; not in any task.
