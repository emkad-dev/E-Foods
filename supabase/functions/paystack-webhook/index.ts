/// <reference path="../_shared/edge-runtime.d.ts" />

import { corsHeaders } from '../_shared/cors.ts';
import { serviceClient } from '../_shared/client.ts';
import { handlePaymentVerification } from '../payment-verification/handler.ts';

type JsonObject = Record<string, unknown>;

const encoder = new TextEncoder();

const hexEncode = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

const computePaystackSignature = async (body: string, secretKey: string) => {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secretKey),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(body));
  return hexEncode(signature);
};

const normalizeText = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const getOrderIdForReference = async (reference: string) => {
  const { data, error } = await serviceClient
    .from('PaymentTransaction')
    .select('orderId')
    .eq('reference', reference)
    .maybeSingle<{ orderId: string }>();

  if (error) {
    throw new Error(`Unable to load payment transaction for webhook reference: ${error.message}`);
  }

  return normalizeText(data?.orderId);
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const paystackSecretKey = Deno.env.get('PAYSTACK_SECRET_KEY') ?? '';
  if (!paystackSecretKey) {
    return new Response(JSON.stringify({ error: 'PAYSTACK_SECRET_KEY not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const signature = req.headers.get('x-paystack-signature') ?? '';
  const rawBody = await req.text();

  const expectedSignature = await computePaystackSignature(rawBody, paystackSecretKey);
  if (!signature || signature.toLowerCase() !== expectedSignature.toLowerCase()) {
    return new Response(JSON.stringify({ error: 'Invalid Paystack signature' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let payload: JsonObject;
  try {
    payload = JSON.parse(rawBody) as JsonObject;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON payload' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const eventType = normalizeText(payload.event);
  const eventData = (payload.data && typeof payload.data === 'object' ? payload.data : null) as JsonObject | null;
  const reference = normalizeText(eventData?.reference);

  if (!reference) {
    return new Response(JSON.stringify({ received: true, ignored: true, reason: 'missing_reference' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (eventType !== 'charge.success') {
    return new Response(
      JSON.stringify({ received: true, ignored: true, event: eventType || 'unknown', reference }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }

  const orderId =
    normalizeText((eventData?.metadata as JsonObject | null)?.orderId) || (await getOrderIdForReference(reference));

  if (!orderId) {
    return new Response(JSON.stringify({ received: true, ignored: true, reason: 'order_not_found', reference }), {
      status: 202,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const result = await handlePaymentVerification({
      orderId,
      paymentReference: reference,
      webhookEvent: payload,
    });

    return new Response(
      JSON.stringify({
        received: true,
        processed: true,
        orderId,
        reference,
        result,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    console.error('Paystack webhook processing failed:', error?.message ?? error);
    return new Response(
      JSON.stringify({
        received: true,
        processed: false,
        orderId,
        reference,
        error: error?.message ?? 'Webhook processing failed',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
