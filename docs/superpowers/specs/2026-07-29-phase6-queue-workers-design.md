# Phase 6 — Persistent Queue Workers (Redis Streams + Node Service)

**Date:** 2026-07-29
**Status:** SUPERSEDED by `2026-07-29-zero-cost-backend-scaling-design.md`
(2026-07-29, user constraint: no added recurring cost — this design requires an
always-on container at ~$5–10/mo). Retained because §2's finding still holds:
`queue-drainer`'s existing HTTP interface means no handler code ever needs to
move. Revisit if throughput justifies the container.
**Depends on:** `2026-07-29-redis-adoption-design.md` (phase 1 wrapper must exist)
**Scope:** The one Chowdeck backend capability phases 1–5 cannot deliver —
real queue workers with blocking consumers, at-least-once delivery, automatic
reclaim of stuck jobs, and a dead-letter path.

## 1. Why this phase exists

`2026-07-29-redis-adoption-design.md` §12 records that phases 1–5 hit three of
Chowdeck's four backend capabilities. The gap is queue workers.

Phase 5 makes job pickup sub-second by invoking `queue-drainer` directly on
enqueue, but that invoke is **fire-and-forget with no delivery guarantee**. If
the HTTP call fails — cold start, transient network, function timeout — the job
falls back to waiting for the next pg_cron tick. That is acceptable today and is
not parity.

Parity requires a process that is *always listening*: a consumer that blocks on
the queue, picks a job up the instant it lands, and whose failure to finish a
job is detected and retried automatically rather than silently.

## 2. The key structural finding

**No handler code moves.** `queue-drainer` already exposes exactly the interface
a worker needs (`supabase/functions/queue-drainer/index.ts`):

- HTTP POST with an `x-queue-worker-token` header (line 70–79)
- A `queue` selector accepting `order-placement`, `payment-verification`,
  `notifications`, or `all` (line 63–68)
- Batch size and concurrency parameters (line 262–263)
- `runWithBackpressure` guarding against concurrent drains (line 270–275)

So the Node service is a **signal consumer, not a job processor**. It blocks on a
Redis Stream, and on each message POSTs to the existing drainer. All money-path
logic — `handleOrderPlacement`, `handlePaymentVerification`,
`markPaymentVerificationFailed`, the `IdempotencyRecord` guards, the retry and
terminal-failure transitions — stays exactly where it is today, tested and
unchanged.

This is what makes phase 6 small. Earlier framing assumed the Node service would
own the handlers, requiring the Deno handler modules to be extracted into
`packages/` for cross-runtime use. That work is not needed and is explicitly out
of scope.

## 3. Architecture

```
enqueue* (edge fn) ──┬──► Postgres queue_* row      (durable, authoritative)
                     └──► XADD feasty:<env>:q:signal  (fast path)

Node worker (always on) ──XREADGROUP (blocking, 5s)──► signal
                        └──► POST queue-drainer {queue}   ──► existing handlers
                        └──► XACK on 2xx
                        └──► XAUTOCLAIM stuck entries (min-idle 120s)
                        └──► XADD to :dlq after 10 delivery attempts

pg_cron queue-drainer (unchanged) ──► backstop, still runs every tick
```

The stream carries a **signal**, not a payload: `{ queue, jobId, enqueuedAt }`.
The job itself never leaves Postgres. A lost or duplicated stream message
therefore cannot lose or double-execute a job — at worst it triggers a drain
that finds nothing, or misses a drain that the cron backstop picks up.

That property is what keeps this safe on the money path.

## 4. What Redis Streams provide that phase 5 does not

| Capability | Phase 5 (direct invoke) | Phase 6 (Streams) |
| --- | --- | --- |
| Pickup latency | Sub-second when the invoke succeeds | Sub-second, blocking read |
| Delivery guarantee | None — fire-and-forget | At-least-once via consumer group |
| Stuck worker detected | No | `XAUTOCLAIM` after 120 s idle |
| Retry on consumer crash | Falls back to cron tick | Automatic redelivery |
| Dead-letter | None | `:dlq` stream after 10 attempts |
| Consumer lag observable | No | `XLEN` vs group pending |
| Horizontal scaling | N/A | Add replicas to the consumer group |

## 5. Where the service runs

**Recommendation: a single managed container (Fly.io or Railway), not a raw VPS.**

The user's earlier evaluation of self-hosting correctly identified operational
commitment — not the ~$6–20/mo — as the blocker. A managed container platform
removes most of that commitment while preserving the exit: the deliverable is a
`Dockerfile` plus a Node process, which moves to a VPS, to Cloudflare
Containers, or anywhere else without code changes.

| Option | Monthly | Ops burden | Notes |
| --- | --- | --- | --- |
| Fly.io / Railway container | ~$5–10 | Low — restarts, health checks, rolling deploys handled | Recommended |
| Hetzner VPS | ~$5–15 | High — patching, monitoring, no failover | Real independence, real cost in attention |
| Cloudflare Containers | varies | Low | Keeps single-platform consolidation; newer, verify current limits |

Start with one replica. Consumer groups make adding replicas a scaling decision
later, not a rewrite.

## 6. Service design

One process, one responsibility. Roughly 150 lines.

**Structure** — new top-level `services/queue-worker/`:

- `src/index.ts` — startup, consumer group creation (`XGROUP CREATE MKSTREAM`),
  main loop, graceful shutdown
- `src/consumer.ts` — `XREADGROUP` loop with 5 s block, `XACK` on success
- `src/reclaim.ts` — periodic `XAUTOCLAIM` for entries idle > 120 s, DLQ after
  10 delivery attempts
