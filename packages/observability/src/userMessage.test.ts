/**
 * Run with: node --test --experimental-strip-types packages/observability/src/userMessage.test.ts
 *
 * `toUserMessage` is the only thing allowed to turn a raw error into text a
 * user sees. Every row here is a promise: give it the shape the brief
 * describes, get back exactly the copy the brief specifies -- verbatim,
 * because that copy is user-facing product text, not implementation detail.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SESSION_EXPIRED_ERROR_MESSAGE } from '../../auth/src/session.ts';
import { FRIENDLY_PASSTHROUGH, isSafeServerMessage, shouldReportRpcFailure, toUserMessage } from './userMessage.ts';

/**
 * Builds an error shaped like `BackendRpcError` without importing the real
 * class -- this test suite must not depend on packages/auth for the same
 * reason userMessage.ts itself does not: it would point the dependency the
 * wrong way.
 */
const backendRpcError = (message: string, status: number, code?: string): Error => {
  const error = new Error(message) as Error & { status: number; code?: string };
  error.name = 'BackendRpcError';
  error.status = status;
  if (code !== undefined) {
    error.code = code;
  }
  return error;
};

const supabaseAuthError = (message: string, code?: string): Error & { code?: string } => {
  const error = new Error(message) as Error & { code?: string };
  if (code !== undefined) {
    error.code = code;
  }
  return error;
};

test('a safe-text BackendRpcError in 400-499 (excluding 401/429) passes through unchanged', () => {
  assert.equal(
    toUserMessage(backendRpcError('This restaurant is paused right now.', 412)),
    'This restaurant is paused right now.'
  );
  assert.equal(toUserMessage(backendRpcError('That code has already been used.', 400)), 'That code has already been used.');
});

test('an unsafe-text 4xx BackendRpcError does not pass through', () => {
  const message = toUserMessage(
    backendRpcError("Could not find the 'orderCount' column of 'OrderGroup' in the schema cache", 400)
  );
  assert.equal(message, 'Something went wrong. Please try again.');
});

test('401 maps to the session-expired line regardless of the server text', () => {
  assert.equal(
    toUserMessage(backendRpcError('Unauthorized', 401)),
    'Your session expired. Please sign in again.'
  );
});

test('a plain Error whose message is the session-expired constant maps the same way', () => {
  assert.equal(toUserMessage(new Error(SESSION_EXPIRED_ERROR_MESSAGE)), 'Your session expired. Please sign in again.');
});

test('429 maps to the rate-limit line', () => {
  assert.equal(
    toUserMessage(backendRpcError('Slow down.', 429)),
    'Too many attempts. Please wait a moment and try again.'
  );
});

test('5xx maps to the server-fault line', () => {
  assert.equal(
    toUserMessage(backendRpcError('column reference "restaurantId" is ambiguous', 500)),
    'Something went wrong on our side. Please try again in a moment.'
  );
});

test('5xx maps to the server-fault line even when the body is a short, safe-looking sentence', () => {
  // The 5xx / isUnparseableServerFailure check must run before the 4xx-safe
  // passthrough check, unconditionally -- a 500 must never pass server text
  // through verbatim just because it happens to look safe.
  assert.equal(
    toUserMessage(backendRpcError('This restaurant is paused right now.', 500)),
    'Something went wrong on our side. Please try again in a moment.'
  );
});

test('an HTML body maps to the server-fault line', () => {
  assert.equal(
    toUserMessage(new Error('<html><body>502 Bad Gateway</body></html>')),
    'Something went wrong on our side. Please try again in a moment.'
  );
});

test('the generated "Backend RPC ... failed with HTTP" fallback maps to the server-fault line', () => {
  assert.equal(
    toUserMessage(backendRpcError('Backend RPC customerSubmitOrderRating failed with HTTP 404.', 404)),
    'Something went wrong on our side. Please try again in a moment.'
  );
});

test('a TypeError from fetch maps to the unreachable line', () => {
  assert.equal(
    toUserMessage(new TypeError('Failed to fetch')),
    "Can't reach FEASTY right now. Check your connection and try again."
  );
});

test('a TypeError with an unrelated message does NOT map to the unreachable line', () => {
  // Being a TypeError is not itself evidence of a network problem -- only a
  // network-shaped message is. A generic client bug reaching toUserMessage
  // must fall to the generic line rather than misleadingly tell the user to
  // check their connection.
  assert.equal(
    toUserMessage(new TypeError("Cannot read properties of undefined (reading 'foo')")),
    'Something went wrong. Please try again.'
  );
});

