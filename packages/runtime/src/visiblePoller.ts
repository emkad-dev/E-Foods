// Framework-free core of visibility-gated polling.
//
// The apps poll on fixed timers as a fallback behind realtime, but those timers
// used to run for as long as a component was mounted — including while the app
// was backgrounded or its tab hidden, where a fallback has nobody to serve. This
// controller owns the "only tick while visible" rule.
//
// It is deliberately free of React and of any platform API so it can be unit
// tested with `node --test`; `useVisiblePolling` is a thin wrapper over it and
// the per-app `useAppVisibility` adapters supply the visibility signal.

export type PollerTimers = {
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
};

const realTimers: PollerTimers = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

export type VisiblePoller = {
  /** Idempotent: only actual visibility changes have an effect. */
  setVisible: (next: boolean) => void;
  /** Clears the timer and returns to the unstarted state. */
  stop: () => void;
};

export const createVisiblePoller = (
  onTick: () => void,
  intervalMs: number,
  timers: PollerTimers = realTimers
): VisiblePoller => {
  let handle: unknown = null;
  // null means "not started yet", which is what distinguishes a first mount from
  // a hidden -> visible resume. Only the latter earns an immediate catch-up tick.
  let visible: boolean | null = null;

  const stopTimer = () => {
    if (handle !== null) {
      timers.clearInterval(handle);
      handle = null;
    }
  };

  return {
    setVisible: (next: boolean) => {
      if (visible === next) {
        return;
      }

      const wasHidden = visible === false;
      visible = next;

      if (!next) {
        stopTimer();
        return;
      }

      if (wasHidden) {
        onTick();
      }

      stopTimer();
      handle = timers.setInterval(onTick, intervalMs);
    },

    stop: () => {
      visible = null;
      stopTimer();
    },
  };
};