- `src/drainer.ts` — the HTTP client for `queue-drainer`
- `Dockerfile`, `fly.toml`

**Redis client:** `ioredis` over RESP directly to Upstash's TCP endpoint (Upstash
exposes both REST and RESP). This is the first consumer of the non-REST
transport and validates the portability claim in the phase-1 spec — the same
Redis, a different transport, no call-site changes elsewhere.

**Blocking read:** `XREADGROUP GROUP workers <consumerId> BLOCK 5000 COUNT 10
STREAMS feasty:<env>:q:signal >`. The 5 s block bounds shutdown latency; it is
not a poll interval — messages arrive immediately.

**Graceful shutdown:** on `SIGTERM`, stop reading, await in-flight drains, `XACK`
them, then exit. Anything unacked is reclaimed by `XAUTOCLAIM` on the next
worker.

**Health:** an HTTP `/health` endpoint reporting last successful read time and
current group pending count, for the platform's health check.

## 7. Migration path

Deliberately incremental. Each step is independently reversible and the system
is correct at every point.

1. **Dual-write.** `_shared/queue.ts` `enqueue*` functions add an `XADD`
   alongside the existing Postgres insert. Env-gated on the phase-1 wrapper —
   secrets unset ⇒ no `XADD`, behaviour identical to today.
2. **Deploy the worker with the drain call disabled** (log-only). Confirm it
   consumes signals, that lag stays near zero, and that `XAUTOCLAIM` behaves
   under a forced crash. Nothing in production depends on it yet.
3. **Enable the drain call.** The worker now triggers real drains. The pg_cron
   drainer keeps running; it simply finds less work.
4. **Reduce the cron frequency** once worker-triggered drains prove reliable —
   from its current schedule to a slower backstop tick. Do **not** remove it.
5. **Optional, later:** drop phase 5's direct-invoke path, now redundant.

**Rollback at any step:** stop the worker. The cron drainer resumes full
responsibility with no data loss, because Postgres was authoritative the whole
time.

## 8. Error handling

| Failure | Behaviour |
| --- | --- |
| Node worker down | pg_cron drainer handles everything; latency returns to tick interval |
| Redis down | `XADD` fails and is logged; Postgres row still written; cron drains |
| Worker crashes mid-drain | Entry unacked ⇒ `XAUTOCLAIM` redelivers after 120 s; handlers are idempotent so re-drain is safe |
| Drainer returns non-2xx | No `XACK`; redelivered; after 10 attempts → `:dlq` |
| Drainer returns 429 (backpressure) | Treated as retryable; `XCLAIM` delay before redelivery |
| Duplicate stream message | Drain finds the row already `completed`; no-op |
| DLQ grows | No consumer; inspected manually. Alerting is a follow-up, not in scope |
| Both Redis and worker down | Fully degraded to today's cron-only behaviour |

Every row degrades to current behaviour — the same property phases 1–5 hold.

## 9. Testing

- **Consumer:** integration test against a local Redis (or Upstash test DB) —
  `XADD` a signal, assert the drainer client is called with the right queue.
- **Reclaim:** publish a signal, read it without acking, kill the consumer,
  assert `XAUTOCLAIM` redelivers after the idle window.
- **DLQ:** force the drainer client to fail, assert the entry lands in `:dlq`
  after exactly 10 delivery attempts.
- **Graceful shutdown:** `SIGTERM` mid-drain, assert in-flight work is acked and
  no entry is orphaned.
- **Idempotency under redelivery:** deliver the same signal twice concurrently,
  assert exactly one order/payment state transition — this is the money-path
  guard and the most important test in the phase.
- **End-to-end:** one live order through the full path, confirming sub-second
  pickup and `paid` status via the worker rather than cron.

## 10. Operator actions

1. Choose and provision the container platform (user action, purchase).
2. Add the Upstash **RESP/TCP** connection URL as a service secret (distinct
   from the REST URL used by edge functions).
3. Set `QUEUE_WORKER_TOKEN` and the `queue-drainer` function URL as service
   secrets — reuse the existing token, no new auth surface.
4. Deploy log-only, observe for a day, then enable draining.

## 11. Where this lands against the Chowdeck bar

| Capability | Phases 1–5 | + Phase 6 |
| --- | --- | --- |
| Sub-second rider tracking | Yes | Yes |
| Geo-ranked courier assignment | Yes | Yes |
| Surge absorption at cache layer | Yes | Yes |
| Real queue workers (blocking consumers) | No | **Yes** |

With phase 6, all four are met.

Worth stating plainly: parity on these four is parity on *backend capability*,
not on everything Chowdeck operates. Multi-region, an on-call rotation, fraud
tooling, and rider supply/demand modelling are all outside this design and are
not implied by it.

## 12. Decisions log

- **Signal-only streams, payload stays in Postgres:** makes lost or duplicated
  messages harmless and keeps money-path logic in one tested place.
- **No handler extraction to `packages/`:** the drainer's existing HTTP
  interface removes the need entirely; this is the decision that makes phase 6
  small.
- **Managed container over VPS:** preserves the user's stated reluctance to take
  on uptime while keeping the deliverable (a Dockerfile) portable.
- **`ioredis` over RESP rather than the REST wrapper:** blocking reads are the
  whole point and REST cannot do them; this also proves the phase-1 transport
  abstraction is real.
- **pg_cron drainer retained permanently:** the backstop is what makes every
  step of the migration reversible. Slowing it is fine; removing it is not.
- **DLQ has no automatic consumer:** matches the existing Cloudflare
  `paystack-webhook-dlq` decision in the edge-shield spec; manual inspection is
  the intended workflow at this scale.