for (const message of [
  'Network request failed',
  'failed to fetch',
  'Failed to send a request to the Edge Function',
  'load failed',
  'Network Error',
  'networkerror',
  'Request timed out',
  'Request timeout',
  'ECONNRESET',
  'getaddrinfo ENOTFOUND example.supabase.co',
]) {
  test(`transport-failure message "${message}" maps to the unreachable line`, () => {
    assert.equal(
      toUserMessage(new Error(message)),
      "Can't reach FEASTY right now. Check your connection and try again."
    );
  });
}

test('a NetworkError-named error (the choke point\'s own tagging) maps to the unreachable line', () => {
  const error = new Error('some raw transport detail');
  error.name = 'NetworkError';
  assert.equal(toUserMessage(error), "Can't reach FEASTY right now. Check your connection and try again.");
});

test('a FunctionsRelayError-named error maps to the unreachable line', () => {
  const error = new Error('Relay Error invoking the Edge Function');
  error.name = 'FunctionsRelayError';
  assert.equal(toUserMessage(error), "Can't reach FEASTY right now. Check your connection and try again.");
});

const SUPABASE_AUTH_CASES: Array<{ code?: string; message: string; expected: string }> = [
  { code: 'invalid_credentials', message: 'anything', expected: "That email or password isn't right." },
  { message: 'Invalid login credentials', expected: "That email or password isn't right." },
  { code: 'email_not_confirmed', message: 'anything', expected: 'Please confirm your email first. Check your inbox for the code.' },
  { message: 'Email not confirmed', expected: 'Please confirm your email first. Check your inbox for the code.' },
  { code: 'user_already_exists', message: 'anything', expected: 'An account with this email already exists. Try signing in instead.' },
  { message: 'User already registered', expected: 'An account with this email already exists. Try signing in instead.' },
  {
    code: 'weak_password',
    message: 'anything',
    expected: 'That password is too weak. Please choose a stronger one.',
  },
  {
    message: 'Password should be at least 6 characters',
    expected: 'That password is too weak. Please choose a stronger one.',
  },
  {
    code: 'over_email_send_rate_limit',
    message: 'anything',
    expected: 'Too many attempts. Please wait a moment and try again.',
  },
  {
    code: 'over_request_rate_limit',
    message: 'anything',
    expected: 'Too many attempts. Please wait a moment and try again.',
  },
  { message: 'Email rate limit exceeded', expected: 'Too many attempts. Please wait a moment and try again.' },
  { code: 'otp_expired', message: 'anything', expected: 'That code has expired. Request a new one.' },
  { message: 'Token has expired or is invalid', expected: 'That code has expired. Request a new one.' },
  { message: 'The otp has expired', expected: 'That code has expired. Request a new one.' },
  { message: 'Invalid otp entered', expected: "That code isn't right. Check it and try again." },
  { message: 'Invalid token provided', expected: "That code isn't right. Check it and try again." },
];

for (const { code, message, expected } of SUPABASE_AUTH_CASES) {
  test(`supabase auth error ${code ? `code "${code}"` : `message "${message}"`} maps correctly`, () => {
    assert.equal(toUserMessage(supabaseAuthError(message, code)), expected);
  });
}

test('code takes priority over message when both are present', () => {
  // The message alone would match "invalid ... token", but the code says
  // this is really an expired-password rejection.
  assert.equal(
    toUserMessage(supabaseAuthError('invalid token', 'weak_password')),
    'That password is too weak. Please choose a stronger one.'
  );
});

test('an unrecognized error falls back to the provided fallback, then the default', () => {
  assert.equal(toUserMessage(new Error('something obscure'), 'Custom fallback.'), 'Custom fallback.');
  assert.equal(toUserMessage(new Error('something obscure')), 'Something went wrong. Please try again.');
  assert.equal(toUserMessage(undefined), 'Something went wrong. Please try again.');
});

test('FRIENDLY_PASSTHROUGH constants pass through unchanged', () => {
  assert.ok(FRIENDLY_PASSTHROUGH.has(SESSION_EXPIRED_ERROR_MESSAGE));
  assert.equal(toUserMessage(new Error(SESSION_EXPIRED_ERROR_MESSAGE)), SESSION_EXPIRED_ERROR_MESSAGE);
});

