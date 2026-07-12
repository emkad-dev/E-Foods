# Auth Gateway Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Supabase edge-function gateway that hardens credential auth (signup/login/logout/refresh) around GoTrue with server-side validation, rate limiting, safe errors, hashed audit logging, and a reusable RBAC guard — plus a drop-in client SDK. App screens are not touched.

**Architecture:** A new Deno edge function `auth-gateway` fronts GoTrue's REST API. It validates input, applies Postgres-backed per-IP/per-email rate limiting, maps all failures to non-enumerable messages, writes a hashed audit row, then forwards to GoTrue (which keeps owning bcrypt hashing, JWT issuance, and refresh rotation). Pure logic (validation, error mapping, rate-limit key hashing, role checks) lives in separately unit-tested modules; the handler only wires them together. A client SDK in `packages/auth` calls the gateway and returns the existing Supabase session shape.

**Tech Stack:** Deno edge functions (`Deno.serve`), Supabase GoTrue REST, Postgres (SQL migration + `SECURITY DEFINER` RPC), TypeScript, `deno test`.

## Global Constraints

- Keep Supabase Auth (GoTrue); never re-implement hashing or token issuance — the gateway only wraps it.
- Password policy: **≥ 6 characters, at least one uppercase, one lowercase, one digit** (matches the existing Supabase min-length of 6; complexity is the added hardening).
- Preserve the existing **email-confirmation** flow on signup.
- Refresh **rotation + reuse detection is a GoTrue project setting** — the gateway relies on it; document verifying it, do not re-implement it.
- **Never log** request bodies, `Authorization` headers, `password`, `access_token`, or `refresh_token`. Audit rows store only hashed subject/IP.
- All new SQL is parameterized; the rate-limit RPC is `SECURITY DEFINER` and executable **only** by `service_role`.
- Roles are the five in `packages/domain/src/roles.ts`: `customer`, `restaurant`, `dispatch`, `admin`, `support`.
- Reuse existing shared helpers: `_shared/observability.ts` (`ClientSafeError`, `clientErrorMessage`, `getErrorStatus`, `jsonResponse`, `createEdgeObservation`, `finishEdgeObservation`, `logEdgeEvent`), `_shared/cors.ts` (`corsHeaders`), `_shared/client.ts` (`serviceClient`). Follow the `Deno.serve` handler shape used in `supabase/functions/app-rpc/index.ts`.
- New secret: `AUTH_HASH_SALT` (server-side salt for hashing audit subject/IP and rate-limit keys). GoTrue REST needs `SUPABASE_URL` (present) and an anon key read as `Deno.env.get('ANON_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY')`.
- Edge tests follow the colocated `*.test.ts` + pure-module pattern of `supabase/functions/payment-verification/invariants.test.ts`; run with `deno test`.
- Commit each task separately, staging files **by explicit path** (never `git add -A` / `git add .` — the working tree has unrelated staged WIP).

---

## File Structure

- `supabase/migrations/20260712_auth_gateway.sql` — `auth_rate_limits`, `auth_audit_log` tables + `auth_rl_hit` RPC.
- `supabase/functions/_shared/validation.ts` (+ `validation.test.ts`) — email + password validation (pure).
- `supabase/functions/_shared/roles.ts` — `APP_ROLES` mirror + `isAppRole` / `roleFromClaims` / `hasAllowedRole` (pure).
- `supabase/functions/_shared/requireRole.ts` (+ `requireRole.test.ts`) — RBAC guard (network wrapper + pure core).
- `supabase/functions/auth-gateway/hash.ts` (+ `hash.test.ts`) — salted key/subject hashing + redaction helper (pure).
- `supabase/functions/auth-gateway/errors.ts` (+ `errors.test.ts`) — safe non-enumerable error mapping (pure).
- `supabase/functions/auth-gateway/ratelimit.ts` — thin `auth_rl_hit` RPC caller + policy constants.
- `supabase/functions/auth-gateway/audit.ts` — hashed audit-row writer.
- `supabase/functions/auth-gateway/gotrue.ts` — thin GoTrue REST fetch wrappers.
- `supabase/functions/auth-gateway/router.ts` (+ `router.test.ts`) — pure request-path → route parser + client-IP extractor.
- `supabase/functions/auth-gateway/index.ts` — `Deno.serve` handler wiring everything.
- `supabase/config.toml` — add `[functions.auth-gateway] verify_jwt = false`.
- `packages/auth/src/gatewayAuth.ts` — client SDK (`signUp/signIn/signOut/refresh`); exported from `packages/auth/src/index.ts`.
- `docs/superpowers/auth-gateway-operations.md` — secrets, refresh-rotation verification, deploy notes.

---

## Task 1: Database migration (rate-limit + audit tables, RPC)

**Files:**
- Create: `supabase/migrations/20260712_auth_gateway.sql`

