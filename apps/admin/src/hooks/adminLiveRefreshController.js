export const createAdminLiveRefreshController = (refresh, options = {}) => {
  const debounceMs = Number.isFinite(options.debounceMs) ? Math.max(0, options.debounceMs) : 250;

  let disposed = false;
  let inFlight = false;
  let queued = false;
  let timeoutId = null;

  const clearTimer = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  const runRefresh = async () => {
    if (disposed) {
      return;
    }

    if (inFlight) {
      queued = true;
      return;
    }

    inFlight = true;

    try {
      await refresh();
    } finally {
      inFlight = false;

      if (disposed) {
        queued = false;
        return;
      }

      if (queued) {
        queued = false;
        schedule();
      }
    }
  };

  const schedule = () => {
    if (disposed) {
      return;
    }

    clearTimer();
    timeoutId = setTimeout(() => {
      timeoutId = null;
      void runRefresh();
    }, debounceMs);
  };

  const runNow = () => {
    if (disposed) {
      return;
    }

    clearTimer();
    void runRefresh();
  };

  const dispose = () => {
    disposed = true;
    queued = false;
    inFlight = false;
    clearTimer();
  };

  return {
    dispose,
    runNow,
    schedule,
  };
};
