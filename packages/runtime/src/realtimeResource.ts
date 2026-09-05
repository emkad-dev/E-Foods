// Framework-free state machine behind `useRealtimeResource`. It owns three
// concerns that used to be duplicated, ad hoc, in every polling hook across
// the four apps:
//
//  1. A trailing-debounced refetch when the realtime channel reports a
//     `changed` broadcast (two events inside the window collapse to one
//     refetch).
//  2. A slow fallback poll that runs ONLY while the channel is not
//     `SUBSCRIBED` -- realtime is the transport now, polling is a safety net
//     for a dropped or never-established connection, not a steady drumbeat
//     running alongside it.
//  3. Visibility: going to the background clears every timer (nothing to
//     serve while nobody is looking), and a resume-to-visible fires one
//     immediate catch-up refetch, mirroring `visiblePoller`'s "returning to
//     visible ticks once" rule.
//
// It is deliberately free of React and of the Supabase client so it can be
// unit tested with `node --test` and reused regardless of whether the
// underlying subscription is a broadcast topic or (for the two
// customer-order screens, where RLS permits it) `postgres_changes` -- both
// just need to report status transitions and `changed` events through this
// same narrow interface.

export type RealtimeResourceTimers = {
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

const realTimers: RealtimeResourceTimers = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

// Collapses every real Supabase channel status (SUBSCRIBED, TIMED_OUT,
// CLOSED, CHANNEL_ERROR, the transient "joining" state before the first
// callback...) down to the one distinction this controller acts on: is the
// fallback poll needed right now, or not.
export type RealtimeChannelStatus = 'SUBSCRIBED' | 'DISCONNECTED';

export type RealtimeResourceController = {
  /** Reports the underlying channel's current status. Idempotent. */
  setChannelStatus: (status: RealtimeChannelStatus) => void;
  /** A `changed` broadcast arrived; schedules a debounced refetch. */
  notifyChanged: () => void;
  /** App foreground/background. Idempotent; clears every timer on `false`. */
  setVisible: (visible: boolean) => void;
  /** Full teardown (unmount). Clears every timer. */
  stop: () => void;
};

export const createRealtimeResourceController = (
  onRefetch: () => void,
  fallbackMs: number,
  debounceMs = 400,
  timers: RealtimeResourceTimers = realTimers
): RealtimeResourceController => {
  // null distinguishes "never told" from an observed 'DISCONNECTED'. Every
  // subscribe() implementation replays the channel's current status into
  // onStatusChange on join (see subscribeToRealtimeChanges), so the very
  // first status a fresh controller ever receives -- whether it's an
  // already-live shared topic reporting SUBSCRIBED synchronously, or a
  // first-time join reporting it moments later -- is not a reconnect, it's
  // the initial connection settling. Seeding status as 'DISCONNECTED' made
  // that first report look identical to a real DISCONNECTED->SUBSCRIBED
  // transition and fired a second, redundant onRefetch() right after the
  // mount-time load() already covered it. Only a transition away from a
  // *previously observed* non-null status counts as a genuine reconnect.
  let status: RealtimeChannelStatus | null = null;
  // null distinguishes "never told" from an explicit hidden/visible value, so
  // the first setVisible(true) call (mount) does not get treated as a
  // hidden -> visible resume and double-fire a catch-up refetch.
  let visible: boolean | null = null;
  let intervalHandle: unknown = null;
  let debounceHandle: unknown = null;

  const stopInterval = () => {
    if (intervalHandle !== null) {
      timers.clearInterval(intervalHandle);
      intervalHandle = null;
    }
  };

  const clearDebounce = () => {
    if (debounceHandle !== null) {
      timers.clearTimeout(debounceHandle);
      debounceHandle = null;
    }
  };

  // Starts the fallback interval only when all three hold: a real status
  // report has arrived (status !== null -- otherwise this would fire before
  // subscribe() has told us anything, guessing disconnected by default),
  // nobody is watching a confirmed-live channel (status !== SUBSCRIBED), and
  // the app is actually in the foreground. Safe to call repeatedly -- a live
  // interval is left alone.
  const ensureInterval = () => {
    if (visible !== true || status !== 'DISCONNECTED' || intervalHandle !== null) {
      return;
    }

    intervalHandle = timers.setInterval(onRefetch, fallbackMs);
  };

  return {
    setChannelStatus: (next) => {
      if (status === next) {
        return;
      }

      const previousStatus = status;
      status = next;

      if (status === 'SUBSCRIBED') {
        stopInterval();

        // A reconnect can straddle a broadcast nobody was joined to receive
        // (e.g. an order placed during a 15s Wi-Fi blip) -- the fallback
        // interval alone can't catch that, it only guards against staying
        // disconnected. One refetch per genuine transition-to-SUBSCRIBED
        // closes that gap, matching what the pre-B1 `.subscribe(status =>
        // status === 'SUBSCRIBED' && loadOrder())` code already did.
        // `previousStatus !== null` is what makes this a *genuine* reconnect
        // rather than the first-ever status report (see the `status` seed
        // comment above) -- without it, an ordinary cold mount that settles
        // straight to SUBSCRIBED would double-fetch: once from the caller's
        // own mount-time load(), once from here. Also skipped while hidden --
        // nothing to refresh for; the foreground catch-up in `setVisible`
        // covers it once someone is actually looking again.
        if (previousStatus !== null && visible === true) {
          onRefetch();
        }
      } else {
        ensureInterval();
      }
    },

    notifyChanged: () => {
      // A hidden screen can still be subscribed (the socket and JS keep
      // running in a backgrounded tab/app) and keep receiving `changed`
      // broadcasts. Arming a new debounce timer for each one would refetch
      // indefinitely for a tab nobody is looking at -- worse than the poll
      // this hook replaced, which at least stopped needing a foreground
      // check. The foreground-resume catch-up already covers whatever was
      // missed once someone returns.
      if (visible === false) {
        return;
      }

      clearDebounce();
      debounceHandle = timers.setTimeout(() => {
        debounceHandle = null;
        onRefetch();
      }, debounceMs);
    },

    setVisible: (next) => {
      if (visible === next) {
        return;
      }

      const wasHidden = visible === false;
      visible = next;

      if (!next) {
        stopInterval();
        clearDebounce();
        return;
      }

      if (wasHidden) {
        // Catch-up read so a returning user does not stare at data that went
        // stale while backgrounded.
        onRefetch();
      }

      ensureInterval();
    },

    stop: () => {
      visible = null;
      stopInterval();
      clearDebounce();
    },
  };
};
