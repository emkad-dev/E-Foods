# FEASTY Phone Validation + OTP Verification (NG/UK)

**Date:** 2026-07-12
**Status:** Design approved by user (Termii, verified-profile-field model, all three apps).
**Revision:** OTP endpoints moved from `app-rpc` to `auth-gateway` (user-approved) after discovering the gateway on `feature/auth-gateway-hardening` already provides rate limiting (`auth_rl_hit`), hashed audit logging, and safe-error mapping.

## Summary

Replace the free-text phone fields in all three Expo apps with a validated, OTP-verified phone number restricted to Nigerian (+234) and UK (+44) mobiles. Email/password remains the login identity; the verified phone is a profile field with a `phoneVerifiedAt` timestamp. Codes are delivered by Termii over SMS (DND route) or WhatsApp.

## Decisions locked with the user

- **Provider:** Termii (SMS with DND bypass + WhatsApp channel). Custom OTP lifecycle on our side per spec — Termii is used only for message delivery, not its hosted Token API.
- **Phone role:** verified profile field; login stays email/password.
- **Scope:** customer, partner, and dispatch apps all switch to the new input in this pass.

## Design

### 1. Shared validation — `packages/domain/src/phone.ts`

Pure TypeScript, no dependencies.

`normalizePhone(input: string): PhoneResult` where `PhoneResult` is either
`{ ok: true, e164, country: 'NG' | 'GB', local }` or `{ ok: false, reason }`.

- Pre-clean: strip spaces, dashes, dots, parentheses; convert leading `00` to `+`; a bare `234…`/`44…` (no `+`, too long to be local) is treated as country-coded.
- **NG mobile:** national significant number is 10 digits matching `^[789][01]\d{8}$` (covers 070x/080x/081x/090x/091x). Accepted inputs: `+234…`, `0…` (11 digits).
- **GB mobile:** national significant number is 10 digits matching `^7\d{9}$`. Accepted inputs: `+44…`, `0…` (11 digits).
- Rejection reasons: `empty`, `unsupported_country` (any other prefix, incl. +1), `invalid_length`, `not_a_mobile`, `invalid_characters`. UI maps reasons to friendly copy.
- `formatLocalForDisplay(e164)` renders `0803 123 4567` / `07123 456789` style grouping for the input as-you-type UX.
- **Mirror:** identical module copied to `supabase/functions/_shared/phone.ts` (edge functions are Deno and do not import `packages/`; the server must re-validate anyway). Header comments in both files point at each other.

### 2. Backend — `auth-gateway` routes + `phone_otps` table

Two new routes in `supabase/functions/auth-gateway` (`otp-request`, `otp-verify`), both requiring a verified Supabase JWT (`verifySupabaseJwt` from `_shared/auth.ts`) — the gateway stays `verify_jwt = false` and guards per-route as it already does. They reuse the gateway's `enforceRateLimit`/`auth_rl_hit`, `writeAudit` (hashed phone as subject), and `ClientSafeError`/`clientErrorMessage` conventions.

**Migration** (`supabase/migrations/20260712_phone_otp.sql`, matching the gateway migration style):

- `phone_otps`: `id uuid pk default gen_random_uuid()`, `uid text`, `phoneE164 text`, `channel text` (`sms`|`whatsapp`), `codeHash text`, `expiresAt timestamptz`, `attempts int default 0`, `consumedAt timestamptz null`, `createdAt timestamptz default now()`. Index on `(uid, "createdAt" desc)`. RLS enabled with no policies — service-role only.
- `"UserAccount"."phoneVerifiedAt" timestamptz null`, appended to the `user_profiles` view (end of column list, so `CREATE OR REPLACE VIEW` is legal) and to the Prisma `UserAccount` model so `db:validate` doesn't drift. Any path that changes `phoneNumber` outside verification clears it.

**`POST /otp-request { phone, channel }`** (bearer required):
1. `verifySupabaseJwt` → uid. Normalize phone server-side (`_shared/phone.ts`); reject non-NG/GB.
2. Rate limits via `auth_rl_hit`: `otp-send:{uid}` 1/60s (resend cooldown), `otp-send-phone:{phone}` 5/hour (per-phone cap), plus the gateway's existing per-IP ceiling.
3. Generate 6-digit code; store HMAC-SHA-256(code, `OTP_PEPPER`); void prior pending rows for `(uid, phoneE164)`; 5-minute expiry.
4. Send via Termii `/api/sms/send` — `channel: "dnd"` for SMS, `channel: "whatsapp"` for WhatsApp; same message body either way (`auth-gateway/termii.ts`).
5. Audit `otp_request` (subject = hashed phone). Termii failure: real error logged server-side, generic `ClientSafeError` to client. Response: `{ success, expiresInSeconds: 300, resendInSeconds: 60 }`.

**`POST /otp-verify { phone, code }`** (bearer required):
1. `verifySupabaseJwt` → uid; normalize; load newest unconsumed row for `(uid, phoneE164)`.
2. Missing/expired → "That code has expired — request a new one." `attempts >= 5` → "Too many attempts — request a new code."
3. Constant-time HMAC compare. Mismatch → increment `attempts`, audit failure, "That code didn't work. Check it and try again."
4. Match → set `consumedAt`, update `UserAccount` `phoneNumber = e164`, `phoneVerifiedAt = now()`; audit success. Response: `{ success, phoneNumber, phoneVerifiedAt }`.

**Client SDK:** `requestPhoneOtp` / `verifyPhoneOtp` added to `packages/auth` alongside the existing gateway SDK, returning the same response shapes.

**Secrets:** `TERMII_API_KEY`, `TERMII_SENDER_ID`, `OTP_PEPPER`. **Dev mode:** `OTP_DEV_MODE=true` logs the code via observability instead of calling Termii, so the flow works before the Termii account exists.

### 3. Expo UI — shared components in `packages/auth/src/components/`

Theme-agnostic via a small `PhoneTheme` props object (colors supplied by each app's palette).

- **`PhoneInput`**: country toggle (🇳🇬 +234 default / 🇬🇧 +44), local-format text entry with as-you-type grouping, inline validation message from the shared normalizer, emits `{ e164 | null }`.
- **`OtpEntry`**: 6-cell code boxes, SMS/WhatsApp channel choice, resend button with 60s countdown, error + attempts-exhausted states.
- Wiring: customer `complete-profile` gains the two-step verify flow (enter phone → code → continue); partner and dispatch `register` screens swap free-text phone for `PhoneInput` + verification before submit. Existing stored numbers untouched (`phoneVerifiedAt` stays null until re-verified).

## Error handling

Follows the 2026-07-12 error-sanitization convention: `ClientSafeError` for expected user-facing failures, everything else logged server-side with a generic client message.

## Verification

- Unit tests for `normalizePhone` (both countries, all accepted input shapes, all rejection reasons) as `packages/domain/src/phone.test.ts` using `node:test` (Node 22+/25 runs TS directly; Deno is not installed locally). Gateway-side `otp.test.ts` follows the existing `*.test.ts` pattern for CI.
- `tsc --noEmit` in touched apps/packages.
- End-to-end with `OTP_DEV_MODE=true`: request code (read from function logs), verify, confirm `phoneVerifiedAt` set.
- Deploy note: `auth-gateway` deploy and the SQL migration are run by the user, same as the support-inbox rollout.

## Out of scope

Phone-as-login-identity, backfilling verification for existing numbers, admin tooling for OTP inspection, non-mobile (landline) numbers, countries beyond NG/GB.
