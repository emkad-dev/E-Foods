// The single-device claim that follows an interactive sign-in, and the guard that
// keeps the passive reconcile from racing it. Shared by customer and dispatch
// (partner is multi-device and has no claim).
//
// WHY THIS IS ITS OWN MODULE. The claim used to run inside signIn, in series
// with it. Moving it to the background made it a thing that can OUTLIVE the
// sign-in that started it, which brings three hazards, each handled here and
// each covered by deviceClaim.test.ts:
//
//   1. A stale claim must never write local state. `updateUserProfile` checks no
//      row count, so after sign-out and a sign-in as someone else, a late write
//      carrying the NEW user's JWT to the OLD user's row matches nothing and
//      returns `error: null`. Storing the old id locally then gives local idA +
//      remote idB, which the reconcile reads as a takeover and evicts the new
//      user with no other device involved. So every claim checks it is still the
//      current one before its retry and before its local store, and a stale claim
//      neither retries, stores nor reports.
//   2. A newer sign-in must not have its guard released by an older claim ending.
//   3. The next sign-in must not clear the local id while an older claim may
//      still be about to write it, but a stalled old claim must not hold sign-in
//      up either: it waits for the in-flight claim, capped.
//
// The ORDER inside a claim is load-bearing and unchanged: remote write first,
// then the local store. Local-new + remote-old evicts; a kill between the two
// leaves local empty, which adopts.

export const DEVICE_CLAIM_RETRY_DELAY_MS = 1_000;
export const DEVICE_CLAIM_WAIT_CAP_MS = 5_000;

export type DeviceClaimDeps = {
  createSessionId: () => string;
  /** Writes the id to the account row. Must reject on failure. */
  writeRemote: (userId: string, sessionId: string) => Promise<void>;
  storeLocal: (sessionId: string) => Promise<void>;
  /** Called with a claim's final failure, only while that claim is still current. */
  report: (error: unknown) => void;
  /** Injectable so tests need no real timers. */
  delay?: (ms: number) => Promise<void>;
};

export type SignInAttempt = {
  /** Starts the background claim. Resolves nothing; failures are reported, never thrown. */
  startClaim: (userId: string) => void;
  /**
   * Call from the sign-in's `finally`. Releases the guard if the claim never
   * started (the claim releases it itself otherwise) and only if this attempt is
   * still the current one.
   */
  release: () => void;
};

const realDelay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const createDeviceClaims = (deps: DeviceClaimDeps) => {
  const delay = deps.delay ?? realDelay;
  let currentAttempt = 0;
  let guardHeld = false;
  let inFlight: Promise<void> | null = null;

  const runClaim = async (attempt: number, userId: string) => {
    const isCurrent = () => currentAttempt === attempt;

    const claimOnce = async () => {
      // Checked BEFORE the write too, not only before the local store. An attempt
      // invalidated between beginSignIn and startClaim (a late null-session event
      // reaching clearLocalUserState) would otherwise write a new remote id while
      // the passive reconcile, which the dropped guard let through, adopted the
      // old one locally: local old + remote new evicts this device. Stale means
      // write nothing; local stays empty and adopts.
      if (!isCurrent()) {
        return;
      }
      const sessionId = deps.createSessionId();
      await deps.writeRemote(userId, sessionId);
      if (!isCurrent()) {
        return;
      }
      await deps.storeLocal(sessionId);
    };

    try {
      try {
        await claimOnce();
      } catch (firstFailure) {
        if (!isCurrent()) {
          return;
        }
        // Brief pause: the usual cause is a blip, and an instant second try
        // lands in the same one.
        await delay(DEVICE_CLAIM_RETRY_DELAY_MS);
        if (!isCurrent()) {
          return;
        }
        await claimOnce();
      }
    } catch (finalFailure) {
      if (isCurrent()) {
        deps.report(finalFailure);
      }
    } finally {
      if (isCurrent()) {
        guardHeld = false;
      }
    }
  };

  return {
    /** True while a sign-in or its background claim is in progress; the passive reconcile steps aside. */
    isGuardHeld: () => guardHeld,

    /**
     * Begins an interactive sign-in: supersedes any earlier claim, holds the
     * guard, and waits (at most DEVICE_CLAIM_WAIT_CAP_MS) for an earlier claim
     * that is mid-write to finish. Await this BEFORE clearing the stored device
     * id, so that clear cannot be undone by the older claim's local store.
     */
    beginSignIn: async (): Promise<SignInAttempt> => {
      currentAttempt += 1;
      const attempt = currentAttempt;
      guardHeld = true;
      let claimStarted = false;

      const earlier = inFlight;
      if (earlier) {
        await Promise.race([earlier, delay(DEVICE_CLAIM_WAIT_CAP_MS)]);
      }

      return {
        startClaim: (userId) => {
          claimStarted = true;
          inFlight = runClaim(attempt, userId);
        },
        release: () => {
          if (!claimStarted && currentAttempt === attempt) {
            guardHeld = false;
          }
        },
      };
    },

    /**
     * The session this claim belonged to is over (sign-out, eviction, expiry):
     * cancel it and drop the guard so nothing waits on a claim that no longer
     * means anything.
     */
    invalidate: () => {
      currentAttempt += 1;
      guardHeld = false;
    },
  };
};
