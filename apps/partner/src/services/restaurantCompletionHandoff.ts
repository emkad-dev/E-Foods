export type RestaurantCompletionAuthUser = {
  restaurantId?: string | null;
  restaurantName?: string | null;
  role?: string | null;
} | null;

export type RestaurantCompletionSubmissionResult = {
  restaurantId: string;
  submittedAt: string;
  targetUid: string;
};

export type WaitForRestaurantAccessResult =
  | {
      kind: 'ready';
      submittedRestaurantId: string | null;
    }
  | {
      kind: 'timeout';
      submittedRestaurantId: string | null;
    };

export type RunRestaurantCompletionHandoffResult = WaitForRestaurantAccessResult & {
  application: RestaurantCompletionSubmissionResult;
};

export type WaitForRestaurantAccessOptions = {
  getCurrentUser: () => RestaurantCompletionAuthUser;
  pollIntervalMs?: number;
  now?: () => number;
  refreshAuthSession: () => Promise<void>;
  sleep?: (milliseconds: number) => Promise<void>;
  submittedRestaurantId?: string | null;
  timeoutMs?: number;
};

export type RunRestaurantCompletionHandoffOptions = WaitForRestaurantAccessOptions & {
  onReady?: (application: RestaurantCompletionSubmissionResult) => Promise<void> | void;
  submitApplication: () => Promise<RestaurantCompletionSubmissionResult>;
};

export const RESTAURANT_ACCESS_WAIT_TIMEOUT_MS = 15_000;
export const RESTAURANT_ACCESS_POLL_INTERVAL_MS = 250;
export const RESTAURANT_ACCESS_WAITING_MESSAGE = 'Waiting for restaurant access to sync...';
export const RESTAURANT_ACCESS_TIMEOUT_MESSAGE =
  'Your details were saved, but restaurant access has not synced yet. Sign out and sign back in, then tap "Check access again".';

const defaultSleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const hasRestaurantAccess = (user: RestaurantCompletionAuthUser, submittedRestaurantId: string | null) => {
  if (!user || user.role !== 'restaurant') {
    return false;
  }

  if (submittedRestaurantId && user.restaurantId && user.restaurantId !== submittedRestaurantId) {
    return false;
  }

  return true;
};

export const waitForRestaurantAccess = async (
  options: WaitForRestaurantAccessOptions
): Promise<WaitForRestaurantAccessResult> => {
  const timeoutMs = options.timeoutMs ?? RESTAURANT_ACCESS_WAIT_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? RESTAURANT_ACCESS_POLL_INTERVAL_MS;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const submittedRestaurantId = options.submittedRestaurantId ?? null;
  const startedAt = now();

  try {
    await options.refreshAuthSession();
  } catch {
    // The screen keeps waiting because auth reconciliation can still land from
    // the background listener even if the refresh call itself fails.
  }

  while (now() - startedAt < timeoutMs) {
    if (hasRestaurantAccess(options.getCurrentUser(), submittedRestaurantId)) {
      return {
        kind: 'ready',
        submittedRestaurantId,
      };
    }

    await sleep(pollIntervalMs);
  }

  if (hasRestaurantAccess(options.getCurrentUser(), submittedRestaurantId)) {
    return {
      kind: 'ready',
      submittedRestaurantId,
    };
  }

  return {
    kind: 'timeout',
    submittedRestaurantId,
  };
};

export const runRestaurantCompletionHandoff = async (
  options: RunRestaurantCompletionHandoffOptions
): Promise<RunRestaurantCompletionHandoffResult> => {
  const application = await options.submitApplication();
  const waitResult = await waitForRestaurantAccess({
    getCurrentUser: options.getCurrentUser,
    now: options.now,
    pollIntervalMs: options.pollIntervalMs,
    refreshAuthSession: options.refreshAuthSession,
    sleep: options.sleep,
    submittedRestaurantId: options.submittedRestaurantId ?? application.restaurantId,
    timeoutMs: options.timeoutMs,
  });

  if (waitResult.kind === 'ready' && options.onReady) {
    await options.onReady(application);
  }

  return {
    ...waitResult,
    application,
  };
};
