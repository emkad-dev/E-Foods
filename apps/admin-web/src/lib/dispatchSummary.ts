/**
 * The live rider figures at the top of Dispatch, counted from the roster.
 *
 * Pure: no imports, so it runs under plain `node --test`.
 */

export type RosterRiderLike = {
  online: boolean;
  activeLoad: number;
  verificationStatus: string;
};

export type RosterSummary = {
  total: number;
  /** The rider's app is pinging its location right now. */
  online: number;
  /** Riders with at least one order assigned to them. */
  carrying: number;
  /**
   * Riders still waiting for an approval decision. Only 'approved' riders can
   * be sent orders (riderEligibility.ts); 'rejected' ones were decided, so
   * they are not waiting for anyone.
   */
  awaitingApproval: number;
};

export const summarizeRoster = (riders: readonly RosterRiderLike[]): RosterSummary => {
  let online = 0;
  let carrying = 0;
  let awaitingApproval = 0;

  for (const rider of riders) {
    if (rider.online) online += 1;
    if (rider.activeLoad > 0) carrying += 1;
    const verification = rider.verificationStatus.toLowerCase();
    if (verification !== 'approved' && verification !== 'rejected') awaitingApproval += 1;
  }

  return { total: riders.length, online, carrying, awaitingApproval };
};

/**
 * Who owns an assignment, only when it says something. The assignment's
 * dispatchOwnerId is set to the courier it was given to, so a separate
 * "Dispatch owner" column repeated the courier's code on every row. It differs
 * only when an assignment changed hands, and that is the one case worth showing.
 */
export const distinctOwner = (assignment: { courierId: string | null; dispatchOwnerId: string | null }): string | null => {
  const owner = assignment.dispatchOwnerId?.trim() || null;
  return owner && owner !== (assignment.courierId?.trim() || null) ? owner : null;
};
