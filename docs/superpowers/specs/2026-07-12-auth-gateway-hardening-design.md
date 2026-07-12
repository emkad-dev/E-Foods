# Hardened Auth Gateway for FEASTY (Supabase-backed) — Design

**Date:** 2026-07-12
**Status:** Approved (brainstorming), pending implementation plan
**Author:** brainstorming session

## Context

FEASTY runs on **Supabase Auth (GoTrue)**. Client apps currently call
`supabase.auth.signUp / signInWithPassword / signOut` **directly from the
client** via `packages/auth/src/supabaseAuth.ts`. Roles live in
`app_metadata.user_role` (`packages/auth/src/claims.ts`, validated against
`packages/domain/src/roles.ts`), and Row-Level Security keys off the Supabase
JWT (`auth.uid()`). Edge functions are Deno on Supabase
(`supabase/functions/*`).

GoTrue already provides bcrypt password hashing, JWT issuance, and
refresh-token rotation. Therefore this work is **NOT** a rewrite of auth from
scratch and **NOT** a replacement of Supabase Auth. It is a **hardening layer**
that adds the controls Supabase does not enforce by default, in a place where
we control them.

The decision (from brainstorming): honor "secure login/logout/signup **route**"
by introducing a server-side **edge function gateway** — the only place we can
enforce *our own* rate limiting, validation, and audit logging server-side.
Scope for this pass: **gateway + shared client SDK only**; app screens are left
untouched and migrate to the SDK incrementally.

## Requirement reconciliation

| Original ask | Reality on Supabase | What we build |
|---|---|---|
| bcrypt password hashing | GoTrue already bcrypts | Never bypass it; enforce a strong password **policy** |
| refresh token rotation | GoTrue supports it (config) | `/refresh` forwards so GoTrue rotates + reuse-detects; we verify the setting is on |
| rate limiting | Built-in global limits only | Our own per-IP + per-email limiting with lockout at the route |
| parameterized queries | PostgREST/RLS parameterize | All new SQL parameterized; audit `app-rpc` for raw SQL |
| input validation | none by default | Shared server-side email + password validation |
| safe error messages | partial (`formatAuthError`) | Central non-enumerable error mapping |
| role-based access control | roles in `app_metadata`, RLS | Reusable `requireRole` guard at edge; RLS remains second layer |
| do not log passwords/tokens | — | Redaction guard + hashed audit log |

## Architecture

```
app  →  auth-gateway (validate · rate-limit · audit · safe-errors)  →  GoTrue REST  →  Postgres
                              ↑ service-role key stays server-side (edge env) only
```

GoTrue keeps owning hashing, JWT issuance, and refresh rotation. The gateway
owns the hardening layer. New edge function: `supabase/functions/auth-gateway`,
configured `verify_jwt = false` (it guards internally per-route).

## Endpoints

| Route | Wraps (GoTrue) | Hardening |
|---|---|---|
| `POST /signup` | `/signup` | email+password validation, password policy, per-IP + per-email rate limit, safe errors, audit. Preserves the existing **email-confirmation** flow. |
| `POST /login` | `/token?grant_type=password` | validation, failure **lockout** rate limit, generic `invalid_credentials`, audit |
| `POST /logout` | `/logout` | bearer required, revokes refresh token, audit |
| `POST /refresh` | `/token?grant_type=refresh_token` | forwards so GoTrue **rotates + reuse-detects**; rate-limited |

Responses return the same session shape the apps already consume so the client
SDK is a drop-in.

## Data model (new migration)

- `auth_rate_limits(key text primary key, window_start timestamptz not null,
  count int not null, locked_until timestamptz)`
  `key` = hash of `ip:route` or `email:route`. Raw email/IP are **not** stored.
- RPC `auth_rl_hit(p_key text, p_limit int, p_window_secs int, p_lockout_secs int)`
  — `SECURITY DEFINER`, **atomic** fixed-window upsert, returns
  `{ allowed boolean, retry_after int }`. All arguments parameterized. Execute
  granted to `service_role` only.
- `auth_audit_log(id bigserial pk, event text, subject_hash text, ip_hash text,
  success boolean, reason text, created_at timestamptz default now())`
  — never stores passwords, tokens, or raw email/IP (hashed with a server-side
  salt).

## Validation & password policy

Shared `supabase/functions/_shared/validation.ts`:
- Email: RFC-lite structural check, length bounds, normalized to lowercase.
- Password policy: **≥ 10 characters, at least one upper, one lower, one digit.**
  Enforced server-side regardless of client. The matching Supabase
  minimum-password-length setting is documented so the two cannot diverge.

## RBAC

Reusable `supabase/functions/_shared/requireRole.ts`:
- Verifies a Supabase access token and reads `app_metadata.user_role`.
- Checks membership against `APP_ROLES` (`packages/domain/src/roles.ts`).
- Returns 401 (no/invalid token) or 403 (wrong role) with safe messages.
- Wired into the gateway's one authenticated route as a reference; documented
  for reuse in `app-rpc`. RLS remains the second enforcement layer.

## Safe errors & no-logging

- Central `errorResponse()` maps all failures to non-enumerable messages —
  login always returns `Incorrect email or password`, never distinguishing
  "user not found" from "wrong password".
- Redaction guard ensures request bodies, `Authorization` header, `password`,
  `access_token`, and `refresh_token` are never logged. Audit rows store only
  hashed subject/IP + boolean success + coarse reason.

## Client SDK (`packages/auth`)

New `packages/auth/src/gatewayAuth.ts`: `signUp / signIn / signOut / refresh`
that call the gateway and return the existing session shape. Existing
`supabaseAuth.ts` is retained until apps migrate. **No app screens change** in
this pass.

## Testing & config

- Deno tests: email/password validation, rate-limit RPC (fixed-window rollover
  + lockout), safe-error mapping, `requireRole` (missing/invalid/wrong/right).
- `config.toml`: add `[functions.auth-gateway] verify_jwt = false`.
- Document verifying refresh **rotation + reuse detection** are enabled in the
  hosted project (cannot be changed from this environment).

## Non-goals / caveats

- Rate limiting is **best-effort**, layered on top of Supabase's global limits —
  not a replacement and not DDoS protection.
- The gateway adds one network hop.
- Refresh **rotation is a GoTrue setting** — the gateway relies on it being
  enabled; flagged explicitly, not silently assumed.
- App screens are not migrated in this pass (deliberate scope choice).

## Open follow-ups (out of scope here)

- Migrating customer/partner/dispatch/admin-web screens to the gateway SDK.
- Optional: move rate-limit store to a faster backing store if edge DB latency
  becomes a concern.
