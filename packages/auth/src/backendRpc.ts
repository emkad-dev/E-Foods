import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
  type SupabaseClient,
} from '@supabase/supabase-js';
// Explicit `.ts` specifiers: without them this module cannot be imported by
// `node --test --experimental-strip-types`, which refuses extensionless
// relative ESM specifiers — so the response-error parsing below would have no
// test coverage at all. Every consuming tsconfig sets
// `allowImportingTsExtensions`, and Metro/Vite both resolve the exact path.
import { KNOWN_RPC_TARGETS, resolveRpcMode, resolveRpcTarget } from '../../domain/src/rpcRoutes.ts';
import { deriveRpcFunctionUrl } from '../../domain/src/rpcUrl.ts';
import { clearSupabaseSession, isStaleSupabaseSessionError, SESSION_EXPIRED_ERROR_MESSAGE } from './session.ts';

export interface BackendRpcEnv {
  anonKey?: string;
  backendRpcUrl?: string;
  projectId?: string;
  region?: string;
  supabaseUrl?: string;
  /**
   * Raw EXPO_PUBLIC_RPC_MODE / VITE_RPC_MODE value. Passed through
   * unnormalized — resolveRpcMode below treats unset/blank/unrecognized
   * values as 'split', so callers never need to validate this themselves.
   */
  rpcMode?: string;
}

/**
 * Upper bound on a message lifted out of an error response. The server's own
 * rejections are single sentences; anything approaching this length is an
 * unbounded internal string (a 5xx whose message is the raw Postgres/driver
 * error, or a proxy's HTML error page arriving as the text fallback). Bounding
 * it here keeps an accidental dump from reaching a toast, without suppressing
 * a legitimate message.
 */
const MAX_RPC_ERROR_MESSAGE_LENGTH = 500;

const boundErrorMessage = (message: string) =>
  message.length <= MAX_RPC_ERROR_MESSAGE_LENGTH
    ? message
    : `${message.slice(0, MAX_RPC_ERROR_MESSAGE_LENGTH).trimEnd()}…`;

export type BackendRpcErrorFields = {
  /** HTTP status of the rejected response. */
  status: number;
  /** Structured code from a ClientSafeError, when the server sent one. */
  code?: string;
  /** Structured details from a ClientSafeError, when the server sent one. */
  details?: Record<string, unknown>;
  /** Parsed `Retry-After` header, present on backpressure (429) responses. */
  retryAfterSeconds?: number;
};

/**
 * Thrown for any HTTP-level rejection of a backend RPC.
 *
 * It is still an `Error` whose `.message` is the sentence the server wrote, so
 * every existing `catch (e) { e.message }` caller is unaffected. The status is
 * carried alongside because the server does NOT sanitize 5xx messages
 * (`errorResponse` in supabase/functions/_shared/rpc/respond.ts deliberately
 * bypasses `clientErrorMessage`): without the status, a caller cannot tell a
 * 4xx the user should read and act on from a 5xx whose message may be raw
 * implementation detail.
 */
export class BackendRpcError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: Record<string, unknown>;
  readonly retryAfterSeconds?: number;

  constructor(message: string, fields: BackendRpcErrorFields) {
    super(message);
    this.name = 'BackendRpcError';
    this.status = fields.status;
    this.code = fields.code;
    this.details = fields.details;
    this.retryAfterSeconds = fields.retryAfterSeconds;
  }
}

/**
 * Structural rather than `instanceof`: each app bundles its own copy of this
 * module, so an error can cross a bundle boundary (or a serialization hop) and
 * fail an identity check while still being exactly this shape.
 */
export const isBackendRpcError = (error: unknown): error is BackendRpcError =>
  error instanceof Error &&
  error.name === 'BackendRpcError' &&
  typeof (error as { status?: unknown }).status === 'number';

type ParsedRpcErrorBody = {
  message: string | null;
  code?: string;
  details?: Record<string, unknown>;
};

const readStructuredFields = (source: Record<string, unknown>) => ({
  ...(typeof source.code === 'string' && source.code.trim() ? { code: source.code.trim() } : null),
  ...(source.details && typeof source.details === 'object' && !Array.isArray(source.details)
    ? { details: source.details as Record<string, unknown> }
    : null),
});

