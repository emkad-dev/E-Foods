/**
 * Client-side mirror of the `enableUserAccess` guard
 * (supabase/functions/_shared/domains/account.ts), so Access only offers Enable
 * when the server can honour it.
 *
 * Enable restores the account's last privileged role; it does not turn a
 * customer back on. The server answers 412 for any account whose
 * `lastPrivilegedRole` is not one of PRIVILEGED_APP_ROLES
 * (supabase/functions/_shared/accounts.ts), which in production is 13 of the
 * 14 disabled accounts. Showing the button on those rows produced a refusal on
 * every click.
 */
const PRIVILEGED_APP_ROLES: ReadonlySet<string> = new Set(['restaurant', 'dispatch', 'admin']);

export const ENABLE_UNAVAILABLE_REASON = 'No previous admin role to restore';

export const canRestoreAccess = (lastPrivilegedRole: string | null | undefined): boolean =>
  typeof lastPrivilegedRole === 'string' && PRIVILEGED_APP_ROLES.has(lastPrivilegedRole.trim());
