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
   * Only `cancelAccountDeletion` sets this. Everything else must be refused
   * while a deletion is pending, including all of the notifications function.
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
