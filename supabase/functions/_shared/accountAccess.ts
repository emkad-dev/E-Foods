import { ClientSafeError } from './observability.ts';

export type AccountAccessProfile = {
  accountDisabled?: boolean | null;
  deletionRequestedAt?: string | null;
  email?: string | null;
  purgeScheduledAt?: string | null;
  role?: string | null;
  uid: string;
};

export type AccountAccessOptions = {
  /**
   * Escape hatch for actions a pending-deletion caller may still invoke.
   *
   * NOTHING IN PRODUCTION SETS THIS. The RPC dispatcher derives it from
   * `PENDING_DELETION_EXEMPT_ACTIONS` (rpc/actions.ts), which is empty, so
   * every action — including all of the notifications function — is refused
   * while a deletion is pending. The parameter is kept because the database
   * side of the 30-day grace period is live, and whoever activates it will
   * need this hook; see docs/account-deletion-design.md.
   *
   * (This doc comment previously claimed `cancelAccountDeletion` sets it.
   * That action has never existed.)
   */
  allowPendingDeletion?: boolean;
};

export const ACCOUNT_PENDING_DELETION_CODE = 'ACCOUNT_PENDING_DELETION';

/**
 * The access decision, kept pure so it can be tested without a database.
 * Disabled is checked first: a disabled account is refused even when the
 * pending-deletion exemption is in play.
 */
export const assertAccountAccessible = (
  profile: AccountAccessProfile,
  options: AccountAccessOptions = {}
): void => {
  if (profile.accountDisabled) {
    throw new ClientSafeError(403, 'This account is disabled.');
  }

  if (profile.deletionRequestedAt && options.allowPendingDeletion !== true) {
    throw new ClientSafeError(403, 'This account is scheduled for deletion.', {
      code: ACCOUNT_PENDING_DELETION_CODE,
      details: { purgeScheduledAt: profile.purgeScheduledAt ?? null },
    });
  }
};