**Interfaces:**
- Produces: RPC `public.auth_rl_hit(p_key text, p_limit int, p_window_secs int, p_lockout_secs int)` returning `table(allowed boolean, retry_after int)`; tables `public.auth_rate_limits(key text pk, window_start timestamptz, count int, locked_until timestamptz)` and `public.auth_audit_log(id bigserial pk, event text, subject_hash text, ip_hash text, success boolean, reason text, created_at timestamptz)`.

- [ ] **Step 1: Write the migration**

```sql
-- Auth gateway: rate-limit + audit infrastructure.
-- Service-role mediated only (edge function). No RLS policies => anon/authenticated see nothing.

create table if not exists public.auth_rate_limits (
  key          text primary key,
  window_start timestamptz not null default now(),
  count        integer     not null default 0,
  locked_until timestamptz
);

create table if not exists public.auth_audit_log (
  id           bigserial primary key,
  event        text        not null,          -- 'signup' | 'login' | 'logout' | 'refresh'
  subject_hash text,                          -- hashed email; never raw
  ip_hash      text,                          -- hashed client IP; never raw
  success      boolean     not null,
  reason       text,                          -- coarse reason code, never secrets
  created_at   timestamptz not null default now()
);

create index if not exists auth_audit_log_event_idx    on public.auth_audit_log (event);
create index if not exists auth_audit_log_created_idx   on public.auth_audit_log (created_at);
create index if not exists auth_rate_limits_locked_idx  on public.auth_rate_limits (locked_until);

alter table public.auth_rate_limits enable row level security;
alter table public.auth_audit_log   enable row level security;

-- Atomic fixed-window counter with lockout. Every argument is parameterized.
create or replace function public.auth_rl_hit(
  p_key text,
  p_limit int,
  p_window_secs int,
  p_lockout_secs int
) returns table(allowed boolean, retry_after int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_row public.auth_rate_limits;
begin
  insert into public.auth_rate_limits(key, window_start, count)
    values (p_key, v_now, 0)
    on conflict (key) do nothing;

  select * into v_row from public.auth_rate_limits where key = p_key for update;

  if v_row.locked_until is not null and v_row.locked_until > v_now then
    return query select false, greatest(1, ceil(extract(epoch from (v_row.locked_until - v_now)))::int);
    return;
  end if;

  if v_row.window_start + make_interval(secs => p_window_secs) <= v_now then
    v_row.window_start := v_now;
    v_row.count := 0;
    v_row.locked_until := null;
  end if;

  v_row.count := v_row.count + 1;

  if v_row.count > p_limit then
    v_row.locked_until := v_now + make_interval(secs => p_lockout_secs);
    update public.auth_rate_limits
      set window_start = v_row.window_start, count = v_row.count, locked_until = v_row.locked_until
      where key = p_key;
    return query select false, p_lockout_secs;
    return;
  end if;

  update public.auth_rate_limits
    set window_start = v_row.window_start, count = v_row.count, locked_until = null
    where key = p_key;
  return query select true, 0;
end;
$$;

revoke all on function public.auth_rl_hit(text, int, int, int) from public;
grant execute on function public.auth_rl_hit(text, int, int, int) to service_role;
```

- [ ] **Step 2: Verify the migration applies and the RPC behaves**

Apply against a local or branch database, then call the RPC 3× with `p_limit => 2` and confirm the 3rd call returns `allowed = false`.

Run (local CLI):
```bash
supabase db reset            # or: supabase migration up
```
Then, via the SQL editor / `supabase` MCP `execute_sql`:
```sql
select * from public.auth_rl_hit('t:demo', 2, 60, 120);  -- allowed=true, retry_after=0
select * from public.auth_rl_hit('t:demo', 2, 60, 120);  -- allowed=true
select * from public.auth_rl_hit('t:demo', 2, 60, 120);  -- allowed=false, retry_after=120
```
Expected: first two `allowed=true`, third `allowed=false, retry_after=120`. Clean up: `delete from public.auth_rate_limits where key = 't:demo';`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260712_auth_gateway.sql
git commit -m "feat(auth): rate-limit + audit tables and auth_rl_hit RPC"
```

---

## Task 2: Input validation module

**Files:**
- Create: `supabase/functions/_shared/validation.ts`
- Test: `supabase/functions/_shared/validation.test.ts`

**Interfaces:**
- Produces: `validateEmail(raw: unknown): string` (returns normalized lowercased email or throws `ClientSafeError(400, ...)`); `validatePassword(raw: unknown): string` (returns the password or throws `ClientSafeError(400, ...)`).

- [ ] **Step 1: Write the failing test**

```ts
// validation.test.ts
import { validateEmail, validatePassword } from './validation.ts';

const throws = (work: () => void, needle: string) => {
  try { work(); } catch (e) { if (e instanceof Error && e.message.includes(needle)) return; throw e; }
  throw new Error(`Expected error containing "${needle}"`);
};

