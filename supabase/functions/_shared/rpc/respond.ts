// RPC response construction: the JSON envelope, the `fail()` throw helper, and
// the error -> HTTP bridge used by the app-rpc entrypoint.

import { corsHeaders } from '../cors.ts';
import { getErrorStatus, jsonResponse } from '../observability.ts';

export class RpcError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'RpcError';
    this.status = status;
  }
}

export const fail = (status: number, message: string): never => {
  throw new RpcError(status, message);
};

export const json = (status: number, body: unknown, headers: HeadersInit = {}) =>
  jsonResponse(status, body, {
    ...corsHeaders,
    ...headers,
  });

// RpcError and EdgeBackpressureError both carry a numeric `.status` in the
// 400-599 range, so getErrorStatus() resolves them the same way the old
// per-type checks did. "This account is disabled." is thrown as a plain
// Error with no `.status` (see _shared/request-context.ts), so it still
// needs an explicit mapping or it would fall through to 500.
export const errorResponse = (error: unknown) => {
  const status =
    error instanceof Error && error.message === 'This account is disabled.'
      ? 403
      : getErrorStatus(error);

  return json(
    status,
    {
      error: {
        message: error instanceof Error ? error.message : 'Unexpected Edge RPC failure.',
      },
    },
    error instanceof Error && 'retryAfterSeconds' in error
      ? { 'Retry-After': String((error as { retryAfterSeconds?: number }).retryAfterSeconds ?? 3) }
      : {}
  );
};
