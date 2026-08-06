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
  let status: RealtimeChannelStatus = 'DISCONNECTED';
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

  // Starts the fallback interval only when both conditions hold: nobody is
  // watching a confirmed-live channel (status !== SUBSCRIBED) and the app is
  // actually in the foreground. Safe to call repeatedly -- a live interval is
  // left alone.
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

      status = next;

      if (status === 'SUBSCRIBED') {
        stopInterval();
      } else {
        ensureInterval();
      }
    },

    notifyChanged: () => {
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