test('isSafeServerMessage rejects internals and accepts deliberate copy', () => {
  assert.equal(isSafeServerMessage('This restaurant is paused right now.'), true);
  assert.equal(isSafeServerMessage(''), false);
  assert.equal(isSafeServerMessage('   '), false);
  assert.equal(isSafeServerMessage('x'.repeat(181)), false);
  assert.equal(isSafeServerMessage('line one\nline two'), false);
  assert.equal(
    isSafeServerMessage("Could not find the 'orderCount' column of 'OrderGroup' in the schema cache"),
    false
  );
  assert.equal(isSafeServerMessage('null value in column "x" violates not-null constraint'), false);
  assert.equal(isSafeServerMessage('relation "orders" does not exist'), false);
  assert.equal(isSafeServerMessage('syntax error at or near "SELECT"'), false);
  assert.equal(isSafeServerMessage('TypeError: Cannot read properties of undefined'), false);
  assert.equal(isSafeServerMessage('ReferenceError: x is not defined'), false);
  assert.equal(isSafeServerMessage('    at Object.<anonymous> (/app/index.js:1:1)'), false);
  assert.equal(isSafeServerMessage('Backend RPC foo failed with HTTP 500.'), false);
  assert.equal(isSafeServerMessage('<html><body>error</body></html>'), false);
});

test('shouldReportRpcFailure: DO NOT report a safe 4xx BackendRpcError', () => {
  assert.equal(shouldReportRpcFailure(backendRpcError('This restaurant is paused right now.', 412)), false);
});

test('shouldReportRpcFailure: DO NOT report a FRIENDLY_PASSTHROUGH message (e.g. session expiry)', () => {
  // Thrown as a plain, status-less Error (see resolveSession() in
  // backendRpc.ts) -- an expected outcome, not a fault, so it must not
  // become Sentry noise every time a session expires.
  assert.equal(shouldReportRpcFailure(new Error(SESSION_EXPIRED_ERROR_MESSAGE)), false);
});

test('shouldReportRpcFailure: DO report a 5xx BackendRpcError', () => {
  assert.equal(shouldReportRpcFailure(backendRpcError('internal failure', 500)), true);
});

test('shouldReportRpcFailure: DO report an unsafe-text 4xx BackendRpcError', () => {
  assert.equal(
    shouldReportRpcFailure(
      backendRpcError("Could not find the 'orderCount' column of 'OrderGroup' in the schema cache", 400)
    ),
    true
  );
});

test('shouldReportRpcFailure: DO report a transport failure', () => {
  const error = new Error('Failed to fetch');
  error.name = 'NetworkError';
  assert.equal(shouldReportRpcFailure(error), true);
});

test('leak test: no raw internals ever reach a user-facing message', () => {
  const rawInputs: unknown[] = [
    backendRpcError("Could not find the 'orderCount' column of 'OrderGroup' in the schema cache", 500),
    backendRpcError("Could not find the 'orderCount' column of 'OrderGroup' in the schema cache", 400),
    new Error('Backend RPC customerPlaceOrder failed with HTTP 500.'),
    new Error('Backend RPC customerPlaceOrder failed to send request.'),
    new Error('<!DOCTYPE html><html><body>502 Bad Gateway</body></html>'),
    new TypeError("Cannot read properties of undefined (reading 'foo')"),
    new Error('ReferenceError: foo is not defined'),
    new Error('    at Object.<anonymous> (/app/handlers/order.ts:42:17)'),
    backendRpcError('relation "OrderGroup" does not exist', 500),
    backendRpcError('null value in column "restaurantId" violates not-null constraint', 500),
    backendRpcError('syntax error at or near "SELECT"', 500),
    null,
    undefined,
    42,
    { random: 'object' },
    'a bare string error',
  ];

  const forbidden = ['Backend RPC', 'HTTP 5', '<html', 'column', 'schema cache', 'TypeError'];

  for (const input of rawInputs) {
    const message = toUserMessage(input);

    for (const banned of forbidden) {
      assert.ok(
        !message.includes(banned),
        `toUserMessage(${JSON.stringify(input)}) = ${JSON.stringify(message)} must not contain "${banned}"`
      );
    }

    assert.ok(!/at .+\(.+:\d+/.test(message), `toUserMessage output must not contain a stack frame: ${message}`);
  }
});