Deno.test('validateEmail normalizes valid email', () => {
  if (validateEmail('  User@Example.COM ') !== 'user@example.com') throw new Error('should normalize');
});
Deno.test('validateEmail rejects malformed', () => throws(() => validateEmail('not-an-email'), 'valid email'));
Deno.test('validateEmail rejects non-string', () => throws(() => validateEmail(42), 'valid email'));

Deno.test('validatePassword accepts compliant', () => {
  if (validatePassword('Abc123') !== 'Abc123') throw new Error('should accept');
});
Deno.test('validatePassword rejects too short', () => throws(() => validatePassword('Ab1'), 'at least 6'));
Deno.test('validatePassword rejects missing digit', () => throws(() => validatePassword('Abcdef'), 'number'));
Deno.test('validatePassword rejects missing uppercase', () => throws(() => validatePassword('abc123'), 'uppercase'));
Deno.test('validatePassword rejects missing lowercase', () => throws(() => validatePassword('ABC123'), 'lowercase'));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test supabase/functions/_shared/validation.test.ts`
Expected: FAIL — cannot resolve `./validation.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// validation.ts
import { ClientSafeError } from './observability.ts';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const validateEmail = (raw: unknown): string => {
  if (typeof raw !== 'string') throw new ClientSafeError(400, 'Enter a valid email address.');
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) {
    throw new ClientSafeError(400, 'Enter a valid email address.');
  }
  return email;
};

