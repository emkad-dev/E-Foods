/// <reference path="./edge-runtime.d.ts" />

// Paystack transport. Nothing here knows about orders — it only turns a
// configured secret key into a signed API call, so the money-path handlers stay
// the single place that decides what a gateway answer means.

import { DEFAULT_CURRENCY } from './orders.ts';
import type { JsonObject } from './rpc/coercion.ts';
import { parseNumber, roundCurrency, sanitizeOptionalText, sanitizeText } from './rpc/coercion.ts';
import { fail } from './rpc/respond.ts';

const PAYSTACK_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_PAYSTACK_CALLBACK_URL = 'https://feasty.com/payment/callback';

export const getPaystackSecretKey = () => sanitizeText(Deno.env.get('PAYSTACK_SECRET_KEY'));
export const getPaystackPublicKey = () => sanitizeText(Deno.env.get('PAYSTACK_PUBLIC_KEY'));

const getPaystackCallbackUrl = () =>
  sanitizeOptionalText(Deno.env.get('PAYSTACK_CALLBACK_URL')) ?? DEFAULT_PAYSTACK_CALLBACK_URL;

/**
 * Client-supplied callback URLs are only honoured when they point at the one
 * path we own, on a scheme we recognise. Anything else falls back to the
 * configured URL — a Paystack callback is an open-redirect surface otherwise.
 */
export const getNormalizedPaystackCallbackUrl = (callbackUrl: unknown) => {
  const rawCallbackUrl = sanitizeOptionalText(callbackUrl);

  if (!rawCallbackUrl) {
    return getPaystackCallbackUrl();
  }

  try {
    const parsed = new URL(rawCallbackUrl);
    const scheme = parsed.protocol.replace(/:$/, '').toLowerCase();
    const pathname = parsed.pathname.replace(/^\/+|\/+$/g, '');

    if ((scheme === 'http' || scheme === 'https') && pathname === 'payment/callback') {
      return parsed.toString();
    }

    if (scheme === 'feasty-customer' && pathname === 'payment/callback') {
      return parsed.toString();
    }
  } catch {
    // Fall back to the configured environment callback below.
  }

  return getPaystackCallbackUrl();
};

export const assertPaystackConfigured = () => {
  if (!getPaystackSecretKey() || !getPaystackPublicKey()) {
    fail(
      412,
      'Paystack is not configured for this backend yet. Add PAYSTACK_SECRET_KEY and PAYSTACK_PUBLIC_KEY first.'
    );
  }
};

export const toKoboAmount = (amount: number) => Math.round(roundCurrency(parseNumber(amount, 0)) * 100);
export const fromKoboAmount = (amount: unknown) => roundCurrency(parseNumber(amount, 0) / 100);

const mapPaystackChannels = (paymentMethod: string) => {
  switch (paymentMethod) {
    case 'card':
      return ['card'];
    case 'bank_transfer':
      return ['bank_transfer'];
    default:
      return [];
  }
};

export const buildPaystackReference = (orderId: string, paymentMethod: string) => {
  const prefix = paymentMethod === 'bank_transfer' ? 'BNK' : 'CRD';
  return `FEASTY-${prefix}-${orderId.slice(-8).toUpperCase()}-${Date.now()}`;
};

const fetchPaystackJson = async ({
  method = 'GET',
  path,
  body = null,
}: {
  body?: JsonObject | null;
  method?: string;
  path: string;
}) => {
  assertPaystackConfigured();

  let response: Response;
  try {
    response = await fetch(`https://api.paystack.co${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${getPaystackSecretKey()}`,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(PAYSTACK_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      fail(504, `Paystack request to ${path} timed out after ${PAYSTACK_REQUEST_TIMEOUT_MS}ms.`);
    }
    throw error;
  }

  const payload = (await response.json().catch(() => null)) as
    | {
        data?: JsonObject | null;
        message?: string;
        status?: boolean;
      }
    | null;

  if (!response.ok || payload?.status !== true) {
    fail(500, sanitizeText(payload?.message, `Paystack request to ${path} failed.`));
  }

  return (payload?.data ?? null) as JsonObject | null;
};

export const initializePaystackTransaction = async ({
  amount,
  callbackUrl,
  email,
  metadata,
  paymentMethod,
  reference,
  subaccount = null,
  transactionCharge = null,
}: {
  amount: number;
  callbackUrl?: string | null;
  email: string;
  metadata: JsonObject;
  paymentMethod: string;
  reference: string;
  subaccount?: string | null;
  transactionCharge?: number | null;
}) => {
  const payload: JsonObject = {
    amount: String(toKoboAmount(amount)),
    channels: mapPaystackChannels(paymentMethod),
    currency: DEFAULT_CURRENCY,
    email,
    metadata: JSON.stringify(metadata),
    reference,
  };

  if (subaccount) {
    payload.subaccount = subaccount;
  }

  if (transactionCharge !== null && transactionCharge !== undefined) {
    payload.transaction_charge = String(toKoboAmount(transactionCharge));
  }

  if (callbackUrl) {
    payload.callback_url = callbackUrl;
  }

  return (await fetchPaystackJson({
    method: 'POST',
    path: '/transaction/initialize',
    body: payload,
  })) as JsonObject;
};

// Resolves the human-readable account name for a bank account. Read-only Paystack
// call; used both during onboarding submission and as a live client check.
export const resolvePaystackBankAccount = async ({
  accountNumber,
  bankCode,
}: {
  accountNumber: string;
  bankCode: string;
}) => {
  const query = `account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`;
  const data = (await fetchPaystackJson({
    method: 'GET',
    path: `/bank/resolve?${query}`,
  })) as JsonObject | null;

  return {
    accountName: sanitizeText(data?.account_name),
    accountNumber: sanitizeText(data?.account_number, accountNumber),
  };
};

export const verifyPaystackTransaction = async (reference: string) =>
  (await fetchPaystackJson({
    method: 'GET',
    path: `/transaction/verify/${encodeURIComponent(reference)}`,
  })) as JsonObject;
