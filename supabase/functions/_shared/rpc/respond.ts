// RPC response construction: the JSON envelope, the `fail()` throw helper, and
// the error -> HTTP bridge used by the app-rpc entrypoint.

import { corsHeaders } from '../cors.ts';
import { clientErrorExtras, getErrorStatus, jsonResponse } from '../observability.ts';

export class RpcError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'RpcError';
    this.status = status;
  }
}

// The annotation belongs on the CONST, not just on the arrow's return type.
// TypeScript only applies never-returning control-flow analysis to a call
// through a variable whose declared type says it returns `never`; a return
// annotation on an inferred function expression does not qualify. Without it,
// every `if (!x.ok) fail(...)` guard in the domain modules fails to narrow the
// discriminated union that follows.
export const fail: (status: number, message: string) => never = (status, message) => {
  throw new RpcError(status, message);
};

export const json = (status: number, body: unknown, headers: HeadersInit = {}) =>
  jsonResponse(status, body, {
    ...corsHeaders,
    ...headers,
  });

// ClientSafeError, RpcError and EdgeBackpressureError all carry a numeric
// `.status`, so getErrorStatus resolves them directly. The old string
// comparison against "This account is disabled." is gone: accountAccess.ts
// throws a ClientSafeError(403) now, so there is nothing left to special-case.
// clientErrorExtras carries a ClientSafeError's structured code/details (e.g.
// ACCOUNT_PENDING_DELETION plus purgeScheduledAt) out to the client.
export const errorResponse = (error: unknown) => {
  const status = getErrorStatus(error);

  return json(
    status,
    {
      error: {
        message: error instanceof Error ? error.message : 'Unexpected Edge RPC failure.',
        ...clientErrorExtras(error),
      },
    },
    error instanceof Error && 'retryAfterSeconds' in error
      ? { 'Retry-After': String((error as { retryAfterSeconds?: number }).retryAfterSeconds ?? 3) }
      : {}
  );
};