/**
 * Extract the human-readable message from a parsed error body.
 *
 * Every edge function answers with `{ error: { message } }` (see
 * `errorResponse`), but the previous implementation only accepted a STRING at
 * `message` / `error` / `msg`. A nested object failed the `typeof === 'string'`
 * guard, so the message was silently dropped and the raw JSON envelope was
 * thrown at the user instead. The nested shape is handled here; the three flat
 * shapes keep working, in their original precedence order, because callers
 * outside the RPC envelope may still produce them.
 *
 * Unwrapping is deliberately ONE level deep and type-checked at each step: an
 * error body is attacker-influenced input in the general case, and recursing
 * for "some string, anywhere" is how internals get surfaced by accident.
 */
export const parseBackendRpcErrorBody = (body: unknown): ParsedRpcErrorBody => {
  // A bare JSON string body is its own message; without this it would fall
  // through to the text fallback and be rendered complete with its quotes.
  if (typeof body === 'string' && body.trim()) {
    return { message: boundErrorMessage(body.trim()) };
  }

  if (typeof body !== 'object' || body === null) {
    return { message: null };
  }

  const record = body as Record<string, unknown>;

  for (const key of ['message', 'error', 'msg'] as const) {
    const candidate = record[key];

    if (typeof candidate === 'string' && candidate.trim()) {
      return { message: boundErrorMessage(candidate.trim()) };
    }

    // The canonical envelope: `{ error: { message, code?, details? } }`. The
    // structured fields ride along only from the SAME object that supplied the
    // message, so a caller reading `code` knows it describes that message.
    if (key === 'error' && candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      const nested = candidate as Record<string, unknown>;

      if (typeof nested.message === 'string' && nested.message.trim()) {
        return {
          message: boundErrorMessage(nested.message.trim()),
          ...readStructuredFields(nested),
        };
      }
    }
  }

  return { message: null };
};

const parseRetryAfterSeconds = (header: string | null) => {
  const seconds = Number(header?.trim());
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
};

/**
 * Build the error to throw for a non-OK RPC response. Shared by the direct-URL
 * and Supabase-relay paths, which previously carried two copies of the same
 * (identically broken) parsing block.
 */
export const backendRpcErrorFromResponse = async (
  response: Response,
  action: string
): Promise<BackendRpcError> => {
  const status = response.status;
  const retryAfterSeconds = parseRetryAfterSeconds(response.headers.get('Retry-After'));
  const base: BackendRpcErrorFields = {
    status,
    ...(retryAfterSeconds === undefined ? null : { retryAfterSeconds }),
  };

  let parsed: ParsedRpcErrorBody | null = null;

  try {
    // Clone so the text fallback below can still read the body.
    parsed = parseBackendRpcErrorBody(await response.clone().json());
  } catch {
    // Not JSON (empty body, proxy HTML, truncated response) — fall through.
    parsed = null;
  }

  if (parsed?.message) {
    return new BackendRpcError(parsed.message, {
      ...base,
      ...(parsed.code === undefined ? null : { code: parsed.code }),
      ...(parsed.details === undefined ? null : { details: parsed.details }),
    });
  }

  // Only reached when the body was NOT valid JSON. A body that parsed but held
  // no message deliberately does not fall through here: re-serializing it is
  // precisely the defect this function exists to prevent.
  if (!parsed) {
    const text = await response.text().catch(() => '');

    if (text.trim()) {
      return new BackendRpcError(boundErrorMessage(text.trim()), base);
    }
  }

  return new BackendRpcError(`Backend RPC ${action} failed with HTTP ${status}.`, base);
};

