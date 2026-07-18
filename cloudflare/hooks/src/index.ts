// Paystack webhook edge buffer. Producer: verifies the Paystack HMAC and
// enqueues the raw event so a Supabase outage never loses a payment event.
// Consumer: replays the raw body + original signature to the Supabase
// paystack-webhook function (which re-verifies it unchanged).

export interface Env {
  WEBHOOK_QUEUE: Queue<WebhookMessage>;
  PAYSTACK_SECRET_KEY: string;
  SUPABASE_WEBHOOK_URL: string;
}

export type WebhookMessage = {
  receivedAt: string;
  signature: string;
  rawBody: string;
};

const MAX_BODY_BYTES = 100_000; // queue message limit is 128 KB; Paystack events are a few KB
const RETRY_BASE_SECONDS = 60;
const RETRY_MAX_SECONDS = 900;

const encoder = new TextEncoder();

const hexEncode = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

const computeSignature = async (body: string, secretKey: string) => {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secretKey),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign']
  );
  return hexEncode(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(body)));
};

const timingSafeEqual = (a: string, b: string) => {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const deliverToSupabase = (env: Env, message: WebhookMessage) =>
  fetch(env.SUPABASE_WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-paystack-signature': message.signature,
    },
    body: message.rawBody,
  });

const isDelivered = (response: Response) => response.status >= 200 && response.status < 300;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/paystack') {
      return json(404, { error: 'Not found' });
    }
    if (request.method !== 'POST') {
      return json(405, { error: 'Method not allowed' });
    }

    const rawBody = await request.text();
    if (rawBody.length > MAX_BODY_BYTES) {
      return json(413, { error: 'Payload too large' });
    }

    const signature = request.headers.get('x-paystack-signature') ?? '';
    const expected = await computeSignature(rawBody, env.PAYSTACK_SECRET_KEY);
    if (!signature || !timingSafeEqual(signature.toLowerCase(), expected.toLowerCase())) {
      return json(401, { error: 'Invalid Paystack signature' });
    }

    const message: WebhookMessage = {
      receivedAt: new Date().toISOString(),
      signature,
      rawBody,
    };

    try {
      await env.WEBHOOK_QUEUE.send(message);
    } catch {
      // Queue unavailable: degrade to today's behavior (direct forward).
      const direct = await deliverToSupabase(env, message).catch(() => null);
      if (!direct || !isDelivered(direct)) {
        // Non-200 makes Paystack retry on its own schedule.
        return json(500, { error: 'Enqueue and direct delivery both failed' });
      }
    }

    return json(200, { received: true });
  },

  async queue(batch: MessageBatch<WebhookMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      let response: Response | null = null;
      try {
        response = await deliverToSupabase(env, message.body);
      } catch {
        response = null;
      }

      if (response && isDelivered(response)) {
        message.ack();
        continue;
      }

      // Retry everything (5xx, 4xx, network): exponential backoff 60s -> 120s
      // -> ... capped at 900s; after max_retries (25, ~6h of outage coverage)
      // the message dead-letters to paystack-webhook-dlq. Acking a 4xx would
      // silently drop a payment event, so we deliberately do not.
      const delaySeconds = Math.min(
        RETRY_BASE_SECONDS * 2 ** Math.max(0, message.attempts - 1),
        RETRY_MAX_SECONDS
      );
      message.retry({ delaySeconds });
    }
  },
};
