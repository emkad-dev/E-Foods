// Explicit `.ts` specifier for the same reason packages/auth/src/backendRpc.ts
// uses one for its own relative imports: `node --test --experimental-strip-types`
// refuses extensionless relative ESM specifiers, and every consuming
// tsconfig sets `allowImportingTsExtensions`.
//
// This is the one place observability reaches into another package. It reads
// ONLY the session-expired string constant (no behavior, no class), and
// session.ts itself imports nothing local, so the graph stays a DAG:
// backendRpc.ts -> userMessage.ts -> session.ts, never back around. Importing
// the real constant keeps this file and packages/auth/src/session.ts from
// drifting apart, which a hand-copied literal could not guarantee.
import { SESSION_EXPIRED_ERROR_MESSAGE } from '../../auth/src/session.ts';

const RATE_LIMITED_MESSAGE_TEXT = 'Too many attempts. Please wait a moment and try again.';
const SERVER_FAULT_MESSAGE_TEXT = 'Something went wrong on our side. Please try again in a moment.';
const UNREACHABLE_MESSAGE_TEXT = "Can't reach FEASTY right now. Check your connection and try again.";
const DEFAULT_FALLBACK_MESSAGE_TEXT = 'Something went wrong. Please try again.';

/**
 * App-thrown constants that are already written for a human and should pass
 * through `toUserMessage` unchanged. Task 3b adds its own friendly constants
 * here as the app screens are switched over.
 */
export const FRIENDLY_PASSTHROUGH = new Set<string>([SESSION_EXPIRED_ERROR_MESSAGE]);

/**
 * Disqualifies a server-written message from being shown to a user verbatim.
 * The server does not sanitize 5xx text (see backendRpc.ts), and even a 4xx
 * body can carry a raw driver/proxy string when something upstream breaks —
 * this is what keeps THAT out of a toast while still letting through
 * deliberate copy like "This restaurant is paused right now."
 */
const UNSAFE_MESSAGE_PATTERN =
  /backend rpc|http \d{3}|<html|<!doctype|column|relation|violates|constraint|syntax error|schema cache|null value|undefined|typeerror|referenceerror|stack|at .+\(.+:\d+/i;

export const isSafeServerMessage = (message: string): boolean => {
  const trimmed = message.trim();

  if (!trimmed || trimmed.length > 180 || trimmed.includes('\n') || trimmed.includes('\r')) {
    return false;
  }

  return !UNSAFE_MESSAGE_PATTERN.test(trimmed);
};

/** The exact fallback `backendRpcErrorFromResponse` writes when a response body has no usable message. */
const RPC_HTTP_FALLBACK_PATTERN = /^backend rpc .+ failed with http \d+\.?$/i;
const HTML_BODY_PATTERN = /<html|<!doctype/i;

/** Body-shape faults: not a status this app assigned meaning to, just an unparseable or markup response. */
const isUnparseableServerFailure = (message: string | null): boolean => {
  if (!message) {
    return false;
  }

  return HTML_BODY_PATTERN.test(message) || RPC_HTTP_FALLBACK_PATTERN.test(message);
};

const TRANSPORT_FAILURE_NAMES = new Set(['FunctionsFetchError', 'FunctionsRelayError', 'NetworkError']);
const TRANSPORT_FAILURE_MESSAGE_PATTERN =
  /network request failed|failed to fetch|failed to send a request|load failed|network ?error|timed? ?out|ECONNRESET|ENOTFOUND/i;

const isTransportFailure = (error: unknown, message: string | null): boolean => {
  const name = error instanceof Error ? error.name : undefined;
  if (name && TRANSPORT_FAILURE_NAMES.has(name)) {
    return true;
  }

  // A `TypeError` is fetch's own transport-failure type (browsers and
  // React Native both throw one for "Failed to fetch" / "Network request
  // failed"), but `TypeError` is also just JavaScript's generic type error
  // for anything reaching into a property that isn't there. Being a
  // TypeError alone isn't evidence of a network problem -- only a message
  // that actually looks network-shaped is.
  return message ? TRANSPORT_FAILURE_MESSAGE_PATTERN.test(message) : false;
};

const getErrorMessage = (error: unknown): string | null => {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }

  return null;
};

const getErrorCode = (error: unknown): string | null => {
  if (error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string') {
    const code = (error as { code: string }).code.trim().toLowerCase();
    return code || null;
  }

  return null;
};

/**
 * Structural, not `instanceof BackendRpcError`: importing that class here
 * would make packages/observability depend on packages/auth for real
 * behavior (the reverse of the direction backendRpc.ts needs, and the start
 * of a circular import). `isBackendRpcError` in packages/auth/src/backendRpc.ts
 * already duck-types for exactly this reason — this mirrors it.
 */
const getBackendRpcStatus = (error: unknown): number | undefined => {
  if (
    error instanceof Error &&
    error.name === 'BackendRpcError' &&
    typeof (error as unknown as { status?: unknown }).status === 'number'
  ) {
    return (error as unknown as { status: number }).status;
  }

  return undefined;
};

