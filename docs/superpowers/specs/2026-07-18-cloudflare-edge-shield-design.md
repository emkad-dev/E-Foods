# Cloudflare Edge Shield — Image Transformations + Paystack Webhook Queue (A1 + A2)

**Date:** 2026-07-18
**Status:** Draft — pending review
**Scope:** Phases A1 (images + catalog edge cache) and A2 (Paystack webhook buffering).
Phase A3 (order-intent capture during outages) is explicitly out of scope and gets
its own spec after A1/A2 are proven in production.

## 1. Context and goals

FEASTY's images are served directly from Supabase Storage since Bunny CDN was
dropped (2026-07-18). All client API traffic hits Supabase edge functions
directly. The feasty.com.ng zone now lives on Cloudflare (account
`04c8ec7606adc0e0b391c2914fc2e429`), with the NS swap at DomainKing still
pending.

Goals, in the user's words: images optimized via Cloudflare, and a
Cloudflare-side queue "so the backend doesn't break." Refined into:

1. **Spike absorption** — launch/promo surges should be absorbed at the edge
   before they reach Supabase.
2. **Outage resilience** — during a Supabase outage: menus stay browsable
   (read-only), and a paid order is never lost because a Paystack webhook
   arrived while the backend was down.

Existing resilience this builds on (not replaces):

- Orders, payment verification, and notifications are already queued
  server-side (Postgres `queue_*` tables + `queue-drainer` cron) with
  visibility timeouts, backoff, and idempotent handlers.
- `paystack-webhook` verifies HMAC-SHA512 of the **raw body** against
  `x-paystack-signature` and is idempotent per reference.
- Paystack retries failed webhook deliveries on its own schedule, and the
  `payment-verification` queue independently polls Paystack.

## 2. Non-goals

- **A3 order intents:** accepting orders while Supabase is down (deferred
  payment UX, edge-side pricing, stock staleness). Own spec later.
- Fronting `app-rpc` (authenticated mutations) with a Worker or queue.
- Replacing the Postgres queue system.
- Cloudflare-hosted images (Images product) — we only transform Supabase-hosted
  originals.

## 3. Architecture overview

```
Clients ──images──► img.feasty.com.ng/cdn-cgi/image/... ──► Supabase Storage (origin pull, cached at edge)
Clients ──catalog─► api.feasty.com.ng (Worker: cache + stale-on-error) ──► public-catalog fn
Clients ──rpc────► <project>.supabase.co/functions/v1/app-rpc   (unchanged, direct)
Paystack ─────────► hooks.feasty.com.ng/paystack (Worker producer)
                        └─► CF Queue paystack-webhook-events ─► consumer ─► paystack-webhook fn
                                                  └─(max retries exceeded)─► paystack-webhook-dlq
```

Three small, independent pieces. Each can ship, fail, and be rolled back alone.

New repo directory: `cloudflare/` with one folder per Worker
(`cloudflare/hooks/`, `cloudflare/edge-cache/`), each with its own
`wrangler.jsonc` and deployed via `npx wrangler deploy`.

## 4. Phase A1a — Image transformations

**Zone setup (dashboard/API):**

- Enable Transformations for feasty.com.ng (Media → Images → Transformations).
- Allow resizing from external origins (Supabase Storage is not on the zone) —
  restrict allowed source origins to the Supabase project host if the UI
  supports origin restriction.
- DNS: `img.feasty.com.ng` proxied A record to `192.0.2.1` (dummy — Cloudflare
  intercepts `/cdn-cgi/image/*` before any origin fetch; other paths 5xx, which
  is acceptable for a purpose-built hostname).

**URL format** emitted by the backend:

```
https://img.feasty.com.ng/cdn-cgi/image/format=auto,quality=78,width=800,onerror=redirect/<original-supabase-url>
```

`onerror=redirect` falls back to the original Supabase URL if a transformation
fails, so images never hard-break.

**Code change (server-side only):** extend
`supabase/functions/_shared/media.ts`. The existing `toCdnImageUrl()` seam
stays; a new env `IMAGE_CDN_BASE_URL` (e.g. `https://img.feasty.com.ng`)
switches it to emit the transformation URL above for public-storage URLs.
Unset env ⇒ no-op passthrough (current behavior), so deploys are safe before
DNS is live. All image URLs reach clients through edge-function responses, so
**no mobile builds are required** for images to switch over.

Note: `feature/promo-landing-pages` (unmerged) pins image hosts client-side;
when it merges, `img.feasty.com.ng` must be added to its allowlist.

**Cost:** free tier 5,000 unique transformations/month, then $0.50/1,000. This
design emits a single default width (800); a catalog of a few hundred items
fits in free with wide headroom, leaving room to add per-context widths later.

## 5. Phase A1b — Catalog edge cache (menus browsable during outage)

A Worker at `api.feasty.com.ng` (Workers custom domain — DNS record is created
automatically) proxying **only** `GET/OPTIONS` for `public-catalog`:

- Forwards to `<project>.supabase.co/functions/v1/public-catalog/...`,
  preserving query string and the anon `apikey`/`Authorization` headers.
- **Cache strategy (Cache API):** serve cached copy if younger than 60 s;
  otherwise revalidate from origin. On origin failure (5xx, timeout, network
  error), serve the cached copy up to 24 h old (manual stale-if-error) with an
  `x-feasty-stale: 1` header for observability. Cache key = full URL.
- Non-matching paths return 404 — this hostname is only the catalog.

