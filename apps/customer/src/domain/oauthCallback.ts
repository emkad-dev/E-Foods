/**
 * What to do with whatever Supabase put in the URL when it sent an OAuth
 * visitor back to the app.
 *
 * WHY THIS IS A ROUTE OF ITS OWN. The Supabase client is built with
 * `detectSessionInUrl: false` (packages/auth/src/client.ts), so nothing reads
 * tokens or codes out of the URL automatically. That flag is not an oversight
 * and must not be flipped: with it on, the client's own URL handling raced the
 * app's deep-link effect and wedged /reset-password, /verify-email and
 * /payment/callback on the web build. The fix is one explicit exchange, on one
 * path nothing else touches -- this one -- rather than a global behaviour
 * change.
 *
 * WHY IT IS PURE. The decision (exchange / report the provider's refusal /
 * report an empty return) is the part that is easy to get wrong and impossible
 * to see, because the screen it drives is only reachable by coming back from
 * Google. The network call and the navigation stay in the route.
 */

/** The provider's own failure, handed to us in the query string. */
export type OAuthCallbackOutcome =
  | { kind: 'exchange'; code: string }
  | { kind: 'declined'; message: string }
  | { kind: 'empty' };

export type OAuthCallbackParams = {
  code?: string | string[] | null;
  error?: string | string[] | null;
  error_code?: string | string[] | null;
  error_description?: string | string[] | null;
};

const firstParam = (value: string | string[] | null | undefined): string | null => {
  const raw = Array.isArray(value) ? value[0] : value;

  if (typeof raw !== 'string') {
    return null;
  }

  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
};

/**
 * The one message the visitor sees when Google (or Supabase) refused.
 *
 * `error_description` is provider-controlled text. It is shown because a
 * generic "sign-in failed" leaves nobody -- user or operator -- able to tell
 * "you pressed Cancel" from "this project's OAuth client is misconfigured",
 * and those need completely different responses. It is capped and stripped of
 * newlines so a long or multi-line value cannot push the recovery links off
 * the screen; it is rendered as text by the route, never as markup.
 */
const MAX_PROVIDER_MESSAGE = 180;

const describeDecline = (params: OAuthCallbackParams): string => {
  const description = firstParam(params.error_description);
  const code = firstParam(params.error_code) ?? firstParam(params.error);

  if (description) {
    const flattened = description.replace(/\s+/g, ' ').trim();
    return flattened.length > MAX_PROVIDER_MESSAGE
      ? `${flattened.slice(0, MAX_PROVIDER_MESSAGE - 1)}…`
      : flattened;
  }

  // No description is common on a plain `access_denied`, which is what
  // pressing Cancel on Google's consent screen produces.
  if (code === 'access_denied') {
    return 'Google sign-in was cancelled.';
  }

  return code ? `Google sign-in failed (${code}).` : 'Google sign-in failed.';
};

/**
 * Reading order matters: a provider error wins over a code.
 *
 * Supabase can return both -- an `error` alongside a stale or partial `code`
 * -- and attempting the exchange first would replace the provider's specific
 * reason with a generic exchange failure, which is strictly less useful.
 */
export const resolveOAuthCallback = (params: OAuthCallbackParams): OAuthCallbackOutcome => {
  if (firstParam(params.error) || firstParam(params.error_code) || firstParam(params.error_description)) {
    return { kind: 'declined', message: describeDecline(params) };
  }

  const code = firstParam(params.code);

  if (code) {
    return { kind: 'exchange', code };
  }

  // Landing here with nothing at all means the page was opened directly, or
  // the return was stripped in transit. Either way there is no session coming,
  // and the screen must say so instead of spinning forever.
  return { kind: 'empty' };
};

/**
 * Where to send the visitor once the exchange succeeds.
 *
 * SECURITY: this value arrives in a URL that an attacker can compose and send
 * to someone -- the whole point of an open-redirect. Only same-origin paths
 * are honoured, and the fallback is /home.
 *
 *  - must start with a single `/`. `//evil.com` is protocol-relative and
 *    browsers treat it as an absolute URL to another host, so a bare
 *    `startsWith('/')` check is not enough.
 *  - `\` is rejected with it: some browsers normalise `/\evil.com` and
 *    `\\evil.com` the same way.
 *  - anything with a scheme (`https:`, `javascript:`, `data:`) is rejected by
 *    the same rule, since none of them start with `/`.
 *
 * The auth screens are excluded too: completing a sign-in and landing back on
 * /login is a loop, not a destination.
 */
const AUTH_PATHS = new Set(['/login', '/register', '/forgot-password', '/reset-password', '/verify-email']);

export const DEFAULT_OAUTH_DESTINATION = '/home';

export const resolveOAuthDestination = (value: string | string[] | null | undefined): string => {
  const raw = firstParam(value);

  if (!raw) {
    return DEFAULT_OAUTH_DESTINATION;
  }

  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) {
    return DEFAULT_OAUTH_DESTINATION;
  }

  if (raw.includes('\\')) {
    return DEFAULT_OAUTH_DESTINATION;
  }

  const [path] = raw.split(/[?#]/);

  if (AUTH_PATHS.has(path) || path === '/auth/callback') {
    return DEFAULT_OAUTH_DESTINATION;
  }

  return raw;
};