type SupabaseAuthRule = {
  codes?: string[];
  matchesMessage: (lowerCaseMessage: string) => boolean;
  message: string;
};

// Order does not matter across rules: code-matching and message-matching are
// each tried as a single pass over this list, and codes are unique per rule.
const SUPABASE_AUTH_RULES: SupabaseAuthRule[] = [
  {
    codes: ['invalid_credentials'],
    matchesMessage: (m) => m.includes('invalid login credentials'),
    message: "That email or password isn't right.",
  },
  {
    codes: ['email_not_confirmed'],
    matchesMessage: (m) => m.includes('email not confirmed'),
    message: 'Please confirm your email first. Check your inbox for the code.',
  },
  {
    codes: ['user_already_exists'],
    matchesMessage: (m) => m.includes('user already registered'),
    message: 'An account with this email already exists. Try signing in instead.',
  },
  {
    codes: ['weak_password'],
    matchesMessage: (m) => m.includes('password should be'),
    message: 'That password is too weak. Please choose a stronger one.',
  },
  {
    codes: ['over_email_send_rate_limit', 'over_request_rate_limit'],
    matchesMessage: (m) => m.includes('rate limit'),
    message: RATE_LIMITED_MESSAGE_TEXT,
  },
  {
    codes: ['otp_expired'],
    matchesMessage: (m) => m.includes('token has expired') || (m.includes('otp') && m.includes('expired')),
    message: 'That code has expired. Request a new one.',
  },
  {
    // No dedicated code from Supabase for this one; message-only.
    matchesMessage: (m) => m.includes('invalid') && (m.includes('otp') || m.includes('token')),
    message: "That code isn't right. Check it and try again.",
  },
];

/**
 * Match on `code` when present (Supabase auth errors carry one); fall back to
 * the message only when there is no code to trust.
 */
const matchSupabaseAuthError = (error: unknown, message: string | null): string | null => {
  const code = getErrorCode(error);

  if (code) {
    const byCode = SUPABASE_AUTH_RULES.find((rule) => rule.codes?.includes(code));
    return byCode?.message ?? null;
  }

  if (!message) {
    return null;
  }

  const lower = message.toLowerCase();
  const byMessage = SUPABASE_AUTH_RULES.find((rule) => rule.matchesMessage(lower));
  return byMessage?.message ?? null;
};

/**
 * Translate any error this app can throw or receive into text a user can be
 * shown. Every other row is generic; only the first is server copy passed
 * through verbatim, and only because it was already screened as safe.
 */
export const toUserMessage = (error: unknown, fallback?: string): string => {
  const message = getErrorMessage(error);

  if (message && FRIENDLY_PASSTHROUGH.has(message)) {
    return message;
  }

  const status = getBackendRpcStatus(error);

  if (status === 401 || message === SESSION_EXPIRED_ERROR_MESSAGE) {
    return SESSION_EXPIRED_ERROR_MESSAGE;
  }

  if (status === 429) {
    return RATE_LIMITED_MESSAGE_TEXT;
  }

  if ((status !== undefined && status >= 500) || isUnparseableServerFailure(message)) {
    return SERVER_FAULT_MESSAGE_TEXT;
  }

  if (status !== undefined && status >= 400 && status <= 499) {
    if (message && isSafeServerMessage(message)) {
      return message;
    }
    // An unsafe 4xx message falls through -- never shown raw, and not
    // forced into the 500 copy either, since it wasn't a server fault.
  }

  if (isTransportFailure(error, message)) {
    return UNREACHABLE_MESSAGE_TEXT;
  }

  const supabaseMapped = matchSupabaseAuthError(error, message);
  if (supabaseMapped) {
    return supabaseMapped;
  }

  return fallback ?? DEFAULT_FALLBACK_MESSAGE_TEXT;
};

/**
 * The choke point's reporting rule, kept here so it can share the exact same
 * "safe" definition `toUserMessage` uses rather than a second copy of it.
 * A 4xx `BackendRpcError` with a safe message is an expected rejection (a
 * paused restaurant, a wrong code) -- not a fault, so it is not reported. A
 * `FRIENDLY_PASSTHROUGH` message (e.g. session expiry, which is thrown as a
 * plain, status-less `Error` and so would otherwise always return `true`
 * below) is the same kind of expected outcome and is excluded for the same
 * reason. Everything else -- 5xx, transport failures, unparseable bodies,
 * and an unsafe 4xx message that leaked something it should not have -- is
 * reported.
 */
export const shouldReportRpcFailure = (error: unknown): boolean => {
  const message = getErrorMessage(error);

  if (message && FRIENDLY_PASSTHROUGH.has(message)) {
    return false;
  }

  const status = getBackendRpcStatus(error);

  if (status !== undefined && status >= 400 && status <= 499) {
    if (message && isSafeServerMessage(message)) {
      return false;
    }
  }

  return true;
};
