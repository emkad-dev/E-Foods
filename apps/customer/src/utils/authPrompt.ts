/**
 * Where a point-of-action sign-in should send the visitor back to.
 *
 * This module used to export `promptForAuth`, an `Alert.alert` wrapper. It was
 * deleted, not patched: in `react-native-web` `Alert` is
 * `class Alert { static alert() {} }` — an empty function — so on
 * app.feasty.com.ng that prompt never rendered and the tap that triggered it did
 * nothing at all. The replacement is `useAuthPrompt()` from
 * `@feasty/design-system`, which renders a real Modal on every platform and
 * carries `redirectTo`.
 *
 * What is left here is the one pure decision the callers share: which path to
 * come back to after signing in.
 */

/** Where a visitor lands when the current path is not a sane return target. */
export const DEFAULT_AUTH_REDIRECT = '/home';

/**
 * Resolves the `redirectTo` for a sign-in prompt raised from `pathname`.
 *
 * Mirrors what `AuthPromptCard` and `AuthHeaderActions` already do: return the
 * screen the visitor is standing on, unless that is the login screen itself (or
 * unknown), in which case send them to the home tab. The auth layout re-checks
 * the value and drops anything it will not honour, so this only has to pick a
 * sensible candidate.
 */
export const resolveAuthRedirectTo = (pathname: string | null | undefined): string => {
  const trimmed = typeof pathname === 'string' ? pathname.trim() : '';

  if (!trimmed || trimmed === '/login' || trimmed === '/register') {
    return DEFAULT_AUTH_REDIRECT;
  }

  return trimmed;
};
