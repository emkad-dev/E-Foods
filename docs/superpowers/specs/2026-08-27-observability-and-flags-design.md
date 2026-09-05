# Observability And Flags Design

## Goal
Add Sentry-backed app observability, a shared feature-flag client, and persisted operational alerts so risky paths can ship dark and production failures are visible in a reviewable queue.

## Architecture

The repo already has Sentry initialization entrypoints in the four apps and a service-role-only `FeatureFlag` table. This task standardizes what already exists instead of inventing parallel telemetry systems.

App observability stays in `packages/observability`: the shared Sentry initializer becomes the single place that configures error capture and performance tracing for browser and native entrypoints, and each app root calls it once at startup. Edge Functions keep using structured JSON logs via `_shared/observability.ts`, but now also emit a consistent error envelope for request failures so operational faults can be counted and reviewed.

Feature flags become a real cross-app client surface. The backend exposes an authenticated read action that returns the current `FeatureFlag` map, the apps hydrate that map at startup, and the admin UI gets a dedicated page to toggle flags dark-on by default. That keeps risky work behind a switch without coupling every app to the admin snapshot.

Operational alerts are persisted into a service-role-only `OperationalAlert` table. Sweeps and gateways write alert rows when the payment-webhook failure rate, dispatch pool availability, acceptance-deadline escalations, or offer exhaustion cross their thresholds. Admin web reads the alert feed from a dedicated RPC and shows it in an observability page alongside the current flag state.

## Tech Stack

- React 19 / Expo Router for customer, partner, and dispatch
- React 18 / React Router for admin-web
- `@sentry/browser` and `@sentry/react-native`
- Supabase Edge Functions, PostgREST, and RLS service-role-only tables
- Existing shared RPC dispatcher in `supabase/functions/_shared/rpc`

## Data Model

- `FeatureFlag` already exists and remains service-role-only.
- New `OperationalAlert` table stores:
  - `id`
  - `dedupeKey`
  - `alertType`
  - `severity`
  - `subjectType`
  - `subjectId`
  - `title`
  - `details`
  - `metadata`
  - `createdAt`
  - `updatedAt`

The alert table is RLS-enabled with no policies and is read and written only through service-role code and admin RPC.

## API Shape

- `getFeatureFlags` returns `{ featureFlags: Record<string, boolean> }` for authenticated app clients.
- `adminListFeatureFlags` returns the current flag rows for admin web.
- `adminUpsertFeatureFlag` writes a single flag row with `enabled`, `description`, and `updatedAt`.
- `adminGetOperationalAlerts` returns a paged alert feed with filters for `severity`, `alertType`, and `subjectType`.

## Error Handling

- App errors are captured once at the app root and again in the error boundary fallback, but never leaked as raw stack traces to the user.
- Edge Functions log structured failures with function name, action, request id, stage, status, and contextual ids such as `orderId` or `queue`.
- Alert writers are best-effort. A failed alert insert must never block the primary user flow that triggered it.

## Testing

- App observability tests assert initialization is idempotent and installs the expected global handlers.
- Feature-flag tests assert default-off behavior, a missing row resolves to `false`, and admin writes persist the exact payload shape.
- Operational-alert tests assert each threshold emits once at or above the cutoff and stays silent below it.
- RPC registry tests assert the new actions are registered exactly once and the total action count reflects the new admin and account actions.

## Scope Notes

- This task extends the existing `FeatureFlag` table rather than replacing it.
- The admin observability page is review-only. It does not acknowledge or dismiss alerts in this task.
- No alert should auto-block user actions. The alert queue is informational only.