**Client change:** the public-catalog base URL in app config moves to
`https://api.feasty.com.ng`. This is the one client-side change in this design;
it rides along with the already-pending pricing-v2 mobile builds. Web deploys
pick it up immediately. Until clients switch, the direct Supabase URL keeps
working — the Worker is purely additive.

## 6. Phase A2 — Paystack webhook buffering

**Queues (already created, 2026-07-18):** `paystack-webhook-events` (main),
`paystack-webhook-dlq` (dead-letter).

**Producer** — Worker route `hooks.feasty.com.ng/paystack` (custom domain):

1. `POST` only. Read raw body (cap 100 KB; Paystack events are a few KB —
   queue message limit is 128 KB).
2. Verify `x-paystack-signature` = HMAC-SHA512(raw body, `PAYSTACK_SECRET_KEY`)
   at the edge; invalid ⇒ 401, nothing enqueued. This duplicates the live
   secret into Cloudflare (Worker secret via `wrangler secret put`) — accepted
   trade-off: it keeps junk out of the money queue, and the origin re-verifies
   anyway (defense in depth).
3. Enqueue `{ receivedAt, signature, rawBody }` and return `200 {"received":true}`
   immediately. If the enqueue itself fails, fall back to a direct synchronous
   forward to the Supabase function (same behavior as today); only if that also
   fails return 500 so Paystack retries.

**Consumer** — same Worker, queue handler:

- POST `rawBody` to the Supabase `paystack-webhook` function with the original
  `x-paystack-signature` header. Because the function verifies the raw body
  verbatim, **it needs zero changes**.
- 2xx ⇒ `msg.ack()`. Anything else ⇒ `msg.retry({ delaySeconds })` with
  increasing delay (60 s → capped at 15 min). Queue config: `max_retries: 25`,
  then the message lands in `paystack-webhook-dlq` (≈ multi-hour outage
  coverage; messages persist up to 4 days).
- DLQ has no consumer; it's inspected via the Cloudflare dashboard. Replay =
  manually POSTing the stored raw body + signature to the function (runbook
  note in the Worker README). Optional alerting is a follow-up, not in scope.

**Idempotency / ordering:** delivery is at-least-once and unordered; the
existing function is idempotent per payment reference and `charge.success`-only,
so duplicates and reordering are safe.

**Cutover:** change the webhook URL in the Paystack dashboard (user action) to
`https://hooks.feasty.com.ng/paystack`. Instant and reversible — the direct
Supabase URL keeps working as fallback. This also closes out the "live webhook
URL unconfirmed" loose end from the Paystack config work.

## 7. Error handling summary

| Failure | Behavior |
| --- | --- |
| Transformation fails | `onerror=redirect` serves the Supabase original |
| `IMAGE_CDN_BASE_URL` unset / DNS not live | media helper is a no-op; originals served |
| public-catalog origin down | ≤24 h-old cached menus served with stale marker |
| Supabase down when webhook fires | event held in CF queue, retried up to ~ 6 h+, then DLQ (4-day retention) |
| Queue enqueue fails | producer falls back to direct forward; 500 to Paystack only if both fail |
| Bad/forged webhook | rejected 401 at the edge; origin verifies again regardless |
| Worker/route misconfigured | Paystack gets non-200 and retries on its own schedule (status quo) |

## 8. Testing

- **Workers:** `wrangler dev` locally; unit-style tests for signature
  verification and cache-key/staleness logic where practical.
- **Webhook path:** replay a captured Paystack payload with a locally computed
  HMAC (test secret) against `wrangler dev`; verify enqueue → consumer →
  function 200. Force a consumer failure (wrong origin URL) to watch
  retry → DLQ.
- **Images:** after NS swap, spot-check `/cdn-cgi/image/...` URLs for real
  menu items (format negotiation, fallback via `onerror=redirect`, cache HIT
  headers).
- **Catalog cache:** curl twice (MISS→HIT), then simulate origin error by
  pointing the Worker at a bad origin in a preview deployment and confirm stale
  serve + `x-feasty-stale`.
- **End-to-end:** one small live payment (as done for pricing v2) with the
  Paystack webhook URL pointed at `hooks.feasty.com.ng`, confirming order
  reaches `paid` via the queue path.

## 9. Rollout order and operator actions

1. **User:** complete Cloudflare DNS records + NS swap at DomainKing
   (prerequisite for everything; runbook already exists).
2. Ship A1a (zone toggle + `media.ts` env-gated change + `img` DNS record) —
   verify live.
3. Ship A2 (hooks Worker + secret + Paystack dashboard URL change) — verify
   with live E2E payment.
4. Ship A1b (edge-cache Worker + client base-URL change riding the pending
   mobile builds).

A2 before A1b because it's the money path and needs no client builds.

**Plan/cost note:** queue creation succeeded on the current plan; if
producer/consumer bindings turn out to require Workers Paid at deploy time,
upgrading to the $5/month plan is a user action (purchase) before step 3.

## 10. Decisions log

- Cloudflare Queues chosen over "rely on Paystack retries" because it makes
  webhook durability deterministic and observable (DLQ) instead of best-effort.
- Edge signature verification accepted despite secret duplication (spam control
  for the queue; origin still verifies).
- `img.` dummy-origin hostname over proxying the root domain: keeps Vercel
  (root/admin/partner) DNS-only and untangled from proxy/SSL concerns.
- Two small Workers over one gateway Worker: independent blast radius,
  independent rollback.
- A3 (order intents during outage) deferred: pricing v2 markup, stock, and
  payment init all live in Postgres; doing this safely needs its own design.
