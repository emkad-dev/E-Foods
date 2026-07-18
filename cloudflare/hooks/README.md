# feasty-hooks — Paystack webhook edge buffer

`POST https://hooks.feasty.com.ng/paystack` verifies the Paystack signature,
enqueues `{receivedAt, signature, rawBody}` on the `paystack-webhook-events`
Cloudflare Queue, and returns 200 immediately. The queue consumer (same
Worker) replays the raw body + original `x-paystack-signature` header to the
Supabase `paystack-webhook` function, retrying with backoff for ~6h before
dead-lettering to `paystack-webhook-dlq` (4-day retention). If the enqueue
itself fails, the producer falls back to a direct synchronous forward.

## Deploy

    npx wrangler deploy                           # from this directory
    npx wrangler secret put PAYSTACK_SECRET_KEY   # live Paystack secret key

## DLQ replay runbook

1. Inspect: Cloudflare dash -> Storage & Databases -> Queues -> paystack-webhook-dlq.
2. For each message, POST its `rawBody` verbatim with header
   `x-paystack-signature: <signature>` to
   `https://rgfbheorvtolixdcpjhy.supabase.co/functions/v1/paystack-webhook`.
3. The function is idempotent per payment reference — duplicates are safe.

The Paystack dashboard live webhook URL must point at
`https://hooks.feasty.com.ng/paystack` (Settings -> API Keys & Webhooks).
Rollback = point it back at the Supabase function URL.
