/**
 * Pure route-building for the auth prompt.
 *
 * Split out of `AuthPromptDialog.tsx` so the one piece of real logic in that
 * component — how `redirectTo` is attached to the `/login` and `/register`
 * hrefs — is testable under `node --test` without a React renderer.
 *
 * The shape produced here is the convention the customer app already uses
 * (`AuthPromptCard.tsx`, `AuthHeaderActions.tsx`, and the `redirectTo` param the
 * `/login` and `/register` screens read via `useLocalSearchParams`):
 *   `{ pathname: '/login', params: { redirectTo: '/home/restaurant/abc' } }`
 * The auth layout (`app/(auth)/_layout.tsx`) is the thing that finally consumes
 * the param, and it re-validates it — it drops redirects back to auth routes and
 * to the payment screens. This helper therefore only has to normalize, not
 * police: it trims, drops an empty value, and guarantees a leading slash so the
 * layout's own `AUTH_ROUTES` check sees a comparable path.
 */

export type AuthPromptTarget = 'signIn' | 'signUp';

export const AUTH_PROMPT_PATHNAMES: Record<AuthPromptTarget, string> = {
  signIn: '/login',
  signUp: '/register',
};

export type AuthPromptHref = {
  pathname: string;
  params?: { redirectTo: string };
};

/**
 * Builds the href for one of the prompt's two navigation actions.
 *
 * Omits `params` entirely when there is no usable `redirectTo`, rather than
 * sending `redirectTo: ''` — expo-router would serialize the empty param into
 * the URL and the auth layout would then have to special-case it.
 */
export function buildAuthPromptHref(
  target: AuthPromptTarget,
  redirectTo?: string | null
): AuthPromptHref {
  const pathname = AUTH_PROMPT_PATHNAMES[target];
  const trimmed = typeof redirectTo === 'string' ? redirectTo.trim() : '';

  if (!trimmed) {
    return { pathname };
  }

  const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;

  return { pathname, params: { redirectTo: normalized } };
}
