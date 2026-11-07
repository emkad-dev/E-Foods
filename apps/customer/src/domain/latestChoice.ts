/**
 * "The customer's last choice wins" for the address screens.
 *
 * A GPS fix can take many seconds, and the customer may pick a search result
 * while it runs. Every choice (a pick, or starting a GPS request) takes a new
 * ticket; when the fix finally arrives it is applied only if its ticket is
 * still the latest, so a slow fix can never overwrite a place picked after it
 * was asked for.
 */
export type LatestChoice = {
  /** Records a new choice and returns its ticket. */
  next: () => number;
  /** Whether nothing has been chosen since this ticket was taken. */
  isLatest: (ticket: number) => boolean;
};

export const createLatestChoice = (): LatestChoice => {
  let latest = 0;
  return {
    next: () => {
      latest += 1;
      return latest;
    },
    isLatest: (ticket) => ticket === latest,
  };
};