export const validatePassword = (raw: unknown): string => {
  if (typeof raw !== 'string' || raw.length < 6) {
    throw new ClientSafeError(400, 'Password must be at least 6 characters.');
  }
  if (!/[A-Z]/.test(raw)) throw new ClientSafeError(400, 'Password must include an uppercase letter.');
  if (!/[a-z]/.test(raw)) throw new ClientSafeError(400, 'Password must include a lowercase letter.');
  if (!/[0-9]/.test(raw)) throw new ClientSafeError(400, 'Password must include a number.');
  return raw;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test supabase/functions/_shared/validation.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/validation.ts supabase/functions/_shared/validation.test.ts
git commit -m "feat(auth): shared email + password validation"
```

---

## Task 3: RBAC role guard

**Files:**
- Create: `supabase/functions/_shared/roles.ts`
- Create: `supabase/functions/_shared/requireRole.ts`
- Test: `supabase/functions/_shared/requireRole.test.ts`

**Interfaces:**
- Consumes: `verifySupabaseJwt` from `_shared/auth.ts` (returns `{ claims: Record<string, unknown>, token }`), `ClientSafeError` from `_shared/observability.ts`.
- Produces: `APP_ROLES` (`readonly string[]`), `roleFromClaims(claims): string | null`, `hasAllowedRole(claims, allowed): boolean`; `requireRole(request: Request, allowed: readonly string[]): Promise<{ claims: Record<string, unknown>; token: string; role: string }>` (throws `ClientSafeError(401)` if unauthenticated, `ClientSafeError(403)` if role not allowed).

- [ ] **Step 1: Write `roles.ts` (no test needed — trivial constants + pure helpers covered via requireRole.test)**

```ts
// roles.ts — mirrors packages/domain/src/roles.ts (Deno cannot import the monorepo package).
export const APP_ROLES = ['customer', 'restaurant', 'dispatch', 'admin', 'support'] as const;
export type AppRole = (typeof APP_ROLES)[number];

export const isAppRole = (v: unknown): v is AppRole =>
  typeof v === 'string' && (APP_ROLES as readonly string[]).includes(v);

export const roleFromClaims = (claims: Record<string, unknown>): string | null => {
  const candidate = claims['user_role'] ?? claims['role'] ?? claims['app_role'];
  return isAppRole(candidate) ? candidate : null;
};

export const hasAllowedRole = (claims: Record<string, unknown>, allowed: readonly string[]): boolean => {
  const role = roleFromClaims(claims);
  return role !== null && allowed.includes(role);
};
```

- [ ] **Step 2: Write the failing test (covers the pure core)**

```ts
// requireRole.test.ts
import { hasAllowedRole, roleFromClaims } from './roles.ts';

Deno.test('roleFromClaims reads user_role', () => {
  if (roleFromClaims({ user_role: 'admin' }) !== 'admin') throw new Error('should read admin');
});
Deno.test('roleFromClaims rejects unknown role', () => {
  if (roleFromClaims({ user_role: 'wizard' }) !== null) throw new Error('should be null');
});
Deno.test('hasAllowedRole true when allowed', () => {
  if (!hasAllowedRole({ role: 'support' }, ['admin', 'support'])) throw new Error('should allow');
});
Deno.test('hasAllowedRole false when not allowed', () => {
  if (hasAllowedRole({ role: 'customer' }, ['admin'])) throw new Error('should deny');
});
Deno.test('hasAllowedRole false when no role claim', () => {
  if (hasAllowedRole({}, ['admin'])) throw new Error('should deny');
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `deno test supabase/functions/_shared/requireRole.test.ts`
Expected: FAIL — cannot resolve `./roles.ts`.

- [ ] **Step 4: Write `requireRole.ts` and re-run to pass**

```ts
// requireRole.ts
import { verifySupabaseJwt } from './auth.ts';
import { ClientSafeError } from './observability.ts';
import { hasAllowedRole, roleFromClaims } from './roles.ts';

export { APP_ROLES, hasAllowedRole, roleFromClaims } from './roles.ts';

export const requireRole = async (request: Request, allowed: readonly string[]) => {
  const { claims, token } = await verifySupabaseJwt(request); // throws ClientSafeError(401) itself
  if (!hasAllowedRole(claims, allowed)) {
    throw new ClientSafeError(403, 'You do not have permission to perform this action.');
  }
  return { claims, token, role: roleFromClaims(claims) as string };
};
```

Run: `deno test supabase/functions/_shared/requireRole.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/roles.ts supabase/functions/_shared/requireRole.ts supabase/functions/_shared/requireRole.test.ts
git commit -m "feat(auth): reusable RBAC role guard for edge functions"
```

---

## Task 4: Hashing + redaction helpers

**Files:**
- Create: `supabase/functions/auth-gateway/hash.ts`
- Test: `supabase/functions/auth-gateway/hash.test.ts`

**Interfaces:**
- Produces: `hashValue(value: string): Promise<string>` (HMAC-SHA-256 hex of `value` keyed by `AUTH_HASH_SALT`; stable for equal inputs, differs for different inputs); `SENSITIVE_KEYS: Set<string>`; `redact(obj: Record<string, unknown>): Record<string, unknown>` (replaces sensitive keys with `'[redacted]'`).

- [ ] **Step 1: Write the failing test**

```ts
// hash.test.ts
import { hashValue, redact } from './hash.ts';

Deno.env.set('AUTH_HASH_SALT', 'test-salt');

Deno.test('hashValue is stable and non-reversible-looking', async () => {
  const a = await hashValue('user@example.com');
  const b = await hashValue('user@example.com');
  if (a !== b) throw new Error('should be stable');
  if (a.includes('user@example.com')) throw new Error('should not contain input');
  if (a.length !== 64) throw new Error('should be 64 hex chars');
});
Deno.test('hashValue differs for different inputs', async () => {
  if (await hashValue('a@x.com') === await hashValue('b@x.com')) throw new Error('should differ');
});
Deno.test('redact masks sensitive keys', () => {
  const out = redact({ email: 'e', password: 'p', access_token: 't', refresh_token: 'r' });
  if (out.password !== '[redacted]' || out.access_token !== '[redacted]' || out.refresh_token !== '[redacted]') {
    throw new Error('should redact secrets');
  }
  if (out.email !== 'e') throw new Error('non-secret preserved');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-env supabase/functions/auth-gateway/hash.test.ts`
Expected: FAIL — cannot resolve `./hash.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// hash.ts
/// <reference path="../_shared/edge-runtime.d.ts" />

const salt = () => Deno.env.get('AUTH_HASH_SALT') ?? '';

export const hashValue = async (value: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(salt()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

export const SENSITIVE_KEYS = new Set(['password', 'access_token', 'refresh_token', 'authorization']);

export const redact = (obj: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? '[redacted]' : v;
  }
  return out;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --allow-env supabase/functions/auth-gateway/hash.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/auth-gateway/hash.ts supabase/functions/auth-gateway/hash.test.ts
git commit -m "feat(auth): salted hashing + log redaction helpers"
```

---

## Task 5: Safe error mapping + route parser

**Files:**
- Create: `supabase/functions/auth-gateway/errors.ts`
- Test: `supabase/functions/auth-gateway/errors.test.ts`
- Create: `supabase/functions/auth-gateway/router.ts`
- Test: `supabase/functions/auth-gateway/router.test.ts`

**Interfaces:**
- Produces: `safeAuthMessage(kind: 'login' | 'signup' | 'refresh' | 'logout', gotrueStatus: number): string` (never reveals whether an account exists); `parseRoute(url: string): 'signup' | 'login' | 'logout' | 'refresh' | null`; `clientIp(request: Request): string`.

- [ ] **Step 1: Write the failing tests**

```ts
// errors.test.ts
import { safeAuthMessage } from './errors.ts';
Deno.test('login errors are non-enumerable', () => {
  if (safeAuthMessage('login', 400) !== safeAuthMessage('login', 403)) throw new Error('must not vary by status');
  if (!safeAuthMessage('login', 400).includes('Incorrect email or password')) throw new Error('generic login msg');
});
Deno.test('signup 422 maps to already-exists-safe message', () => {
  if (!safeAuthMessage('signup', 422).toLowerCase().includes('could not')) throw new Error('safe signup msg');
});
```

```ts
// router.test.ts
import { parseRoute } from './router.ts';
Deno.test('parseRoute maps known paths', () => {
  if (parseRoute('https://x.fn/auth-gateway/login') !== 'login') throw new Error('login');
  if (parseRoute('https://x.fn/auth-gateway/signup') !== 'signup') throw new Error('signup');
  if (parseRoute('https://x.fn/auth-gateway/logout') !== 'logout') throw new Error('logout');
  if (parseRoute('https://x.fn/auth-gateway/refresh') !== 'refresh') throw new Error('refresh');
});
Deno.test('parseRoute returns null for unknown', () => {
  if (parseRoute('https://x.fn/auth-gateway/admin') !== null) throw new Error('null');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test supabase/functions/auth-gateway/errors.test.ts supabase/functions/auth-gateway/router.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write minimal implementations**

```ts
// errors.ts
type Kind = 'login' | 'signup' | 'refresh' | 'logout';

// Deliberately NOT keyed on whether the account exists — same message for
// wrong-password and unknown-user so accounts cannot be enumerated.
export const safeAuthMessage = (kind: Kind, _gotrueStatus: number): string => {
  switch (kind) {
    case 'login':   return 'Incorrect email or password.';
    case 'signup':  return 'We could not create your account. Please try again.';
    case 'refresh': return 'Your session has expired. Please sign in again.';
    case 'logout':  return 'Could not sign you out. Please try again.';
  }
};
```

```ts
// router.ts
export type AuthRoute = 'signup' | 'login' | 'logout' | 'refresh';

export const parseRoute = (url: string): AuthRoute | null => {
  const seg = new URL(url).pathname.split('/').filter(Boolean).pop();
  return seg === 'signup' || seg === 'login' || seg === 'logout' || seg === 'refresh' ? seg : null;
};

export const clientIp = (request: Request): string => {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test supabase/functions/auth-gateway/errors.test.ts supabase/functions/auth-gateway/router.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/auth-gateway/errors.ts supabase/functions/auth-gateway/errors.test.ts supabase/functions/auth-gateway/router.ts supabase/functions/auth-gateway/router.test.ts
git commit -m "feat(auth): non-enumerable error mapping + route parsing"
```

---

## Task 6: Rate-limit caller, audit writer, GoTrue client

**Files:**
- Create: `supabase/functions/auth-gateway/ratelimit.ts`
- Create: `supabase/functions/auth-gateway/audit.ts`
- Create: `supabase/functions/auth-gateway/gotrue.ts`

**Interfaces:**
- Consumes: `serviceClient` (`_shared/client.ts`), `hashValue` (`./hash.ts`), `logEdgeEvent`, `ClientSafeError` (`_shared/observability.ts`), `clientIp` (`./router.ts`).
- Produces:
  - `enforceRateLimit(rawKey: string, policy: RlPolicy): Promise<void>` — throws `ClientSafeError(429, ...)` when blocked; `RlPolicy = { limit: number; windowSecs: number; lockoutSecs: number }`; `POLICIES = { ipGeneral, loginFailure, signupPerIp, refreshPerIp }`.
  - `writeAudit(input: { event: string; email?: string; ip: string; success: boolean; reason?: string }): Promise<void>` — hashes email+ip, never throws (best-effort).
  - `gotrue.signUp(email, password)`, `gotrue.passwordGrant(email, password)`, `gotrue.refresh(refreshToken)`, `gotrue.logout(accessToken)` — each returns `{ ok: boolean; status: number; body: unknown }`.

> No unit tests: these are thin I/O wrappers over Postgres/HTTP with no branching logic worth isolating (the branching logic they use — hashing, policies, error mapping — is tested in Tasks 4–5). They are exercised by the Task 7 handler and the Task 9 manual smoke test.

- [ ] **Step 1: Write `ratelimit.ts`**

```ts
// ratelimit.ts
import { serviceClient } from '../_shared/client.ts';
import { ClientSafeError, logEdgeEvent } from '../_shared/observability.ts';
import { hashValue } from './hash.ts';

export type RlPolicy = { limit: number; windowSecs: number; lockoutSecs: number };

export const POLICIES = {
  ipGeneral:    { limit: 30, windowSecs: 600, lockoutSecs: 600 } as RlPolicy,  // per-IP ceiling
  loginFailure: { limit: 5,  windowSecs: 600, lockoutSecs: 900 } as RlPolicy,  // 5 fails/10m -> 15m lock
  signupPerIp:  { limit: 10, windowSecs: 3600, lockoutSecs: 900 } as RlPolicy,
  refreshPerIp: { limit: 60, windowSecs: 600, lockoutSecs: 300 } as RlPolicy,
};

export const enforceRateLimit = async (rawKey: string, policy: RlPolicy): Promise<void> => {
  const key = await hashValue(rawKey);
  const { data, error } = await serviceClient.rpc('auth_rl_hit', {
    p_key: key,
    p_limit: policy.limit,
    p_window_secs: policy.windowSecs,
    p_lockout_secs: policy.lockoutSecs,
  });
  if (error) {
    // Fail open on infra error, but log it — do not block legitimate users if the RPC is down.
    logEdgeEvent('error', 'rate limit RPC failed', { reason: error.message });
    return;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (row && row.allowed === false) {
    throw new ClientSafeError(429, 'Too many attempts. Please try again later.');
  }
};
```

- [ ] **Step 2: Write `audit.ts`**

```ts
// audit.ts
import { serviceClient } from '../_shared/client.ts';
import { logEdgeEvent } from '../_shared/observability.ts';
import { hashValue } from './hash.ts';

export const writeAudit = async (input: {
  event: string; email?: string; ip: string; success: boolean; reason?: string;
}): Promise<void> => {
  try {
    await serviceClient.from('auth_audit_log').insert({
      event: input.event,
      subject_hash: input.email ? await hashValue(input.email) : null,
      ip_hash: await hashValue(input.ip),
      success: input.success,
      reason: input.reason ?? null,
    });
  } catch (e) {
    logEdgeEvent('warn', 'audit write failed', { event: input.event, reason: e instanceof Error ? e.message : 'unknown' });
  }
};
```

- [ ] **Step 3: Write `gotrue.ts`**

```ts
// gotrue.ts
/// <reference path="../_shared/edge-runtime.d.ts" />

const base = () => `${Deno.env.get('SUPABASE_URL') ?? ''}/auth/v1`;
const anon = () => Deno.env.get('ANON_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const call = async (path: string, init: RequestInit) => {
  const res = await fetch(`${base()}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', apikey: anon(), ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
};

export const gotrue = {
  signUp: (email: string, password: string) =>
    call('/signup', { method: 'POST', body: JSON.stringify({ email, password }) }),
  passwordGrant: (email: string, password: string) =>
    call('/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password }) }),
  refresh: (refresh_token: string) =>
    call('/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token }) }),
  logout: (accessToken: string) =>
    call('/logout', { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, body: '{}' }),
};
```

- [ ] **Step 4: Type-check the modules**

Run: `deno check supabase/functions/auth-gateway/ratelimit.ts supabase/functions/auth-gateway/audit.ts supabase/functions/auth-gateway/gotrue.ts`
Expected: no type errors.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/auth-gateway/ratelimit.ts supabase/functions/auth-gateway/audit.ts supabase/functions/auth-gateway/gotrue.ts
git commit -m "feat(auth): rate-limit caller, hashed audit writer, GoTrue REST client"
```

---

## Task 7: Gateway handler + config

**Files:**
- Create: `supabase/functions/auth-gateway/index.ts`
- Modify: `supabase/config.toml` (add `[functions.auth-gateway] verify_jwt = false`)

**Interfaces:**
- Consumes: everything from Tasks 2–6 plus `_shared/cors.ts`, `_shared/observability.ts`, `_shared/auth.ts` (`getBearerToken`).
- Produces: the deployed HTTP surface `POST /auth-gateway/{signup|login|logout|refresh}`.

- [ ] **Step 1: Write the handler**

```ts
// index.ts
/// <reference path="../_shared/edge-runtime.d.ts" />

import { corsHeaders } from '../_shared/cors.ts';
import { getBearerToken } from '../_shared/auth.ts';
import {
  ClientSafeError, clientErrorMessage, createEdgeObservation,
  finishEdgeObservation, getErrorStatus, jsonResponse, logEdgeEvent,
} from '../_shared/observability.ts';
import { validateEmail, validatePassword } from '../_shared/validation.ts';
import { parseRoute, clientIp } from './router.ts';
import { safeAuthMessage } from './errors.ts';
import { enforceRateLimit, POLICIES } from './ratelimit.ts';
import { writeAudit } from './audit.ts';
import { gotrue } from './gotrue.ts';

const respond = (status: number, body: unknown) =>
  jsonResponse(status, body, corsHeaders);

Deno.serve(async (request) => {
  const observation = createEdgeObservation(request, 'auth-gateway');
  let capturedError: unknown = null;
  let response: Response;

  if (request.method === 'OPTIONS') {
    response = new Response(null, { headers: corsHeaders, status: 204 });
    finishEdgeObservation(observation, { status: 204 });
    return response;
  }

  const ip = clientIp(request);
  const route = parseRoute(request.url);
  observation.action = route ?? undefined;

  try {
    if (request.method !== 'POST') throw new ClientSafeError(405, 'Use POST for auth requests.');
    if (!route) throw new ClientSafeError(404, 'Unknown auth route.');

    // Per-IP ceiling on every route (cheap DoS/abuse brake).
    await enforceRateLimit(`ip:${route}:${ip}`, POLICIES.ipGeneral);

    const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    if (route === 'signup') {
      const email = validateEmail(payload.email);
      const password = validatePassword(payload.password);
      await enforceRateLimit(`signup:${ip}`, POLICIES.signupPerIp);
      const r = await gotrue.signUp(email, password);
      await writeAudit({ event: 'signup', email, ip, success: r.ok, reason: r.ok ? undefined : `gotrue_${r.status}` });
      if (!r.ok) throw new ClientSafeError(r.status >= 500 ? 502 : 400, safeAuthMessage('signup', r.status));
      response = respond(200, r.body);         // preserves email-confirmation flow (may have null session)
    } else if (route === 'login') {
      const email = validateEmail(payload.email);
      const password = validatePassword(payload.password);
      const r = await gotrue.passwordGrant(email, password);
      if (!r.ok) {
        // Count only failures toward the per-email lockout.
        await enforceRateLimit(`login-fail:${email}`, POLICIES.loginFailure);
        await writeAudit({ event: 'login', email, ip, success: false, reason: `gotrue_${r.status}` });
        throw new ClientSafeError(401, safeAuthMessage('login', r.status));
      }
      await writeAudit({ event: 'login', email, ip, success: true });
      response = respond(200, r.body);
    } else if (route === 'refresh') {
      const token = typeof payload.refresh_token === 'string' ? payload.refresh_token : '';
      if (!token) throw new ClientSafeError(400, safeAuthMessage('refresh', 400));
      await enforceRateLimit(`refresh:${ip}`, POLICIES.refreshPerIp);
      const r = await gotrue.refresh(token);   // GoTrue rotates + reuse-detects (project setting)
      await writeAudit({ event: 'refresh', ip, success: r.ok, reason: r.ok ? undefined : `gotrue_${r.status}` });
      if (!r.ok) throw new ClientSafeError(401, safeAuthMessage('refresh', r.status));
      response = respond(200, r.body);
    } else { // logout
      const token = getBearerToken(request); // throws ClientSafeError(401) if missing
      const r = await gotrue.logout(token);
      await writeAudit({ event: 'logout', ip, success: r.ok, reason: r.ok ? undefined : `gotrue_${r.status}` });
      if (!r.ok) throw new ClientSafeError(400, safeAuthMessage('logout', r.status));
      response = respond(200, { success: true });
    }

    finishEdgeObservation(observation, { status: response.status });
    return response;
  } catch (error) {
    capturedError = error;
    const status = getErrorStatus(error);
    // clientErrorMessage returns the ClientSafeError message (safe by construction)
    // or a generic fallback for anything unexpected. Real details are logged, not returned.
    response = respond(status, { error: { message: clientErrorMessage(error) } });
    finishEdgeObservation(observation, { status, error: capturedError });
    if (status >= 500) logEdgeEvent('error', 'auth-gateway failure', { route, status });
    return response;
  }
});
```

- [ ] **Step 2: Add the config entry**

Append to `supabase/config.toml`:
```toml
[functions.auth-gateway]
verify_jwt = false
```

- [ ] **Step 3: Type-check the whole function**

Run: `deno check supabase/functions/auth-gateway/index.ts`
Expected: no type errors.

- [ ] **Step 4: Run the full gateway test suite (from Tasks 2–5)**

Run: `deno test --allow-env supabase/functions/_shared/validation.test.ts supabase/functions/_shared/requireRole.test.ts supabase/functions/auth-gateway/`
Expected: PASS (all unit tests green).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/auth-gateway/index.ts supabase/config.toml
git commit -m "feat(auth): auth-gateway handler wiring validation, rate-limit, audit, safe errors"
```

---

## Task 8: Client SDK

**Files:**
- Create: `packages/auth/src/gatewayAuth.ts`
- Modify: `packages/auth/src/index.ts` (add `export * from './gatewayAuth';`)

**Interfaces:**
- Consumes: gateway base URL + anon key supplied by the caller (`GatewayAuthEnv`).
- Produces: `createGatewayAuth(env: GatewayAuthEnv)` returning `{ signUp, signIn, signOut, refresh }`. `signUp(email,password)` / `signIn(email,password)` / `refresh(refreshToken)` return the parsed GoTrue session body; `signOut(accessToken)` returns `void`. All throw `Error` with the gateway's safe message on failure.

- [ ] **Step 1: Write the SDK**

```ts
// gatewayAuth.ts
export interface GatewayAuthEnv {
  gatewayUrl: string; // e.g. https://<project>.functions.supabase.co/auth-gateway
  anonKey: string;
}

const GENERIC = 'Something went wrong. Please try again.';

const post = async (env: GatewayAuthEnv, route: string, body: unknown, bearer?: string) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', apikey: env.anonKey };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const res = await fetch(`${env.gatewayUrl.replace(/\/$/, '')}/${route}`, {
    method: 'POST', headers, body: JSON.stringify(body ?? {}),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (json && typeof json === 'object' && (json as any).error?.message) || GENERIC;
    throw new Error(message);
  }
  return json;
};

export const createGatewayAuth = (env: GatewayAuthEnv) => ({
  signUp: (email: string, password: string) => post(env, 'signup', { email, password }),
  signIn: (email: string, password: string) => post(env, 'login', { email, password }),
  refresh: (refreshToken: string) => post(env, 'refresh', { refresh_token: refreshToken }),
  signOut: async (accessToken: string) => { await post(env, 'logout', {}, accessToken); },
});
```

- [ ] **Step 2: Export it**

Add to `packages/auth/src/index.ts`:
```ts
export * from './gatewayAuth';
```

- [ ] **Step 3: Type-check the auth package**

Run: `npx tsc --noEmit -p packages/auth/tsconfig.json` (or the repo's `pnpm --filter @ebuy/auth typecheck` if defined).
Expected: no type errors. If the package has no tsconfig, run the workspace typecheck used in CI.

- [ ] **Step 4: Commit**

```bash
git add packages/auth/src/gatewayAuth.ts packages/auth/src/index.ts
git commit -m "feat(auth): client SDK for the auth gateway"
```

---

## Task 9: Operations doc + end-to-end smoke test

**Files:**
- Create: `docs/superpowers/auth-gateway-operations.md`

**Interfaces:**
- Consumes: the deployed `auth-gateway` function.
- Produces: operator documentation; a verified end-to-end signup→login→refresh→logout run.

- [ ] **Step 1: Write the operations doc**

Contents (write in full):
- **Secrets to set** (`supabase secrets set ...`): `AUTH_HASH_SALT` (random 32+ char string). Confirm `SUPABASE_URL`, `SERVICE_ROLE_KEY`, and an anon key (`ANON_KEY` or `SUPABASE_ANON_KEY`) are present in the function env.
- **Deploy:** `supabase functions deploy auth-gateway --no-verify-jwt` (matches `verify_jwt = false`; the user runs this — the agent cannot per project convention).
- **Refresh rotation verification:** in Dashboard → Authentication → Sessions (or `config.toml`/project settings), confirm refresh-token **rotation is enabled** and **reuse detection interval** is set. The gateway relies on this; it does not implement rotation itself.
- **Password policy alignment:** confirm the project's minimum password length is 6 so it matches the gateway policy.
- **Client wiring (future):** apps construct `createGatewayAuth({ gatewayUrl, anonKey })` and call `signUp/signIn/signOut/refresh`; existing `supabaseAuth.ts` remains until screens migrate.
- **Rate-limit tuning:** policies live in `supabase/functions/auth-gateway/ratelimit.ts` (`POLICIES`). Note the layer is best-effort on top of Supabase's global limits.

- [ ] **Step 2: End-to-end smoke test against the deployed function**

After the user deploys and sets secrets, run (replace URL/anon):
```bash
GW=https://<project>.functions.supabase.co/auth-gateway
AK=<anon key>
# signup (expect 200, may require email confirmation)
curl -sS -X POST "$GW/signup" -H "apikey: $AK" -H 'Content-Type: application/json' \
  -d '{"email":"smoke+1@example.com","password":"Abc123"}' -w '\n%{http_code}\n'
# wrong password 6x -> expect 401s then 429 lockout
for i in 1 2 3 4 5 6; do curl -sS -X POST "$GW/login" -H "apikey: $AK" -H 'Content-Type: application/json' \
  -d '{"email":"smoke+1@example.com","password":"Wrong1x"}' -w ' -> %{http_code}\n'; done
```
Expected: signup `200`; the first login failures return `401` with `Incorrect email or password.`, and after the 5-failure threshold a `429` appears. Confirm no password/token strings appear in `supabase functions logs auth-gateway`.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/auth-gateway-operations.md
git commit -m "docs(auth): auth-gateway operations + smoke test"
```

---

## Self-Review

**Spec coverage:**
- bcrypt (never bypass) → Tasks 6/7 forward to GoTrue, never hash passwords locally. ✓
- refresh rotation → Task 7 `/refresh` forwards; Task 9 documents verifying the setting. ✓
- rate limiting → Tasks 1, 6, 7 (per-IP + per-email failure lockout). ✓
- parameterized queries → Task 1 RPC fully parameterized; all DB access via supabase-js (parameterized). ✓
- input validation → Task 2, applied in Task 7. ✓
- safe error messages → Task 5 `safeAuthMessage` (non-enumerable), applied in Task 7; shared `clientErrorMessage` fallback. ✓
- RBAC → Task 3 reusable guard (`requireRole`), documented for `app-rpc` reuse. ✓
- no secret logging → Task 4 redaction + hashed audit; Task 7 never logs bodies/tokens; Task 9 verifies logs. ✓
- password policy ≥6 + upper/lower/digit → Task 2. ✓
- email-confirmation preserved → Task 7 signup returns GoTrue body as-is. ✓
- gateway location (edge function) + client SDK only, no app screens → Tasks 7 & 8; screens untouched. ✓

**Placeholder scan:** none — every code step is complete.

**Type consistency:** `enforceRateLimit(rawKey, policy)`, `writeAudit({event,email?,ip,success,reason?})`, `gotrue.{signUp,passwordGrant,refresh,logout}`, `parseRoute`, `clientIp`, `safeAuthMessage(kind,status)`, `hashValue`, `validateEmail/validatePassword`, `requireRole(request, allowed)`, `createGatewayAuth(env)` — names/signatures consistent across Tasks 2–8. ✓