export const callBackendRpc = async <T>(
  supabase: SupabaseClient,
  env: BackendRpcEnv,
  action: string,
  data?: Record<string, unknown>
): Promise<T> => {
  // Resolve the routing target before doing anything else — including
  // before the session dance below. An unknown action must fail
  // immediately and loudly, never proceed as if it were routable.
  const rpcMode = resolveRpcMode(env.rpcMode);
  const targetFunction = resolveRpcTarget(action, rpcMode);

  const resolveSession = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (session?.access_token) {
      return session;
    }

    const refreshResult = await supabase.auth.refreshSession().catch((error) => ({ error, data: null }));
    const refreshedSession = refreshResult?.data?.session ?? null;

    if (refreshedSession?.access_token) {
      return refreshedSession;
    }

    if (isStaleSupabaseSessionError(refreshResult?.error)) {
      await clearSupabaseSession(supabase);
      throw new Error(SESSION_EXPIRED_ERROR_MESSAGE);
    }

    return session;
  };

  const session = await resolveSession();

  if (!session?.access_token) {
    throw new Error(SESSION_EXPIRED_ERROR_MESSAGE);
  }

  const payload = {
    action,
    data: data ?? {},
  };

  const parseResponseError = async (response: Response) => {
    const responseForJson = response.clone();
    let parsedMessage: string | null = null;

    try {
      const body = await responseForJson.json();
      const message =
        typeof body === 'object' && body !== null
          ? (body as { message?: unknown }).message ??
            (body as { error?: unknown }).error ??
            (body as { msg?: unknown }).msg
          : null;

      if (typeof message === 'string' && message.trim()) {
        parsedMessage = message.trim();
      }
    } catch {
      // Ignore JSON parse errors and fall back to text below.
    }

    if (parsedMessage) {
      return parsedMessage;
    }

    const text = await response.text().catch(() => '');

    if (text.trim()) {
      return text.trim();
    }

    return `Backend RPC ${action} failed with HTTP ${response.status}.`;
  };

  const callViaDirectUrl = async () => {
    if (!env.backendRpcUrl?.trim()) {
      return null;
    }

    // Rewrite the configured app-rpc URL's last path segment to target the
    // resolved domain function (or, in legacy mode, back to app-rpc). A
    // malformed configured URL throws here and is treated as a
    // transport-level failure by the catch below, falling back to the
    // relay — it is not a routing bug, so it doesn't need to fail loudly
    // the way an unknown action does.
    const targetUrl = deriveRpcFunctionUrl(env.backendRpcUrl.trim(), targetFunction, KNOWN_RPC_TARGETS);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    };

    if (env.anonKey?.trim()) {
      headers.apikey = env.anonKey.trim();
    }

    const response = await fetch(targetUrl, {
      body: JSON.stringify(payload),
      headers,
      method: 'POST',
    }).catch((error) => {
      throw new Error(error instanceof Error ? error.message : `Backend RPC ${action} failed to send request.`);
    });

    if (!response.ok) {
      throw new Error(await parseResponseError(response));
    }

    const responseData = (await response.json().catch(() => null)) as { data?: T } | T | null;
    if (responseData && typeof responseData === 'object' && 'data' in responseData) {
      return (responseData as { data: T }).data;
    }

    return responseData as T;
  };

  try {
    const directResponse = await callViaDirectUrl();
    if (directResponse !== null) {
      return directResponse;
    }
  } catch (error) {
    // Fall back to the Supabase function relay if the direct URL path fails.
    console.warn(`Backend RPC ${action} direct URL fallback failed:`, error);
  }

  const { data: responseData, error } = await supabase.functions.invoke<T>(targetFunction, {
    body: payload,
  });

  if (error) {
    if (error instanceof FunctionsHttpError) {
      const response = error.context as Response | undefined;

      if (response) {
        const responseForJson = response.clone();
        let parsedMessage: string | null = null;

        try {
          const body = await responseForJson.json();
          const message =
            typeof body === 'object' && body !== null
              ? (body as { message?: unknown }).message ??
                (body as { error?: unknown }).error ??
                (body as { msg?: unknown }).msg
              : null;

          if (typeof message === 'string' && message.trim()) {
            parsedMessage = message.trim();
          }
        } catch {
          // Ignore JSON parse errors and fall back to text below.
        }

        if (parsedMessage) {
          throw new Error(parsedMessage);
        }

        const text = await response.text().catch(() => '');

        if (text.trim()) {
          throw new Error(text.trim());
        }

        throw new Error(`Backend RPC ${action} failed with HTTP ${response.status}.`);
      }
    }

    if (error instanceof FunctionsRelayError || error instanceof FunctionsFetchError) {
      throw new Error(`Backend RPC ${action} failed: ${error.message}`);
    }

    throw new Error(
      error instanceof Error ? error.message : 'Backend RPC request failed. Check Supabase function availability.'
    );
  }

  if (responseData && typeof responseData === 'object' && 'data' in responseData) {
    return (responseData as { data: T }).data;
  }

  return responseData as T;
};
