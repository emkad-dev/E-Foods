# Auth Gateway — Operations

Operator guide for the `auth-gateway` edge function (hardening layer around
Supabase Auth / GoTrue). Design: `docs/superpowers/specs/2026-07-12-auth-gateway-hardening-design.md`.
Implementation plan: `docs/superpowers/plans/2026-07-12-auth-gateway-hardening.md`.

The gateway wraps GoTrue — GoTrue still owns bcrypt hashing, JWT issuance, and
refresh rotation. The gateway adds validation, rate limiting, safe
(non-enumerable) errors, and hashed audit logging.

## 1. Secrets & environment

Set the audit/rate-limit hashing salt (random, 32+ chars):

```bash
supabase secrets set AUTH_HASH_SALT="$(openssl rand -hex 32)"
```

Confirm these are present in the function environment (used by the shared
service client and GoTrue REST calls):

- `SUPABASE_URL` — project URL.
- `SERVICE_ROLE_KEY` — used by `_shared/client.ts` for the privileged client
  (rate-limit RPC + audit inserts). Never exposed to clients.
- An anon key readable as `ANON_KEY` **or** `SUPABASE_ANON_KEY` — used as the
  `apikey` on GoTrue REST calls.

## 2. Deploy

`config.toml` already sets `[functions.auth-gateway] verify_jwt = false` (the
gateway guards each route itself). Deploy:

```bash
supabase functions deploy auth-gateway --no-verify-jwt
```

> Per project convention the agent cannot run this deploy — a human operator
> runs it.

## 3. Verify refresh-token rotation (required)

The gateway's `/refresh` route forwards to GoTrue's
`token?grant_type=refresh_token`; **GoTrue performs the rotation and
reuse-detection**, not the gateway. Confirm in the project:

- Dashboard → Authentication → Sessions: refresh-token **rotation enabled**.
- Refresh-token **reuse interval** set to a small value (e.g. 10s).

If rotation is off, refresh tokens are not rotated and the "refresh token
rotation" requirement is not actually met — the gateway relies on this
setting.

## 4. Password-policy alignment

The gateway enforces **≥ 6 chars + one uppercase + one lowercase + one digit**
(`_shared/validation.ts`). Confirm the project's Auth minimum password length
is **6** so the two do not diverge. The complexity requirement is added on top
by the gateway.

## 5. Migration

Apply `supabase/migrations/20260712_auth_gateway.sql` (tables
`auth_rate_limits`, `auth_audit_log`; RPC `auth_rl_hit`). The RPC is
`SECURITY DEFINER` and executable only by `service_role`.

## 6. Rate-limit tuning

Policies live in `supabase/functions/auth-gateway/ratelimit.ts` (`POLICIES`):

- `ipGeneral` — per-IP ceiling on every route (30 / 10 min, 10 min lock).
- `loginFailure` — per-email failure lockout (5 fails / 10 min → 15 min lock).
- `signupPerIp` — 10 / hour, 15 min lock.
- `refreshPerIp` — 60 / 10 min, 5 min lock.

This layer is **best-effort**, on top of Supabase's own global limits — not a
replacement and not DDoS protection. Note: where `lockoutSecs < windowSecs`
(signup, refresh), an over-limit caller can be re-locked on its first
post-lockout hit under continued traffic — intended for abuse mitigation.

## 7. Client wiring (future — not done in this pass)

Apps continue to use `supabaseAuth.ts` until migrated. To adopt the gateway,
construct the SDK and call it:

```ts
import { createGatewayAuth } from '@ebuy/auth';

const auth = createGatewayAuth({
  gatewayUrl: 'https://<project>.functions.supabase.co/auth-gateway',
  anonKey: EXPO_PUBLIC_SUPABASE_ANON_KEY,
});

await auth.signUp(email, password);
await auth.signIn(email, password);
await auth.refresh(refreshToken);
await auth.signOut(accessToken);
```

## 8. Smoke test (after deploy)

Replace the URL and anon key:

```bash
GW=https://<project>.functions.supabase.co/auth-gateway
AK=<anon key>

# signup (expect 200; may require email confirmation)
curl -sS -X POST "$GW/signup" -H "apikey: $AK" -H 'Content-Type: application/json' \
  -d '{"email":"smoke+1@example.com","password":"Abc123"}' -w '\n%{http_code}\n'

# wrong password 6x -> expect 401s, then a 429 lockout once the threshold trips
for i in 1 2 3 4 5 6; do
  curl -sS -X POST "$GW/login" -H "apikey: $AK" -H 'Content-Type: application/json' \
    -d '{"email":"smoke+1@example.com","password":"Wrong1x"}' -w ' -> %{http_code}\n'
done
```

Expected: signup `200`; login failures return `401` with
`Incorrect email or password.`; after the 5-failure threshold a `429` appears.
Then confirm **no** password/token strings appear in the logs:

```bash
supabase functions logs auth-gateway
```
