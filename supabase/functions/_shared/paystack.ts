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

  // Some callers (resolveBankAccount) put the account number in the query
  // string. `path` must never appear whole in a message that can reach a
  // client, the DB, or the logs — strip the query string once, here, so no
  // current or future caller of fetchPaystackJson can leak it. Do not
  // "restore" the query string for debuggability.
  const safePath = path.split('?')[0];

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
      fail(504, `Paystack request to ${safePath} timed out after ${PAYSTACK_REQUEST_TIMEOUT_MS}ms.`);
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
    fail(500, sanitizeText(payload?.message, `Paystack request to ${safePath} failed.`));
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

// ── Transfers (rider payouts) ──────────────────────────────────────────────
//
// Money LEAVES the platform balance through these, so the transport reports
// what Paystack actually said instead of collapsing everything into a throw:
//   ok        - Paystack answered status:true.
//   rejected  - Paystack answered a 4xx with status:false. Nothing was created
//               (validation, insufficient balance, duplicate reference, ...).
//   unknown   - timeout, network failure, 5xx, unparsable body. The transfer
//               MAY exist. Callers must never treat this as "not sent".
export type PaystackCallOutcome =
  | { data: JsonObject | null; kind: 'ok' }
  | { httpStatus: number; kind: 'rejected'; message: string }
  | { kind: 'unknown'; message: string };

export const callPaystack = async ({
  body = null,
  method = 'GET',
  path,
}: {
  body?: JsonObject | null;
  method?: string;
  path: string;
}): Promise<PaystackCallOutcome> => {
  assertPaystackConfigured();
  const safePath = path.split('?')[0];

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
    return {
      kind: 'unknown',
      message:
        error instanceof DOMException && error.name === 'TimeoutError'
          ? `Paystack request to ${safePath} timed out after ${PAYSTACK_REQUEST_TIMEOUT_MS}ms.`
          : `Paystack request to ${safePath} failed before a response.`,
    };
  }

  const payload = (await response.json().catch(() => null)) as
    | { data?: JsonObject | null; message?: string; status?: boolean }
    | null;

  if (response.ok && payload?.status === true) {
    return { data: (payload.data ?? null) as JsonObject | null, kind: 'ok' };
  }
  if (response.status >= 400 && response.status < 500 && payload && payload.status === false) {
    return {
      httpStatus: response.status,
      kind: 'rejected',
      message: sanitizeText(payload.message, `Paystack rejected ${safePath}.`),
    };
  }
  return {
    kind: 'unknown',
    message: sanitizeText(payload?.message, `Paystack request to ${safePath} returned HTTP ${response.status}.`),
  };
};

// Creates (or, for an account Paystack already knows, returns) a NUBAN
// transfer recipient. Resolve the account first; this does not.
export const createPaystackTransferRecipient = async ({
  accountName,
  accountNumber,
  bankCode,
}: {
  accountName: string;
  accountNumber: string;
  bankCode: string;
}): Promise<{ bankName: string | null; recipientCode: string }> => {
  const data = await fetchPaystackJson({
    method: 'POST',
    path: '/transferrecipient',
    body: {
      account_number: accountNumber,
      bank_code: bankCode,
      currency: DEFAULT_CURRENCY,
      name: accountName,
      type: 'nuban',
    },
  });

  const recipientCode = sanitizeText((data as { recipient_code?: string } | null)?.recipient_code);
  if (!recipientCode) {
    fail(500, 'Paystack created the transfer recipient but returned no recipient code.');
  }
  const details = ((data as { details?: JsonObject } | null)?.details ?? null) as JsonObject | null;
  return { bankName: sanitizeOptionalText(details?.bank_name), recipientCode };
};

/** Paystack transfer references: lowercase alphanumerics, '-' and '_' only. */
export const isValidTransferReference = (reference: string) => /^[a-z0-9_-]{16,100}$/.test(reference);

export const initiatePaystackTransfer = ({
  amountKobo,
  reason,
  recipientCode,
  reference,
}: {
  amountKobo: number;
  reason: string;
  recipientCode: string;
  reference: string;
}): Promise<PaystackCallOutcome> => {
  if (!Number.isInteger(amountKobo) || amountKobo <= 0) {
    throw new Error('Transfer amount must be a positive whole number of kobo.');
  }
  if (!isValidTransferReference(reference)) {
    throw new Error('Transfer reference is not a valid Paystack reference.');
  }
  return callPaystack({
    method: 'POST',
    path: '/transfer',
    body: {
      amount: amountKobo,
      currency: DEFAULT_CURRENCY,
      reason,
      recipient: recipientCode,
      reference,
      source: 'balance',
    },
  });
};

export const verifyPaystackTransfer = (reference: string): Promise<PaystackCallOutcome> =>
  callPaystack({ method: 'GET', path: `/transfer/verify/${encodeURIComponent(reference)}` });

export const verifyPaystackTransaction = async (reference: string) =>
  (await fetchPaystackJson({
    method: 'GET',
    path: `/transaction/verify/${encodeURIComponent(reference)}`,
  })) as JsonObject;

// percentage_charge is 0 on purpose: the platform's revenue is the embedded
// menu markup (pricing v2), not a Paystack commission. Setting anything else
// here would double-charge the restaurant.
export const createPaystackSubaccount = async ({
  accountNumber,
  bankCode,
  businessName,
}: {
  accountNumber: string;
  bankCode: string;
  businessName: string;
}): Promise<{ subaccountCode: string }> => {
  const data = await fetchPaystackJson({
    method: 'POST',
    path: '/subaccount',
    body: {
      account_number: accountNumber,
      settlement_bank: bankCode,
      business_name: businessName,
      percentage_charge: 0,
    },
  });

  const subaccountCode = sanitizeText((data as { subaccount_code?: string } | null)?.subaccount_code);
  if (!subaccountCode) {
    fail(500, 'Paystack created the subaccount but returned no subaccount code.');
  }

  return { subaccountCode };
};
