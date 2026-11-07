// Coming back to the foreground is what retries a reconcile the network broke.
//
// WHY THIS EXISTS. When a reconcile fails on the network, the apps keep the
// Supabase session and show "No internet" (or, for a customer with nothing saved,
// stay a guest), waiting for the next reconcile to reach the server. On native,
// nothing starts one: auth-js only has a foreground listener in a browser, and the
// next auth event with a valid token can be about an hour away. So a rider or
// partner stayed on the login screen after the network was back.
//
// On web, auth-js's own visibility listener already emits an event on refocus.
// That event is noted here, so a refocus still reconciles only once there.
//
// Everything is decided here and the three AuthContexts only wire it to AppState
// and their reconcile queue; react-native stays out of this file so node can test it.

export const shouldCheckSessionOnForeground = ({
  previousState,
  nextState,
  isOffline,
  isSignInInProgress,
  isCheckInFlight,
}: {
  previousState: string | null | undefined;
  nextState: string;
  isOffline: boolean;
  isSignInInProgress: boolean;
  isCheckInFlight: boolean;
}): boolean =>
  nextState === 'active' && previousState !== 'active' && isOffline && !isSignInInProgress && !isCheckInFlight;

export const createForegroundSessionCheck = <TSession>({
  initialState,
  getSession,
  isOffline,
  isSignInInProgress,
  queueReconcile,
}: {
  initialState: string | null | undefined;
  getSession: () => Promise<{ data: { session: TSession | null } }>;
  /** The no-internet state, read at call time. False in normal use, so nothing runs. */
  isOffline: () => boolean;
  isSignInInProgress: () => boolean;
  /** The app's own reconcile queue, so this stays in order with auth events and outside the auth lock. */
  queueReconcile: (session: TSession) => void;
}) => {
  let appState = initialState;
  let isCheckInFlight = false;
  let authEventsSeen = 0;

  return {
    /** Call from the auth listener: that listener queues its own reconcile. */
    noteAuthEvent: () => {
      authEventsSeen += 1;
    },
    onAppStateChange: async (nextState: string) => {
      const previousState = appState;
      appState = nextState;

      if (
        !shouldCheckSessionOnForeground({
          previousState,
          nextState,
          isOffline: isOffline(),
          isSignInInProgress: isSignInInProgress(),
          isCheckInFlight,
        })
      ) {
        return;
      }

      isCheckInFlight = true;
      const authEventsBeforeCheck = authEventsSeen;

      try {
        const {
          data: { session },
        } = await getSession();

        // getSession can wait out a refresh, so the answer may be old news: a
        // refresh that worked already emitted an event (and queued a reconcile),
        // and a sign-in or sign-out may have started since.
        if (session && authEventsSeen === authEventsBeforeCheck && isOffline() && !isSignInInProgress()) {
          queueReconcile(session);
        }
      } catch {
        // Still no way through. The session is untouched; the next return to the
        // foreground asks again.
      } finally {
        isCheckInFlight = false;
      }
    },
  };
};
