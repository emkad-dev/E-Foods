# Analytics and Monitoring Guide

## Goal

Set up error tracking, performance monitoring, and product analytics so production issues and launch metrics are visible in real time.

## Why This Matters

- Error tracking catches crashes and API failures before users report them.
- Analytics tracks the core funnel from signup to delivery.
- Dashboards give live visibility into conversion, volume, and retention.
- Structured logging makes Edge Function and backend debugging faster.

## Architecture

```text
Apps: Customer, Partner, Dispatch, Admin
  -> Sentry client SDK
  -> Analytics SDK
  -> Structured logging

Edge Functions
  -> Structured logs

Postgres
  -> Query monitoring
  -> Slow query logs
```

## Sentry

Use Sentry for unhandled exceptions, network errors, and performance traces.

### Setup

1. Create a Sentry account.
2. Create one project per app surface you want to watch.
3. Install the SDK in each Expo app that should report client errors.
4. Initialize Sentry at the root app entry point.
5. Store `EXPO_PUBLIC_SENTRY_DSN` in the Expo app environment.

### Example

```typescript
import * as Sentry from "@sentry/react-native";

Sentry.init({
  dsn: "https://[key]@[org].ingest.sentry.io/[project-id]",
  environment: "production",
  tracesSampleRate: 0.1,
});
```

## Product Analytics

Use Mixpanel or Amplitude to track:

- Signup
- Login
- Browse restaurants
- Add to cart
- Checkout
- Order placed
- Delivery completed

The repo now includes a lightweight analytics helper at [`packages/observability/src/analytics.ts`](packages/observability/src/analytics.ts).
It logs events locally by default and will POST to `EXPO_PUBLIC_ANALYTICS_ENDPOINT` when that environment variable is set.
The customer app already emits the main funnel events from auth, discovery, and checkout.

### Setup

1. Create a product analytics account.
2. Create a production project.
3. Install the analytics SDK.
4. Instrument the customer app with funnel events.
5. Build conversion and retention dashboards.

### Example

```typescript
import { Mixpanel } from "mixpanel-browser";

const mixpanel = Mixpanel.init("[PROJECT_TOKEN]", {
  debug: __DEV__,
  track_page_view: true,
});
```

Recommended funnel views:

- Signup -> Browse -> Cart -> Checkout -> Order placed
- Order placed -> Rider assigned -> Pickup -> Delivered

## Dashboards

Track these groups of metrics:

- User growth: DAU, WAU, MAU, signup rate
- Conversion: browse rate, add-to-cart rate, checkout rate, order completion rate
- Monetization: GMV, average order value, orders per day, revenue after fees
- Retention: day 1, 3, 7, and 30 return rate, churn rate
- Technical: API error rate, response time, Edge Function execution time, database performance

Options:

1. Built-in Mixpanel or Amplitude dashboards
2. A custom Metabase or Grafana dashboard
3. Supabase logs and project analytics for a lighter setup

## Structured Logging

Logs should be structured in development and production.

```typescript
import pino from "pino";

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
});
```

Use log fields for:

- Order ID
- Event name
- Error details
- Result payloads
- Request ID
- Function name
- Latency in milliseconds

## Load Testing

Use the repo-local load harness before launch to exercise the hot paths under burst load.

```bash
npm run load:test
```

Recommended environment variables:

- `PUBLIC_CATALOG_URL`
- `APP_RPC_URL`
- `AUTH_TOKEN`
- `RESTAURANT_ID`
- `ORDER_ID`
- `QUEUE_DRAINER_URL`
- `QUEUE_WORKER_TOKEN`
- `CONFIRM_LOAD_TEST_MUTATIONS=yes`

Keep the default run read-only unless you explicitly seed disposable write targets.

### Seeded Environment Recipe

Use this when you want a concrete, repeatable burst test against your seeded dev database:

1. Start the local seeded backend and confirm the database contains sample restaurants, orders, and queue rows.
2. Export the harness variables in PowerShell:

```powershell
$env:PUBLIC_CATALOG_URL = "http://127.0.0.1:54321/functions/v1/public-catalog"
$env:APP_RPC_URL = "http://127.0.0.1:54321/functions/v1/app-rpc"
$env:AUTH_TOKEN = "YOUR_USER_SESSION_TOKEN"
$env:RESTAURANT_ID = "YOUR_SEEDED_RESTAURANT_ID"
$env:ORDER_ID = "YOUR_SEEDED_ORDER_ID"
$env:QUEUE_DRAINER_URL = "http://127.0.0.1:54321/functions/v1/queue-drainer"
$env:QUEUE_WORKER_TOKEN = "your-queue-worker-token"
$env:CONCURRENCY = "100"
$env:DURATION_SECONDS = "300"
$env:CONFIRM_LOAD_TEST_MUTATIONS = "yes"
npm run load:test
```

3. Watch the output for:
   - p95 and p99 latency spikes
   - queue-drainer failures
   - any order RPC error bursts
4. After the run, inspect `cron.job_run_details` and the function logs for failed queue-drainer invocations.

If you want a harsher burst test, rerun with `CONCURRENCY=250` or `CONCURRENCY=500` against a disposable seed only.

## Launch Checklist

- [ ] Sentry account created and projects configured
- [ ] Sentry DSN added to environment variables
- [ ] Sentry initialized in all apps
- [ ] Analytics account created
- [ ] Funnel events tracked in the customer app
- [ ] Conversion dashboard created
- [ ] Logging initialized in Edge Functions
- [ ] KPI dashboard created
- [ ] Alerting configured for critical errors and conversion drops
- [ ] Load test harness run against the hot paths
- [ ] Queue drainer verified against seeded queue tables

## Priority Order

1. Set up Sentry in all apps.
2. Add analytics tracking to the core user flows.
3. Create dashboards for launch-day monitoring.
4. Refine retention and cohort analysis after launch.
