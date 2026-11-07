type FlushDependencies = {
  userId: string;
  readPendingUserId: () => Promise<string | null>;
  isStillCurrent: () => Promise<boolean>;
  record: () => Promise<unknown>;
  clearPending: () => Promise<unknown>;
};

export type PendingPolicyFlushResult = 'nothing-pending' | 'stale' | 'recorded';

/**
 * Records an acceptance given during sign-up once that account has a session.
 *
 * Consent is recorded against whoever's token the request carries, so this only
 * ever acts on an acceptance captured for `userId`, and re-checks that `userId`
 * still holds the session immediately before the write. Another account's pending
 * entry is left in place: it stays theirs for when they sign in.
 *
 * A failed write throws with the entry intact, so the next sign-in retries it.
 */
export const flushPendingPolicyAcceptance = async ({
  userId,
  readPendingUserId,
  isStillCurrent,
  record,
  clearPending,
}: FlushDependencies): Promise<PendingPolicyFlushResult> => {
  if ((await readPendingUserId()) !== userId) {
    return 'nothing-pending';
  }

  if (!(await isStillCurrent())) {
    return 'stale';
  }

  await record();
  await clearPending();
  return 'recorded';
};
